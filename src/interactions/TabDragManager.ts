import { Tab, TabDropArea, TabHeader, TabHeaderBar, ViewBlock } from '../containers/Tabs'
import { SplitPaneFrame } from '../containers/SplitPane';
import { TabSplitPaneFrame } from '../containers/TabSplitPane';
import { Accessor, createSignal, Setter } from 'solid-js';
import { VisualGhost } from './VisualGhost';

const DRAG_THRESHOLD = 6;

export class TabIntx {
    origin: TabHeader;
    originBar: TabHeaderBar;
    current: TabDropArea | null = null;

    constructor(origin: TabHeader) {
        this.origin = origin;
        this.originBar = origin.tabBar;
    }
}

class PreTabDragOp {
    // Manages listener for keeping track of whether a full tab drag
    // has started so regular tab clicks do not jitter
    tab: TabHeader;
    pos: [number, number];
    moveFunc: (e: PointerEvent) => void;
    liftFunc: (e: PointerEvent) => void;
    dragStartCallback: (e: PointerEvent) => void;
    dragReleaseCallback: (e: PointerEvent) => void;
    stale: boolean = false;

    constructor(tab: TabHeader, pos: [number, number], 
        startCallback: (e: PointerEvent) => void,
        releaseCallback: (e: PointerEvent) => void) {
        this.tab = tab;
        this.pos = pos;
        this.dragStartCallback = startCallback;
        this.dragReleaseCallback = releaseCallback;

        const onMove = (e: PointerEvent) => {
            const [startX, startY] = this.pos;
            const distance = Math.hypot(e.x - startX, e.y - startY);

            if (distance > DRAG_THRESHOLD ) {
                this.dragStartCallback(e);
                this.dispose();
            }
        };

        const onLift = (e: PointerEvent) => {
            this.dispose();
        };

        this.moveFunc = onMove.bind(this);
        this.liftFunc = onLift.bind(this)

        window.addEventListener('pointermove', this.moveFunc);
        window.addEventListener('pointerup', this.liftFunc);
    }

    dispose() {
        if (!this.stale) {
            window.removeEventListener('pointermove', this.moveFunc);
            window.removeEventListener('pointerup', this.liftFunc);
            this.stale = true;
        }
    }
}

export class TabDragManager {
    // Stores current interaction and visual ghost data
    currentIntx: TabIntx | null = null;
    ghost: VisualGhost | null = null;

    // Signals used only for keeping visuals local when active changes
    getActiveTarget: Accessor<TabDropArea | null>;
    setActiveTarget: Setter<TabDropArea | null>;

    // To eliminate jitter for regular tab clicks, keep track of pre-tab drag state
    // until threshold for tab drag reached
    preDrag: PreTabDragOp | null = null;

    constructor() {
        [this.getActiveTarget, this.setActiveTarget] = createSignal<TabDropArea | null>(null);
    }

    setupGhost(e: PointerEvent, header: TabHeader) {
        let visual = header.getGhostPreview();
        this.ghost = new VisualGhost(visual, e.x, e.y, 
            (e: PointerEvent) => {this.onTabDragReleased(e)},
            (e: PointerEvent) => {this.onTabMove(e)}
        );
    }

    isDragActive(): boolean {
        // True once a tab drag has crossed the threshold (ghost is live).
        return this.currentIntx != null;
    }

    updateCurrentTarget(target: TabDropArea | null) {
        // Update current intx and signal so visuals are informed
        // to show/hide indicators
        if (this.currentIntx) {
            this.currentIntx.current = target;
            this.setActiveTarget(target);
        }
    }

    clearCurrentIntx() {
        // Nullify current intx and signal so visuals are informed
        // to hide indicators
        this.currentIntx = null;
        this.setActiveTarget(null);
    }

