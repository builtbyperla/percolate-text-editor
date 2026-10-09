import { describe, it, expect, afterEach } from 'vitest';
import { withRoot } from './reactive';
import { TabDragManager } from '../src/interactions/TabDragManager';
import { fakeTabHeader, FakeTabDropArea } from './factories/fakes';
import { buildRealTabHeader, makeTab, rect, stubPaneRects } from './factories/panes';
import { TabContainer } from '../src/containers/Tabs';
import { TabSplitPaneFrame } from '../src/containers/TabSplitPane';

const DRAG_THRESHOLD = 6;

const down = (x: number, y: number) =>
    new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0 });
const moveEvt = (x: number, y: number) =>
    new PointerEvent('pointermove', { clientX: x, clientY: y });
const winMove = (x: number, y: number) => window.dispatchEvent(moveEvt(x, y));
const winUp = (x = 0, y = 0) =>
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y }));

// Pointer event whose target is nowhere near a drop area (release in open space).
const upInVoid = () => {
    const e = new PointerEvent('pointerup', { clientX: 9, clientY: 9 });
    Object.defineProperty(e, 'target', { value: document.body, configurable: true });
    return e;
};

afterEach(() => {
    document.querySelectorAll('[data-tabdroparea]').forEach(el => el.remove());
    document.querySelectorAll('div').forEach(el => { if (el.style.zIndex === '9999') el.remove(); });
});

describe('TabDragManager — drag lifecycle (functional)', () => {
    it('promotes a press to a drag only past the threshold, then mounts a ghost', () => {
        withRoot(() => {
            const mgr = new TabDragManager();
            mgr.onTabPointerDown(down(100, 100), fakeTabHeader());

            winMove(102, 102); // under threshold — no ghost yet
            expect(mgr.ghost).toBeNull();
            expect(mgr.currentIntx).toBeNull();

            winMove(100 + DRAG_THRESHOLD + 5, 100); // crosses threshold
            expect(mgr.ghost).not.toBeNull();
            expect(mgr.currentIntx).not.toBeNull();
            expect(document.body.contains(mgr.ghost!.el)).toBe(true);
        });
    });

    it('drives a real TabHeader through the seam (ghost from getGhostPreview mounts)', () => {
        withRoot(() => {
            const mgr = new TabDragManager();
            // Real TabHeader, not a fake: exercises getGhostPreview() producing a
            // live element and tabBar being read into the interaction.
            const header = buildRealTabHeader('real');
            mgr.onTabPointerDown(down(0, 0), header);
            winMove(50, 0); // cross threshold

            expect(mgr.ghost).not.toBeNull();
            expect(document.body.contains(mgr.ghost!.el)).toBe(true);
            // The mounted ghost carries the real header's preview text.
            expect(mgr.ghost!.el.textContent).toContain('real');
            mgr.cleanupTab();
        });
    });

    it('a press released before the threshold never starts a drag', () => {
        withRoot(() => {
            const mgr = new TabDragManager();
            mgr.onTabPointerDown(down(0, 0), fakeTabHeader());
            winUp(2, 2); // click, not a drag
            winMove(50, 50);
            expect(mgr.ghost).toBeNull();
            expect(mgr.currentIntx).toBeNull();
        });
    });

    it('releasing in open space cleans up the ghost and clears the interaction', () => {
        withRoot(() => {
            const mgr = new TabDragManager();
            mgr.onTabPointerDown(down(0, 0), fakeTabHeader());
            winMove(50, 0); // start drag
            const ghostEl = mgr.ghost!.el;

            mgr.onTabDragReleased(upInVoid());

            expect(document.body.contains(ghostEl)).toBe(false);
            expect(mgr.ghost).toBeNull();
            expect(mgr.currentIntx).toBeNull();
            expect(mgr.getActiveTarget()).toBeNull();
        });
    });
});

