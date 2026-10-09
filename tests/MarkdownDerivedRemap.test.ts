import { describe, it, expect } from 'vitest';
import { MarkdownDerivedModel } from '../src/markdown/MarkdownDerivedModel';

// Tier-1: annotation range reconciliation in the READER's flat display space.
//
// A highlight here is nothing but a {from, to} pair of offsets — no content hash, no
// text re-matching. So reconciliation has exactly one job: when the flat text changes,
// move those two integers to still cover the same characters. This file pins that.
//
// The reader can't reuse the raw editor's ChangeSet (that one is in RAW markdown space,
// this model is in flattened display space), so MarkdownDerivedModel INFERS the change
// by diffing old flat text against new. That inference is the layer under test, and the
// stated contract it must honour is: an edit ABOVE an annotation may only SHIFT it,
// never GROW it.

// Reconcile one annotation across a flat-text change and hand back its new span.
// Mirrors exactly what MarkdownInnerText.rederive does: seed from the item's current
// range, rederive to the new flat text, read the survivor back.
function remap(oldFlat: string, newFlat: string, from: number, to: number) {
    const model = new MarkdownDerivedModel(oldFlat);
    const { survivors, dropped } = model.rederive(newFlat, [{ id: 'a', from, to }]);
    return { survivor: survivors.find(s => s.id === 'a') ?? null, dropped };
}

// The text an annotation's offsets actually cover — the real assertion. Comparing the
// covered SUBSTRING rather than raw numbers is what makes a failure legible: "was
// 'beta', now 'beta\n\n• one'" says grew-by-a-bullet, where "to: 10 -> 19" does not.
function covered(flat: string, span: { from: number; to: number } | null) {
    return span == null ? null : flat.slice(span.from, span.to);
}

describe('MarkdownDerivedModel: edit above an annotation only shifts it', () => {
    it('shifts on a plain-prose insert above', () => {
        const oldFlat = 'title\n\nfirst para\n\nsecond para';
        const newFlat = 'title\n\nfirst para EXTRA\n\nsecond para';
        const from = oldFlat.indexOf('second para');
        const { survivor } = remap(oldFlat, newFlat, from, from + 'second para'.length);

        expect(covered(newFlat, survivor)).toBe('second para');
    });

    // The adversarial case for a prefix/suffix diff: flattened markdown is dense with
    // repeated '\n' and identical '•' glyphs, so the common-suffix scan can walk back
    // through a whole bullet run and cross the insertion point.
    it('shifts on an insert above a bullet list', () => {
        const oldFlat = 'intro\n\n• one\n• two\n• three';
        const newFlat = 'intro MORE\n\n• one\n• two\n• three';
        const from = oldFlat.indexOf('• three');
        const { survivor } = remap(oldFlat, newFlat, from, from + '• three'.length);

        expect(covered(newFlat, survivor)).toBe('• three');
    });

    // Inserting a WHOLE new bullet above: the new text duplicates a run that already
    // exists below it, which is precisely what makes prefix/suffix ambiguous.
    it('shifts when a duplicate bullet is inserted above', () => {
        const oldFlat = '• one\n• two\n• target';
        const newFlat = '• one\n• two\n• two\n• target';
        const from = oldFlat.indexOf('• target');
        const { survivor } = remap(oldFlat, newFlat, from, from + '• target'.length);

        expect(covered(newFlat, survivor)).toBe('• target');
    });

    it('shifts when a new heading block is prepended', () => {
        const oldFlat = 'body text here';
        const newFlat = 'New Heading\n\nbody text here';
        const from = oldFlat.indexOf('text');
        const { survivor } = remap(oldFlat, newFlat, from, from + 'text'.length);

        expect(covered(newFlat, survivor)).toBe('text');
    });
});

describe('MarkdownDerivedModel: edits at and after the annotation', () => {
    it('leaves an annotation untouched when the edit is below it', () => {
        const oldFlat = 'alpha\n\nbeta\n\ngamma';
        const newFlat = 'alpha\n\nbeta\n\ngamma delta';
        const from = oldFlat.indexOf('alpha');
        const { survivor } = remap(oldFlat, newFlat, from, from + 'alpha'.length);

        expect(survivor).toEqual({ id: 'a', from: 0, to: 5 });
    });

    it('grows the annotation when text is inserted INSIDE it', () => {
        const oldFlat = 'alpha beta gamma';
        const newFlat = 'alpha beXXta gamma';
        const from = oldFlat.indexOf('beta');
        const { survivor } = remap(oldFlat, newFlat, from, from + 'beta'.length);

        // Growing is correct here — the inserted text is within the annotated span.
        expect(covered(newFlat, survivor)).toBe('beXXta');
    });

    it('drops the annotation when its text is deleted outright', () => {
        const oldFlat = 'alpha beta gamma';
        const newFlat = 'alpha  gamma';
        const from = oldFlat.indexOf('beta');
        const { dropped } = remap(oldFlat, newFlat, from, from + 'beta'.length);

        expect(dropped).toContain('a');
    });
});
