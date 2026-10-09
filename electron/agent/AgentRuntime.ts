import { randomUUID } from 'node:crypto';
import type {
    AgentEvent,
    ApprovalMode,
    ContextStatsDTO,
    ControlAction,
    ControlResponsesDTO,
    MessageDTO,
    RuntimeState,
    SessionSnapshot,
    ToolBlockDTO,
    UserInteractionDTO,
} from '../../shared/agentProtocol';
import { ToolRegistry } from './ToolRegistry';
import { VercelProviderAgent } from './VercelAgent';
import { DebugProviderAgent } from './DebugAgent';
import type { Agent } from './Agent';
import type { ResolvedAgentSettings } from './AgentConfigStore';
import { activeContextMessages, compactContext, contextStats } from './SessionContext';
import { evaluateToolPolicy, toolAvailableToProvider } from './ApprovalPolicy';
import { parseAskQuestionInput, validateQuestionAnswer } from '../../shared/agentQuestion';

interface DeferredWork {
    input?: UserInteractionDTO;
    callOnly?: boolean;
}

interface PendingTool {
    block: ToolBlockDTO;
    name: string;
    input: unknown;
}

interface ProviderToolCall {
    id: string;
    name: string;
    input: unknown;
}

export class AgentRuntime {
    readonly snapshot: SessionSnapshot;
    private controller?: AbortController;
    private deferred: DeferredWork[] = [];
    private pendingTools = new Map<string, PendingTool>();
    private approvalTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private pauseRequested = false;
    private activeRun?: Promise<void>;
    private activeToolControllers = new Set<AbortController>();
    private activeToolRuns = new Set<Promise<void>>();
    private stepsSinceUser = 0;
    private stopGeneration = 0;

    constructor(
        id: string = randomUUID(),
        private readonly emit: (event: AgentEvent) => void,
        private readonly tools = new ToolRegistry(process.cwd(), process.env.AGENT_MODE === 'stub'),
        initial?: SessionSnapshot,
        private readonly getSettings?: () => Promise<ResolvedAgentSettings>,
    ) {
        const now = Date.now();
        this.snapshot = initial ?? {
            id,
            agent: process.env.AGENT_MODE === 'stub' ? 'stub' : 'openai',
            displayName: 'New session',
            archived: false,
            state: 'IDLE' as RuntimeState,
            createdAt: now,
            updatedAt: now,
            messages: [],
            steeringPolicy: 'QUEUE' as const,
            approvalMode: parseApprovalMode(process.env.AGENT_APPROVAL_MODE),
        };

        for (const message of this.snapshot.messages) {
            for (const block of message.blocks) {
                if (block.kind === 'tool' && block.status === 'pending') {
                    if (block.approval?.kind === 'timed' && block.approval.autoApproveAt <= now) {
                        // Do not auto-execute a deadline that elapsed while the
                        // app was closed and the user could not observe it.
                        block.approval = undefined;
                        this.snapshot.updatedAt = now;
                    }
                    this.pendingTools.set(block.toolCallId, {
                        block,
                        name: block.type,
                        input: block.input,
                    });
                }
            }
        }
        for (const [toolCallId, pending] of this.pendingTools) {
            if (pending.block.approval?.kind === 'timed') {
                this.armApprovalTimer(toolCallId, pending.block.approval.autoApproveAt - now);
            }
        }
        if (this.pendingTools.size > 0) this.snapshot.state = 'WAITING_FOR_CONTROL';
    }

    async send(input: UserInteractionDTO): Promise<void> {
        await this.resolveControls(input.responses ?? {}, true);
        if (this.controller) {
            if (input.steeringPolicy === 'QUEUE') {
                this.deferred.push({ input });
            } else if (input.steeringPolicy === 'APPEND') {
                this.recordUser(input);
                this.deferred.push({ callOnly: true });
            } else {
                this.deferred.unshift({ input });
                this.setState('CANCELLING');
                this.controller.abort();
            }
            return;
        }
        this.recordUser(input);
        this.startCall();
    }

