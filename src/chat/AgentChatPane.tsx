import { JSX } from 'solid-js/jsx-runtime';
import { Accessor, Setter, Show, createSignal, createEffect } from 'solid-js';
import { ViewBlock } from '../containers/Tabs';
import styles from '../styles/ChatPane.module.css';
import { ChatFlow, setAgentFlow } from './ChatFlow';
import type { AgentClient } from '../agent/AgentClient';
import { createAgentClient } from '../agent/createAgentClient';
import { ChatThread } from './ChatThread';
import { PendingTasksBox, ResponseBox, ResponseMinifiedBox } from './Composer';
import type { ToolBlock } from './ChatBlockModel';
import type { AttachmentDTO, ControlAction } from '../../shared/agentProtocol';

export class AgentChatPane implements ViewBlock {
    // Pane owns its own scroll: the thread scrolls internally while the composer
    // stays pinned, so the tab frame must not wrap us in overflow.
    ownsScroll: boolean = true;

    // The real conversation model — messages, streaming, send().
    flow: ChatFlow;
    onOpenFileEdit?: (block: ToolBlock) => void;

    getNotificationsOpen: Accessor<boolean>;
    private setNotificationsOpen: Setter<boolean>;
    private getAcknowledgedToolIds: Accessor<ReadonlySet<string>>;
    private setAcknowledgedToolIds: Setter<ReadonlySet<string>>;
    private getStagedActions: Accessor<Record<string, ControlAction>>;
    private setStagedActions: Setter<Record<string, ControlAction>>;

    // Draft lives here (not on the textarea) so minify can unmount the composer
    // without losing what was typed.
    getDraft: Accessor<string>;
    setDraft: Setter<string>;
    getAttachments: Accessor<AttachmentDTO[]>;
    private setAttachments: Setter<AttachmentDTO[]>;

    getMinified: Accessor<boolean>;
    setMinified: Setter<boolean>;

    // The scroll container, captured on mount so submit() can pin to the bottom.
    private scrollEl?: HTMLDivElement;
    private paneEl?: HTMLDivElement;
    private submitting = false;
    private attachmentRead: Promise<void> = Promise.resolve();

    constructor(client: AgentClient = createAgentClient()) {
        this.flow = new ChatFlow(client);
        [this.getNotificationsOpen, this.setNotificationsOpen] = createSignal(false);
        [this.getAcknowledgedToolIds, this.setAcknowledgedToolIds] = createSignal<ReadonlySet<string>>(new Set());
        [this.getStagedActions, this.setStagedActions] = createSignal<Record<string, ControlAction>>({});
        [this.getDraft, this.setDraft] = createSignal('');
        [this.getAttachments, this.setAttachments] = createSignal<AttachmentDTO[]>([]);
        [this.getMinified, this.setMinified] = createSignal(false);

        // Expose the flow to the annotation layer, which has no route to this pane
        // (App builds it as a local const) but needs to send a single note+slice.
        setAgentFlow(this.flow);

        this.flow.onTurnPosted = () => queueMicrotask(() => this.scrollToBottom());
        window.addEventListener('agent-settings-updated', () => {
            this.setAttachments([]);
            void this.flow.refreshAttachmentSupport();
        });
        void this.flow.initialize();
    }

    // The tray contains only the current user turn's tool tasks. A new user turn
    // naturally moves the boundary past the old list; dismissing hides this turn.
    statusCount(): number {
        return this.pendingTasks().length;
    }

