import { Accessor, Setter, JSXElement, For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Minimize2, Maximize2, Square, Send, Paperclip, ChevronLeft, ChevronRight, ChevronUp, Check, X, Bell } from 'lucide-solid';
import styles from '../styles/ChatPane.module.css';
import type { ApprovalMode, AttachmentDTO, AttachmentSupportDTO, SteeringPolicy } from '../../shared/agentProtocol';
import type { ToolBlock } from './ChatBlockModel';
import { resolveToolSpec } from './ToolTypeSpecs';

// One icon button used across both toolbars and the options bar. `send` gives
// the expanded composer send action its filled accent styling.
export function Button(props: {
    icon?: JSXElement;
    onClick: () => void;
    label: string;
    send?: boolean;
    showLabel?: boolean;
    disabled?: boolean;
    attachedToMode?: boolean;
}) {
    return (
        <button
            type="button"
            classList={{
                [styles.button]: true,
                [styles.sendButton]: props.send,
                [styles.sendButtonAttached]: props.attachedToMode,
            }}
            aria-label={props.label}
            title={props.label}
            disabled={props.disabled}
            onClick={() => props.onClick()}
        >
            {props.icon}
            <Show when={props.showLabel}>
                <span class={styles.buttonLabel}>{props.label}</span>
            </Show>
        </button>
    );
}

export function StatusButton(props: { count: number; onClick: () => void; expanded: boolean }) {
    return (
        <button
            type="button"
            classList={{
                [styles.button]: true,
                [styles.buttonActive]: props.count > 0,
            }}
            aria-label="Pending tasks"
            title={props.count > 0 ? `${props.count} pending tasks` : 'No pending tasks'}
            aria-expanded={props.expanded}
            onClick={() => props.onClick()}
        >
            <Bell size={14} />
            <Show when={props.count > 0}>
                <span class={styles.statusBadge}>{props.count}</span>
            </Show>
        </button>
    );
}

export class PagerState {
    label: string;
    getItems: Accessor<string[]>;
    setItems: Setter<string[]>;
    getPage: Accessor<number>;
    setPage: Setter<number>;

    constructor(label: string, items: string[]) {
        this.label = label;
        [this.getItems, this.setItems] = createSignal(items);
        [this.getPage, this.setPage] = createSignal(0);
    }

    total(): number {
        return this.getItems().length;
    }

    prev() {
        this.setPage((p) => Math.max(0, p - 1));
    }

    next() {
        this.setPage((p) => Math.min(this.total() - 1, p + 1));
    }

    // Dismiss clears the whole row; reset page so a refilled list starts clean.
    dismiss() {
        this.setItems([]);
        this.setPage(0);
    }

    // A count + label row with left/right pager controls. Reads position/total off
    // this state and disables the arrows at the ends.
    getVisual(): () => JSXElement {
        return () => (
            <div class={styles.pagerRow}>
                {/* Count */}
                <span class={styles.pagerCount}>{this.total()}</span>

                {/* Label ("actions", "artifacts", …) */}
                <span class={styles.pagerLabel}>{this.label}</span>

                <div class={styles.pagerControls}>
                    {/* Left button */}
                    <Button
                        icon={<ChevronLeft size={14} />}
                        onClick={() => this.prev()}
                        label="Previous"
                        disabled={this.getPage() <= 0}
                    />
                    <span class={styles.pagerPosition}>
                        {this.total() > 0 ? `${this.getPage() + 1} / ${this.total()}` : '0 / 0'}
                    </span>
                    {/* Right button */}
                    <Button
                        icon={<ChevronRight size={14} />}
                        onClick={() => this.next()}
                        label="Next"
                        disabled={this.getPage() >= this.total() - 1}
                    />

                    {/* Dismiss — clears the row (user has seen all) */}
                    <Button
                        icon={<X size={14} />}
                        onClick={() => this.dismiss()}
                        label="Dismiss"
                    />
                </div>
            </div>
        );
    }
}

export function TodoBox(props: { actions: PagerState; artifacts: PagerState }) {
    return (
        <div class={styles.todoBox}>
            {/* Actions row — dismiss removes the whole row */}
            <Show when={props.actions.total() > 0}>
                {props.actions.getVisual()()}
            </Show>

            {/* Artifacts row — dismiss removes the whole row */}
            <Show when={props.artifacts.total() > 0}>
                {props.artifacts.getVisual()()}
            </Show>
        </div>
    );
}

