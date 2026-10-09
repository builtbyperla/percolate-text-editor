import { describe, it, expect, vi } from 'vitest';
import { ContextItem, ContextView } from '../src/annotation/ContextItem';
import { FixedTextDataModel } from '../src/textmodel/FixedTextDataModel';
import { ViewLocator } from '../src/interactions/ViewLocator';
import { Tab, TabContainer } from '../src/containers/Tabs';
import { SourceId } from '../src/textmodel/SourceId';
import { buildSplitFrame } from './factories/panes';
import { DiffView } from '../src/editor/diff/DiffView';

// Tier-1: resolving an item to the view that should reveal it is pure ranking over
// the tab tree — no signals, no root, no DOM. The locator answers TWO questions
// separately: findItem RANKS (active beats backgrounded, and a nested view is
// reachable through its host) while showItem SEQUENCES (surface the tab only when
// it isn't already showing, then hand off to the view).
//
// Ranking must collect across the WHOLE tree before choosing: a backgrounded hit
// found first must never beat an active hit found later.

// A ContextView standing in for a real one. scrollToItem is a spy, so a test can
// assert WHICH view was chosen rather than inferring it from side effects.
function view(sourceId: string, subViews: ContextView[] = []): ContextView & {
    scrollToItem: ReturnType<typeof vi.fn<(item: ContextItem) => void>>;
} {
    const model = new FixedTextDataModel('alpha beta gamma');
    return {
        sourceId,
        label: sourceId,
        getDataSource: () => model,
        scrollToItem: vi.fn<(item: ContextItem) => void>(),
        getSubViews: () => subViews,
    };
}

// A ViewBlock that HOSTS a ContextView without being one (the MarkdownView shape).
function host(...views: ContextView[]) {
    return { ownsScroll: false, getVisual: () => () => null, getContextViews: () => views };
}

// A Tab wrapping an arbitrary view object. The locator only reads `tab.view`, so
// the view need not be a full ViewBlock.
function tabFor(v: object, id: string): Tab {
    return new Tab(new SourceId('scratch', id, id), v as never);
}

function itemOn(v: ContextView): ContextItem {
    return new ContextItem(v);
}

describe('ViewLocator.findItem', () => {
    it('finds a view in the active tab and marks it active', () => {
        const v = view('Editor');
        const container = new TabContainer([tabFor(v, 'a')]);
        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([container]));

        const hit = locator.findItem(itemOn(v));
        expect(hit?.view).toBe(v);
        expect(hit?.active).toBe(true);
    });

    it('prefers an ACTIVE view over a backgrounded one on the same source', () => {
        const bg = view('Editor');
        const active = view('Editor');
        // Backgrounded copy sits in an earlier container, so a first-match walk
        // would wrongly return it — this is the case ranking exists for.
        const first = new TabContainer([tabFor(view('Other'), 'x'), tabFor(bg, 'bg')]);
        const second = new TabContainer([tabFor(active, 'active')]);

        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([first, second]));

        const hit = locator.findItem(itemOn(bg));
        expect(hit?.view).toBe(active);
        expect(hit?.active).toBe(true);
    });

    it('falls back to a backgrounded view when no active one holds the source', () => {
        const bg = view('Editor');
        const container = new TabContainer([tabFor(view('Other'), 'x'), tabFor(bg, 'bg')]);
        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([container]));

        const hit = locator.findItem(itemOn(bg));
        expect(hit?.view).toBe(bg);
        expect(hit?.active).toBe(false);
    });

    it('prefers the tab-level view over a sub-view sharing its sourceId', () => {
        // The editor/annotator pair. The PARENT wins and reveals the item itself —
        // it can resolve an offset in either mode, while the annotator only exists in
        // annotate mode. Deferring to the sub would break reveal in edit mode.
        const sub = view('Editor');
        const parent = view('Editor', [sub]);
        const container = new TabContainer([tabFor(parent, 'a')]);
        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([container]));

        expect(locator.findItem(itemOn(parent))?.view).toBe(parent);
    });

    it('reaches a sub-view whose sourceId the parent does NOT share', () => {
        // getSubViews earns its place here: a nested view on a different source is
        // unreachable any other way.
        const sub = view('Nested');
        const parent = view('Parent', [sub]);
        const container = new TabContainer([tabFor(parent, 'a')]);
        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([container]));

        expect(locator.findItem(itemOn(sub))?.view).toBe(sub);
    });

    it('reaches a view held by a non-ContextView host (the markdown shell)', () => {
        const inner = view('Notes.md');
        const container = new TabContainer([tabFor(host(inner), 'md')]);
        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([container]));

        expect(locator.findItem(itemOn(inner))?.view).toBe(inner);
    });

    it('reaches both sides of a diff tab through its host', () => {
        const diff = new DiffView('diff:proposal', 'before', 'after');
        const [oldSide, newSide] = diff.getContextViews();
        const container = new TabContainer([tabFor(diff, 'diff')]);
        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([container]));

        expect(locator.findItem(itemOn(oldSide))?.view).toBe(oldSide);
        expect(locator.findItem(itemOn(newSide))?.view).toBe(newSide);
        diff.dispose();
    });

    it('returns null when nothing open holds the source, and when unrooted', () => {
        const orphan = view('Closed');
        const container = new TabContainer([tabFor(view('Other'), 'x')]);

        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([container]));
        expect(locator.findItem(itemOn(orphan))).toBeNull();

        // No root wired yet (App hasn't run): a miss, not a crash.
        expect(new ViewLocator().findItem(itemOn(orphan))).toBeNull();
    });
});

describe('ViewLocator.showItem', () => {
    it('scrolls WITHOUT switching tabs when the view is already active', () => {
        const v = view('Editor');
        const container = new TabContainer([tabFor(v, 'a')]);
        const selectTab = vi.spyOn(container, 'selectTab');
        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([container]));

        const item = itemOn(v);
        expect(locator.showItem(item)).toBe(true);
        expect(selectTab).not.toHaveBeenCalled();
        expect(v.scrollToItem).toHaveBeenCalledWith(item);
    });

    it('surfaces the tab first when the view is backgrounded', () => {
        const bg = view('Editor');
        const bgTab = tabFor(bg, 'bg');
        const container = new TabContainer([tabFor(view('Other'), 'x'), bgTab]);
        const selectTab = vi.spyOn(container, 'selectTab');
        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([container]));

        const item = itemOn(bg);
        expect(locator.showItem(item)).toBe(true);
        expect(selectTab).toHaveBeenCalledWith(bgTab);
        expect(bg.scrollToItem).toHaveBeenCalledWith(item);
    });

    it('reports false on a miss, so a caller can fall back', () => {
        const orphan = view('Closed');
        const container = new TabContainer([tabFor(view('Other'), 'x')]);
        const locator = new ViewLocator();
        locator.setRoot(buildSplitFrame([container]));

        expect(locator.showItem(itemOn(orphan))).toBe(false);
        expect(orphan.scrollToItem).not.toHaveBeenCalled();
    });
});
