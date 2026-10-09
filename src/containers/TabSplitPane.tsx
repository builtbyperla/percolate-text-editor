import { createSignal, Accessor, Setter, JSX, For, Show } from 'solid-js';
import styles from '../styles/SplitPane.module.css';
import { SplitPaneFrame } from './SplitPane';
import { SubNode, Tab, TabContainer, TabDropArea, TabHeader, TabHeaderBar } from './Tabs';
import { tabDragManager } from '../interactions/TabDragManager';
import { Grid2x2 } from 'lucide-solid';

export type DropDirection = 'top' | 'bottom' | 'left' | 'right';
type WholePaneDropTarget = {
    kind: 'whole-pane';
    paneIndex: number;
};
type SplitDropTarget = {
    kind: 'split';
    paneIndex: number;
    direction: DropDirection;
};
export type DropTarget = WholePaneDropTarget | SplitDropTarget | null;

function isHorizontalSplit(direction: DropDirection): boolean {
    return direction === 'left' || direction === 'right';
}

const EDGE_BAND = 0.25;

function isInPaneCenter(position: number): boolean {
    return position > EDGE_BAND && position < 1 - EDGE_BAND;
}

// Minimum post-split dimension. A split is only offered along an axis when
// the pane is large enough that both halves would clear this threshold.
const MIN_SPLIT_PX = 160;

function dropIndicatorStyle(target: WholePaneDropTarget | SplitDropTarget): JSX.CSSProperties {
    const base: JSX.CSSProperties = { position: 'absolute', 'pointer-events': 'none' };

    if (target.kind === 'whole-pane') {
        return { ...base, inset: '0' };
    }

    switch (target.direction) {
        case 'left':
            return { ...base, top: '0', bottom: '0', left: '0', width: '50%' };
        case 'right':
            return { ...base, top: '0', bottom: '0', right: '0', width: '50%' };
        case 'top':
            return { ...base, top: '0', left: '0', right: '0', height: '50%' };
        case 'bottom':
            return { ...base, bottom: '0', left: '0', right: '0', height: '50%' };
    }
}

export class TabSplitPaneFrame extends SplitPaneFrame<SubNode> implements SubNode, TabDropArea {
    getHoverTarget: Accessor<DropTarget>;
    setHoverTarget: Setter<DropTarget>;
    // Keyed by pane identity: cached blocks only fire their ref once, so an
    // index-keyed slot would go stale when a sibling is added/removed.
    paneEls: Map<SubNode, HTMLElement> = new Map();
    ownsScroll: boolean = true;
    parent: SubNode | null = null;

    constructor(isHorizontal: boolean = false, panes: SubNode[] = [], parent: SubNode | null = null) {
        super(isHorizontal, panes);

        for (let p of panes) {
            p.setParent(this);
        }

        this.parent = parent;

        [this.getHoverTarget, this.setHoverTarget] = createSignal<DropTarget>(null);
    }

    getRef(): HTMLElement | undefined {
        return this.containerRef;
    }

    onTabHover(e: PointerEvent, hdr: TabHeader) {
        // Guarded by tab drag manager, do not call without guard

        let dropTarget = this.computeDropTarget(e.x, e.y);

        // Do not advertise a whole-pane drop that would be rejected on release.
        if (dropTarget?.kind === 'whole-pane') {
            const destination = this.getWholePaneDestination(dropTarget, hdr.tab, hdr.tabBar);
            if (!destination) {
                dropTarget = null;
            }
        }

        this.setHoverTarget(dropTarget);
    }

    addPane(node: SubNode) {
        node.setParent(this);
        this.panes.push(node);
        this.refreshBlocks();
    }

    onTabDrop(e: PointerEvent, hdr: TabHeader) {
        // Guarded by tab drag manager, do not call without guard

        // Clear hover indicator
        this.clearHoverTarget();

        // Drop tab in place
        this.dropTab(hdr.tab, e.x, e.y, hdr.tabBar);
    }

    setParent(p: SubNode | null): void {
        this.parent = p;
    }

    preserveScroll(): void {
        for (const pane of this.panes) pane.preserveScroll();
    }

    removeNode(n: SubNode): void {
        // Find the pane and drop it from the array
        const idx = this.getPaneIndex(n);
        if (idx === -1) return;

        // Remove node
        this.panes.splice(idx, 1);

        // Remove self if empty or recompute blocks
        if (this.parent && (this.panes.length == 0)) {
            this.parent.removeNode(this);
        } 
        else {
            this._initBlocks();
            this.setBlocks(this.blocks);
        }
    }

    // Resolve a pointer to either the middle of a leaf pane or one of its
    // splittable edges.
    computeDropTarget(clientX: number, clientY: number): DropTarget {
        if (!this.containerRef) return null;

        for (let i = 0; i < this.panes.length; i++) {
            // Match pane ref to actual pane
            const pane: SubNode = this.panes[i];

            if (pane instanceof SplitPaneFrame) {
                continue;
            }

            const el = this.paneEls.get(pane);
            if (!el) continue;
            const r = el.getBoundingClientRect();

            // Get inner bounding rect for pane if available
            const isOutsidePane = clientX < r.left ||
                clientX > r.right ||
                clientY < r.top ||
                clientY > r.bottom;
            if (isOutsidePane) continue;

            // Normalized pointer position within the pane, 0..1 on each axis.
            const horizontalPosition = (clientX - r.left) / r.width;
            const verticalPosition = (clientY - r.top) / r.height;

            const isWholePaneDrop = isInPaneCenter(horizontalPosition) &&
                isInPaneCenter(verticalPosition);
            if (isWholePaneDrop) {
                return { kind: 'whole-pane', paneIndex: i };
            }

            // A split is only viable along an axis with room for both halves
            // to clear MIN_SPLIT_PX.
            const canSplitHorizontally = r.width >= MIN_SPLIT_PX * 2;
            const canSplitVertically = r.height >= MIN_SPLIT_PX * 2;

            // Build candidate edges from splittable axes only, then pick the
            // one closest to the pointer.
            const candidates: { direction: DropDirection; distance: number }[] = [];
            if (canSplitHorizontally) {
                candidates.push({ direction: 'left', distance: horizontalPosition });
                candidates.push({ direction: 'right', distance: 1 - horizontalPosition });
            }
            if (canSplitVertically) {
                candidates.push({ direction: 'top', distance: verticalPosition });
                candidates.push({ direction: 'bottom', distance: 1 - verticalPosition });
            }

            // Pointer is in an edge band but the pane is too small to honor
            // any split direction — nothing valid to return.
            if (candidates.length === 0) return null;

            candidates.sort((a, b) => a.distance - b.distance);
            return { kind: 'split', paneIndex: i, direction: candidates[0].direction };
        }

        return null;
    }