    private turnTasks(): ToolBlock[] {
        const blocks = this.flow.getMessages();
        let start = 0;
        for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].kind === 'text' && blocks[i].role === 'user') {
                start = i + 1;
                break;
            }
        }
        return blocks.slice(start).filter((block): block is ToolBlock => {
            if (block.kind !== 'tool') return false;
            const tool = block as ToolBlock;
            if (tool.getStatus() === 'pending') return true;
            const action = tool.getControlAction();
            return action != null && action.kind !== 'automated_approval';
        });
    }

    pendingTasks(): ToolBlock[] {
        const acknowledged = this.getAcknowledgedToolIds();
        return this.turnTasks().filter(task => !acknowledged.has(task.toolCallId));
    }

    private actionableTasks(): ToolBlock[] {
        return this.turnTasks().filter(task => task.getStatus() === 'pending');
    }

    private acknowledge(tasks: ToolBlock[]) {
        this.setAcknowledgedToolIds(previous => {
            const next = new Set(previous);
            for (const task of tasks) next.add(task.toolCallId);
            return next;
        });
    }

    stagedAction(toolCallId: string): ControlAction | undefined {
        return this.getStagedActions()[toolCallId];
    }

    clearStagedAction(toolCallId: string): void {
        this.setStagedActions(previous => {
            if (!(toolCallId in previous)) return previous;
            const next = { ...previous };
            delete next[toolCallId];
            return next;
        });
    }

    stagedActionCount(): number {
        const actionable = new Set(this.actionableTasks().map(task => task.toolCallId));
        return Object.keys(this.getStagedActions()).filter(id => actionable.has(id)).length;
    }

    async chooseAction(toolCallId: string, action: ControlAction) {
        const actionable = this.actionableTasks();
        if (actionable.length <= 1) {
            const notifications = this.pendingTasks();
            if (await this.flow.respond(toolCallId, action)) {
                this.acknowledge(notifications);
                this.setStagedActions({});
                this.setNotificationsOpen(false);
            }
            return;
        }
        this.setStagedActions(previous => ({ ...previous, [toolCallId]: action }));
    }

    async proceedWithChoices() {
        const actionable = this.actionableTasks();
        const staged = this.getStagedActions();
        const responses = Object.fromEntries(actionable.map(task => [
            task.toolCallId,
            staged[task.toolCallId] ?? { kind: 'skipped', reason: 'Omitted when proceeding with selected choices.' },
        ])) as Record<string, ControlAction>;
        const notifications = this.pendingTasks();
        if (await this.flow.respondAll(responses)) {
            this.acknowledge(notifications);
            this.setStagedActions({});
            this.setNotificationsOpen(false);
        }
    }

    showNotifications() {
        this.setNotificationsOpen(open => !open);
    }

    async submit() {
        if (this.submitting) return;
        this.submitting = true;
        try {
            await this.attachmentRead;
            const notifications = this.pendingTasks();
            if (await this.flow.send(this.getDraft(), this.getStagedActions(), this.getAttachments())) {
                this.acknowledge(notifications);
                this.setStagedActions({});
                this.setNotificationsOpen(false);
                this.setDraft('');
                this.setAttachments([]);
            }
        } finally {
            this.submitting = false;
        }
    }

    addAttachments(files: FileList): void {
        const selected = [...files];
        this.attachmentRead = this.attachmentRead.then(() => this.readAttachments(selected));
    }

    private async readAttachments(selected: File[]): Promise<void> {
        const support = this.flow.getAttachmentSupport();
        if (!support) return;
        let total = this.getAttachments().reduce((sum, file) => sum + file.size, 0);
        for (const file of selected) {
            if (!support.mediaTypes.includes(file.type)) { this.flow.reportError(`Unsupported file type: ${file.name}`); return; }
            if (file.size > support.maxFileBytes || total + file.size > support.maxTotalBytes) { this.flow.reportError(`Attachment is too large: ${file.name}`); return; }
            total += file.size;
        }
        try {
            const attachments = await Promise.all(selected.map(async file => ({
                name: file.name,
                mediaType: file.type,
                size: file.size,
                data: await fileAsBase64(file),
            })));
            this.setAttachments(current => [...current, ...attachments]);
        } catch { this.flow.reportError('Unable to read the selected file.'); }
    }

    private scrollToBottom() {
        if (this.scrollEl) this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
    }

    revealTool(toolCallId: string) {
        const rows = this.paneEl?.querySelectorAll<HTMLElement>('[data-tool-call-id]') ?? [];
        const row = [...rows].find(candidate => candidate.dataset.toolCallId === toolCallId);
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    revealBlock(blockId: string) {
        const rows = this.paneEl?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [];
        const row = [...rows].find(candidate => candidate.dataset.blockId === blockId);
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    private reviewTool(toolCallId: string) {
        this.setNotificationsOpen(false);
        queueMicrotask(() => this.revealTool(toolCallId));
    }

    getVisual(): () => JSX.Element {
        const attachScroll = (el: HTMLDivElement) => {
            this.scrollEl = el;
        };

        createEffect(() => {
            this.flow.store.getRevision();
            // Temporarily follow every update unconditionally. Keep the separate
            // onTurnPosted hook above: it is the explicit/manual jump used when a
            // new turn is submitted and remains useful if gated following returns.
            queueMicrotask(() => this.scrollToBottom());
        });

        return () => (
            <div class={styles.pane} data-tour="chat" ref={el => { this.paneEl = el; }}>

                <Show when={this.flow.getError()}>{message => <div class={styles.errorBanner} role="alert">{message()}</div>}</Show>

                <div class={styles.chatScroll} ref={attachScroll}>
                    {/* The scroller doubles as the note clamp box. */}
                    <ChatThread
                        flow={this.flow}
                        getScroller={() => this.scrollEl}
                        getNotePortalMount={() => this.scrollEl}
                        getStagedAction={toolCallId => this.stagedAction(toolCallId)}
                        onControlAction={(toolCallId, action) => void this.chooseAction(toolCallId, action)}
                        onClearAction={toolCallId => this.clearStagedAction(toolCallId)}
                        pendingActionCount={this.actionableTasks().length}
                        stagedActionCount={this.stagedActionCount()}
                        onProceed={() => void this.proceedWithChoices()}
                        onOpenFileEdit={block => this.onOpenFileEdit?.(block)}
                    />
                </div>

                <div class={styles.floating}>
                    <Show when={this.getNotificationsOpen() && this.pendingTasks().length > 0}>
                        <PendingTasksBox
                            items={this.pendingTasks()}
                            onDismiss={() => {
                                this.acknowledge(this.pendingTasks());
                                this.setNotificationsOpen(false);
                            }}
                            onReview={toolCallId => this.reviewTool(toolCallId)}
                        />
                    </Show>
                    <Show
                        when={!this.getMinified()}
                        fallback={
                            <ResponseMinifiedBox
                                onExpand={() => this.setMinified(false)}
                                draft={this.getDraft()}
                                onDraftChange={value => this.setDraft(value)}
                                onSend={() => this.submit()}
                            />
                        }
                    >
                        <ResponseBox
                            statusCount={this.statusCount()}
                            onStatusClick={() => this.showNotifications()}
                            draft={this.getDraft()}
                            attachmentSupport={this.flow.getAttachmentSupport()}
                            attachments={this.getAttachments()}
                            onAttachmentsSelected={files => void this.addAttachments(files)}
                            onAttachmentRemove={index => this.setAttachments(current => current.filter((_, i) => i !== index))}
                            onDraftChange={(v) => this.setDraft(v)}
                            onMinify={() => this.setMinified(true)}
                            onSend={() => this.submit()}
                            onBreak={() => void this.flow.cancel()}
                            onStop={() => void this.flow.stop()}
                            steeringPolicy={this.flow.getSteeringPolicy()}
                            onSteeringPolicyChange={policy => this.flow.setSteeringPolicy(policy)}
                            approvalMode={this.flow.getApprovalMode()}
                            onApprovalModeChange={mode => void this.flow.setApprovalMode(mode)}
                            tasksOpen={this.getNotificationsOpen()}
                        />
                    </Show>
                </div>
            </div>
        );
    }
}

function fileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
        reader.readAsDataURL(file);
    });
}
