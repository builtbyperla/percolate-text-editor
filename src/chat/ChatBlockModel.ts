import { Accessor, Setter, createSignal } from 'solid-js';
import type { AttachmentDTO, ControlAction, FileEditRefDTO, TimedApprovalDTO } from '../../shared/agentProtocol';

// A snapshot of one included context item, captured at send time so a message
// carries its evidence independently of the (mutable) registry.
export interface EvidenceSnapshot {
    label: string;
    note: string;
    // Origin tag of the annotation (e.g. 'text', 'segment', 'container', 'editor').
    type: string;
    presentation?: 'text' | 'code';
    preview?: {
        startLine: number;
        lines: string[];
        selectedStartLine?: number;
        selectedEndLine?: number;
    };
    // Optional richer, kind-specific payload the origin attaches (e.g. a diff
    // annotation's before/after + hunks from its coordinator). Absent otherwise.
    additionalData?: unknown;
}

export interface EvidenceGroupSnapshot {
    sourceId: string;
    label: string;
    items: EvidenceSnapshot[];
}

export type TextStatus = 'streaming' | 'done' | 'interrupted' | 'error';
export type ToolStatus = 'pending' | 'running' | 'done' | 'rejected' | 'skipped' | 'error';

export interface BlockUpdate {
    blockId: string;
    // Which block subclass to construct on first sight. Defaults to 'text'.
    kind?: 'text' | 'tool';
    // A pure text append: text content for a TextBlock, stdout for a ToolBlock.
    delta?: string;
    done?: boolean;

    // --- Creation-only (first update for a blockId) ---
    role?: 'user' | 'assistant';
    origin?: 'agent' | 'system';
    contextContent?: string;
    evidence?: EvidenceGroupSnapshot[];
    attachments?: AttachmentDTO[];
    // Tool-block identity: its type key (resolves a ToolTypeSpec) and target.
    type?: string;
    subject?: string;
    toolCallId?: string;
    input?: unknown;
    controlAction?: ControlAction;
    approval?: TimedApprovalDTO;
    fileEdit?: FileEditRefDTO;
    userModified?: boolean;

    // --- Settle-only (a tool stop event carries final metadata) ---
    status?: TextStatus | ToolStatus;
    output?: string;
}

export abstract class ChatBlock {
    readonly id: string;
    readonly role: 'user' | 'assistant';
    readonly timestamp: number;
    abstract readonly kind: 'text' | 'tool';

    constructor(update: BlockUpdate) {
        this.id = update.blockId;
        this.role = update.role ?? 'assistant';
        this.timestamp = Date.now();
    }

    // The only streaming op: a pure text append onto a kind-specific signal.
    abstract appendDelta(delta: string): void;

    // Close the block. Kind-specific finalization; takes the update because a
    // tool's stop event carries final metadata (status, exit-coded subject).
    abstract settle(update: BlockUpdate): void;

    // Raw content for the streaming body and the history payload.
    abstract getMarkdown(): string;

    abstract ownsVisual(): boolean;
}

export class TextBlock extends ChatBlock {
    readonly kind = 'text' as const;
    getContent: Accessor<string>;
    private setContent: Setter<string>;
    readonly evidence?: EvidenceGroupSnapshot[];
    readonly attachments?: AttachmentDTO[];
    readonly origin: 'agent' | 'system';
    readonly contextContent?: string;

    getStatus: Accessor<TextStatus>;
    private setStatus: Setter<TextStatus>;

    constructor(update: BlockUpdate) {
        super(update);
        [this.getContent, this.setContent] = createSignal('');
        [this.getStatus, this.setStatus] = createSignal<TextStatus>('streaming');
        this.evidence = update.evidence;
        this.attachments = update.attachments;
        this.origin = update.origin ?? 'agent';
        this.contextContent = update.contextContent;
    }

    appendDelta(delta: string): void {
        this.setContent(c => c + delta);
    }

    settle(update: BlockUpdate): void {
        this.setStatus((update.status as TextStatus | undefined) ?? 'done');
    }

    getMarkdown(): string {
        return this.getContent();
    }

    ownsVisual(): boolean {
        return this.getStatus() !== 'streaming';
    }
}

export class ToolBlock extends ChatBlock {
    readonly kind = 'tool' as const;
    readonly type: string;
    readonly toolCallId: string;
    readonly input?: unknown;
    getControlAction: Accessor<ControlAction | undefined>;
    private setControlAction: Setter<ControlAction | undefined>;
    getApproval: Accessor<TimedApprovalDTO | undefined>;
    private setApproval: Setter<TimedApprovalDTO | undefined>;
    getFileEdit: Accessor<FileEditRefDTO | undefined>;
    private setFileEdit: Setter<FileEditRefDTO | undefined>;
    getUserModified: Accessor<boolean | undefined>;
    private setUserModified: Setter<boolean | undefined>;
    getSubject: Accessor<string | undefined>;
    private setSubject: Setter<string | undefined>;
    getStatus: Accessor<ToolStatus>;
    private setStatus: Setter<ToolStatus>;
    getOutput: Accessor<string>;
    private setOutput: Setter<string>;

