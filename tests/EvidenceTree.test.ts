import { describe, it, expect } from 'vitest';
import { ContextItem, ContextView } from '../src/annotation/ContextItem';
import { FixedTextDataModel } from '../src/textmodel/FixedTextDataModel';
import { contextRegistry } from '../src/interactions/ContextRegistry';
import { EvidenceTree } from '../src/interactions/EvidenceTree';

// Tier-1: grouping is pure data work on an item list — no signals, no root. The
// tree buckets items by sourceId and, per group, resolves a whole-source PARENT
// for the header row: the real whole-file item when the source is selected, else
// a derived virtual stand-in that lives only while the group has slices. Whether
// a derived parent actually ships is decided at snapshot time by the
// include-full-source setting, not by its own flag.
//
// Each test builds its own tree, so the virtual-parent cache starts empty rather
// than carrying stand-ins in from the previous case.

// A ContextView tagged with a sourceId, so its items group together.
function owner(sourceId: string, fullText = 'alpha beta gamma'): ContextView {
    const model = new FixedTextDataModel(fullText);
    return {
        sourceId,
        label: `WHOLE:${sourceId}`,
        getDataSource: () => model,
        scrollToItem: () => {},
        getSubViews: () => [],
    };
}

// A registered slice (ranged) item on the given owner.
function slice(o: ContextView, start: number, end: number): ContextItem {
    const item = new ContextItem(o);
    item.setRange(start, end);
    item.register();
    return item;
}

// A registered whole-file (null-range) item on the given owner.
function whole(o: ContextView): ContextItem {
    const item = new ContextItem(o);
    item.register();
    return item;
}

// Each test drives the shared registry, so clear it first for isolation.
function reset() {
    for (const item of [...contextRegistry.items()]) contextRegistry.removeItem(item);
}

// Group whatever the registry currently holds, through the given tree.
function group(tree: EvidenceTree) {
    return tree.group(contextRegistry.items());
}

describe('EvidenceTree.group', () => {
    it('groups items by sourceId, first-seen order, slices only in items', () => {
        reset();
        const md = owner('Markdown');
        const editor = owner('Editor');
        slice(md, 0, 5);
        slice(editor, 0, 5);
        slice(md, 6, 10);

        const groups = group(new EvidenceTree());
        expect(groups.map(g => g.key)).toEqual(['Markdown', 'Editor']);
        expect(groups[0].items).toHaveLength(2);
        expect(groups[1].items).toHaveLength(1);
    });

    it('uses the REAL whole-file item as the parent when the source is selected', () => {
        reset();
        const md = owner('Markdown');
        const w = whole(md);
        slice(md, 0, 5);

        const [g] = group(new EvidenceTree());
        expect(g.parent).toBe(w);
        // The whole-file item is the parent, never a sub-slice row.
        expect(g.items.every(i => i.getRange() != null)).toBe(true);
    });

    it('mints a virtual parent, absent from the registry, when the source is not selected', () => {
        reset();
        const md = owner('Markdown');
        slice(md, 0, 5);

        const [g] = group(new EvidenceTree());
        expect(g.parent).not.toBeNull();
        expect(g.parent!.getRange()).toBeNull();
        // Registry absence is what marks it derived — the test consumers use to
        // decide it ships per include-full-source rather than its own flag.
        expect(contextRegistry.items()).not.toContain(g.parent!);
    });

    it('reuses the same virtual parent across re-runs while the group has slices', () => {
        reset();
        const tree = new EvidenceTree();
        const md = owner('Markdown');
        const s1 = slice(md, 0, 5);
        const first = group(tree)[0].parent;

        // Deselect the virtual parent, add another slice, regroup: same instance,
        // state preserved (still deselected).
        first!.setIncluded(false);
        slice(md, 6, 10);
        const second = group(tree)[0].parent;
        expect(second).toBe(first);
        expect(second!.getIncluded()).toBe(false);

        // Sanity: the first slice is still there.
        expect(group(tree)[0].items).toContain(s1);
    });

    it('evicts the virtual parent once its group empties, minting a fresh one later', () => {
        reset();
        const tree = new EvidenceTree();
        const md = owner('Markdown');
        const s1 = slice(md, 0, 5);
        const first = group(tree)[0].parent;
        first!.setIncluded(false);

        // Remove the last slice: the group vanishes, so its virtual parent is evicted.
        contextRegistry.removeItem(s1);
        expect(group(tree)).toHaveLength(0);

        // A new slice mints a fresh parent instance (the evicted one is not revived).
        slice(md, 0, 5);
        const fresh = group(tree)[0].parent;
        expect(fresh).not.toBe(first);
    });

    it('keeps each tree\'s virtual parents to itself', () => {
        reset();
        const md = owner('Markdown');
        slice(md, 0, 5);

        // Two trees over the same items mint independent stand-ins — the cache is
        // per-instance, which is what lets tests (and panes) not share state.
        const a = group(new EvidenceTree())[0].parent;
        const b = group(new EvidenceTree())[0].parent;
        expect(a).not.toBe(b);
    });
});
