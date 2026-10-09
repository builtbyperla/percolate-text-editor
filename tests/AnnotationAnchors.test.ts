import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { anchorsFrom, rangesFrom } from '../src/textmodel/AnnotationAnchors';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';

// Tier-1/2: annotation-range reconciliation via the model-owned anchor RangeSet.
// The editor seeds the model's tracked ranges from the context registry each edit
// (setAnnotationRanges), then mapAnnotations maps them through the real ChangeSet and
// reports survivors (id -> new span) + dropped ids. Deletion is a set-difference over
// the model's OWN tracked set — never a diff against the registry — so an id the model
// doesn't track can never be reported deleted (the mirror-bug regression).

function changeSet(doc: string, change: { from: number; to?: number; insert?: string }) {
    return EditorState.create({ doc }).update({ changes: change }).changes;
}

describe('anchorsFrom / rangesFrom round-trip', () => {
    it('sorts on build and reads back in document order', () => {
        const set = anchorsFrom([
            { id: 'b', from: 6, to: 11 },
            { id: 'a', from: 0, to: 5 },
        ]);
        expect(rangesFrom(set)).toEqual([
            { id: 'a', from: 0, to: 5 },
            { id: 'b', from: 6, to: 11 },
        ]);
    });
});

describe('CmTextDataModel.mapAnnotations', () => {
    function tracking(doc: string, ranges: { id: string; from: number; to: number }[]) {
        const model = new CmTextDataModel(doc);
        model.setAnnotationRanges(ranges);
        return model;
    }

    it('shifts a range when text is inserted before it', () => {
        const model = tracking('alpha beta gamma', [{ id: 'x', from: 6, to: 10 }]); // "beta"
        const { survivors, dropped } = model.mapAnnotations(changeSet('alpha beta gamma', { from: 0, insert: 'XX ' }));
        expect(survivors).toEqual([{ id: 'x', from: 9, to: 13 }]);
        expect(dropped).toEqual([]);
    });

    it('grows a range when text is inserted inside it', () => {
        const model = tracking('alpha beta gamma', [{ id: 'x', from: 6, to: 10 }]);
        const { survivors, dropped } = model.mapAnnotations(changeSet('alpha beta gamma', { from: 8, insert: 'ZZ' }));
        expect(survivors).toEqual([{ id: 'x', from: 6, to: 12 }]);
        expect(dropped).toEqual([]);
    });

    it('leaves a range untouched when the edit is entirely after it', () => {
        const model = tracking('alpha beta gamma', [{ id: 'x', from: 0, to: 5 }]); // "alpha"
        const { survivors, dropped } = model.mapAnnotations(changeSet('alpha beta gamma', { from: 11, insert: '!!!' }));
        expect(survivors).toEqual([{ id: 'x', from: 0, to: 5 }]);
        expect(dropped).toEqual([]);
    });

    it('reports dropped when the exact span is deleted (collapses to zero width)', () => {
        const model = tracking('alpha beta gamma', [{ id: 'x', from: 6, to: 11 }]); // "beta "
        const { survivors, dropped } = model.mapAnnotations(changeSet('alpha beta gamma', { from: 6, to: 11, insert: '' }));
        expect(survivors).toEqual([]);
        expect(dropped).toEqual(['x']);
    });

    it('reports dropped when a delete straddles both endpoints (select-all)', () => {
        // delete [3,14) strictly contains span [6,11): RangeSet.map drops it entirely.
        const model = tracking('alpha beta gamma', [{ id: 'x', from: 6, to: 11 }]);
        const { survivors, dropped } = model.mapAnnotations(changeSet('alpha beta gamma', { from: 3, to: 14, insert: '' }));
        expect(survivors).toEqual([]);
        expect(dropped).toEqual(['x']);
    });

    it('maps multiple ranges independently in one edit', () => {
        const model = tracking('alpha beta gamma', [
            { id: 'a', from: 0, to: 5 },   // "alpha"
            { id: 'b', from: 11, to: 16 }, // "gamma"
        ]);
        const { survivors, dropped } = model.mapAnnotations(changeSet('alpha beta gamma', { from: 6, insert: 'XX ' }));
        expect(survivors).toEqual([
            { id: 'a', from: 0, to: 5 },   // before insert: unchanged
            { id: 'b', from: 14, to: 19 }, // after insert: shifted by 3
        ]);
        expect(dropped).toEqual([]);
    });

    // The mirror-bug regression. A peer view added annotation 'x'; the editor seeds it
    // via setAnnotationRanges and then a newline-above merely shifts it. It must be a
    // SURVIVOR, never dropped — deletion is only ever an id the map itself removed.
    it('never drops an id the map merely shifted (newline above)', () => {
        const doc = 'line one\nHIGHLIGHT here\nline three';
        const from = doc.indexOf('HIGHLIGHT');
        const to = from + 'HIGHLIGHT'.length;
        const model = tracking(doc, [{ id: 'peer', from, to }]);
        const { survivors, dropped } = model.mapAnnotations(changeSet(doc, { from: 0, insert: '\n' }));
        expect(dropped).toEqual([]);
        expect(survivors).toEqual([{ id: 'peer', from: from + 1, to: to + 1 }]);
    });

    // Re-seeding each edit from the registry: an id not in the current tracked set is
    // simply never mapped and never dropped (it isn't ours to delete).
    it('does not report an untracked id as dropped', () => {
        const model = tracking('abcdef', [{ id: 'tracked', from: 0, to: 3 }]);
        const { survivors, dropped } = model.mapAnnotations(changeSet('abcdef', { from: 6, insert: 'X' }));
        expect(dropped).toEqual([]);
        expect(survivors.map(s => s.id)).toEqual(['tracked']);
    });

    it('advances the doc buffer via applyChanges', () => {
        const model = new CmTextDataModel('abc');
        model.applyChanges(changeSet('abc', { from: 3, insert: 'def' }));
        expect(model.getValue()).toBe('abcdef');
    });
});
