import { Tab, TabContainer, TabHeader, SubNode } from '../../src/containers/Tabs';
import { TabSplitPaneFrame } from '../../src/containers/TabSplitPane';
import { SourceId } from '../../src/textmodel/SourceId';
import { FakeViewBlock } from './fakes';

// A Tab wrapping a throwaway view, labelled by id for readable assertions. The
// explicit label keeps SourceId.label() == id so assertions read cleanly.
export function makeTab(id: string): Tab {
    return new Tab(new SourceId('scratch', id, id), new FakeViewBlock(id));
}

// A real TabHeader (not a fake) wired to a real TabContainer's headerBar, for
// the TabDragManager seam test. TabHeader's ctor takes a plain settings literal
// (not the unexported TabSettings), so this needs no source change.
export function buildRealTabHeader(label = 'real-tab'): TabHeader {
    const container = new TabContainer([makeTab(label)]);
    return new TabHeader(container.getTabs()[0], container.headerBar, {
        moveable: true,
        closeable: false,
    });
}

// A TabContainer pre-filled with `n` tabs (ids 'tab-0'..'tab-(n-1)').
export function buildTabContainer(n: number, parent: SubNode | null = null): TabContainer {
    const tabs = Array.from({ length: n }, (_, i) => makeTab(`tab-${i}`));
    return new TabContainer(tabs, parent);
}

// A horizontal split frame holding `panes`, with each pane re-parented to it
// (the frame's constructor already does this; exposed here for clarity/control).
export function buildSplitFrame(panes: SubNode[], horizontal = true): TabSplitPaneFrame {
    return new TabSplitPaneFrame(horizontal, panes);
}

// Inject getBoundingClientRect on a frame's pane elements so geometry-dependent
// logic (computeDropTarget, divider drag) runs against known rects without layout.
// paneEls is keyed by pane identity (not index), so map each rect onto the
// frame's pane at the matching position.
export function stubPaneRects(frame: TabSplitPaneFrame, rects: DOMRect[]): void {
    frame.paneEls = new Map();
    rects.forEach((r, i) => {
        const el = document.createElement('div');
        el.getBoundingClientRect = () => r;
        frame.paneEls.set(frame.panes[i], el);
    });
}

// Convenience DOMRect builder (jsdom's DOMRect lacks a friendly literal form).
export function rect(x: number, y: number, width: number, height: number): DOMRect {
    return {
        x, y, width, height,
        left: x, top: y, right: x + width, bottom: y + height,
        toJSON: () => ({}),
    } as DOMRect;
}
