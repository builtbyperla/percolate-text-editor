import { Accessor, createEffect, createSignal, For, JSX, Setter, Show, untrack } from 'solid-js';
import { Activity, Archive, Bot, ChevronDown, ChevronRight, ClipboardIcon, GitFork, Highlighter, Layers, Layers2, ListTodo, ListTree, MessagesSquare, Pencil, PencilSparkles, Plus, Shrink, UserRound, Wrench } from 'lucide-solid';
import { Tab, TabContainer, ViewBlock } from '../containers/Tabs';
import { NonDataSource } from '../textmodel/SourceId';
import styles from '../styles/AgentToolsPane.module.css';
import type { ChatFlow } from '../chat/ChatFlow';
import type { RuntimeState, SessionSummary } from '../../shared/agentProtocol';
import type { ChatBlock, TextBlock, ToolBlock } from '../chat/ChatBlockModel';
import { resolveToolSpec } from '../chat/ToolTypeSpecs';

class SessionListItem {
    readonly id: string;
    readonly agent: string;
    readonly createdAt: number;
    readonly getDisplayName: Accessor<string>;
    readonly getState: Accessor<RuntimeState>;
    readonly getUpdatedAt: Accessor<number>;
    private readonly setDisplayName: Setter<string>;
    private readonly setState: Setter<RuntimeState>;
    private readonly setUpdatedAt: Setter<number>;

    constructor(summary: SessionSummary) {
        this.id = summary.id;
        this.agent = summary.agent;
        this.createdAt = summary.createdAt;
        [this.getDisplayName, this.setDisplayName] = createSignal(summary.displayName);
        [this.getState, this.setState] = createSignal(summary.state);
        [this.getUpdatedAt, this.setUpdatedAt] = createSignal(summary.updatedAt);
    }

    update(summary: SessionSummary): void {
        this.setDisplayName(summary.displayName);
        this.setState(summary.state);
        this.setUpdatedAt(summary.updatedAt);
    }
}

export class AgentToolTab extends Tab {
    constructor(
        key: string,
        label: string,
        view: ViewBlock,
        readonly icon: () => JSX.Element,
    ) {
        super(new NonDataSource('agent-tools', key, label), view, view.ownsScroll);
    }
}

export class SessionsPane implements ViewBlock {
    ownsScroll = false;
    private getSessions: Accessor<SessionListItem[]>;
    private setSessions: Setter<SessionListItem[]>;
    private getEditingId: Accessor<string | undefined>;
    private setEditingId: Setter<string | undefined>;
    private getDraftName: Accessor<string>;
    private setDraftName: Setter<string>;