    async respond(input: ControlResponsesDTO): Promise<void> {
        const generation = this.stopGeneration;
        const resolved = await this.resolveControls(input.responses, false);
        if (resolved && generation === this.stopGeneration && !this.controller && this.pendingTools.size === 0) {
            this.startCall();
        }
    }

    async cancel(): Promise<void> {
        if (!this.controller) return;
        this.setState('CANCELLING');
        this.controller.abort();
        await this.activeRun;
    }

    async stop(): Promise<void> {
        // Stop ends the entire turn. Unlike cancel/Break, deferred steering is
        // discarded and pending approvals cannot resume the stopped turn.
        this.stopGeneration++;
        this.deferred = [];
        for (const controller of this.activeToolControllers) controller.abort();
        if (this.controller) {
            this.setState('CANCELLING');
            this.controller.abort();
            await this.activeRun;
        }
        await Promise.allSettled([...this.activeToolRuns]);
        for (const [id, pending] of [...this.pendingTools]) {
            this.pendingTools.delete(id);
            this.clearApprovalTimer(id);
            const action = { kind: 'skipped', reason: 'Stopped by user.' } as const;
            pending.block.controlAction = action;
            if (pending.block.fileEdit) pending.block.userModified = await this.tools.settleFileEdit(pending.block.fileEdit.artifactId);
            this.finishTool(pending.block, 'skipped', action.reason);
        }
        if (this.snapshot.state !== 'FAILED') this.setState('IDLE');
    }

    async undo(toolCallId: string): Promise<void> {
        if (this.controller || this.activeToolRuns.size > 0) {
            throw new Error('Wait for the active operation before undoing a file write.');
        }
        const original = this.snapshot.messages.flatMap(message => message.blocks)
            .find(block => block.kind === 'tool' && block.toolCallId === toolCallId);
        if (
            !original
            || original.kind !== 'tool'
            || !['write_file', 'edit_file'].includes(original.type)
            || original.status !== 'done'
        ) {
            throw new Error('Only a completed file write or edit can be undone.');
        }
        if (original.output?.includes('undoStatus: undone')) throw new Error('This file write has already been undone.');
        const operationId = original.output?.match(/undoOperationId: ([0-9a-f-]{36})/i)?.[1];
        if (!operationId) throw new Error('This file write does not have undo metadata.');

        const id = randomUUID();
        const block: ToolBlockDTO = {
            id,
            kind: 'tool',
            role: 'assistant',
            toolCallId: id,
            type: 'undo_file_write',
            subject: original.subject,
            input: { operationId },
            status: 'running',
            controlAction: { kind: 'approved' },
        };
        this.snapshot.messages.push({
            id: randomUUID(),
            role: 'assistant',
            status: 'done',
            blocks: [block],
            createdAt: Date.now(),
        });
        this.emit({ type: 'tool-start', sessionId: this.snapshot.id, call: block });
        await this.executeControlledTool(block, 'undo_file_write', block.input);
        if (block.status === 'done') {
            original.output = `${original.output}\nundoStatus: undone`;
            this.emit({
                type: 'tool-end',
                sessionId: this.snapshot.id,
                response: {
                    id: original.id,
                    toolCallId: original.toolCallId,
                    type: original.type,
                    subject: original.subject,
                    output: original.output,
                    status: original.status,
                    controlAction: original.controlAction,
                },
            });
        }
        if (this.snapshot.state !== 'FAILED') this.setState('IDLE');
    }

    async readFileEdit(artifactId: string) {
        this.requireFileEdit(artifactId);
        return this.tools.readFileEdit(artifactId);
    }

    async updateFileEdit(artifactId: string, revision: number, content: string) {
        const block = this.requireFileEdit(artifactId);
        if (block.status !== 'pending') throw new Error('This file edit is no longer pending.');
        const ref = await this.tools.updateFileEdit(artifactId, revision, content);
        block.fileEdit = ref;
        this.emit({ type: 'file-edit-updated', sessionId: this.snapshot.id, artifactId, revision: ref.revision });
        return ref;
    }