    constructor(update: BlockUpdate) {
        super(update);
        this.type = update.type ?? 'tool';
        this.toolCallId = update.toolCallId ?? update.blockId;
        this.input = update.input;
        [this.getControlAction, this.setControlAction] = createSignal(update.controlAction);
        [this.getApproval, this.setApproval] = createSignal(update.approval);
        [this.getFileEdit, this.setFileEdit] = createSignal(update.fileEdit);
        [this.getUserModified, this.setUserModified] = createSignal(update.userModified);
        [this.getSubject, this.setSubject] = createSignal(update.subject);
        // A tool arriving with `done` set is a whole (already-resolved) call;
        // otherwise it opens 'running' and streams output in.
        [this.getStatus, this.setStatus] = createSignal<ToolStatus>(
            update.done ? ((update.status as ToolStatus | undefined) ?? 'done') : ((update.status as ToolStatus | undefined) ?? 'running'));
        // Output starts empty; a whole call's `output` rides its create+done
        // update and is applied by settle, keeping the constructor identity-only.
        [this.getOutput, this.setOutput] = createSignal('');
    }

    appendDelta(delta: string): void {
        this.setOutput(o => o + delta);
    }

    updateStatus(status: ToolStatus): void {
        this.setStatus(status);
    }

    updateControlAction(action: ControlAction): void { this.setControlAction(action); }
    updateApproval(approval: TimedApprovalDTO): void { this.setApproval(approval); }
    updateFileEdit(fileEdit: FileEditRefDTO): void { this.setFileEdit(fileEdit); }

    // Close a running tool: final status plus an optional subject/output patch
    // (e.g. an exit code folded into the subject).
    settle(update: BlockUpdate): void {
        this.setStatus((update.status as ToolStatus | undefined) ?? 'done');
        if (update.subject != null) this.setSubject(update.subject);
        if (update.output != null) this.setOutput(update.output);
        if (update.controlAction != null) this.setControlAction(update.controlAction);
        if (update.approval != null) this.setApproval(update.approval);
        if (update.fileEdit != null) this.setFileEdit(update.fileEdit);
        if (update.userModified != null) this.setUserModified(update.userModified);
    }

    getMarkdown(): string {
        return this.getOutput();
    }

    ownsVisual(): boolean {
        return true;
    }
}

export class ChatBlockStore {
    getBlocks: Accessor<ChatBlock[]>;
    private setBlocks: Setter<ChatBlock[]>;

    getRevision: Accessor<number>;
    private setRevision: Setter<number>;
    private beforeReplace?: () => void;

    constructor() {
        [this.getBlocks, this.setBlocks] = createSignal<ChatBlock[]>([]);
        [this.getRevision, this.setRevision] = createSignal(0);
    }

    applyUpdate(update: BlockUpdate): void {
        const block = this.find(update.blockId) ?? this.create(update);
        if (block.kind === 'tool' && update.status != null) (block as ToolBlock).updateStatus(update.status as ToolStatus);
        if (block.kind === 'tool' && update.controlAction != null) (block as ToolBlock).updateControlAction(update.controlAction);
        if (block.kind === 'tool' && update.approval != null) (block as ToolBlock).updateApproval(update.approval);
        if (block.kind === 'tool' && update.fileEdit != null) (block as ToolBlock).updateFileEdit(update.fileEdit);
        if (update.delta != null) block.appendDelta(update.delta);
        if (update.done) block.settle(update);
        this.setRevision(r => r + 1);
    }

    private find(id: string): ChatBlock | undefined {
        return this.getBlocks().find(b => b.id === id);
    }

    private create(update: BlockUpdate): ChatBlock {
        const block: ChatBlock = update.kind === 'tool'
            ? new ToolBlock(update)
            : new TextBlock(update);
        this.setBlocks(prev => [...prev, block]);
        return block;
    }

    lastId(): string | undefined {
        return this.getBlocks().at(-1)?.id;
    }

    setBeforeReplace(callback: () => void): void { this.beforeReplace = callback; }

    replaceAll(blocks: Array<{ id: string; kind: 'text' | 'tool'; role: 'user' | 'assistant'; content?: string; origin?: 'agent' | 'system'; contextContent?: string; evidence?: EvidenceGroupSnapshot[]; attachments?: AttachmentDTO[]; toolCallId?: string; type?: string; subject?: string; input?: unknown; output?: string; status: TextStatus | ToolStatus; controlAction?: ControlAction; approval?: TimedApprovalDTO; fileEdit?: FileEditRefDTO; userModified?: boolean }>): void {
        this.beforeReplace?.();
        const hydrated: ChatBlock[] = [];
        for (const block of blocks) {
            const update: BlockUpdate = block.kind === 'text'
                ? { blockId: block.id, kind: 'text', role: block.role, origin: block.origin, contextContent: block.contextContent, evidence: block.evidence, attachments: block.attachments, delta: block.content, done: true, status: block.status }
                : { blockId: block.id, kind: 'tool', role: block.role, toolCallId: block.toolCallId, type: block.type, subject: block.subject, input: block.input, output: block.output, done: true, status: block.status, controlAction: block.controlAction, approval: block.approval, fileEdit: block.fileEdit, userModified: block.userModified };
            const created = update.kind === 'tool' ? new ToolBlock(update) : new TextBlock(update);
            if (update.delta) created.appendDelta(update.delta);
            created.settle(update);
            hydrated.push(created);
        }
        this.setBlocks(hydrated); this.setRevision(r => r + 1);
    }
}