    constructor(private readonly flow: ChatFlow) {
        [this.getSessions, this.setSessions] = createSignal<SessionListItem[]>([]);
        [this.getEditingId, this.setEditingId] = createSignal();
        [this.getDraftName, this.setDraftName] = createSignal('');
        createEffect(() => { this.flow.getSessionId(); void this.refresh(); });
        this.flow.onSessionChanged = () => { void this.refresh(); };
    }
    private async refresh() {
        try {
            const summaries = await this.flow.listSessions();
            // refresh() is launched inside an effect that intentionally depends only
            // on the active session id. Reading this list as a tracked dependency
            // would make setSessions() below retrigger refresh forever at startup.
            const current = new Map(untrack(this.getSessions).map(session => [session.id, session]));
            const sessions = summaries.map(summary => {
                const session = current.get(summary.id) ?? new SessionListItem(summary);
                session.update(summary);
                return session;
            });
            this.setSessions(sessions);
        } catch { this.setSessions([]); }
    }
    private async create() { await this.flow.createSession(); await this.refresh(); }
    private async open(id: string) { await this.flow.openSession(id); }
    private async fork(id: string) { await this.flow.forkSession(id); await this.refresh(); }
    private startRename(session: SessionListItem) {
        this.setDraftName(session.getDisplayName());
        this.setEditingId(session.id);
    }
    private cancelRename() { this.setEditingId(); this.setDraftName(''); }
    private async saveRename(id: string) {
        if (this.getEditingId() !== id) return;
        const name = this.getDraftName().trim();
        this.cancelRename();
        if (name && await this.flow.renameSession(id, name)) await this.refresh();
    }
    private async archive(id: string) {
        this.cancelRename();
        if (await this.flow.archiveSession(id)) await this.refresh();
    }
    private formatUpdatedAt(timestamp: number): string {
        return new Intl.DateTimeFormat(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }).format(timestamp);
    }

    getVisual(): () => JSX.Element {
        return () => (
            <div class={styles.sessionsPane}>
                <div class={styles.sessionsToolbar}>
                    <div>
                        <div class={styles.sessionsEyebrow}>Workspace</div>
                        <div class={styles.sessionsHeading}>Agent sessions</div>
                    </div>
                    <button class={styles.newSessionButton} type="button" onClick={() => void this.create()}>
                        <Plus size={14} />
                        <span>New</span>
                    </button>
                </div>

                <Show
                    when={this.getSessions().length > 0}
                    fallback={
                        <div class={styles.sessionsEmpty}>
                            <span class={styles.sessionsEmptyIcon}><MessagesSquare size={18} /></span>
                            <strong>No sessions yet</strong>
                            <span>Start a thread to keep an agent task and its evidence together.</span>
                        </div>
                    }
                >
                    <div class={styles.sessionList} role="list" aria-label="Agent sessions">
                        <For each={this.getSessions()}>{session => {
                            const isActive = () => session.id === this.flow.getSessionId();
                            return (
                                <div
                                    class={styles.sessionRow}
                                    classList={{ [styles.sessionRowActive]: isActive() }}
                                    role="listitem"
                                >
                                    <Show when={this.getEditingId() === session.id} fallback={
                                        <button
                                            class={styles.sessionMain}
                                            type="button"
                                            onClick={() => void this.open(session.id)}
                                            aria-current={isActive() ? 'true' : undefined}
                                            title={`Session ID: ${session.id}`}
                                        >
                                            <span class={styles.sessionTitleRow}>
                                                <span class={styles.sessionState} data-state={session.getState().toLowerCase()} />
                                                <span class={styles.sessionTitle}>{session.getDisplayName() || 'Untitled session'}</span>
                                            </span>
                                            <span class={styles.sessionMeta}>
                                                {session.agent} · {this.formatUpdatedAt(session.getUpdatedAt())}
                                            </span>
                                        </button>
                                    }>
                                        <div class={styles.sessionMain}>
                                            <input
                                                class={styles.renameInput}
                                                value={this.getDraftName()}
                                                onInput={event => this.setDraftName(event.currentTarget.value)}
                                                onBlur={() => void this.saveRename(session.id)}
                                                onKeyDown={event => {
                                                    if (event.key === 'Enter') void this.saveRename(session.id);
                                                    if (event.key === 'Escape') this.cancelRename();
                                                }}
                                                ref={element => queueMicrotask(() => { element.focus(); element.select(); })}
                                                aria-label="Session display name"
                                            />
                                            <span class={styles.sessionId} title={session.id}>{session.id}</span>
                                        </div>
                                    </Show>
                                    <div class={styles.sessionActions}>
                                        <button
                                            class={styles.sessionActionButton}
                                            type="button"
                                            onClick={() => this.startRename(session)}
                                            aria-label={`Rename ${session.getDisplayName() || 'session'}`}
                                            title="Rename session"
                                        >
                                            <Pencil size={12} />
                                        </button>
                                        <button
                                            class={styles.sessionActionButton}
                                            type="button"
                                            onClick={() => void this.fork(session.id)}
                                            aria-label={`Fork ${session.getDisplayName() || 'session'}`}
                                            title="Fork session"
                                        >
                                            <GitFork size={12} />
                                        </button>
                                        <button
                                            class={`${styles.sessionActionButton} ${styles.archiveButton}`}
                                            type="button"
                                            onClick={() => void this.archive(session.id)}
                                            aria-label={`Archive ${session.getDisplayName() || 'session'}`}
                                            title="Archive session"
                                        >
                                            <Archive size={12} />
                                        </button>
                                    </div>
                                </div>
                            );
                        }}</For>
                    </div>
                </Show>
            </div>
        );
    }
}

