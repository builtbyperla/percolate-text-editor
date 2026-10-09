import type { AgentClient } from './AgentClient';
import { firstMessageDisplayName, isUntitledSessionName, nextForkDisplayName } from '../../shared/sessionDisplayName';
import type { AgentEvent, ApprovalMode, ContextStatsDTO, ControlAction, ControlResponsesDTO, MessageDTO, SessionSnapshot, SessionSummary, ToolBlockDTO, UserInteractionDTO } from '../../shared/agentProtocol';
import { STANDARD_ATTACHMENT_SUPPORT } from '../../shared/agentProtocol';
import { TIMED_APPROVAL_DELAYS } from '../../shared/approvalProfiles';
import { agentStubTurn, type AgentStubTool } from '../../shared/agentStubResponses';
import { parseAskQuestionInput, validateQuestionAnswer } from '../../shared/agentQuestion';
import { createTwoFilesPatch } from 'diff';
import { buildCompactionMessage } from '../../shared/contextCompaction';

interface DemoFileEdit {
    before: string;
    after?: string;
    initial: string;
    revision: number;
    patch?: string;
    sessionId: string;
}
const DEMO_BASE_SHA256 = 'ec87d2605198f3c7eeaf803f0ac3ac42ca3cf099b8175faa4a4e42cbfd1f4d70';

// Simulation belongs at the client edge, so ChatFlow behaves identically in demo
// and desktop builds. Demo snapshots are updated as events are emitted so session
// switching exercises the same hydration path as Electron.
export class DemoAgentClient implements AgentClient {
    readonly available = true;
    async attachmentSupport() { return this.mode === 'interactive' ? STANDARD_ATTACHMENT_SUPPORT : undefined; }
    private sessions = new Map<string, SessionSnapshot>();
    private listeners = new Map<string, Set<(e: AgentEvent) => void>>();
    private active = new Map<string, { timer: ReturnType<typeof setInterval>; message: MessageDTO }>();
    private pending = new Map<string, { block: ToolBlockDTO; output: string; response: string; timer?: ReturnType<typeof setTimeout> }>();
    private fileEdits = new Map<string, DemoFileEdit>();

    constructor(private readonly mode: 'passive' | 'interactive' = 'passive') {}

    async createSession(): Promise<SessionSummary> {
        const id = crypto.randomUUID(); const now = Date.now();
        const session: SessionSnapshot = { id, agent: this.mode === 'passive' ? 'demo' : 'browser-stub', displayName: 'New session', archived: false, state: 'IDLE', createdAt: now, updatedAt: now, messages: [], steeringPolicy: 'QUEUE', approvalMode: this.mode === 'passive' ? 'operate' : 'ask' };
        this.sessions.set(id, session); return session;
    }
    async listSessions() { return [...this.sessions.values()].filter(session => !session.archived); }
    async loadSession(id: string) { const session = this.sessions.get(id); if (!session) throw new Error('Unknown session'); return structuredClone(session); }
    async forkSession(id: string, throughBlockId?: string) {
        const source = await this.loadSession(id); const now = Date.now();
        const selectedIndex = throughBlockId == null
            ? source.messages.length - 1
            : source.messages.findIndex(message => message.id === throughBlockId || message.blocks.some(block => block.id === throughBlockId));
        if (throughBlockId != null && selectedIndex < 0) throw new Error('The selected message no longer exists.');
        const fork = { ...source, id: crypto.randomUUID(), displayName: nextForkDisplayName(source.displayName, [...this.sessions.values()].map(session => session.displayName)), archived: false, state: 'IDLE' as const, createdAt: now, updatedAt: now, contextCutoff: throughBlockId == null ? Math.min(source.contextCutoff ?? 0, selectedIndex + 1) || undefined : undefined, messages: structuredClone(source.messages.slice(0, selectedIndex + 1)) };
        this.sessions.set(fork.id, fork); return structuredClone(fork);
    }
    async renameSession(id: string, displayName: string) {
        const session = this.sessions.get(id); if (!session) throw new Error('Unknown session');
        const name = displayName.trim(); if (!name) throw new Error('Session name cannot be empty.');
        session.displayName = name; session.updatedAt = Date.now(); return structuredClone(session);
    }
    async archiveSession(id: string) {
        const session = this.sessions.get(id); if (!session) throw new Error('Unknown session');
        session.archived = true; session.updatedAt = Date.now();
    }
    onEvent(id: string, cb: (event: AgentEvent) => void) { const set = this.listeners.get(id) ?? new Set(); set.add(cb); this.listeners.set(id, set); return () => { set.delete(cb); }; }
    private emit(event: AgentEvent) { this.listeners.get(event.sessionId)?.forEach(cb => cb(event)); }

