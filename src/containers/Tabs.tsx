import styles from '../styles/Tabs.module.css';
import { Accessor, Setter, For, createSignal, JSX, createMemo, Show } from 'solid-js';
import { tabDragManager, TabIntx } from '../interactions/TabDragManager';
import { TabSplitPaneFrame } from './TabSplitPane';
import { style } from 'solid-js/web';
import { X } from 'lucide-solid';
import { SourceId } from '../textmodel/SourceId';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
// TODO: Review the pointerEvent vs mouseEvent types in whole codebase

export interface ViewBlock {
    ownsScroll: boolean;
    getVisual(): () => JSX.Element;

    getScrollOffset?(): number;
    setScrollOffset?(top: number): void;

    dispose?(): void;

    makePeer?(): ViewBlock;
}

export interface SearchData {
    line: number;        // 1-based
    column?: number;     // 1-based caret column within the line
    matchLength?: number;
}

export interface Editor extends ViewBlock {
    revealSearch(data: SearchData): void;
}

export function isEditor(v: ViewBlock): v is Editor {
    return typeof (v as Partial<Editor>).revealSearch === 'function';
}

export interface SubNode extends ViewBlock {
    parent: SubNode | null;
    setParent(p: SubNode | null): void;
    removeNode(n: SubNode): void;

    preserveScroll(): void;
}

export class TabDecoration {
    id: string;
    render: () => JSX.Element;
    tooltip?: () => string;

    constructor(id: string, render: () => JSX.Element, tooltip?: () => string) {
        this.id = id;
        this.render = render;
        this.tooltip = tooltip;
    }
}

// A button a tab contributes to its container's action slot. The container owns
// the visual (uniform icon button); the action owns identity and behavior.
export class TabAction {
    id: string;

    icon: () => JSX.Element;
    tooltip: () => string;

    onInvoke: () => void;

    constructor(id: string, icon: () => JSX.Element, tooltip: () => string, onInvoke: () => void) {
        this.id = id;
        this.icon = icon;
        this.tooltip = tooltip;
        this.onInvoke = onInvoke;
    }
}

class TabSettings {
    moveable: boolean;
    closeable: boolean;

    constructor(moveable: boolean, closeable: boolean) {
        this.moveable = moveable;
        this.closeable = closeable;
    }
}

export class TabHeader {
    tab: Tab;
    tabBar: TabHeaderBar;
    settings: TabSettings;
    beingDragged: boolean = false;
    tabRef: HTMLElement | null = null;

    // Indicators for showing tab insertion to left of tab
    getShowInsert: Accessor<boolean>;
    setShowInsert: Setter<boolean>;

    // Signals to show insertion divider on right (for end-caps)
    getShowInsertRight: Accessor<boolean>;
    setShowInsertRight: Setter<boolean>;

    private menu: ContextMenu;

    constructor(tab: Tab, bar: TabHeaderBar, settings: TabSettings) {
        this.tab = tab;
        this.tabBar = bar;
        this.settings = settings;

        // No insertions shown on initialization since it's drag action triggered
        [this.getShowInsert, this.setShowInsert] = createSignal(false);
        [this.getShowInsertRight, this.setShowInsertRight] = createSignal(false);

        this.menu = new ContextMenu(this.buildMenuItems());
    }

    // The tab's right-click actions. getLabel is constant; isDisabled reads live
    // container state so each item enables/disables as the tab set changes.
    private buildMenuItems(): ContextMenuItem[] {
        const container = this.tabBar.container;
        return [
            {
                getLabel: () => 'Close',
                onSelect: () => container.closeTab(this.tab),
                isDisabled: () => !this.isCloseable(),
            },
            {
                getLabel: () => 'Close others',
                onSelect: () => container.closeOthers(this.tab),
                isDisabled: () => container.tabs.length <= 1,
            },
            {
                getLabel: () => 'Close all',
                onSelect: () => container.closeAll(),
                isDisabled: () => container.tabs.length === 0,
                isDanger: () => true,
            },
            {
                getLabel: () => 'Split to new pane',
                onSelect: () => container.splitTabToNewPane(this.tab),
                // Needs a split-frame parent and a sibling tab to leave behind.
                isDisabled: () =>
                    container.tabs.length <= 1 || !(container.parent instanceof TabSplitPaneFrame),
            },
            {
                getLabel: () => 'Copy to new pane',
                onSelect: () => container.splitTabCopyToNewPane(this.tab),
                // Copy leaves the original, so no sibling-tab requirement — only a
                // split-frame parent and a copyable tab (TerminalTab isn't).
                isDisabled: () =>
                    !(container.parent instanceof TabSplitPaneFrame) || !this.tab.canCopy(),
            },
        ];
    }