export class ActivityPane implements ViewBlock {
    ownsScroll = false;
    private readonly getCompacting: Accessor<boolean>;
    private readonly setCompacting: Setter<boolean>;

    constructor(
        private readonly flow: ChatFlow,
        private readonly onReveal: (blockId: string) => void,
    ) {
        [this.getCompacting, this.setCompacting] = createSignal(false);
    }

    private async compact(): Promise<void> {
        this.setCompacting(true);
        try { await this.flow.compact(); }
        finally { this.setCompacting(false); }
    }

    private items(): ChatBlock[] {
        // Subscribe the pane to settles/deltas as well as block creation. Tool
        // instances own their signals, while the revision covers session hydration.
        this.flow.store.getRevision();
        return [...this.flow.getMessages()].reverse();
    }

    private formatTime(timestamp: number): string {
        return new Intl.DateTimeFormat(undefined, {
            hour: 'numeric', minute: '2-digit', second: '2-digit',
        }).format(timestamp);
    }

    getVisual(): () => JSX.Element {
        return () => (
            <div class={styles.activityPane}>
                <div class={styles.activityToolbar}>
                    <Show when={this.flow.getContextStats()}>{stats => (
                        <div class={styles.activityContext} aria-label="Active context">
                            <div class={styles.activityContextDetails}>
                                <strong>Context usage</strong>
                                <span
                                    class={styles.tokenEstimate}
                                    tabIndex={0}
                                    aria-label={`Approximately ${stats().estimatedTokens.toLocaleString()} tokens`}
                                    aria-describedby="activity-token-estimate-help"
                                >
                                    ~{stats().estimatedTokens.toLocaleString()} tokens
                                    <span
                                        class={styles.tokenEstimateTooltip}
                                        id="activity-token-estimate-help"
                                        role="tooltip"
                                    >
                                        Estimate based on character count. Actual usage varies by provider and model.
                                    </span>
                                </span>
                            </div>
                            <button
                                class={styles.compactButton}
                                type="button"
                                disabled={this.getCompacting() || stats().activeMessages < 2}
                                onClick={() => void this.compact()}
                                title="Append a local summary and use it as the start of future model context"
                            >
                                <Shrink size={13} />
                                <span>{this.getCompacting() ? 'Compacting…' : 'Compact'}</span>
                            </button>
                        </div>
                    )}</Show>
                </div>

                <Show
                    when={this.items().length > 0}
                    fallback={
                        <div class={styles.sessionsEmpty}>
                            <span class={styles.sessionsEmptyIcon}><Activity size={18} /></span>
                            <strong>No activity yet</strong>
                            <span>Messages and tool calls from this session will appear here.</span>
                        </div>
                    }
                >
                    <div class={styles.activityFeed}>
                        <div class={styles.activityList} role="list" aria-label="Current session activity">
                            <For each={this.items()}>{item => {
                                if (item.kind === 'text') {
                                    const message = item as TextBlock;
                                    return (
                                        <button
                                            class={styles.activityRow}
                                            type="button"
                                            role="listitem"
                                            onClick={() => this.onReveal(message.id)}
                                            title="Show in conversation"
                                        >
                                            <span class={styles.activityMessageIcon}>
                                                {message.role === 'user' ? <UserRound size={13} /> : <Bot size={13} />}
                                            </span>
                                            <span class={styles.activityContent}>
                                                <span class={styles.activityTitleLine}>
                                                    <span class={styles.activityName}>{message.origin === 'system' ? 'System event' : message.role === 'user' ? 'User message' : 'Agent message'}</span>
                                                    <span class={styles.activityTime}>{this.formatTime(message.timestamp)}</span>
                                                </span>
                                                <span class={styles.activityDetail}>
                                                    <span class={styles.activitySubject}>{message.getContent().trim().replace(/\s+/g, ' ') || 'Message in progress…'}</span>
                                                </span>
                                            </span>
                                        </button>
                                    );
                                }
                                const tool = item as ToolBlock;
                                const spec = resolveToolSpec(tool.type);
                                return (
                                    <button
                                        class={styles.activityRow}
                                        type="button"
                                        role="listitem"
                                        data-status={tool.getStatus()}
                                        onClick={() => this.onReveal(tool.id)}
                                        title="Show in conversation"
                                    >
                                        <span class={styles.activityToolIcon}><Wrench size={13} /></span>
                                        <span class={styles.activityContent}>
                                            <span class={styles.activityTitleLine}>
                                                <span class={styles.activityName}>{spec.label}</span>
                                                <span class={styles.activityTime}>{this.formatTime(tool.timestamp)}</span>
                                            </span>
                                            <span class={styles.activityDetail}>
                                                <span class={styles.activitySubject}>{tool.getSubject() || 'Agent tool call'}</span>
                                                <span class={styles.activityStatus}>{tool.getStatus()}</span>
                                            </span>
                                        </span>
                                    </button>
                                );
                            }}</For>
                        </div>
                    </div>
                </Show>
            </div>
        );
    }
}

