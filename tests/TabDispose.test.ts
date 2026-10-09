import { describe, it, expect } from 'vitest';
import { withRoot } from './reactive';
import { buildTabContainer, makeTab } from './factories/panes';
import { Tab, TabContainer, ViewBlock } from '../src/containers/Tabs';
import { SourceId } from '../src/textmodel/SourceId';

// A view that records whether the tab system tore it down. Views like
// DualTextView hold document listeners and reactive roots, so a missed
// dispose() leaks them for the life of the page.
class DisposableView implements ViewBlock {
    ownsScroll = false;
    disposeCount = 0;
    getVisual() {
        return () => null;
    }
    dispose() {
        this.disposeCount++;
    }
}

function tabWithDisposable(id: string): [Tab, DisposableView] {
    const view = new DisposableView();
    return [new Tab(new SourceId('scratch', id, id), view), view];
}

describe('tab view disposal', () => {
    it('disposes the view when a tab is closed', () => {
        withRoot(() => {
            const [tab, view] = tabWithDisposable('doomed');
            const c = new TabContainer([tab]);

            c.closeTab(tab);

            expect(view.disposeCount).toBe(1);
        });
    });

    it('does NOT dispose when a tab is merely removed for a move', () => {
        withRoot(() => {
            const [tab, view] = tabWithDisposable('mover');
            const from = new TabContainer([tab, makeTab('other')]);
            const to = buildTabContainer(1);

            // The drag path: removeTab from the origin, insertTab into the
            // destination. The view object survives and is remounted, so
            // tearing it down here would destroy a live tab.
            from.removeTab(tab);
            to.insertTab(0, tab);

            expect(view.disposeCount).toBe(0);
            expect(to.getTabs()).toContain(tab);
        });
    });

    it('disposes the destination peer when an equivalent moved tab replaces it', () => {
        withRoot(() => {
            const [existing, existingView] = tabWithDisposable('shared');
            const [moving, movingView] = tabWithDisposable('shared');
            const from = new TabContainer([moving]);
            const to = new TabContainer([existing]);

            expect(to.transferTabFrom(from, moving)).toBe(true);

            expect(to.getTabs()).toEqual([moving]);
            expect(existingView.disposeCount).toBe(1);
            expect(movingView.disposeCount).toBe(0);
        });
    });

    it('tolerates views that expose no dispose hook', () => {
        withRoot(() => {
            // dispose?() is optional — most views hold nothing outside their DOM.
            const c = buildTabContainer(1);
            expect(() => c.closeTab(c.getTabs()[0])).not.toThrow();
        });
    });

    it('disposes only the closed tab, leaving siblings alone', () => {
        withRoot(() => {
            const [tabA, viewA] = tabWithDisposable('a');
            const [tabB, viewB] = tabWithDisposable('b');
            const c = new TabContainer([tabA, tabB]);

            c.closeTab(tabA);

            expect(viewA.disposeCount).toBe(1);
            expect(viewB.disposeCount).toBe(0);
        });
    });
});