    async send(input: UserInteractionDTO): Promise<{ accepted: true }> {
        const session = this.sessions.get(input.sessionId); if (!session) throw new Error('Unknown session');
        if (isUntitledSessionName(session.displayName) && !session.messages.some(message => message.role === 'user')) {
            session.displayName = firstMessageDisplayName(input.text, [...this.sessions.values()].filter(other => other.id !== session.id).map(other => other.displayName), session.displayName) ?? session.displayName;
        }
        const userId = crypto.randomUUID();
        session.messages.push({ id: userId, role: 'user', status: 'done', createdAt: Date.now(), blocks: [{ id: userId, kind: 'text', role: 'user', content: input.text, status: 'done', evidence: input.evidence, attachments: input.attachments }] });
        session.steeringPolicy = input.steeringPolicy; session.updatedAt = Date.now();
        this.emit({ type: 'text-start', sessionId: input.sessionId, messageId: userId, role: 'user', evidence: input.evidence, attachments: input.attachments });
        this.emit({ type: 'text-delta', sessionId: input.sessionId, messageId: userId, delta: input.text });
        this.emit({ type: 'text-end', sessionId: input.sessionId, messageId: userId, status: 'done' });
        if (this.active.has(input.sessionId) || this.pending.has(input.sessionId)) await this.stop(input.sessionId);
        this.startTurn(session);
        return { accepted: true };
    }

    private startTurn(session: SessionSnapshot): void {
        session.state = 'CALLING_AGENT'; this.emit({ type: 'runtime-state', sessionId: session.id, state: 'CALLING_AGENT' });
        const responseIndex = Math.max(0, session.messages.filter(candidate => candidate.role === 'user').length - 1);
        const turn = agentStubTurn(responseIndex);
        for (const tool of turn.tools) {
            if (tool.type === 'write_file') {
                this.startFileEditSample(session, tool, turn.response);
                return;
            }
            const isQuestion = tool.type === 'ask_question';
            const timedDelay = !isQuestion && session.approvalMode === 'timer-quick'
                ? TIMED_APPROVAL_DELAYS[session.approvalMode]
                : undefined;
            const block = this.startTool(session, tool, tool.requiresApproval ? timedDelay : undefined);
            if (isQuestion || (tool.requiresApproval && (session.approvalMode === 'ask' || timedDelay != null))) {
                session.state = 'WAITING_FOR_CONTROL';
                const pending = { block, output: tool.output, response: turn.response, timer: undefined as ReturnType<typeof setTimeout> | undefined };
                this.pending.set(session.id, pending);
                if (timedDelay != null) {
                    pending.timer = setTimeout(() => {
                        void this.respond({ sessionId: session.id, responses: { [block.toolCallId]: { kind: 'automated_approval' } } });
                    }, timedDelay);
                }
                this.emit({ type: 'runtime-state', sessionId: session.id, state: 'WAITING_FOR_CONTROL' });
                return;
            }
            this.finishTool(session, block, 'done', tool.output, { kind: 'automated_approval' });
        }
        this.startReply(session, turn.response);
    }