// A compact navigator for the current turn's unacknowledged items. Decisions
// remain on the inline tool cards; this surface only reviews or dismisses them.
export function PendingTasksBox(props: {
    items: ToolBlock[];
    onDismiss: () => void;
    onReview: (toolCallId: string) => void;
}) {
    const [getPage, setPage] = createSignal(0);
    const current = () => props.items[getPage()];

    createEffect(() => {
        const lastPage = Math.max(0, props.items.length - 1);
        setPage(page => Math.min(page, lastPage));
    });

    return (
        <div class={styles.todoBox} role="region" aria-label="Notifications">
            <div class={styles.pagerRow}>
                <span class={styles.pagerCount}>{props.items.length}</span>
                <span class={styles.pagerLabel}>notifications</span>

                <div class={styles.pagerControls}>
                    <Button icon={<ChevronLeft size={14} />} onClick={() => setPage(page => Math.max(0, page - 1))} label="Previous notification" disabled={getPage() <= 0} />
                    <span class={styles.pagerPosition}>{getPage() + 1} / {props.items.length}</span>
                    <Button icon={<ChevronRight size={14} />} onClick={() => setPage(page => Math.min(props.items.length - 1, page + 1))} label="Next notification" disabled={getPage() >= props.items.length - 1} />
                    <Button icon={<X size={14} />} onClick={props.onDismiss} label="Dismiss notifications" />
                </div>
            </div>

            <Show when={current()}>{item => {
                const spec = resolveToolSpec(item().type);
                return (
                    <div class={styles.pendingTaskSummary}>
                        <span class={styles.pendingTaskName}>{spec.label}</span>
                        <Show when={item().getSubject()}>
                            <span class={styles.pendingTaskSubject}>{item().getSubject()}</span>
                        </Show>
                        <button type="button" onClick={() => props.onReview(item().toolCallId)}>Review inline</button>
                    </div>
                );
            }}</Show>
        </div>
    );
}