    private requireFileEdit(artifactId: string): ToolBlockDTO {
        const block = this.snapshot.messages.flatMap(message => message.blocks)
            .find(candidate => candidate.kind === 'tool' && candidate.fileEdit?.artifactId === artifactId);
        if (!block || block.kind !== 'tool') throw new Error('File edit is not part of this session.');
        return block;
    }

    getContextStats(): ContextStatsDTO {
        return contextStats(this.snapshot);
    }

    setApprovalMode(mode: ApprovalMode): void {
        if (!['ask', 'operate', 'timer-quick'].includes(mode)) throw new Error('Unknown agent approval mode.');
        this.snapshot.approvalMode = mode;
        this.snapshot.updatedAt = Date.now();
    }

    dispose(): void {
        for (const timer of this.approvalTimers.values()) clearTimeout(timer);
        this.approvalTimers.clear();
    }

    compact(): SessionSnapshot {
        if (this.controller || this.activeToolRuns.size > 0 || this.pendingTools.size > 0 || this.snapshot.state !== 'IDLE') {
            throw new Error('Wait for the current agent turn and approvals to finish before compacting.');
        }
        const cutoff = this.snapshot.messages.length;
        const summary = compactContext(this.snapshot);
        this.snapshot.messages.push(summary);
        this.snapshot.contextCutoff = cutoff;
        this.snapshot.updatedAt = Date.now();
        // Compaction is a synchronous local state transition. The caller hydrates
        // the returned snapshot, so it must not masquerade as streamed agent text.
        return structuredClone(this.snapshot);
    }

    setPaused(paused: boolean): void {
        this.pauseRequested = paused;
        if (!this.controller) {
            this.setState(paused ? 'PAUSED' : 'IDLE');
            if (!paused) this.drainDeferred();
        }
    }

    private startCall(): void {
        if (this.controller || this.activeToolRuns.size > 0 || this.pauseRequested || this.pendingTools.size > 0) {
            if (this.pauseRequested) this.setState('PAUSED');
            return;
        }
        if (++this.stepsSinceUser > 32) {
            this.fail('Agent stopped after exceeding the emergency step limit.');
            return;
        }

        const controller = new AbortController();
        this.controller = controller;
        this.activeRun = this.runCall(controller).finally(() => {
            if (this.controller !== controller) return;
            this.controller = undefined;
            this.activeRun = undefined;
            if (this.snapshot.state === 'FAILED') return;
            if (this.pauseRequested) this.setState('PAUSED');
            else if (this.pendingTools.size > 0) this.setState('WAITING_FOR_CONTROL');
            else {
                this.setState('IDLE');
                this.drainDeferred();
            }
        });
    }

    private drainDeferred(): void {
        if (this.controller || this.pauseRequested || this.pendingTools.size > 0) return;
        const next = this.deferred.shift();
        if (!next) return;
        if (next.input) this.recordUser(next.input);
        this.startCall();
    }

    private recordUser(input: UserInteractionDTO): void {
        this.stepsSinceUser = 0;
        const id = randomUUID();
        const message: MessageDTO = {
            id,
            role: 'user',
            status: 'done',
            createdAt: Date.now(),
            blocks: [{
                id,
                kind: 'text',
                role: 'user',
                content: input.text,
                status: 'done',
                evidence: input.evidence,
                attachments: input.attachments,
            }],
        };
        this.snapshot.messages.push(message);
        this.snapshot.updatedAt = Date.now();
        this.snapshot.steeringPolicy = input.steeringPolicy;
        this.emit({ type: 'text-start', sessionId: this.snapshot.id, messageId: id, role: 'user', evidence: input.evidence, attachments: input.attachments });
        this.emit({ type: 'text-delta', sessionId: this.snapshot.id, messageId: id, delta: input.text });
        this.emit({ type: 'text-end', sessionId: this.snapshot.id, messageId: id, status: 'done' });
    }

