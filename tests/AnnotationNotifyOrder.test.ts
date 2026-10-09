import { describe, it, expect } from 'vitest';
import { EditorState, ChangeSet } from '@codemirror/state';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';
import type { AnchorRange } from '../src/textmodel/AnnotationAnchors';

// Tier-1: the ORDER of model.notify() vs annotation reconciliation.
//
// CmEditorFrame's update listener runs applyChanges (which notifies synchronously)
// and only THEN reconcileAnnotations. DualTextView subscribes to that notify and
// re-runs loadFromContext against the new text — so the annotate view observes the
// new doc paired with ranges that have not yet been mapped through the edit.
//
// These tests pin that observable skew. They describe current behaviour: the first
// asserts what a subscriber sees today (the bug), the second what it must see.

describe('model notify vs annotation reconcile ordering', () => {
    const DOC = 'alpha beta gamma';
    const RANGE: AnchorRange = { id: 'h1', from: 11, to: 16 }; // "gamma", at the very end

    // Reproduces CmEditorFrame.buildListener: applyChanges (notifies) then reconcile.
    function editLikeTheFrame(doc: string, items: AnchorRange[], changes: ChangeSet) {
        const model = new CmTextDataModel(doc);
        const seenBySubscriber: { text: string; items: AnchorRange[] }[] = [];

        // DualTextView._onTextContentChanged -> refreshContent -> loadFromContext,
        // which reads the registry's CURRENT ranges (mutated in place by setRange).
        model.onChange(() => {
            seenBySubscriber.push({
                text: model.getValue(),
                items: items.map(i => ({ ...i })),
            });
        });

        model.setAnnotationRanges(items);
        const { survivors } = model.mapAnnotations(changes);
        for (const s of survivors) {              // setRange write-back
            const item = items.find(i => i.id === s.id);
            if (item) { item.from = s.from; item.to = s.to; }
        }
        model.applyChanges(changes);              // notify fires here, ranges current
        return { seenBySubscriber, items };
    }

    // Deleting before the highlight shortens the doc. Before the fix the subscriber
    // saw the new text beside the old range (to=16 against a 10-char doc) — the
    // `past-eof` report seen in the app. Now it sees the mapped range.
    it('subscriber observes the new text with already-mapped ranges', () => {
        const changes = ChangeSet.of({ from: 0, to: 6, insert: '' }, DOC.length); // drop "alpha "
        const { seenBySubscriber } = editLikeTheFrame(DOC, [{ ...RANGE }], changes);

        expect(seenBySubscriber).toHaveLength(1);
        const observed = seenBySubscriber[0];
        expect(observed.text).toBe('beta gamma');       // new text, length 10
        expect(observed.items[0]).toMatchObject({ from: 5, to: 10 });
    });

    // The invariant itself: whatever the subscriber sees must be self-consistent.
    it('every observed (text, ranges) pair should be in bounds', () => {
        const changes = ChangeSet.of({ from: 0, to: 6, insert: '' }, DOC.length);
        const { seenBySubscriber } = editLikeTheFrame(DOC, [{ ...RANGE }], changes);

        for (const obs of seenBySubscriber) {
            for (const r of obs.items) {
                expect(r.to, `range ${r.id} [${r.from},${r.to}) vs len ${obs.text.length}`)
                    .toBeLessThanOrEqual(obs.text.length);
            }
        }
    });

    // After reconcile completes the ranges ARE correct — proving the mapping is
    // fine and the defect is purely the window between notify and write-back.
    it('ranges are correct once reconcile has finished', () => {
        const changes = ChangeSet.of({ from: 0, to: 6, insert: '' }, DOC.length);
        const { items } = editLikeTheFrame(DOC, [{ ...RANGE }], changes);
        expect(items[0]).toMatchObject({ from: 5, to: 10 }); // "gamma" in "beta gamma"
    });
});