    // Clears the hover preview. Called when the drag leaves the frame or
    // ends, so the indicator disappears.
    clearHoverTarget() {
        this.setHoverTarget(null);
    }

    // Route a valid drop to either a whole-pane move or an edge split.
    dropTab(tab: Tab, clientX: number, clientY: number, originTabBar: TabHeaderBar) {
        const target = this.computeDropTarget(clientX, clientY);
        if (!target) return;

        if (target.kind === 'whole-pane') {
            this.dropTabIntoPane(target, tab, originTabBar);
            return;
        }

        this.splitTabAtEdge(target, tab, originTabBar);
    }

    private getWholePaneDestination(
        target: WholePaneDropTarget,
        tab: Tab,
        originTabBar: TabHeaderBar,
    ): TabContainer | null {
        const destination = this.panes[target.paneIndex];
        if (!(destination instanceof TabContainer)) return null;
        if (destination === originTabBar.container) return null;

        return destination;
    }

    private dropTabIntoPane(
        target: WholePaneDropTarget,
        tab: Tab,
        originTabBar: TabHeaderBar,
    ) {
        const destination = this.getWholePaneDestination(target, tab, originTabBar);
        if (!destination) return;

        destination.transferTabFrom(originTabBar.container, tab);
    }

    private splitTabAtEdge(target: SplitDropTarget, tab: Tab, originTabBar: TabHeaderBar) {
        originTabBar.container.preserveScroll();

        const splitIsHorizontal = isHorizontalSplit(target.direction);
        const newPaneGoesAfterTarget = target.direction === 'right' ||
            target.direction === 'bottom';

        // The frame already runs in the requested direction, so the new pane
        // can be inserted directly beside the target.
        if (splitIsHorizontal === this.getIsHorizontal()) {
            let insertAt = target.paneIndex;
            if (newPaneGoesAfterTarget) {
                insertAt += 1;
            }

            const newPane = new TabContainer([tab], this);
            this.panes.splice(insertAt, 0, newPane);
        }
        // A different direction needs a nested split in place of the target.
        else {
            const targetPane = this.panes[target.paneIndex];
            const tabPane = new TabContainer([tab], this);

            let children: SubNode[] = [tabPane, targetPane];
            if (newPaneGoesAfterTarget) {
                children = [targetPane, tabPane];
            }

            targetPane.preserveScroll();
            const nestedSplit = new TabSplitPaneFrame(splitIsHorizontal, children, this);
            this.panes.splice(target.paneIndex, 1, nestedSplit);
        }

        this._initBlocks();
        this.setBlocks(this.blocks);

        // TODO, when creating new panes, need to refer to original parent
        // pane for its removal so we can remove empty cases, drop single tab panes

        // TODO: Try catch here too
        originTabBar.removeTab(tab);
    }

    _wrapPane(pane: SubNode, frac: Accessor<number>) {
        const paneClass = pane.ownsScroll ? styles.paneSelfManagedScroll : styles.paneScroll;
        return () => (
            <div class={styles.pane} ref={(el) => { this.paneEls.set(pane, el); }} style={{ flex: `${frac()} 1 0`, position: 'relative' }}>
                <div class={paneClass}>
                    {pane.getVisual()()}
                </div>
                <Show when={tabDragManager.getActiveTarget() == this && (() => {
                    const t = this.getHoverTarget();
                    return t?.paneIndex === this.getPaneIndex(pane) ? t : null;
                })()}>
                    {(target) => (
                        <div
                            class={styles.dropIndicator}
                            style={dropIndicatorStyle(target())}
                        />
                    )}
                </Show>
            </div>
        );
    }

    getFallbackVisual() {
        // For when all tabs are closed
        return (
            <div class={styles.emptySplitPane}>
                <Grid2x2/>
                <div style={{'padding-top':'5px'}}>No tabs open</div>
            </div>
        );
    }

    // Visual rendering
    getVisual(): () => JSX.Element {
        return () => (
            <div
                class={styles.container}
                classList={{ [styles.horizontal]: this.getIsHorizontal() }}
                data-tabdroparea
                onPointerMove={(e) => tabDragManager.onDropAreaHover(e, this)}
                onPointerUp={(e) => tabDragManager.onDropAreaDrop(e, this)}
                ref={(el) => { this.containerRef = el; }}
            >
                {/* Show blocks or empty fallback */}
                <Show when={this.getBlocks().length > 0} fallback={this.getFallbackVisual()}>
                    <For each={this.getBlocks()}>
                        {(block) => block()}
                    </For>
                </Show>
            </div>
        );
    }
}