describe('TabDragManager — drop areas (functional)', () => {
    it('moves a tab through the full drag-to-whole-pane path exactly once', () => {
        withRoot(() => {
            const moving = makeTab('moving');
            const staying = makeTab('staying');
            const destinationTab = makeTab('destination');
            const source = new TabContainer([moving, staying]);
            const destination = new TabContainer([destinationTab]);
            const frame = new TabSplitPaneFrame(true, [source, destination]);
            frame.containerRef = document.createElement('div');
            frame.containerRef.setAttribute('data-tabdroparea', '');
            stubPaneRects(frame, [rect(0, 0, 400, 400), rect(400, 0, 400, 400)]);

            const mgr = new TabDragManager();
            const header = source.headerBar.getTabHeaders()[0];
            mgr.onTabPointerDown(down(10, 10), header);
            winMove(50, 10);

            const drop = new PointerEvent('pointerup', { clientX: 600, clientY: 200 });
            Object.defineProperty(drop, 'target', { value: frame.containerRef, configurable: true });
            mgr.onDropAreaDrop(drop, frame);

            expect(source.getTabs()).toEqual([staying]);
            expect(destination.getTabs()).toEqual([destinationTab, moving]);
            expect(destination.getTabs().filter(tab => tab === moving)).toHaveLength(1);
            expect(frame.panes).toEqual([source, destination]);
            expect(mgr.currentIntx).toBeNull();
            expect(mgr.ghost).toBeNull();
        });
    });

    it('finishes a whole-pane drop on the source pane without duplicating the tab', () => {
        withRoot(() => {
            const moving = makeTab('moving');
            const staying = makeTab('staying');
            const source = new TabContainer([moving, staying]);
            const frame = new TabSplitPaneFrame(true, [source]);
            frame.containerRef = document.createElement('div');
            frame.containerRef.setAttribute('data-tabdroparea', '');
            stubPaneRects(frame, [rect(0, 0, 400, 400)]);

            const mgr = new TabDragManager();
            mgr.onTabPointerDown(down(10, 10), source.headerBar.getTabHeaders()[0]);
            winMove(50, 10);

            const drop = new PointerEvent('pointerup', { clientX: 200, clientY: 200 });
            Object.defineProperty(drop, 'target', { value: frame.containerRef, configurable: true });
            mgr.onDropAreaDrop(drop, frame);

            expect(source.getTabs()).toEqual([moving, staying]);
            expect(source.getTabs().filter(tab => tab === moving)).toHaveLength(1);
            expect(frame.panes).toEqual([source]);
            expect(mgr.currentIntx).toBeNull();
            expect(mgr.ghost).toBeNull();
        });
    });

    it('routes a drop over a matching area to its onTabDrop, then cleans up', () => {
        withRoot(() => {
            const mgr = new TabDragManager();
            const header = fakeTabHeader();
            mgr.onTabPointerDown(down(0, 0), header);
            winMove(50, 0); // active drag

            const area = new FakeTabDropArea();
            mgr.onDropAreaDrop(area.eventOver(), area);

            expect(area.drops).toHaveLength(1);
            // The drop was handed the SAME origin header that started the drag —
            // proves the interaction threaded the right tab through, not just
            // that *a* drop fired.
            expect(area.drops[0]).toBe(header);
            expect(mgr.currentIntx).toBeNull(); // cleaned up after drop
            expect(mgr.ghost).toBeNull();
        });
    });

    it('routes a hover over a matching area to its onTabHover and tracks it as the target', () => {
        withRoot(() => {
            const mgr = new TabDragManager();
            mgr.onTabPointerDown(down(0, 0), fakeTabHeader());
            winMove(50, 0);

            const area = new FakeTabDropArea();
            const hover = new PointerEvent('pointermove', {});
            Object.defineProperty(hover, 'target', { value: area.ref, configurable: true });
            mgr.onDropAreaHover(hover, area);

            expect(area.hovers).toHaveLength(1);
            expect(mgr.getActiveTarget()).toBe(area);
        });
    });

    it('ignores drop-area events when no drag is in progress', () => {
        withRoot(() => {
            const mgr = new TabDragManager();
            const area = new FakeTabDropArea();
            mgr.onDropAreaDrop(area.eventOver(), area);
            mgr.onDropAreaHover(area.eventOver(), area);
            expect(area.drops).toHaveLength(0);
            expect(area.hovers).toHaveLength(0);
        });
    });

    it('ignores a drop whose pointer target is not the claimed area', () => {
        withRoot(() => {
            const mgr = new TabDragManager();
            mgr.onTabPointerDown(down(0, 0), fakeTabHeader());
            winMove(50, 0);

            const area = new FakeTabDropArea();
            // Event target is body, not the area ref -> ref mismatch guard trips.
            mgr.onDropAreaDrop(upInVoid(), area);
            expect(area.drops).toHaveLength(0);
        });
    });
});
