import { describe, it, expect } from 'vitest';
import { JSX } from 'solid-js';
import { withRoot } from './reactive';
import { Tab, TabContainer, ViewBlock } from '../src/containers/Tabs';
import { SourceId } from '../src/textmodel/SourceId';

// Records confirmClose() interaction. Returning false from confirmClose must
// leave the tab in place; returning true must let it close normally. Views
// without confirmClose skip the veto (existing behavior preserved).
class ConfirmableView implements ViewBlock {
    ownsScroll = false;
    confirmCalls = 0;
    disposeCount = 0;

    constructor(private answer: boolean) {}

    getVisual(): () => JSX.Element {
        return () => null;
    }
    async confirmClose(): Promise<boolean> {
        this.confirmCalls++;
        return this.answer;
    }
    dispose() {
        this.disposeCount++;
    }
}

describe('TabContainer close-on-dirty', () => {
    it('proceeds when the view confirms close', async () => {
        await withRoot(async () => {
            const view = new ConfirmableView(true);
            const tab = new Tab(new SourceId('scratch', 'ok', 'ok'), view);
            const c = new TabContainer([tab]);

            await c.closeTab(tab);

            expect(view.confirmCalls).toBe(1);
            expect(c.getTabs()).not.toContain(tab);
            expect(view.disposeCount).toBe(1);
        });
    });

    it('aborts close when the view returns false — tab and view survive', async () => {
        await withRoot(async () => {
            const view = new ConfirmableView(false);
            const tab = new Tab(new SourceId('scratch', 'cancel', 'cancel'), view);
            const c = new TabContainer([tab]);

            await c.closeTab(tab);

            expect(view.confirmCalls).toBe(1);
            expect(c.getTabs()).toContain(tab);
            // Critical: dispose MUST NOT run on a cancelled close — the view is
            // still live and holds real resources (editor state, listeners).
            expect(view.disposeCount).toBe(0);
        });
    });

    it('views without confirmClose close without prompting (backwards compatible)', async () => {
        await withRoot(async () => {
            // A plain ViewBlock — no confirmClose method. The optional chain in
            // closeTab must short-circuit to "proceed" so pre-Step-3 views keep
            // closing on click without a modal.
            const view: ViewBlock = { ownsScroll: false, getVisual: () => () => null };
            const tab = new Tab(new SourceId('scratch', 'plain', 'plain'), view);
            const c = new TabContainer([tab]);

            await c.closeTab(tab);
            expect(c.getTabs()).not.toContain(tab);
        });
    });
});