    private startFileEditSample(session: SessionSnapshot, tool: AgentStubTool, response: string): void {
        const id = crypto.randomUUID();
        const artifactId = crypto.randomUUID();
        const input = tool.input as { path: string; content: string };
        const path = input.path;
        const before = 'Alpha\nBeta\nGamma\n';
        const after = input.content;
        this.fileEdits.set(artifactId, { before, after, initial: after, revision: 0, sessionId: session.id });
        const timedDelay = session.approvalMode === 'timer-quick'
            ? TIMED_APPROVAL_DELAYS[session.approvalMode]
            : undefined;
        const requestedAt = Date.now();
        const block: ToolBlockDTO = {
            id, kind: 'tool', role: 'assistant', toolCallId: id, type: 'write_file',
            subject: path, input: { path, artifactId }, status: session.approvalMode === 'operate' ? 'running' : 'pending',
            approval: timedDelay == null ? undefined : { kind: 'timed', requestedAt, autoApproveAt: requestedAt + timedDelay },
            fileEdit: { artifactId, path, baseSha256: DEMO_BASE_SHA256, revision: 0 },
        };
        session.messages.push({ id: crypto.randomUUID(), role: 'assistant', status: 'done', createdAt: Date.now(), blocks: [block] });
        this.emit({ type: 'tool-start', sessionId: session.id, call: block });
        if (session.approvalMode === 'operate') {
            this.settleFileEditSample(block);
            this.finishTool(session, block, 'done', tool.output, { kind: 'automated_approval' });
            this.startReply(session, response);
            return;
        }
        const pending = { block, output: tool.output, response, timer: undefined as ReturnType<typeof setTimeout> | undefined };
        this.pending.set(session.id, pending);
        if (timedDelay != null) {
            pending.timer = setTimeout(() => {
                void this.respond({ sessionId: session.id, responses: { [block.toolCallId]: { kind: 'automated_approval' } } });
            }, timedDelay);
        }
        session.state = 'WAITING_FOR_CONTROL';
        this.emit({ type: 'runtime-state', sessionId: session.id, state: 'WAITING_FOR_CONTROL' });
    }

    private startTool(session: SessionSnapshot, tool: AgentStubTool, timedDelay?: number): ToolBlockDTO {
        const id = crypto.randomUUID();
        const status = tool.type === 'ask_question' || (tool.requiresApproval && session.approvalMode !== 'operate') ? 'pending' : 'running';
        const requestedAt = Date.now();
        const approval = timedDelay == null ? undefined : { kind: 'timed' as const, requestedAt, autoApproveAt: requestedAt + timedDelay };
        const block: ToolBlockDTO = { id, kind: 'tool', role: 'assistant', toolCallId: id, type: tool.type, subject: tool.subject, input: tool.input, status, approval };
        session.messages.push({ id: crypto.randomUUID(), role: 'assistant', status: 'done', createdAt: Date.now(), blocks: [block] });
        this.emit({ type: 'tool-start', sessionId: session.id, call: block });
        return block;
    }

    private finishTool(session: SessionSnapshot, block: ToolBlockDTO, status: ToolBlockDTO['status'], output: string, controlAction?: ControlAction): void {
        block.status = status; block.output = output; block.controlAction = controlAction;
        this.emit({ type: 'tool-end', sessionId: session.id, response: { id: block.id, toolCallId: block.toolCallId, type: block.type, subject: block.subject, output, status, controlAction, approval: block.approval, fileEdit: block.fileEdit, userModified: block.userModified } });
    }

    private startReply(session: SessionSnapshot, text: string): void {
        const id = crypto.randomUUID();
        const message: MessageDTO = { id, role: 'assistant', status: 'streaming', createdAt: Date.now(), blocks: [{ id, kind: 'text', role: 'assistant', content: '', status: 'streaming' }] };
        session.messages.push(message); this.emit({ type: 'text-start', sessionId: session.id, messageId: id, role: 'assistant' });
        let offset = 0;
        const timer = setInterval(() => {
            if (offset >= text.length) { this.finishReply(session, message, 'done'); return; }
            const delta = text.slice(offset, offset += 5); const block = message.blocks[0]; if (block.kind === 'text') block.content += delta;
            this.emit({ type: 'text-delta', sessionId: session.id, messageId: id, delta });
        }, 45);
        this.active.set(session.id, { timer, message });
    }