    onContextMenu(e: MouseEvent) {
        e.preventDefault();
        this.menu.openAt(e.clientX, e.clientY);
    }

    targetType(): string {
        return 'tab-header';
    }

    isMoveable(): boolean {
        return this.settings.moveable;
    }

    isCloseable(): boolean {
        return this.settings.moveable;
    }

    closeTab() {
        console.log("Closing tab");
        this.tabBar.closeTab(this);
    }

    onCloseButtonClick(e: PointerEvent) {
        e.stopPropagation();
        this.closeTab();
    }

    getGhostPreview(): HTMLElement {
        // Visual the drag ghost should render. Uses .tabDragGhost (not
        // .tabHeader) to avoid inheriting the source's :hover transition.
        const el = document.createElement('div');
        el.className = styles.tabDragGhost;
        el.textContent = this.tab.getLabel();
        return el;
    }

    getVisual() {
        return () => (
            <div style={{ position: 'relative' }}>
                {/* Core header */}
                <div
                    classList={{
                        [styles.tabHeader]: true,
                        [styles.tabHeaderActive]:
                            this.tab == this.tabBar.getActiveTabSignal()
                    }}
                    data-mode={this.tab.getMode()()}
                    ref={(el) => this.tabRef = el}
                    onClick={() => {this.tabBar.container.selectTab(this.tab)}}
                    onContextMenu={(e) => this.onContextMenu(e)}
                    onPointerDown={this.isMoveable() ? (e) => {
                        tabDragManager.onTabPointerDown(e, this);
                    } : undefined}
                >
                    {/* Decorations (dirty dot, badges) — left of the label so
                        their presence doesn't shift close/action affordances. */}
                    <For each={this.tab.getDecorations()()}>
                        {(d) => (
                            <span title={d.tooltip?.()} class={styles.tabDecoration}>
                                {d.render()}
                            </span>
                        )}
                    </For>

                    {/* Label */}
                    {this.tab.getLabel()}

                    {/* Tab indicators */}
                    <div class={styles.tabIndicatorArea}>
                    </div>

                    {/* Close button */}
                    <Show when={this.isCloseable()}>
                        <div class={styles.tabClose} aria-label="Close tab" onpointerdown={(e) => this.onCloseButtonClick(e)}>
                            <X size={16} color="currentColor" />
                        </div>
                    </Show>

                </div>

                {/* Drop index indicator for tab drag-n-drop */}
                <Show when={tabDragManager.getActiveTarget() == this.tabBar && this.getShowInsert()}>
                    <div class={styles.tabInsertionCursor}
                        style={this.getShowInsertRight() ? {right:0} : {left:0}}
                        >
                    </div>
                </Show>

                {/* Right-click menu — self-gated on its own open signal and
                    portaled out, so tree placement doesn't affect layout. */}
                {this.menu.getVisual()()}
            </div>

        );
    }
}

export class TabHeaderBar implements TabDropArea {
    container: TabContainer;
    el: HTMLDivElement | undefined;

    // The scrolling tab strip inside this.el. Kept separate from el, which stays
    // the drop-target element the drag manager hit-tests against.
    stripEl: HTMLDivElement | undefined;

    // Helper signal for showing insert indicator after end tab
    getInsertIndex: Accessor<number | null>;
    setInsertIndex: Setter<number | null>;

    // The active tab's contributed buttons. A memo so the <Show> gate and the
    // <For> don't re-read the list on unrelated bar re-renders.
    getActiveActions: Accessor<TabAction[]>;

    // Headers in tab order — preserves per-header signal state across
    // re-renders and gives O(1) index lookups for drag/insert computations
    private headers: TabHeader[] = [];

    constructor(container: TabContainer) {
        this.container = container;
        [this.getInsertIndex, this.setInsertIndex] = createSignal<number | null>(null);
        this.getActiveActions = createMemo(() => this.container.getActiveTab()?.actions ?? []);
    }

