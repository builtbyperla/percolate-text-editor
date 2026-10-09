import { describe, it, expect } from 'vitest';
import { withRoot } from './reactive';
import { TabSplitPaneFrame } from '../src/containers/TabSplitPane';
import { TabContainer } from '../src/containers/Tabs';
import { FakeSubNode } from './factories/fakes';
import { buildTabContainer, makeTab, stubPaneRects, rect } from './factories/panes';

// A frame with `n` leaf TabContainers as panes, plus a stubbed containerRef so
// the geometry guard passes.
function buildFrame(n: number, horizontal = false): TabSplitPaneFrame {
    const panes = Array.from({ length: n }, () => buildTabContainer(1));
    const f = new TabSplitPaneFrame(horizontal, panes);
    f.containerRef = document.createElement('div');
    return f;
}

describe('TabSplitPaneFrame.computeDropTarget', () => {
    it('returns null without a container ref', () => {
        withRoot(() => {
            const f = buildFrame(1);
            f.containerRef = undefined;
            expect(f.computeDropTarget(50, 50)).toBeNull();
        });
    });

    it('resolves the inner zone as a whole-pane target', () => {
        withRoot(() => {
            const f = buildFrame(1);
            stubPaneRects(f, [rect(0, 0, 400, 400)]);
            // Dead center is inside the non-edge band on both axes.
            expect(f.computeDropTarget(200, 200)).toEqual({
                kind: 'whole-pane',
                paneIndex: 0,
            });
        });
    });

    it('resolves the nearest splittable edge in an edge band', () => {
        withRoot(() => {
            const f = buildFrame(1);
            // 400px both axes -> both can split (>= 320). Pointer near left edge.
            stubPaneRects(f, [rect(0, 0, 400, 400)]);
            const t = f.computeDropTarget(20, 200);
            expect(t).toEqual({
                kind: 'split',
                paneIndex: 0,
                direction: 'left',
            });
        });
    });

    it('only offers the axis with room (MIN_SPLIT_PX*2), picking the specific edge', () => {
        withRoot(() => {
            const f = buildFrame(1);
            // Wide but short: 400 wide (can split H), 100 tall (cannot split V).
            stubPaneRects(f, [rect(0, 0, 400, 100)]);
            // Pointer near the left edge: vertical split is disallowed, so the
            // resolved edge must be exactly 'left' (not merely "horizontal").
            expect(f.computeDropTarget(10, 5)).toEqual({
                kind: 'split',
                paneIndex: 0,
                direction: 'left',
            });
        });
    });

    it('resolves the right edge when the pointer is near the right side', () => {
        withRoot(() => {
            const f = buildFrame(1);
            stubPaneRects(f, [rect(0, 0, 400, 100)]);
            // The pointer is closest to the right horizontal edge.
            expect(f.computeDropTarget(390, 50)).toEqual({
                kind: 'split',
                paneIndex: 0,
                direction: 'right',
            });
        });
    });

    it('returns null when the pane is too small to split either axis', () => {
        withRoot(() => {
            const f = buildFrame(1);
            stubPaneRects(f, [rect(0, 0, 100, 100)]);
            expect(f.computeDropTarget(5, 5)).toBeNull();
        });
    });
});

describe('TabSplitPaneFrame.removeNode', () => {
    it('drops the pane and recomputes blocks when others remain', () => {
        withRoot(() => {
            const f = buildFrame(2);
            const [first] = f.panes;
            f.removeNode(f.panes[1]);
            expect(f.panes).toEqual([first]);
            // Blocks/fractions were rebuilt to match the single remaining pane
            // (1 pane -> 1 block, no divider). Proves _initBlocks actually ran,
            // not just that the panes array was spliced.
            expect(f.blocks).toHaveLength(1);
            expect(f.fractions).toHaveLength(1);
        });
    });

    it('asks its parent to remove it once emptied', () => {
        withRoot(() => {
            const parent = new FakeSubNode();
            const f = buildFrame(1);
            f.parent = parent;
            f.removeNode(f.panes[0]);
            expect(f.panes).toHaveLength(0);
            expect(parent.removed).toContain(f);
        });
    });

    it('ignores a node that is not a child', () => {
        withRoot(() => {
            const f = buildFrame(2);
            const before = f.panes.length;
            f.removeNode(buildTabContainer(1));
            expect(f.panes).toHaveLength(before);
        });
    });
});

