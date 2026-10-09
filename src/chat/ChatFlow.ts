import { Accessor, Setter, createSignal } from 'solid-js';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import { createSingleSnapshot, prepareEvidenceSnapshot } from '../interactions/EvidenceSnapshotBuilder';
import { currentEvidenceGroups } from '../interactions/EvidenceTree';
import type { ContextItem } from '../annotation/ContextItem';
import type { AgentClient } from '../agent/AgentClient';
import type { AgentEvent, ApprovalMode, AttachmentDTO, AttachmentSupportDTO, ContextStatsDTO, ControlAction, FileEditRefDTO, SessionSnapshot, SteeringPolicy } from '../../shared/agentProtocol';
import { ChatBlockStore, EvidenceGroupSnapshot, ToolBlock } from './ChatBlockModel';
import { FileEditBuffer } from './FileEditBuffer';

export class ChatFlow {
    store = new ChatBlockStore();
    getStreaming: Accessor<boolean>; private setStreaming: Setter<boolean>;
    getSessionId: Accessor<string | undefined>; private setSessionId: Setter<string | undefined>;
    getSteeringPolicy: Accessor<SteeringPolicy>; setSteeringPolicy: Setter<SteeringPolicy>;
    getApprovalMode: Accessor<ApprovalMode>; private setApprovalModeSignal: Setter<ApprovalMode>;
    getError: Accessor<string | undefined>; private setError: Setter<string | undefined>;
    getContextStats: Accessor<ContextStatsDTO | undefined>; private setContextStats: Setter<ContextStatsDTO | undefined>;
    getAttachmentSupport: Accessor<AttachmentSupportDTO | undefined>; private setAttachmentSupport: Setter<AttachmentSupportDTO | undefined>;
    onTurnPosted?: () => void;
    onSessionChanged?: () => void;
    onFileEditSettled?: (sessionId: string, artifactId: string) => void;
    private fileEditBuffers = new Map<string, FileEditBuffer>();
    private disposeEvents?: () => void;