    private async runCall(controller: AbortController): Promise<void> {
        const agent: Agent = process.env.AGENT_MODE === 'stub'
            ? new DebugProviderAgent(this.tools.get('update_stub_fixture') != null)
            : new VercelProviderAgent(this.tools, this.getSettings, tool => toolAvailableToProvider(this.snapshot.approvalMode, tool));
        return this.callAgent(agent, controller);
    }

    private async callAgent(agent: Agent, controller: AbortController): Promise<void> {
        const id = randomUUID();
        const message = this.createAssistantMessage(id);
        this.setState('CALLING_AGENT');
        this.emit({ type: 'text-start', sessionId: this.snapshot.id, messageId: id, role: 'assistant' });
        try {
            const toolCalls: ProviderToolCall[] = [];
            for await (const event of agent.call(activeContextMessages(this.snapshot), controller.signal)) {
                if (event.type === 'text-delta') {
                    const block = message.blocks[0];
                    if (block.kind === 'text') block.content += event.delta;
                    this.emit({ type: 'text-delta', sessionId: this.snapshot.id, messageId: message.id, delta: event.delta });
                } else {
                    toolCalls.push(event);
                }
            }
            controller.signal.throwIfAborted();
            this.finishText(message, 'done');
            if (toolCalls.length > 0) await this.handleToolCalls(toolCalls, controller.signal);
        } catch (error) {
            const status = controller.signal.aborted ? 'interrupted' : 'error';
            this.finishText(message, status);
            if (status === 'error') this.fail(error instanceof Error ? error.message : 'Provider failed.');
        }
    }


    private createAssistantMessage(id: string): MessageDTO {
        const message: MessageDTO = {
            id,
            role: 'assistant',
            status: 'streaming',
            createdAt: Date.now(),
            blocks: [{
                id,
                kind: 'text',
                role: 'assistant',
                content: '',
                status: 'streaming',
            }],
        };
        this.snapshot.messages.push(message);
        return message;
    }

    private finishText(message: MessageDTO, status: 'done' | 'interrupted' | 'error'): void {
        if (message.status !== 'streaming') return;
        message.status = status;
        const block = message.blocks[0];
        if (block?.kind === 'text') block.status = status;
        this.emit({ type: 'text-end', sessionId: this.snapshot.id, messageId: message.id, status });
    }

    private async handleToolCalls(calls: ProviderToolCall[], signal: AbortSignal): Promise<void> {
        for (const call of calls) {
            const input = call.input;
            const tool = this.tools.get(call.name);
            const block: ToolBlockDTO = {
                id: call.id,
                kind: 'tool',
                role: 'assistant',
                toolCallId: call.id,
                type: call.name,
                subject: summarizeInput(input),
                input: call.name === 'write_file' || call.name === 'edit_file'
                    ? { path: summarizeInput(input) }
                    : input,
                status: 'pending',
            };
            this.snapshot.messages.push({
                id: randomUUID(),
                role: 'assistant',
                status: 'done',
                blocks: [block],
                createdAt: Date.now(),
            });
            if (!tool) {
                this.emit({ type: 'tool-start', sessionId: this.snapshot.id, call: block });
                this.finishTool(block, 'error', `Unknown tool: ${call.name}`);
                continue;
            }
            if (call.name === 'write_file' || call.name === 'edit_file') {
                try {
                    block.fileEdit = await this.tools.prepareFileEdit(call.id, call.name, input);
                    block.input = { path: block.fileEdit.path, artifactId: block.fileEdit.artifactId };
                } catch (error) {
                    this.emit({ type: 'tool-start', sessionId: this.snapshot.id, call: block });
                    this.finishTool(block, 'error', error instanceof Error ? error.message : 'Unable to prepare file edit.');
                    continue;
                }
            }
            if (tool.category === 'question') {
                try {
                    const question = parseAskQuestionInput(input);
                    block.input = question;
                    block.subject = question.question;
                    this.emit({ type: 'tool-start', sessionId: this.snapshot.id, call: block });
                    this.pendingTools.set(call.id, { block, name: call.name, input: question });
                } catch (error) {
                    this.emit({ type: 'tool-start', sessionId: this.snapshot.id, call: block });
                    this.finishTool(block, 'error', error instanceof Error ? error.message : 'Invalid question.');
                }
                continue;
            }
            const evaluated = evaluateToolPolicy(this.snapshot.approvalMode, tool, input);
            const policy = evaluated;
            if (policy.disposition === 'timed') {
                const requestedAt = Date.now();
                block.approval = { kind: 'timed', requestedAt, autoApproveAt: requestedAt + policy.delayMs };
            }
            this.emit({ type: 'tool-start', sessionId: this.snapshot.id, call: block });
            if (policy.disposition === 'ask') {
                this.pendingTools.set(call.id, { block, name: call.name, input: block.input });
            } else if (policy.disposition === 'timed') {
                this.pendingTools.set(call.id, { block, name: call.name, input });
                this.armApprovalTimer(call.id, policy.delayMs);
            } else if (policy.disposition === 'reject') {
                const action = { kind: 'rejected', reason: policy.reason } as const;
                block.controlAction = action;
                if (block.fileEdit) block.userModified = await this.tools.settleFileEdit(block.fileEdit.artifactId);
                this.finishTool(block, 'rejected', policy.reason);
            } else {
                block.controlAction = { kind: 'automated_approval' };
                await this.executeTool(block, tool.name, block.fileEdit ? block.input : input, signal);
            }
        }
        if (this.pendingTools.size === 0 && !signal.aborted) this.deferred.unshift({ callOnly: true });
    }