describe('TabSplitPaneFrame.dropTab', () => {
    it('same-direction drop splices a new pane next to the target', () => {
        withRoot(() => {
            const f = buildFrame(1, /* horizontal */ true);
            stubPaneRects(f, [rect(0, 0, 400, 400)]);
            const origin = buildTabContainer(2); // has the tab to move
            const tab = origin.getTabs()[0];

            // Drop near the right edge -> horizontal dir matches frame -> insert after.
            f.dropTab(tab, 390, 200, origin.headerBar);

            expect(f.panes).toHaveLength(2);
            // New pane is a TabContainer holding the moved tab, inserted after index 0.
            const newPane = f.panes[1] as TabContainer;
            expect(newPane).toBeInstanceOf(TabContainer);
            expect(newPane.getTabs()).toContain(tab);
            // Origin lost the tab.
            expect(origin.getTabs()).not.toContain(tab);
            // The new pane is parented to the frame — this is what makes it
            // collapsible later (removeTab -> parent.removeNode). Without it the
            // split renders but can never auto-collapse.
            expect(newPane.parent).toBe(f);
            // Dividers were rebuilt for 2 panes (2 panes -> 3 blocks).
            expect(f.blocks).toHaveLength(3);
            expect(f.fractions).toHaveLength(2);
        });
    });

    it('cross-direction drop wraps the target in a new split frame, edge-ordered', () => {
        withRoot(() => {
            const f = buildFrame(1, /* horizontal */ false); // vertical frame
            stubPaneRects(f, [rect(0, 0, 400, 400)]);
            const target = f.panes[0];
            const origin = buildTabContainer(1);
            const tab = origin.getTabs()[0];

            // Drop near the left edge -> horizontal dir, differs from vertical frame.
            f.dropTab(tab, 10, 200, origin.headerBar);

            expect(f.panes).toHaveLength(1);
            const wrapper = f.panes[0] as TabSplitPaneFrame;
            expect(wrapper).toBeInstanceOf(TabSplitPaneFrame);
            // 'left' -> new tab pane comes first, original target second.
            expect(wrapper.panes[1]).toBe(target);
            expect((wrapper.panes[0] as TabContainer).getTabs()).toContain(tab);
            // The wrapper is parented to the outer frame, and BOTH of its
            // children are reparented to the wrapper — the full collapse chain.
            expect(wrapper.parent).toBe(f);
            expect(wrapper.panes[0].parent).toBe(wrapper);
            expect(wrapper.panes[1].parent).toBe(wrapper);
            // Wrapper has its own dividers for its 2 children.
            expect(wrapper.blocks).toHaveLength(3);
        });
    });

    it('moves a center-dropped tab into the target pane without creating a split', () => {
        withRoot(() => {
            const destinationTab = makeTab('destination');
            const destination = new TabContainer([destinationTab]);
            const f = new TabSplitPaneFrame(true, [destination]);
            f.containerRef = document.createElement('div');
            stubPaneRects(f, [rect(0, 0, 400, 400)]);
            const tab = makeTab('moving');
            const origin = new TabContainer([tab, makeTab('staying')]);

            f.dropTab(tab, 200, 200, origin.headerBar);

            expect(f.panes).toHaveLength(1);
            expect(destination.getTabs()).toEqual([destinationTab, tab]);
            expect(destination.getTabs().filter(candidate => candidate === tab)).toHaveLength(1);
            expect(origin.getTabs()).not.toContain(tab);
            expect(f.blocks).toHaveLength(1);
        });
    });

    it('treats a center drop onto the source pane as a no-op', () => {
        withRoot(() => {
            const source = buildTabContainer(2);
            const f = new TabSplitPaneFrame(true, [source]);
            f.containerRef = document.createElement('div');
            stubPaneRects(f, [rect(0, 0, 400, 400)]);
            const tab = source.getTabs()[0];
            const before = source.getTabs();

            f.dropTab(tab, 200, 200, source.headerBar);

            expect(source.getTabs()).toEqual(before);
            expect(source.getTabs().filter(candidate => candidate === tab)).toHaveLength(1);
            expect(f.panes).toEqual([source]);
        });
    });

    it('coalesces a center drop when the destination already has the same tab id', () => {
        withRoot(() => {
            const destination = buildTabContainer(0);
            const duplicate = makeTab('shared');
            destination.addTab(duplicate);
            const f = new TabSplitPaneFrame(true, [destination]);
            f.containerRef = document.createElement('div');
            stubPaneRects(f, [rect(0, 0, 400, 400)]);
            const origin = new TabContainer([makeTab('shared')]);
            const tab = origin.getTabs()[0];

            f.dropTab(tab, 200, 200, origin.headerBar);

            expect(destination.getTabs()).toEqual([tab]);
            expect(destination.getActiveTab()).toBe(tab);
            expect(origin.getTabs()).toEqual([]);
        });
    });

    it('collapses the source pane when its only tab coalesces into a sibling', () => {
        withRoot(() => {
            const tab = makeTab('shared');
            const origin = new TabContainer([tab]);
            const destination = new TabContainer([makeTab('shared')]);
            const f = new TabSplitPaneFrame(true, [origin, destination]);
            f.containerRef = document.createElement('div');
            stubPaneRects(f, [rect(0, 0, 400, 400), rect(400, 0, 400, 400)]);

            f.dropTab(tab, 600, 200, origin.headerBar);

            expect(f.panes).toEqual([destination]);
            expect(destination.getTabs()).toEqual([tab]);
            expect(destination.getActiveTab()).toBe(tab);
            expect(f.blocks).toHaveLength(1);
        });
    });
});
