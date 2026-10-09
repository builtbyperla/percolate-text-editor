import { describe, it, expect } from 'vitest';
import { withRoot } from './reactive';
import { TabContainer } from '../src/containers/Tabs';
import { buildTabContainer, makeTab } from './factories/panes';
import { FakeSubNode } from './factories/fakes';

const labels = (c: { getTabs: () => { getLabel: () => string }[] }) =>
    c.getTabs().map(t => t.getLabel());

describe('TabContainer', () => {
    it('starts with the first tab active and reports emptiness', () => {
        withRoot(() => {
            const c = buildTabContainer(2);
            expect(c.isEmpty()).toBe(false);
            expect(c.getActiveTab()).toBe(c.getTabs()[0]);

            const empty = buildTabContainer(0);
            expect(empty.isEmpty()).toBe(true);
            expect(empty.getActiveTab()).toBeNull();
        });
    });

    it('getTabIndex finds a tab and returns -1 when absent', () => {
        withRoot(() => {
            const c = buildTabContainer(3);
            expect(c.getTabIndex(c.getTabs()[1])).toBe(1);
            expect(c.getTabIndex(makeTab('outsider'))).toBe(-1);
        });
    });

    it('addTab and insertTab place tabs at end / at index', () => {
        withRoot(() => {
            const c = buildTabContainer(2);
            expect(c.addTab(makeTab('appended'))).toBe(true);
            expect(labels(c)).toEqual(['tab-0', 'tab-1', 'appended']);
            expect(c.insertTab(1, makeTab('inserted'))).toBe(true);
            expect(labels(c)).toEqual(['tab-0', 'inserted', 'tab-1', 'appended']);
        });
    });

    it('rejects add and insert operations with an equivalent tab id', () => {
        withRoot(() => {
            const existing = makeTab('shared');
            const c = new TabContainer([existing]);

            expect(c.findEquivalentTab(makeTab('shared'))).toBe(existing);
            expect(c.canAcceptTab(makeTab('shared'))).toBe(false);
            expect(c.addTab(makeTab('shared'))).toBe(false);
            expect(c.insertTab(0, makeTab('shared'))).toBe(false);
            expect(c.getTabs()).toEqual([existing]);
        });
    });

    it('coalesces an equivalent cross-bar drop and collapses an emptied origin', () => {
        withRoot(() => {
            const existing = makeTab('shared');
            const destination = new TabContainer([existing]);
            const moving = makeTab('shared');
            const parent = new FakeSubNode();
            const origin = new TabContainer([moving], parent);

            destination.headerBar.acceptTabDrop(0, moving, origin.headerBar);

            expect(destination.getTabs()).toEqual([moving]);
            expect(destination.getActiveTab()).toBe(moving);
            expect(origin.getTabs()).toEqual([]);
            expect(parent.removed).toContain(origin);
        });
    });

    describe('moveTab', () => {
        it('moves a tab left', () => {
            withRoot(() => {
                const c = buildTabContainer(4); // tab-0..tab-3
                c.moveTab(3, 1);
                expect(labels(c)).toEqual(['tab-0', 'tab-3', 'tab-1', 'tab-2']);
            });
        });
        it('preserves the active tab across a reorder', () => {
            withRoot(() => {
                const c = buildTabContainer(4);
                const active = c.getTabs()[2];
                c.selectTab(active);
                c.moveTab(0, 3); // reorder elsewhere
                // Reordering must not change *which* tab is active (same instance).
                expect(c.getActiveTab()).toBe(active);
            });
        });
        it('moves a tab right', () => {
            withRoot(() => {
                const c = buildTabContainer(4);
                // Right-move inserts at toIndex first, then removes the original
                // slot: [0,1,2,3] -> insert 0 at 2 -> [0,1,0,2,3] -> remove
                // index 0 -> [1,0,2,3].
                c.moveTab(0, 2);
                expect(labels(c)).toEqual(['tab-1', 'tab-0', 'tab-2', 'tab-3']);
            });
        });
        it('is a no-op when from === to', () => {
            withRoot(() => {
                const c = buildTabContainer(3);
                c.moveTab(1, 1);
                expect(labels(c)).toEqual(['tab-0', 'tab-1', 'tab-2']);
            });
        });
    });

    describe('removeTab / adjustActiveTab', () => {
        it('selects the tab that shifts into the removed slot', () => {
            withRoot(() => {
                const c = buildTabContainer(3);
                c.selectTab(c.getTabs()[1]); // active = tab-1
                c.removeTab(c.getTabs()[1]); // remove active; tab-2 shifts into slot 1
                expect(c.getActiveTab()?.getLabel()).toBe('tab-2');
            });
        });

        it('falls back to the previous tab when the last is removed', () => {
            withRoot(() => {
                const c = buildTabContainer(3);
                const last = c.getTabs()[2];
                c.selectTab(last);
                c.removeTab(last); // no tab in slot 2 -> previous (tab-1)
                expect(c.getActiveTab()?.getLabel()).toBe('tab-1');
            });
        });

        it('keeps the active tab when a different tab is removed', () => {
            withRoot(() => {
                const c = buildTabContainer(3);
                c.selectTab(c.getTabs()[0]);
                c.removeTab(c.getTabs()[2]);
                expect(c.getActiveTab()?.getLabel()).toBe('tab-0');
            });
        });

        it('asks the parent to remove it when the last tab leaves', () => {
            withRoot(() => {
                const parent = new FakeSubNode();
                const c = buildTabContainer(1, parent);
                c.removeTab(c.getTabs()[0]);
                expect(c.isEmpty()).toBe(true);
                expect(parent.removed).toContain(c);
            });
        });

        it('does not collapse when there is no parent', () => {
            withRoot(() => {
                const c = buildTabContainer(1); // parent = null
                expect(() => c.removeTab(c.getTabs()[0])).not.toThrow();
                expect(c.isEmpty()).toBe(true);
            });
        });
    });
});