    private async resolveControls(responses: Record<string, ControlAction>, skipOmitted: boolean): Promise<boolean> {
        const executions: Promise<void>[] = [];
        let resolved = false;
        for (const [id, pending] of [...this.pendingTools]) {
            const action = responses[id] ?? (skipOmitted
                ? { kind: 'skipped', reason: 'Omitted when a new response was sent.' } as const
                : undefined);
            if (!action) continue;

            resolved = true;
            executions.push(this.settlePendingTool(id, pending, action));
        }
        await Promise.all(executions);
        return resolved;
    }

    private async settlePendingTool(id: string, pending: PendingTool, action: ControlAction): Promise<void> {
        if (this.pendingTools.get(id) !== pending) return;
        const question = pending.name === 'ask_question' ? parseAskQuestionInput(pending.input) : undefined;
        if (question) {
            if (action.kind === 'answered') action = { kind: 'answered', answer: validateQuestionAnswer(question, action.answer) };
            else if (action.kind !== 'skipped') throw new Error('A question must be answered or skipped.');
        } else if (action.kind === 'answered') {
            throw new Error('An answer can only resolve a question.');
        }
        // Claim the request before awaiting execution so a deadline and click
        // can never execute the same tool twice.
        this.pendingTools.delete(id);
        this.clearApprovalTimer(id);
        pending.block.controlAction = action;
        if (question && action.kind === 'answered') {
            const answer = action.answer;
            const option = answer.kind === 'option'
                ? question.options?.find(candidate => candidate.id === answer.optionId)
                : undefined;
            this.finishTool(pending.block, 'done', JSON.stringify({
                status: 'answered',
                answer,
                ...(option ? { label: option.label } : {}),
            }));
        } else if (question && action.kind === 'skipped') {
            this.finishTool(pending.block, 'skipped', JSON.stringify({ status: 'skipped', reason: action.reason ?? 'Skipped by user.' }));
        } else if (action.kind === 'approved' || action.kind === 'automated_approval') {
            const tool = this.tools.get(pending.name);
            if (tool) await this.executeControlledTool(pending.block, pending.name, pending.input);
            else this.finishTool(pending.block, 'error', `Unknown tool: ${pending.name}`);
        } else if (action.kind === 'rejected') {
            if (pending.block.fileEdit) pending.block.userModified = await this.tools.settleFileEdit(pending.block.fileEdit.artifactId);
            this.finishTool(pending.block, 'rejected', action.reason ?? 'Rejected by user.');
        } else {
            const reason = action.kind === 'skipped'
                ? action.reason ?? 'Skipped by user.'
                : 'Invalid response for tool.';
            if (pending.block.fileEdit) pending.block.userModified = await this.tools.settleFileEdit(pending.block.fileEdit.artifactId);
            this.finishTool(pending.block, 'skipped', reason);
        }
    }

