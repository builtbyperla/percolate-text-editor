import { describe, it, expect } from 'vitest';
import { ContextItem, ContextView, RegionContextItem } from '../src/annotation/ContextItem';
import { FixedTextDataModel } from '../src/textmodel/FixedTextDataModel';

// Tier-1: RegionContextItem covers a selection that crosses multiple views (a
// chat-transcript drag spanning several blocks). It is a SUBCLASS, not a mode on the
// base: a single-view item slices one source by one range and knows nothing about
// pieces. A single-piece region list still behaves exactly like setRange, so the
// multi-view path is not a special case of its own.

function owner(name: string, fullText: string): ContextView {
    const model = new FixedTextDataModel(fullText);
    return {
        sourceId: `test-${name}`,
        label: `WHOLE:${name}`,
        getDataSource: () => model,
        scrollToItem: () => {},
        getSubViews: () => [],
    };
}

describe('RegionContextItem region-spanning slice', () => {
    it('setRegions with ONE piece behaves exactly like setRange', () => {
        const o = owner('a', 'alpha beta gamma');
        const item = new RegionContextItem(o);
        item.setRegions([{ view: o, start: 6, end: 10 }]); // "beta"
        expect(item.getPreviewText()).toBe('beta');
        expect(item.getRange()).toEqual({ start: 6, end: 10 });
    });

    it('setRegions with MULTIPLE pieces concatenates each piece\'s own slice, in order', () => {
        const a = owner('a', 'first block text');
        const b = owner('b', 'second block text');
        const item = new RegionContextItem(a);
        item.setRegions([
            { view: a, start: 6, end: 11 },  // "block"
            { view: b, start: 0, end: 6 },   // "second"
        ]);
        expect(item.getPreviewText()).toBe('blocksecond');
    });

    it('getRegions returns the stamped pieces; empty before setRegions', () => {
        const a = owner('a', 'alpha');
        const item = new RegionContextItem(a);
        expect(item.getRegions()).toEqual([]);
        item.setRegions([{ view: a, start: 0, end: 5 }]);
        expect(item.getRegions()).toEqual([{ view: a, start: 0, end: 5 }]);
    });

    it('spans the outer range so range-only readers still see a sensible extent', () => {
        const a = owner('a', 'first block text');
        const b = owner('b', 'second block text');
        const item = new RegionContextItem(a);
        item.setRegions([
            { view: a, start: 6, end: 11 },
            { view: b, start: 0, end: 6 },
        ]);
        expect(item.getRange()).toEqual({ start: 6, end: 6 });
    });

    it('scrollIntoView targets the FIRST piece\'s owner', () => {
        let scrolledA = false;
        let scrolledB = false;
        const a: ContextView = { ...owner('a', 'aaa'), scrollToItem: () => { scrolledA = true; } };
        const b: ContextView = { ...owner('b', 'bbb'), scrollToItem: () => { scrolledB = true; } };
        const item = new RegionContextItem(a);
        item.setRegions([{ view: b, start: 0, end: 2 }, { view: a, start: 0, end: 2 }]);
        item.scrollIntoView();
        expect(scrolledB).toBe(true);
        expect(scrolledA).toBe(false);
    });

    // The separation the subclass split buys: pieces are not a mode the single-origin
    // item can be put into, so there is no "setRange clears the regions" state to get
    // wrong. A plain item has no region surface at all.
    it('a base ContextItem exposes no region surface', () => {
        const a = owner('a', 'alpha beta');
        const item = new ContextItem(a);
        expect((item as unknown as { setRegions?: unknown }).setRegions).toBeUndefined();
        item.setRange(6, 10);
        expect(item.getPreviewText()).toBe('beta');
    });
});