    private finishReply(session: SessionSnapshot, message: MessageDTO, status: 'done' | 'interrupted'): void {
        const active = this.active.get(session.id); if (active) clearInterval(active.timer); this.active.delete(session.id);
        message.status = status; const block = message.blocks[0]; if (block.kind === 'text') block.status = status;
        session.state = 'IDLE'; session.updatedAt = Date.now();
        this.emit({ type: 'text-end', sessionId: session.id, messageId: message.id, status });
        this.emit({ type: 'runtime-state', sessionId: session.id, state: 'IDLE' });
    }

    async respond(input: ControlResponsesDTO) {
        const session = this.sessions.get(input.sessionId); const pending = this.pending.get(input.sessionId);
        if (!session || !pending) return { accepted: true } as const;
        const action = input.responses[pending.block.toolCallId]; if (!action) return { accepted: true } as const;
        if (pending.block.type === 'ask_question') {
            const question = parseAskQuestionInput(pending.block.input);
            if (action.kind !== 'answered' && action.kind !== 'skipped') throw new Error('A question must be answered or skipped.');
            const answer = action.kind === 'answered' ? validateQuestionAnswer(question, action.answer) : undefined;
            this.pending.delete(input.sessionId);
            if (answer) {
                const option = answer.kind === 'option' ? question.options?.find(item => item.id === answer.optionId) : undefined;
                this.finishTool(session, pending.block, 'done', JSON.stringify({ status: 'answered', answer, ...(option ? { label: option.label } : {}) }), { kind: 'answered', answer });
                this.startReply(session, pending.response);
            } else {
                this.finishTool(session, pending.block, 'skipped', JSON.stringify({ status: 'skipped', reason: action.kind === 'skipped' ? action.reason ?? 'Skipped by user.' : '' }), action);
                this.startReply(session, 'Question skipped. No preference was recorded.');
            }
            return { accepted: true } as const;
        }
        this.pending.delete(input.sessionId);
        if (pending.timer) clearTimeout(pending.timer);
        if (pending.block.fileEdit) {
            this.settleFileEditSample(pending.block);
            const approved = action.kind === 'approved' || action.kind === 'automated_approval';
            const status = approved ? 'done' : action.kind === 'rejected' ? 'rejected' : 'skipped';
            this.finishTool(session, pending.block, status, approved ? pending.output : `${status} by user.`, action);
            this.startReply(session, approved ? pending.response : `The sample file edit was ${status}.`);
            return { accepted: true } as const;
        }
        if (action.kind === 'approved' || action.kind === 'automated_approval') {
            this.finishTool(session, pending.block, 'done', pending.output, action);
            this.startReply(session, pending.response);
        } else {
            const status = action.kind === 'rejected' ? 'rejected' : 'skipped';
            const output = action.kind === 'rejected' ? action.reason ?? 'Rejected by user.' : action.kind === 'skipped' ? action.reason ?? 'Skipped by user.' : 'Unsupported response.';
            this.finishTool(session, pending.block, status, output, action);
            this.startReply(session, `The simulated tool call was ${status}. No local data was changed.`);
        }
        return { accepted: true } as const;
    }
    async cancel(sessionId: string) {
        const session = this.sessions.get(sessionId); if (!session) return;
        const active = this.active.get(sessionId); if (active) this.finishReply(session, active.message, 'interrupted');
    }
    async stop(sessionId: string) {
        const session = this.sessions.get(sessionId); if (!session) return;
        await this.cancel(sessionId);
        const pending = this.pending.get(sessionId);
        if (pending) {
            const reason = 'Stopped by user.';
            this.pending.delete(sessionId); if (pending.timer) clearTimeout(pending.timer);
            if (pending.block.fileEdit) this.settleFileEditSample(pending.block);
            this.finishTool(session, pending.block, 'skipped', reason, { kind: 'skipped', reason });
            session.state = 'IDLE'; this.emit({ type: 'runtime-state', sessionId, state: 'IDLE' });
        }
    }
    async undo() {}
    async readFileEdit(sessionId: string, artifactId: string) {
        const edit = this.requireFileEdit(sessionId, artifactId);
        return edit.patch != null
            ? { patch: edit.patch, revision: edit.revision, settled: true, userModified: edit.after !== edit.initial }
            : { before: edit.before, after: edit.after, revision: edit.revision, settled: false };
    }
    async updateFileEdit(sessionId: string, artifactId: string, revision: number, content: string) {
        const edit = this.requireFileEdit(sessionId, artifactId);
        if (edit.patch != null) throw new Error('This sample file edit has settled.');
        if (revision !== edit.revision) throw new Error('The proposed buffer changed. Reload it before editing.');
        if (typeof content !== 'string' || content.length > 1024 * 1024) throw new Error('Sample file edit is too large.');
        edit.after = content;
        edit.revision++;
        const block = this.sessions.get(sessionId)?.messages.flatMap(message => message.blocks)
            .find(candidate => candidate.kind === 'tool' && candidate.fileEdit?.artifactId === artifactId);
        if (block?.kind === 'tool' && block.fileEdit) block.fileEdit.revision = edit.revision;
        this.emit({ type: 'file-edit-updated', sessionId, artifactId, revision: edit.revision });
        return { artifactId, path: block?.kind === 'tool' ? block.fileEdit?.path ?? '' : '', baseSha256: DEMO_BASE_SHA256, revision: edit.revision };
    }
    private requireFileEdit(sessionId: string, artifactId: string): DemoFileEdit {
        const edit = this.fileEdits.get(artifactId);
        if (!edit || edit.sessionId !== sessionId) throw new Error('Unknown sample file edit.');
        return edit;
    }
    private settleFileEditSample(block: ToolBlockDTO): void {
        const id = block.fileEdit?.artifactId;
        const edit = id ? this.fileEdits.get(id) : undefined;
        if (!edit) return;
        block.userModified = edit.after !== edit.initial;
        const path = block.fileEdit?.path ?? 'sample.txt';
        edit.patch = createTwoFilesPatch(`a/${path}`, `b/${path}`, edit.before, edit.after ?? '');
    }
    async contextStats(sessionId: string): Promise<ContextStatsDTO> {
        const session = this.sessions.get(sessionId); if (!session) throw new Error('Unknown session');
        const cutoff = Math.min(session.contextCutoff ?? 0, session.messages.length);
        const active = session.messages.slice(cutoff);
        return { totalMessages: session.messages.length, activeMessages: active.length, compactedMessages: cutoff, estimatedTokens: Math.ceil(active.reduce((sum, message) => sum + JSON.stringify(message.blocks).length, 0) / 4) };
    }
    async compact(sessionId: string): Promise<SessionSnapshot> {
        const session = this.sessions.get(sessionId); if (!session) throw new Error('Unknown session');
        if (session.state !== 'IDLE') throw new Error('Wait for the current agent turn to finish before compacting.');
        const active = session.messages.slice(session.contextCutoff ?? 0);
        if (active.length < 2) throw new Error('There is not enough active conversation to compact.');
        const cutoff = session.messages.length;
        session.messages.push(buildCompactionMessage(session, crypto.randomUUID()));
        session.contextCutoff = cutoff; session.updatedAt = Date.now();
        return structuredClone(session);
    }
    async setPaused(sessionId: string, paused: boolean) { const session = this.sessions.get(sessionId); if (session) session.state = paused ? 'PAUSED' : 'IDLE'; this.emit({ type: 'runtime-state', sessionId, state: paused ? 'PAUSED' : 'IDLE' }); }
    async setApprovalMode(sessionId: string, mode: ApprovalMode) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Unknown session');
        session.approvalMode = mode;
        session.updatedAt = Date.now();
    }
}