    onTabPointerDown(e: PointerEvent, header: TabHeader) {
        // Start a tentative tab drag interaction
        if (e.button !== 0) return;

        // Tab headers own interactions TODO: default vs tab drag mode, this is the issue on dragging TODO: are the tab add drops setting the parent correctly for add tabs when…

        e.stopPropagation();

        // Listen for completed drag, record current position and set flag
        this.preDrag = new PreTabDragOp(header, [e.x, e.y], (e) => this.onTabDragStarted(e), (e) => this.onTabDragReleased(e));
        console.log("Starting drag", this.preDrag);
    }

    onTabDragStarted(e: PointerEvent) {
        console.log("Callback here", this.preDrag);
        if (this.preDrag) {
            console.log("Current interaction");
            const hdr: TabHeader = this.preDrag.tab;
            this.preDrag?.dispose();
            this.setupGhost(e, hdr);
            this.currentIntx = new TabIntx(hdr);
            return;
        }
        console.log("Nullifying predrag");
        this.preDrag = null;
    }

    onTabDragReleased(e: PointerEvent) {
        const dropAreaRef = this._getDropAreaRef(e);
        if (dropAreaRef != null) {
            return;
        } else {
            this.cleanupTab();
        }
    }

    cleanupTab() {
        this.ghost?.detach();
        this.ghost = null;
        // TODO: Add a check here just to see if a droppable will accept the drop?

        // One check for closest, ref, matches current intx
        // or register pointer down for current but only release triggers the right callabck
        this.updateCurrentTarget(null);
        this.currentIntx = null;

        this.preDrag?.dispose();
        this.preDrag = null;
    }

    onTabMove(e: PointerEvent) {
        // Update target if not over tabDropArea so visuals are properly cleared.
        // DropAreas route to this.onDropAreaHover if tab is hovering tabDropArea
        const dropArea: HTMLElement | null = this._getDropAreaRef(e);
        if (dropArea == null) {
            this.updateCurrentTarget(null);
        }
    }


    _getDropAreaRef(e: PointerEvent): HTMLElement | null {
        // Skip non-HTML target types
        if (!(e.target instanceof Element)) {
            return null;
        }

        // Check if over a tab drop area
        const ref: HTMLElement | null = e.target?.closest('[data-tabdroparea]');
        return ref;
    }

    onDropAreaHover(e: PointerEvent, area: TabDropArea) {
        // Don't do anything if tab drag hasn't started
        if (!this.currentIntx) return;

        if (this.currentIntx) {
            // Make sure drop area ref matches caller
            const dropAreaRef = this._getDropAreaRef(e);
            if (dropAreaRef != area.getRef()) {
                return;
            }

            // Update current target signal and passthrough
            // to drop area for it to react to hover
            this.updateCurrentTarget(area);
            area.onTabHover(e, this.currentIntx.origin);
        }
    }

    onDropAreaDrop(e: PointerEvent, area: TabDropArea) {
        // Don't do anything if tab drag hasn't started
        if (!this.currentIntx) return;

        if (this.currentIntx) {
            // Make sure drop area ref matches caller
            const dropAreaRef = this._getDropAreaRef(e);
            if (dropAreaRef != area.getRef()) {
                return;
            }

            // Update current target signal and passthrough
            // to drop area for it to react to hover
            this.updateCurrentTarget(area);
            area.onTabDrop(e, this.currentIntx.origin);

            // Cleanup tab per contract with dragged tab + droppable
            this.cleanupTab();
        }
    }

    // // Send drop to target tab header bar end.handleTabDrop(e.clientX, this.currentIntx.originTab, this.currentIntx.origin); // Ends on empty view pane area // TODO: NO-OP, to be…

    //     return false;
    // }

    // onSplitPaneDrop(e: PointerEvent, frame: TabSplitPaneFrame) {
    //     if (this.preDrag) return;

    //     if (!this.currentIntx) return;
    //     e.stopPropagation();

}

export const tabDragManager: TabDragManager = new TabDragManager();