    constructor(private readonly client: AgentClient) {
        [this.getStreaming, this.setStreaming] = createSignal(false);
        [this.getSessionId, this.setSessionId] = createSignal();
        [this.getSteeringPolicy, this.setSteeringPolicy] = createSignal<SteeringPolicy>('QUEUE');
        [this.getApprovalMode, this.setApprovalModeSignal] = createSignal<ApprovalMode>('ask');
        [this.getError, this.setError] = createSignal();
        [this.getContextStats, this.setContextStats] = createSignal();
        [this.getAttachmentSupport, this.setAttachmentSupport] = createSignal();
    }
    get getMessages() { return this.store.getBlocks; }
    get available() { return this.client.available; }
    reportError(message: string) { this.setError(message); }
    async refreshAttachmentSupport(): Promise<void> {
        try { this.setAttachmentSupport(await this.client.attachmentSupport?.()); }
        catch { this.setAttachmentSupport(); }
    }
    async initialize(): Promise<void> {
        if (!this.client.available) { this.setError('Agent runtime is unavailable in this browser.'); return; }
        try {
            await this.refreshAttachmentSupport();
            const sessions = await this.client.listSessions();
            const session = sessions[0] ?? await this.client.createSession();
            await this.openSession(session.id);
        } catch (error) { this.setError(error instanceof Error ? error.message : 'Unable to initialize the agent.'); }
    }
    async listSessions() { return this.client.listSessions(); }
    async createSession() { const s = await this.client.createSession(); await this.openSession(s.id); return s; }
    async openSession(id: string): Promise<void> {
        const snapshot = await this.client.loadSession(id);
        this.hydrate(snapshot); this.disposeEvents?.();
        this.disposeEvents = this.client.onEvent(id, event => this.applyAgentEvent(event));
        await this.refreshContextStats();
    }
    async forkSession(id: string, throughBlockId?: string): Promise<boolean> {
        try { const snapshot = await this.client.forkSession(id, throughBlockId); await this.openSession(snapshot.id); return true; }
        catch (error) { this.setError(error instanceof Error ? error.message : 'Unable to fork session.'); return false; }
    }
    async renameSession(id: string, displayName: string): Promise<boolean> {
        try { await this.client.renameSession(id, displayName); return true; }
        catch (error) { this.setError(error instanceof Error ? error.message : 'Unable to rename session.'); return false; }
    }
    async archiveSession(id: string): Promise<boolean> {
        try {
            await this.client.archiveSession(id);
            if (id === this.getSessionId()) {
                const next = (await this.client.listSessions())[0] ?? await this.client.createSession();
                await this.openSession(next.id);
            }
            return true;
        } catch (error) { this.setError(error instanceof Error ? error.message : 'Unable to archive session.'); return false; }
    }
    private hydrate(snapshot: SessionSnapshot) { this.setSessionId(snapshot.id); this.setSteeringPolicy(snapshot.steeringPolicy); this.setApprovalModeSignal(snapshot.approvalMode); this.store.replaceAll(snapshot.messages.flatMap(message => message.blocks)); }
    async setApprovalMode(mode: ApprovalMode): Promise<void> {
        const id = this.getSessionId(); if (!id) return;
        try { await this.client.setApprovalMode(id, mode); this.setApprovalModeSignal(mode); }
        catch (error) { this.setError(error instanceof Error ? error.message : 'Unable to change agent mode.'); }
    }
    async send(text: string, responses?: Record<string, ControlAction>, attachments: AttachmentDTO[] = []): Promise<boolean> {
        const trimmed = text.trim(); if (!this.getSessionId() || !this.client.available) return false;
        const { groups, consumed } = prepareEvidenceSnapshot(currentEvidenceGroups());
        // A turn may consist entirely of selected context. Only reject when
        // there is neither user-authored text nor evidence to send.
        if (!trimmed && groups.length === 0 && attachments.length === 0) return false;
        return this.sendSnapshotToAgent(trimmed, groups, consumed, responses, attachments);
    }
    async sendContextItem(text: string, item: ContextItem): Promise<boolean> {
        const trimmed = text.trim(); if (!trimmed || !this.getSessionId() || !this.client.available) return false;
        const { groups, consumed } = createSingleSnapshot(item, currentEvidenceGroups());
        return this.sendSnapshotToAgent(trimmed, groups, consumed);
    }
    private async sendSnapshotToAgent(text: string, groups: EvidenceGroupSnapshot[], consumed: ContextItem[], responses?: Record<string, ControlAction>, attachments: AttachmentDTO[] = []): Promise<boolean> {
        const sessionId = this.getSessionId(); if (!sessionId) return false;
        try {
            await this.flushFileEdits(sessionId);
            await this.client.send({ sessionId, text, evidence: groups.length ? groups : undefined, attachments: attachments.length ? attachments : undefined, steeringPolicy: this.getSteeringPolicy(), responses });
            for (const item of consumed) {
                if (sourceContextRegistry.itemsFor(item.groupKey()).includes(item)) {
                    sourceContextRegistry.remove(item);
                } else {
                    // Whole-file selections register directly with the evidence pane.
                    // Let their owner reset its selection and note state as well.
                    const owner = item.view as typeof item.view & { clear?: () => void };
                    if (typeof owner.clear === 'function') owner.clear();
                    else item.deregister();
                }
            }
            this.onTurnPosted?.(); this.onSessionChanged?.(); return true;
        } catch (error) { this.setError(error instanceof Error ? error.message : 'Unable to send message.'); return false; }
    }
    async cancel(): Promise<void> { const id = this.getSessionId(); if (id) await this.client.cancel(id); }
    async stop(): Promise<void> { const id = this.getSessionId(); if (id) { await this.flushFileEdits(id); await this.client.stop(id); } }
    async compact(): Promise<boolean> {
        const id = this.getSessionId(); if (!id) return false;
        try { this.hydrate(await this.client.compact(id)); await this.refreshContextStats(); return true; }
        catch (error) { this.setError(error instanceof Error ? error.message : 'Unable to compact session context.'); return false; }
    }
    async undo(toolCallId: string): Promise<void> {
        const id = this.getSessionId(); if (!id) return;
        try { await this.client.undo(id, toolCallId); }
        catch (error) { this.setError(error instanceof Error ? error.message : 'Unable to undo file write.'); }
    }
    fileEditBuffer(ref: FileEditRefDTO): FileEditBuffer {
        const sessionId = this.getSessionId();
        if (!sessionId) throw new Error('No active agent session.');
        const key = `${sessionId}:${ref.artifactId}`;
        let buffer = this.fileEditBuffers.get(key);
        if (!buffer) {
            buffer = new FileEditBuffer(sessionId, ref, this.client);
            this.fileEditBuffers.set(key, buffer);
            void buffer.load().then(() => {
                if (buffer?.getContent()?.settled) this.fileEditBuffers.delete(key);
            }).catch(error => this.setError(error instanceof Error ? error.message : 'Unable to load file edit.'));
        }
        return buffer;
    }
    private async flushFileEdits(sessionId: string): Promise<void> {
        await Promise.all([...this.fileEditBuffers.values()].filter(buffer => buffer.sessionId === sessionId).map(buffer => buffer.flush()));
    }
    async respond(toolCallId: string, action: ControlAction): Promise<boolean> {
        return this.respondAll({ [toolCallId]: action });
    }
    async respondAll(responses: Record<string, ControlAction>): Promise<boolean> {
        const sessionId = this.getSessionId(); if (!sessionId) return false;
        try { await this.flushFileEdits(sessionId); await this.client.respond({ sessionId, responses }); return true; }
        catch (error) { this.setError(error instanceof Error ? error.message : 'Unable to respond to tool request.'); return false; }
    }
    private applyAgentEvent(event: AgentEvent): void {
        switch (event.type) {
            case 'file-edit-updated': {
                const block = this.store.getBlocks().find(candidate => candidate instanceof ToolBlock && candidate.getFileEdit()?.artifactId === event.artifactId) as ToolBlock | undefined;
                if (block?.getFileEdit()) this.store.applyUpdate({ blockId: block.id, fileEdit: { ...block.getFileEdit()!, revision: event.revision } });
                const buffer = this.fileEditBuffers.get(`${event.sessionId}:${event.artifactId}`);
                if (buffer) void buffer.load().catch(() => {});
                break;
            }
            case 'text-start': this.store.applyUpdate({ blockId: event.messageId, role: event.role, origin: event.origin, evidence: event.evidence, attachments: event.attachments }); break;
            case 'text-delta': this.store.applyUpdate({ blockId: event.messageId, delta: event.delta }); break;
            case 'text-end': this.store.applyUpdate({ blockId: event.messageId, done: true, status: event.status }); void this.refreshContextStats(); break;
            case 'tool-start': this.store.applyUpdate({ blockId: event.call.id, kind: 'tool', role: 'assistant', toolCallId: event.call.toolCallId, type: event.call.type, subject: event.call.subject, input: event.call.input, status: event.call.status, controlAction: event.call.controlAction, approval: event.call.approval, fileEdit: event.call.fileEdit, userModified: event.call.userModified }); break;
            case 'tool-delta': this.store.applyUpdate({ blockId: event.toolCallId, kind: 'tool', toolCallId: event.toolCallId, delta: event.delta }); break;
            case 'tool-end': {
                this.store.applyUpdate({ blockId: event.response.id, kind: 'tool', toolCallId: event.response.toolCallId, type: event.response.type, subject: event.response.subject, output: event.response.output, status: event.response.status, controlAction: event.response.controlAction, approval: event.response.approval, fileEdit: event.response.fileEdit, userModified: event.response.userModified, done: true });
                if (event.response.fileEdit) {
                    const key = `${event.sessionId}:${event.response.fileEdit.artifactId}`;
                    const buffer = this.fileEditBuffers.get(key);
                    if (buffer) void buffer.load().then(() => this.fileEditBuffers.delete(key)).catch(() => {});
                    if (event.response.status === 'done' || event.response.status === 'rejected' || event.response.status === 'skipped') {
                        this.onFileEditSettled?.(event.sessionId, event.response.fileEdit.artifactId);
                    }
                }
                void this.refreshContextStats();
                break;
            }
            case 'runtime-state': this.setStreaming(event.state === 'CALLING_AGENT' || event.state === 'RUNNING_TOOL' || event.state === 'CANCELLING'); break;
            case 'runtime-error': this.setError(event.message); this.setStreaming(false); break;
        }
    }
    private async refreshContextStats(): Promise<void> {
        const id = this.getSessionId(); if (!id) { this.setContextStats(); return; }
        try { this.setContextStats(await this.client.contextStats(id)); }
        catch { /* Context stats are supplementary; session use should remain available. */ }
    }
}
let activeFlow: ChatFlow | null = null;
export function setAgentFlow(flow: ChatFlow) { activeFlow = flow; }
export async function sendToAgent(text: string, item: ContextItem): Promise<boolean> { return activeFlow?.sendContextItem(text, item) ?? false; }
export function formatDiffEvidence(additionalData: unknown): string | null { const d = additionalData as { diff?: { oldText: string; newText: string } } | undefined; return d?.diff ? `--- old\n${d.diff.oldText}\n+++ new\n${d.diff.newText}` : null; }