    private armApprovalTimer(toolCallId: string, delayMs: number): void {
        this.clearApprovalTimer(toolCallId);
        const timer = setTimeout(() => {
            this.approvalTimers.delete(toolCallId);
            const pending = this.pendingTools.get(toolCallId);
            if (!pending) return;
            void this.settlePendingTool(toolCallId, pending, { kind: 'automated_approval' }).then(() => {
                if (!this.controller && this.activeToolRuns.size === 0 && this.pendingTools.size === 0 && this.snapshot.state !== 'FAILED') this.startCall();
            });
        }, Math.max(0, delayMs));
        this.approvalTimers.set(toolCallId, timer);
    }

    private clearApprovalTimer(toolCallId: string): void {
        const timer = this.approvalTimers.get(toolCallId);
        if (timer) clearTimeout(timer);
        this.approvalTimers.delete(toolCallId);
    }

    private executeControlledTool(block: ToolBlockDTO, name: string, input: unknown): Promise<void> {
        const controller = new AbortController();
        this.activeToolControllers.add(controller);
        const run = this.executeTool(block, name, input, controller.signal).finally(() => {
            this.activeToolControllers.delete(controller);
            this.activeToolRuns.delete(run);
        });
        this.activeToolRuns.add(run);
        return run;
    }

    private async executeTool(block: ToolBlockDTO, name: string, input: unknown, signal: AbortSignal): Promise<void> {
        const tool = this.tools.get(name);
        if (!tool) return;

        block.status = 'running';
        this.setState('RUNNING_TOOL');
        this.emit({ type: 'tool-start', sessionId: this.snapshot.id, call: block });
        try {
            const result = block.fileEdit
                ? await this.tools.applyFileEdit(block.fileEdit.artifactId, signal)
                : { output: await tool.execute(input, signal), userModified: false };
            block.userModified = block.fileEdit ? result.userModified : undefined;
            let output = result.output;
            if (block.fileEdit) {
                try { await this.tools.settleFileEdit(block.fileEdit.artifactId); }
                catch { output += '\nHistory could not be saved; the file write completed.'; }
            }
            this.finishTool(block, 'done', output);
        } catch (error) {
            const output = signal.aborted
                ? 'Stopped by user.'
                : error instanceof Error
                    ? error.message
                    : 'Tool failed.';
            if (block.fileEdit) {
                try { block.userModified = await this.tools.settleFileEdit(block.fileEdit.artifactId); }
                catch { /* Preserve the original write failure. */ }
            }
            this.finishTool(block, signal.aborted ? 'skipped' : 'error', output);
        }
    }

    private finishTool(block: ToolBlockDTO, status: ToolBlockDTO['status'], output: string): void {
        block.status = status;
        block.output = output;
        this.emit({
            type: 'tool-end',
            sessionId: this.snapshot.id,
            response: {
                id: block.id,
                toolCallId: block.toolCallId,
                type: block.type,
                subject: block.subject,
                output,
                status,
                controlAction: block.controlAction,
                approval: block.approval,
                fileEdit: block.fileEdit,
                userModified: block.userModified,
            },
        });
    }

    private setState(state: RuntimeState): void {
        this.snapshot.state = state;
        this.snapshot.updatedAt = Date.now();
        this.emit({ type: 'runtime-state', sessionId: this.snapshot.id, state });
    }

    private fail(message: string): void {
        this.setState('FAILED');
        this.emit({ type: 'runtime-error', sessionId: this.snapshot.id, message });
    }
}

function summarizeInput(input: unknown): string | undefined {
    if (typeof input !== 'object' || input == null) return undefined;
    const value = (input as Record<string, unknown>).path;
    return typeof value === 'string' ? value : undefined;
}

function parseApprovalMode(value: string | undefined): ApprovalMode {
    if (value === 'timer-quick' || value === 'operate') return value;
    return 'ask';
}