export function ResponseMinifiedBox(props: {
    onExpand: () => void;
    draft: string;
    onDraftChange: (v: string) => void;
    onSend: () => void;
}) {
    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            props.onSend();
        }
    }

    return (
        <div class={styles.minifiedBox}>
            <Button
                icon={<Maximize2 size={14} />}
                onClick={props.onExpand}
                label="Expand"
            />
            <input
                class={styles.minifiedInput}
                aria-label="Response"
                placeholder="Respond to the agent…"
                value={props.draft}
                onInput={e => props.onDraftChange(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
            />
            <Button icon={<Send size={14} />} onClick={props.onSend} label="Send" />
        </div>
    );
}

export function ResponseBox(props: {
    statusCount: number;
    onStatusClick: () => void;
    draft: string;
    attachmentSupport?: AttachmentSupportDTO;
    attachments: AttachmentDTO[];
    onAttachmentsSelected: (files: FileList) => void;
    onAttachmentRemove: (index: number) => void;
    onDraftChange: (v: string) => void;
    onMinify: () => void;
    onSend: () => void;
    onBreak: () => void;
    onStop: () => void;
    steeringPolicy: SteeringPolicy;
    onSteeringPolicyChange: (policy: SteeringPolicy) => void;
    approvalMode: ApprovalMode;
    onApprovalModeChange: (mode: ApprovalMode) => void;
    tasksOpen: boolean;
}) {
    const [openMenu, setOpenMenu] = createSignal<'agent' | 'message' | null>(null);
    let fileInput: HTMLInputElement | undefined;

    createEffect(() => {
        if (!openMenu()) return;
        const closeOutside = (event: PointerEvent) => {
            if (!(event.target as Element | null)?.closest?.(`.${styles.menuAnchor}`)) setOpenMenu(null);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpenMenu(null);
        };
        document.addEventListener('pointerdown', closeOutside, true);
        document.addEventListener('keydown', closeOnEscape, true);
        onCleanup(() => {
            document.removeEventListener('pointerdown', closeOutside, true);
            document.removeEventListener('keydown', closeOnEscape, true);
        });
    });

    // Enter sends; Shift+Enter inserts a newline.
    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            props.onSend();
        }
    }
    const steeringOptions: { value: SteeringPolicy; label: string; initial: string; title: string }[] = [
        { value: 'QUEUE', label: 'Queue', initial: 'Q', title: 'Finish the current turn, then send' },
        { value: 'INTERRUPT', label: 'Interrupt', initial: 'I', title: 'Stop the current turn and send now' },
        { value: 'APPEND', label: 'Append', initial: 'A', title: 'Add this to the current turn' },
    ];
    const approvalOptions: { value: ApprovalMode; label: string; title: string }[] = [
        { value: 'ask', label: 'Ask', title: 'Run inspection tools automatically and ask before changes or commands' },
        { value: 'operate', label: 'Operate', title: 'Run ordinary tools automatically' },
        { value: 'timer-quick', label: 'Timer', title: 'Review changes briefly, then approve automatically' },
    ];
    const currentSteering = () => steeringOptions.find(option => option.value === props.steeringPolicy)!;
    const currentApproval = () => approvalOptions.find(option => option.value === props.approvalMode)!;

    return (
        <div class={styles.responseBox}>
            {/* Options bar */}
            <div class={styles.optionsBar}>
                <Show when={props.attachmentSupport}>
                    <input
                        ref={fileInput}
                        type="file"
                        multiple
                        accept={props.attachmentSupport?.mediaTypes.join(',')}
                        class={styles.hiddenFileInput}
                        aria-label="Choose attachments"
                        onChange={event => {
                            if (event.currentTarget.files) props.onAttachmentsSelected(event.currentTarget.files);
                            event.currentTarget.value = '';
                        }}
                    />
                    <Button icon={<Paperclip size={14} />} onClick={() => fileInput?.click()} label="Attach file" />
                </Show>
                <StatusButton count={props.statusCount} onClick={props.onStatusClick} expanded={props.tasksOpen} />
                <div class={styles.optionsSpacer} />
                <div class={styles.menuAnchor}>
                    <button
                        type="button"
                        class={styles.modeTrigger}
                        aria-haspopup="menu"
                        aria-expanded={openMenu() === 'agent'}
                        aria-label={`Agent mode: ${currentApproval().label}`}
                        title={`Agent mode: ${currentApproval().label}`}
                        onClick={() => setOpenMenu(openMenu() === 'agent' ? null : 'agent')}
                    >
                        <span>{currentApproval().label}</span>
                        <ChevronUp size={12} />
                    </button>
                    <Show when={openMenu() === 'agent'}>
                        <div class={`${styles.modeMenu} ${styles.agentModeMenu}`} role="menu" aria-label="Agent mode">
                            <div class={styles.modeMenuLabel}>Agent mode</div>
                            {approvalOptions.map(option => (
                                <button
                                    type="button"
                                    classList={{
                                        [styles.modeMenuItem]: true,
                                        [styles.modeMenuItemActive]: props.approvalMode === option.value,
                                    }}
                                    role="menuitemradio"
                                    aria-checked={props.approvalMode === option.value}
                                    onClick={() => {
                                        setOpenMenu(null);
                                        props.onApprovalModeChange(option.value);
                                    }}
                                >
                                    <span class={styles.modeMenuCheck}><Check size={12} /></span>
                                    <span class={styles.modeMenuCopy}>
                                        <span class={styles.modeMenuTitle}>{option.label}</span>
                                        <span class={styles.modeMenuDescription}>{option.title}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </Show>
                </div>
            </div>

            {/* User text input */}
            <div class={styles.inputArea}>
                <textarea
                    class={styles.textarea}
                    placeholder="Respond to the agent…"
                    rows={3}
                    value={props.draft}
                    onInput={(e) => props.onDraftChange(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                />
            </div>
            <Show when={props.attachments.length > 0}>
                <div class={styles.attachmentList} aria-label="Selected attachments">
                    <For each={props.attachments}>{(file, index) => (
                        <span class={styles.attachmentPill}>
                            <span class={styles.attachmentKind}>File</span>
                            <span class={styles.attachmentName} title={file.name}>{file.name}</span>
                            <button type="button" aria-label={`Remove ${file.name}`} onClick={() => props.onAttachmentRemove(index())}><X size={12} /></button>
                        </span>
                    )}</For>
                </div>
            </Show>

            {/* Toolbar */}
            <div class={styles.toolbar}>
                {/* Minify button */}
                <Button
                    icon={<Minimize2 size={14} />}
                    onClick={() => props.onMinify()}
                    label="Minify"
                />

                <div class={styles.toolbarSpacer} />

                {/* Stop button */}
                <Button
                    icon={<Square size={13} />}
                    onClick={props.onStop}
                    label="Stop"
                />

                <div class={styles.sendGroup}>
                    <div class={styles.menuAnchor}>
                        <button
                            type="button"
                            class={`${styles.button} ${styles.sendButton} ${styles.messageModeButton}`}
                            aria-haspopup="menu"
                            aria-expanded={openMenu() === 'message'}
                            aria-label={`Message mode: ${currentSteering().label}`}
                            onClick={() => setOpenMenu(openMenu() === 'message' ? null : 'message')}
                        >
                            <ChevronUp size={12} />
                        </button>
                        <Show when={openMenu() === 'message'}>
                            <div class={`${styles.modeMenu} ${styles.messageModeMenu}`} role="menu" aria-label="Message mode">
                                <div class={styles.modeMenuLabel}>Message mode</div>
                                {steeringOptions.map(option => (
                                    <button
                                        type="button"
                                        classList={{
                                            [styles.modeMenuItem]: true,
                                            [styles.modeMenuItemActive]: props.steeringPolicy === option.value,
                                        }}
                                        role="menuitemradio"
                                        aria-checked={props.steeringPolicy === option.value}
                                        onClick={() => {
                                            props.onSteeringPolicyChange(option.value);
                                            setOpenMenu(null);
                                        }}
                                    >
                                        <span class={styles.modeInitial}>{option.initial}</span>
                                        <span class={styles.modeMenuCopy}>
                                            <span class={styles.modeMenuTitle}>{option.label}</span>
                                            <span class={styles.modeMenuDescription}>{option.title}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </Show>
                    </div>
                    <Button
                        onClick={() => props.onSend()}
                        label="Send"
                        send
                        showLabel
                        attachedToMode
                    />
                </div>
            </div>
        </div>
    );
}