    getRef(): HTMLElement | undefined {
        return this.el;
    }

    getActiveTabSignal() {
        return this.container.getActiveTab();
    }

    onTabHover(e: PointerEvent, _hdr: TabHeader) {
        // Guarded by tabdragmanager

        // Show insert index indicator for tab
        this.updateInsertIndexByPos(e.x);
    }

    onTabDrop(e: PointerEvent, hdr: TabHeader) {
        console.log("Dropping tab");
        this.handleTabDrop(e.x, hdr);
    }

    closeTab(tabHeader: TabHeader) {
        this.container.closeTab(tabHeader.tab);
    }

    // // TODO: Set a signal to toggle either tab header or pane drop placement // each object type should turn it on by default, initially both are // set at the start of a tab drag,…

    _isOverTabBar(e: PointerEvent) {
        // Skip non-HTML target types
        if (!(e.target instanceof Element)) {
            return false;
        }

        if (e.target?.closest('[data-tabdroparea]')) {
            return true;
        }

        return false;
    }

    targetType(): string {
        return 'tab-header-bar';
    }

    onStripWheel(e: WheelEvent) {
        if (!this.stripEl) return;
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

        // Nothing to scroll — let the event bubble so an ancestor can use it.
        const maxScroll = this.stripEl.scrollWidth - this.stripEl.clientWidth;
        if (maxScroll <= 0) return;

        e.preventDefault();
        this.stripEl.scrollLeft += e.deltaY;
    }

    computeTabInsertIndex(clientX: number): number {
        // Skip if not initialized
        if (!this.el)
            return this.container.tabs.length;

        // Look for all tab headers in DOM children and calculate midpoints for each
        // as cutoff for insertion indices
        const children = Array.from(this.el.querySelectorAll<HTMLElement>(`.${styles.tabHeader}`));
        for (let i = 0; i < children.length; i++) {
            const rect = children[i].getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            if (clientX < midX)
                return i;
        }

        return children.length;
    }

    getTabHeaders(): TabHeader[] {
        const tabs = this.container.getTabs();

        // Drop headers whose tabs no longer exist
        this.headers = this.headers.filter(h => tabs.includes(h.tab));

        // Add headers for any new tabs, in tab order
        const result: TabHeader[] = [];
        for (const tab of tabs) {
            let h = this.headers.find(h => h.tab === tab);
            if (!h) {
                h = new TabHeader(tab, this, {moveable: true, closeable: true});
                this.headers.push(h);
            }
            result.push(h);
        }
        this.headers = result;
        return this.headers;
    }

    updateInsertIndexByPos(clientX: number) {
        // Compute insertion index point and update visual
        const index = this.computeTabInsertIndex(clientX);
        this.showInsertLineAtIndex(index);

        // TODO: How will we handle empty tab cases?
        // Also need to handle a separate visual for that empty tab bar hover insert because its valid
    }

    clearInsertVisuals() {
        for (let hdr of this.headers) {
            hdr.setShowInsert(false);
        }
    }

    showInsertLineAtIndex(index: number) {
        // Clear previous insert decorations
        this.clearInsertVisuals()

        // Standard left edge case
        if (index < this.headers.length) {
            this.headers[index].setShowInsert(true);
            this.headers[index].setShowInsertRight(false);
        }
        // End of header list end cap
        else if (index == this.headers.length && this.headers.length > 0) {
            this.headers[index-1].setShowInsert(true);
            this.headers[index-1].setShowInsertRight(true);
        }
        // Invalid index case (such as empty tab bar)
        else {
            // TODO: Need to fix this but this is okay for now
        }

    }

    handleTabDrop(clientX: number, hdr: TabHeader) {
        console.log("Tab bar handling tab drop");
        if (this == hdr.tabBar) {
            this.repositionTab(clientX, hdr.tab);
        } else {
            this.acceptTabDrop(clientX, hdr.tab, hdr.tabBar);
        }
    }

    repositionTab(clientX: number, tab: Tab) {
        // Computes drop index then removes from old index
        // and places in new one
        this.clearInsertVisuals();
        const prevIndex: number = this.container.getTabIndex(tab);
        const currIndex: number = this.computeTabInsertIndex(clientX);
        this.container.moveTab(prevIndex, currIndex);
    }

