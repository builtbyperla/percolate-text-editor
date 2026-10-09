import { describe, it, expect } from 'vitest';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';
import { DiffScheduler } from '../src/editor/diff/DiffScheduler';
import { DiffTextSource, DiffSourceData } from '../src/editor/diff/DiffTextSource';

// Tier-1: DiffTextSource as the composite/identity source. It is ONE annotatable source
// (one stable sourceId, kind()='diff') derived from two child CmTextDataModels, and it
// hands out side-bound callbacks that route operations to the correct child — the
// composite never stores per-annotation side state; each ContextItem holds its own bound
// callback. These tests pin the identity, the getData payload, the child resolver, and
// that a bound editor callback edits the intended child.

function makeSource(oldText: string, newText: string) {
    const oldModel = new CmTextDataModel(oldText);
    const newModel = new CmTextDataModel(newText);
    const scheduler = new DiffScheduler(() => ({
        oldText: oldModel.getValue(),
        newText: newModel.getValue(),
    }));
    scheduler.recomputeNow(); // seed the snapshot
    const source = new DiffTextSource('diff::sample', oldModel, newModel, scheduler);
    return { source, oldModel, newModel, scheduler };
}

describe('DiffTextSource identity', () => {
    it('reports kind "diff" and a stable sourceId', () => {
        const { source } = makeSource('a\n', 'a\nb\n');
        expect(source.kind()).toBe('diff');
        expect(source.getSourceId()).toBe('diff::sample');
    });

    it('getData() exposes both child models and the current hunks', () => {
        const { source, oldModel, newModel, scheduler } = makeSource('a\n', 'a\nb\n');
        const data = source.getData();
        expect(data.kind).toBe('diff');
        // Cast to the diff variant for the structural checks (consumers do the same after
        // checking kind).
        const diff = data as DiffSourceData;
        expect(diff.oldModel).toBe(oldModel);
        expect(diff.newModel).toBe(newModel);
        expect(diff.hunks).toEqual(scheduler.current());
        expect(diff.hunks).toHaveLength(1); // one added line
    });
});

describe('DiffTextSource child resolution + bound callbacks', () => {
    it('modelFor(side) returns the matching child', () => {
        const { source, oldModel, newModel } = makeSource('a\n', 'a\nb\n');
        expect(source.modelFor('old')).toBe(oldModel);
        expect(source.modelFor('new')).toBe(newModel);
    });

    it('a side-bound editor callback edits only that child', () => {
        const { source, oldModel, newModel } = makeSource('a\n', 'a\nb\n');
        // The callback a ContextItem would hold: bound to the 'new' side.
        const editNew = source.boundEditor('new');
        editNew({ from: 0, to: 0, insert: 'X' });
        expect(newModel.getValue()).toBe('Xa\nb\n');
        expect(oldModel.getValue()).toBe('a\n'); // other side untouched
    });

    it('flat getValue/lineAtOffset delegate via an explicit side', () => {
        const { source } = makeSource('a\n', 'a\nb\nc\n');
        expect(source.valueFor('old')).toBe('a\n');
        expect(source.valueFor('new')).toBe('a\nb\nc\n');
        // line 3 ('c') on the new side starts at offset 4 ('a\nb\n' = 4 chars).
        expect(source.modelFor('new').lineAtOffset(4)).toBe(3);
    });
});