export class AgentToolsPane extends TabContainer {
    // Header including its border. Collapsing keeps this pane in the split and
    // moves the divider here; the mounted tool body is only made invisible.
    readonly minimumPaneSize = 30;
    readonly getCollapsed: Accessor<boolean>;
    private readonly setCollapsed: Setter<boolean>;
    private onCollapseChange: (collapsed: boolean) => void = () => undefined;

    constructor(
        tabs: AgentToolTab[],
    ) {
        super(tabs);
        [this.getCollapsed, this.setCollapsed] = createSignal(false);
    }

    setCollapseListener(listener: (collapsed: boolean) => void): void {
        this.onCollapseChange = listener;
    }

    private toggleCollapsed = (): void => {
        const collapsed = !this.getCollapsed();
        this.setCollapsed(collapsed);
        this.onCollapseChange(collapsed);
    };

    onPaneResize(size: number): void {
        if (size > this.minimumPaneSize + 2 && this.getCollapsed()) {
            this.setCollapsed(false);
        }
    }

    getVisual(): () => JSX.Element {
        return () => (
            <div class={styles.container}>
                {this.getHeaderVisual()}
                <div
                    class={styles.body}
                    classList={{ [styles.bodyHidden]: this.getCollapsed() }}
                    aria-hidden={this.getCollapsed()}
                >
                    {this.getBodyVisual()}
                </div>
            </div>
        );
    }

    protected getHeaderVisual(): JSX.Element {
        // TODO: We wanted this to be done with tab header bar via an interface mechanism
        return (
            <div class={styles.header}>
                <button
                    class={styles.hideButton}
                    title={this.getCollapsed() ? 'Show tool view' : 'Hide tool view'}
                    aria-label={this.getCollapsed() ? 'Show tool view' : 'Hide tool view'}
                    aria-expanded={!this.getCollapsed()}
                    onClick={this.toggleCollapsed}
                >
                    {this.getCollapsed() ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                </button>

                <span class={styles.title}>{this.getActiveTab()?.getLabel()}</span>

                <div class={styles.tabs} role="tablist" aria-label="Agent tools">
                    <For each={this.getTabs() as AgentToolTab[]}>
                        {(tab) => (
                            <button
                                class={styles.tabButton}
                                classList={{ [styles.active]: this.getActiveTab() === tab }}
                                role="tab"
                                aria-selected={this.getActiveTab() === tab}
                                aria-label={tab.getLabel()}
                                title={tab.getLabel()}
                                onClick={() => this.selectTab(tab)}
                            >
                                {tab.icon()}
                            </button>
                        )}
                    </For>
                </div>
            </div>
        );
    }
}

export function createContextToolTab(view: ViewBlock): AgentToolTab {
    return new AgentToolTab('context', 'Context', view, () => <PencilSparkles size={16} />);
}

export function createSessionsToolTab(view: SessionsPane): AgentToolTab {
    return new AgentToolTab('sessions', 'Sessions', view, () => <Layers size={16} />);
}

export function createActivityToolTab(view: ActivityPane): AgentToolTab {
    return new AgentToolTab('activity', 'Activity', view, () => <Activity size={16} />);
}
