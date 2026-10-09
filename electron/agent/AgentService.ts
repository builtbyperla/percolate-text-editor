import type { WebContents } from 'electron';
import type {
    AgentEvent,
    ApprovalMode,
    ContextStatsDTO,
    ControlResponsesDTO,
    SessionSnapshot,
    SessionSummary,
    UserInteractionDTO,
} from '../../shared/agentProtocol';
import { AGENT_CHANNELS } from '../ipcChannels';
import { AgentRuntime } from './AgentRuntime';
import { SessionRepository } from './SessionRepository';
import { AgentConfigStore } from './AgentConfigStore';
import { ToolRegistry } from './ToolRegistry';
import { VercelProviderAgent } from './VercelAgent';
import { firstMessageDisplayName, isUntitledSessionName } from '../../shared/sessionDisplayName';

export class AgentService {
    private runtimes = new Map<string, AgentRuntime>();
    private senders = new Map<string, WebContents>();
    private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        private readonly repository?: SessionRepository,
        private readonly config?: AgentConfigStore,
        private readonly createTools?: () => ToolRegistry,
    ) {}

    create(sender: WebContents, agent?: string): SessionSummary {
        const runtime = this.makeRuntime(undefined, sender);
        runtime.snapshot.agent = agent ?? this.config?.get().provider ?? runtime.snapshot.agent;
        this.repository?.save(runtime.snapshot);
        return runtime.snapshot;
    }

    list(): SessionSummary[] {
        return this.repository?.list() ?? [...this.runtimes.values()].map(runtime => runtime.snapshot);
    }

    load(id: string, sender?: WebContents): SessionSnapshot {
        const runtime = this.runtime(id, sender);
        return structuredClone(runtime.snapshot);
    }

    fork(id: string, sender: WebContents, throughBlockId?: string): SessionSnapshot {
        if (!this.repository) throw new Error('Session persistence is unavailable.');
        const snapshot = this.repository.fork(id, throughBlockId);
        this.makeRuntime(snapshot, sender);
        return snapshot;
    }

    rename(id: string, displayName: string): SessionSummary {
        const name = displayName.trim();
        if (!name) throw new Error('Session name cannot be empty.');
        const runtime = this.runtime(id);
        runtime.snapshot.displayName = name;
        runtime.snapshot.updatedAt = Date.now();
        this.repository?.save(runtime.snapshot);
        return runtime.snapshot;
    }

    archive(id: string): void {
        const runtime = this.runtime(id);
        runtime.snapshot.archived = true;
        runtime.snapshot.updatedAt = Date.now();
        this.repository?.save(runtime.snapshot);
    }

    async send(input: UserInteractionDTO) {
        const support = this.attachmentSupport();
        const files = input.attachments ?? [];
        if (files.length) {
            if (!support) throw new Error('This agent does not support file attachments.');
            let total = 0;
            for (const file of files) {
                if (!support.mediaTypes.includes(file.mediaType)) throw new Error(`Unsupported attachment type: ${file.mediaType}`);
                if (!file.name || file.name.length > 255 || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > support.maxFileBytes) throw new Error(`Attachment is invalid or too large: ${file.name}`);
                if (typeof file.data !== 'string' || file.data.length > Math.ceil(support.maxFileBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data) || Buffer.byteLength(file.data, 'base64') !== file.size) throw new Error(`Attachment data is invalid: ${file.name}`);
                total += file.size;
            }
            if (total > support.maxTotalBytes) throw new Error('Attachments exceed the total size limit.');
        }
        const runtime = this.runtime(input.sessionId);
        if (files.length && ['CALLING_AGENT', 'RUNNING_TOOL', 'CANCELLING', 'PAUSED'].includes(runtime.snapshot.state)) {
            throw new Error('Wait for the current agent turn to finish before sending attachments.');
        }
        const firstMessage = !runtime.snapshot.messages.some(message => message.role === 'user');
        await runtime.send(input);
        if (firstMessage && isUntitledSessionName(runtime.snapshot.displayName)) {
            const names = this.repository?.displayNames() ?? [...this.runtimes.values()].map(item => item.snapshot.displayName);
            const ownName = runtime.snapshot.displayName;
            const ownIndex = names.indexOf(ownName);
            if (ownIndex >= 0) names.splice(ownIndex, 1);
            runtime.snapshot.displayName = firstMessageDisplayName(input.text, names, ownName) ?? ownName;
        }
        this.save(runtime);
        return { accepted: true } as const;
    }

    attachmentSupport() {
        return this.config ? VercelProviderAgent.messageInterfaceFor(this.config.get()).attachmentSupport : undefined;
    }

    async respond(input: ControlResponsesDTO) {
        const runtime = this.runtime(input.sessionId);
        await runtime.respond(input);
        this.save(runtime);
        return { accepted: true } as const;
    }

    async cancel(id: string) {
        const runtime = this.runtime(id);
        await runtime.cancel();
        this.save(runtime);
    }

    async stop(id: string) {
        const runtime = this.runtime(id);
        await runtime.stop();
        this.save(runtime);
    }

    async undo(id: string, toolCallId: string) {
        const runtime = this.runtime(id);
        await runtime.undo(toolCallId);
        this.save(runtime);
    }

    readFileEdit(sessionId: string, artifactId: string) {
        return this.runtime(sessionId).readFileEdit(artifactId);
    }

    async updateFileEdit(sessionId: string, artifactId: string, revision: number, content: string) {
        const runtime = this.runtime(sessionId);
        const ref = await runtime.updateFileEdit(artifactId, revision, content);
        this.save(runtime);
        return ref;
    }

    contextStats(id: string): ContextStatsDTO {
        return this.runtime(id).getContextStats();
    }

    compact(id: string): SessionSnapshot {
        const runtime = this.runtime(id);
        const snapshot = runtime.compact();
        this.save(runtime);
        return snapshot;
    }

    setPaused(id: string, paused: boolean) {
        const runtime = this.runtime(id);
        runtime.setPaused(paused);
        this.save(runtime);
    }

    setApprovalMode(id: string, mode: ApprovalMode) {
        const runtime = this.runtime(id);
        runtime.setApprovalMode(mode);
        this.save(runtime);
    }

    close(): void {
        for (const timer of this.saveTimers.values()) clearTimeout(timer);
        for (const runtime of this.runtimes.values()) {
            runtime.dispose();
            this.repository?.save(runtime.snapshot);
        }
        this.repository?.close();
    }

    private runtime(id: string, sender?: WebContents): AgentRuntime {
        const existing = this.runtimes.get(id);
        if (existing) {
            if (sender) this.senders.set(id, sender);
            return existing;
        }

        const snapshot = this.repository?.load(id);
        if (!snapshot) throw new Error('Unknown agent session.');
        return this.makeRuntime(snapshot, sender);
    }

    private makeRuntime(snapshot: SessionSnapshot | undefined, sender?: WebContents): AgentRuntime {
        const id = snapshot?.id;
        const config = this.config;
        const getSettings = config ? () => config.resolve() : undefined;
        const runtime = new AgentRuntime(
            id,
            event => this.onEvent(event),
            this.createTools?.(),
            snapshot,
            getSettings,
        );
        this.runtimes.set(runtime.snapshot.id, runtime);
        if (snapshot) this.repository?.save(runtime.snapshot);
        if (sender) this.senders.set(runtime.snapshot.id, sender);
        return runtime;
    }

    private onEvent(event: AgentEvent): void {
        const sender = this.senders.get(event.sessionId);
        if (sender && !sender.isDestroyed()) {
            sender.send(`${AGENT_CHANNELS.event}${event.sessionId}`, event);
        }

        const runtime = this.runtimes.get(event.sessionId);
        if (!runtime || !this.repository) return;

        if (event.type === 'text-delta') {
            if (this.saveTimers.has(event.sessionId)) return;
            this.saveTimers.set(event.sessionId, setTimeout(() => {
                this.saveTimers.delete(event.sessionId);
                this.save(runtime);
            }, 250));
        } else {
            this.save(runtime);
        }
    }

    private save(runtime: AgentRuntime): void {
        this.repository?.save(runtime.snapshot);
    }
}