    acceptTabDrop(clientX: number, tab: Tab, originBar: TabHeaderBar) {
        // Clear visuals and get drop index
        this.clearInsertVisuals();
        const index = this.computeTabInsertIndex(clientX);

        this.container.transferTabFrom(originBar.container, tab, index);
    }

    removeTab(tab: Tab) {
        this.container.removeTab(tab);
    }

    getVisual() {
        return () => (
            <Show
              when={this.container.getTabs().length > 0}
              fallback={<div class={`${styles.tabHeaderArea} ${styles.tabHeaderAreaEmpty}`}></div>}
            >
                {/* Tab bar frame for drag-n-drop ops */}
                <div
                    class={styles.tabHeaderArea}
                    data-mode={this.container.getActiveTab()?.getMode()()}
                    data-droppable-type="tabheader"
                    data-tabdroparea
                    data-tour="tabs"
                    ref={this.el}
                    onPointerMove={(e) => tabDragManager.onDropAreaHover(e, this)}
                    onPointerUp={(e) => tabDragManager.onDropAreaDrop(e, this)}
                >
                    {/* Tab headers — scrolls horizontally once they overflow */}
                    <div
                        class={styles.tabStrip}
                        ref={(el) => { this.stripEl = el; }}
                        onWheel={(e) => this.onStripWheel(e)}
                    >
                        <For each={this.getTabHeaders()}>
                            {(header) => header.getVisual()()}
                        </For>
                    </div>

                    {/* Active tab's buttons, pinned outside the scrolling strip */}
                    <Show when={this.getActiveActions().length > 0}>
                        <div class={styles.tabActionArea}>
                            <For each={this.getActiveActions()}>
                                {(action) => (
                                    <button
                                        class={styles.tabActionButton}
                                        title={action.tooltip()}
                                        aria-label={action.tooltip()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={() => action.onInvoke()}
                                    >
                                        {action.icon()}
                                    </button>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>
            </Show>
        );
    }
}

// The standard tab content region is ordinary Solid composition. The
// container remains the state owner; this component only reads its signals and
// attaches the shared frame element used by tab interactions.
export function TabBody(props: { container: TabContainer }): JSX.Element {
    return (
        <div
            class={styles.tabFrame}
            ref={(el) => { props.container.frameEl = el; }}
            style={props.container.getActiveTab()?.ownsScroll ? {} : {"overflow-y": "auto"}}
        >
            <div class={styles.tab}>
                {props.container.getActiveTab()?.getVisual()()}
            </div>
        </div>
    );
}

export class TabContainer implements SubNode {
    tabs: Tab[] = [];
    getTabs: Accessor<Tab[]>;
    setTabs: Setter<Tab[]>;
    getActiveTab: Accessor<Tab | null>;
    setActiveTab: Setter<Tab | null>;
    headerBar: TabHeaderBar;
    frameEl: HTMLDivElement | undefined;

    ownsScroll: boolean = true;
    parent: SubNode | null = null;

    constructor(tabs: Tab[], parent: SubNode | null = null) {
        this.tabs = tabs;
        const activeTab = this.tabs.length > 0 ? this.tabs[0] : null;
        [this.getTabs, this.setTabs] = createSignal(this.tabs);
        [this.getActiveTab, this.setActiveTab] = createSignal(activeTab);
        this.headerBar = new TabHeaderBar(this);
        this.parent = parent;

        // A container built around an already-scrolled tab (dropTab wraps the dragged
        // tab in a fresh container) restores on first mount, not through insertTab.
        this.restoreScroll(activeTab);
    }

    getTabsList(): Tab[] {
        return [...this.tabs];
    }

    removeNode(n: SubNode): void {
        // No-op, only applies to parent nodes
    }

    setParent(p: SubNode | null): void {
        this.parent = p;
    }

    private stashScroll(): void {
        const active = this.getActiveTab();
        if (!active) return;
        const top = active.view.getScrollOffset?.();
        if (top !== undefined) active.scrollOffset = top;
    }

    // Hand a tab back its offset. Called once the new DOM is mounted, so the view
    // can write straight to its scroller.
    private restoreScroll(tab: Tab | null): void {
        if (tab?.scrollOffset !== undefined) tab.view.setScrollOffset?.(tab.scrollOffset);
    }

    preserveScroll(): void {
        this.stashScroll();
    }

    isEmpty(): boolean {
        return (this.tabs.length == 0);
    }

    updateVisual() {
        // Update tabs signal with current vlaue
        this.setTabs([...this.tabs]);
    }

    findEquivalentTab(tab: Tab): Tab | undefined {
        return this.tabs.find(existing => existing.id === tab.id);
    }

    canAcceptTab(tab: Tab): boolean {
        return this.findEquivalentTab(tab) === undefined;
    }

    // Move a tab from another container. If this container already shows the
    // same source, replace that peer in place: the user's dragged view survives,
    // the redundant destination view is disposed, and an emptied origin pane
    // collapses through removeTab's normal parent callback.
    transferTabFrom(origin: TabContainer, tab: Tab, index: number = this.tabs.length): boolean {
        if (origin === this || origin.getTabIndex(tab) === -1) return false;

        const equivalent = this.findEquivalentTab(tab);
        if (equivalent === tab) return false;

        origin.preserveScroll();
        origin.removeTab(tab);

        if (!equivalent) {
            return this.insertTab(index, tab);
        }

        // Preserve the destination's outgoing scroll before swapping its tab.
        this.stashScroll();
        const equivalentIndex = this.getTabIndex(equivalent);
        this.tabs.splice(equivalentIndex, 1, tab);
        this.setActiveTab(tab);
        this.updateVisual();
        this.restoreScroll(tab);
        equivalent.view.dispose?.();
        return true;
    }

    addTab(tab: Tab): boolean {
        if (!this.canAcceptTab(tab)) return false;

        // Add tab to end of list
        this.tabs.push(tab);
        this.updateVisual();
        this.restoreScroll(tab);
        return true;
    }

    insertTab(index: number, tab: Tab): boolean {
        if (!this.canAcceptTab(tab)) return false;

        // Add tab to specific index
        this.tabs.splice(index, 0, tab);
        this.updateVisual();

        // An arriving tab may carry an offset from the container it left; hand it
        // back now that this container's DOM holds it.
        this.restoreScroll(tab);
        return true;
    }

    selectTab(tab: Tab) {
        if (tab === this.getActiveTab()) return;

        // The frame renders only the active tab, so this signal write unmounts the
        // outgoing scroller and mounts the incoming one. Stash before, restore after.
        this.stashScroll();
        this.setActiveTab(tab);
        this.restoreScroll(tab);
    }

    removeTab(tab: Tab) {
        const i = this.tabs.indexOf(tab);
        if (i === -1) return;

        if (tab === this.getActiveTab()) this.stashScroll();

        this.tabs.splice(i, 1);
        this.adjustActiveTab(i);

        // Remove node if empty and parent is provided
        if (this.isEmpty() && this.parent) {
            this.parent.removeNode(this);
        } else {
            this.updateVisual();
        }
    }

    async closeTab(tab: Tab) {
        // Get tab index
        const index: number = this.getTabIndex(tab);
        if (index < 0) {
            return;
        }

        const view = tab.view as { confirmClose?: () => Promise<boolean> };
        if (view.confirmClose) {
            const proceed = await view.confirmClose();
            if (!proceed) return;
        }

        // Finally remove tab
        this.removeTab(tab)

        tab.view.dispose?.();
    }

    async closeOthers(keep: Tab) {
        for (const t of [...this.tabs]) {
            if (t !== keep) await this.closeTab(t);
        }
    }

    // Close all tabs (same sequential-veto behavior as closeOthers). The
    // container auto-removes from its parent frame once the last tab is gone.
    async closeAll() {
        for (const t of [...this.tabs]) {
            await this.closeTab(t);
        }
    }

    splitTabToNewPane(tab: Tab) {
        if (!(this.parent instanceof TabSplitPaneFrame) || this.tabs.length <= 1) return;

        // Stash scroll before the structural change re-renders, while the tab's
        // scroller is still mounted here (mirrors dropTab).
        this.preserveScroll();

        const newPane = new TabContainer([tab], this.parent);
        // addPane reuses the existing programmatic entry point (sets parent,
        // pushes, refreshes blocks).
        this.parent.addPane(newPane);

        // removeTab, not closeTab: the view is moving, not closing, so it must
        // not be disposed. Auto-removes this container if it goes empty.
        this.removeTab(tab);
    }

    splitTabCopyToNewPane(tab: Tab) {
        if (!(this.parent instanceof TabSplitPaneFrame) || !tab.canCopy()) return;

        const copyTab = tab.copy();
        const newPane = new TabContainer([copyTab], this.parent);
        this.parent.addPane(newPane);
        // No removeTab: the original stays put — this is a copy, not a move.
    }

    adjustActiveTab(removedIndex: number) {
        const active = this.getActiveTab();
        if (active && this.tabs.includes(active)) return;

        // Prefer the tab that shifted into the removed slot, else the
        // previous one, else null when the bar is empty.
        const next = this.tabs[removedIndex] ?? this.tabs[removedIndex - 1] ?? null;
        this.setActiveTab(next);
    }

    moveTab(fromIndex: number, toIndex: number) {
        const tab = this.tabs[fromIndex];
        if (toIndex < fromIndex) {
            // Moving left: remove from old slot first, then insert.
            // The destination index is unaffected by the removal.
            this.tabs.splice(fromIndex, 1);
            this.tabs.splice(toIndex, 0, tab);
        } else if (toIndex > fromIndex) {
            this.tabs.splice(toIndex, 0, tab);
            this.tabs.splice(fromIndex, 1);
        } else {
            // Equal: nothing to do.
            return;
        }
        this.updateVisual();
    }

    getTabIndex(tab: Tab): number {
        for (let i = 0; i < this.tabs.length; i++) {
            if (this.tabs[i] == tab) {
                return i;
            }
        }
        return -1;
    }

    // Pane families can keep TabContainer's selection/body contract while
    // supplying chrome appropriate to their scale. Editors use the full,
    // draggable TabHeaderBar; compact tool panes can override only this slot.
    protected getHeaderVisual(): JSX.Element {
        return this.headerBar.getVisual()();
    }

    protected getBodyVisual(): JSX.Element {
        return <TabBody container={this} />;
    }

    getVisual() {
        return () => (
            <div class={styles.tabContainer}>
                {this.getHeaderVisual()}
                {this.getBodyVisual()}
            </div>
        );
    }
}

export class Tab {
    view: ViewBlock;
    id: string;
    ownsScroll: boolean;

    source: SourceId;

    scrollOffset: number | undefined;

    // Buttons this tab contributes to its container's action slot. Empty means
    // the tab reserves no slot.
    actions: TabAction[] = [];

    private decorations: Accessor<TabDecoration[]> = () => [];
    private mode: Accessor<string | undefined> = () => undefined;

    getLabel: Accessor<string>;
    setLabel: Setter<string>;

    constructor(source: SourceId, view: ViewBlock, ownsScroll: boolean = false) {
        this.view = view;
        this.source = source;
        this.id = source.full();
        this.ownsScroll = ownsScroll;
        [this.getLabel, this.setLabel] = createSignal(source.label());
    }

    setActions(actions: TabAction[]) {
        this.actions = actions;
    }

    setDecorations(decorations: TabDecoration[]) {
        this.decorations = () => decorations;
    }

    setDecorationsAccessor(decorations: Accessor<TabDecoration[]>) {
        this.decorations = decorations;
    }

    getDecorations(): Accessor<TabDecoration[]> {
        return this.decorations;
    }

    setModeAccessor(mode: Accessor<string | undefined>) {
        this.mode = mode;
    }

    getMode(): Accessor<string | undefined> {
        return this.mode;
    }

    getVisual() {
        return this.view.getVisual();
    }

    revealSearch(data: SearchData) {
        if (isEditor(this.view)) this.view.revealSearch(data);
    }

    protected copySource(): SourceId {
        return this.source;
    }

    copy(): Tab {
        return new Tab(this.copySource(), this.view.makePeer!(), this.ownsScroll);
    }

    canCopy(): boolean {
        return typeof this.view.makePeer === 'function';
    }
}

export interface TabDropArea {
    onTabHover: (e: PointerEvent, hdr: TabHeader) => void;
    onTabDrop: (e: PointerEvent, hdr: TabHeader) => void;
    // onTargetChanged: (e: PointerEvent, hdr: TabHeader) => void;
    getRef(): HTMLElement | undefined;
}

// TabHeader

// Annotation frame should just have editable note too, no need for a second frame

// TODO: replace PointerMoveFunc (and similar callback types) with a generic Handler<T> wrapper class to avoid SolidJS setter ambiguity when storing functions in signals.
