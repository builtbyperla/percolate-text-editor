import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { renderMarkdown } from '../src/markdown/MarkdownModel';
import { buildTree, MarkdownTree } from '../src/markdown/MarkdownTree';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';

// Tier-1 (pure): the PROPOSED reconcile pipeline, proven before any of it is wired in.
//
//   reader ranges held in RAW coordinates on the raw model
//     -> raw model remaps them through the REAL ChangeSet   (exact, CM6, no diffing)
//     -> survivors projected back into DISPLAY space by leaf (structural, snapping)
//
// The point of the design is that NOTHING infers an edit position from text. The
// current implementation (MarkdownDerivedModel.diffToChangeSet) reconstructs the change
// by diffing old flat text against new, which is ambiguous whenever the inserted text
// shares a boundary run with what follows — see the duplicate-bullet failure in
// MarkdownDerivedRemap.test.ts, where a highlight GREW on an edit above it. Here the
// edit position is known exactly, so that whole bug class cannot occur.

function tree(raw: string): MarkdownTree {
    return buildTree(renderMarkdown(raw).tree);
}

// One edit + one reconcile of N annotations, end to end. Ranges go in as raw offsets,
// come back as display offsets over the NEW text.
function reconcile(
    rawBefore: string,
    edit: { from: number; to?: number; insert?: string },
    ranges: { id: string; from: number; to: number }[],
) {
    const model = new CmTextDataModel(rawBefore);
    model.setAnnotationRanges(ranges);

    const changes = EditorState.create({ doc: rawBefore }).update({ changes: edit }).changes;
    const { survivors, dropped } = model.mapAnnotations(changes);

    const rawAfter = changes.apply(EditorState.create({ doc: rawBefore }).doc).toString();
    const after = tree(rawAfter);

    const projected = survivors.map(s => ({ id: s.id, span: after.projectRange(s) }));
    return { rawAfter, displayAfter: after.text, projected, dropped };
}

// What an annotation's projected offsets actually cover in the new DISPLAY text. This
// is the real assertion — comparing covered TEXT rather than raw numbers is what makes
// a failure legible ("grew by a bullet" vs "to: 10 -> 19").
function covered(displayText: string, span: { from: number; to: number } | null) {
    return span == null ? null : displayText.slice(span.from, span.to);
}

function spanOf(res: ReturnType<typeof reconcile>, id: string) {
    const hit = res.projected.find(p => p.id === id);
    return covered(res.displayAfter, hit?.span ?? null);
}

// A raw range covering `needle`, expressed in raw-buffer coordinates.
function rawRange(raw: string, needle: string, id = 'a') {
    const from = raw.indexOf(needle);
    if (from < 0) throw new Error(`fixture error: ${JSON.stringify(needle)} not in raw`);
    return { id, from, to: from + needle.length };
}

describe('no highlights', () => {
    it('an edit with nothing tracked survives and drops nothing', () => {
        const raw = '# Title\n\n- one\n- two\n';
        const res = reconcile(raw, { from: raw.indexOf('- two'), insert: '- mid\n' }, []);

        expect(res.projected).toEqual([]);
        expect(res.dropped).toEqual([]);
    });
});

describe('one highlight — edit before / inside / after', () => {
    const raw = '# Title\n\nalpha para\n\nbeta para\n\ngamma para\n';

    it('edit BEFORE only shifts it', () => {
        const target = rawRange(raw, 'gamma para');
        const res = reconcile(raw, { from: raw.indexOf('alpha'), insert: 'INSERTED\n\n' }, [target]);

        expect(spanOf(res, 'a')).toBe('gamma para');
    });

    it('edit INSIDE grows it to include the new text', () => {
        const target = rawRange(raw, 'beta para');
        const res = reconcile(raw, { from: raw.indexOf('beta') + 4, insert: 'XX' }, [target]);

        // Growing is correct here: the insert landed within the annotated span.
        expect(spanOf(res, 'a')).toBe('betaXX para');
    });

    it('edit AFTER leaves it untouched', () => {
        const target = rawRange(raw, 'alpha para');
        const res = reconcile(raw, { from: raw.indexOf('gamma'), insert: 'TAIL ' }, [target]);

        expect(spanOf(res, 'a')).toBe('alpha para');
    });
});

// The case the current diff-based implementation gets wrong. Flattened markdown is
// dense with repeated '\n' and identical bullet glyphs, so a text diff cannot tell
// WHICH bullet was inserted. With the real ChangeSet there is nothing to disambiguate.
describe('one highlight — the duplicate-bullet case that broke the diff', () => {
    const raw = '- one\n- two\n- target\n';

    it('inserting a duplicate bullet above only shifts the highlight', () => {
        const target = rawRange(raw, '- target');
        const res = reconcile(raw, { from: raw.indexOf('- target'), insert: '- two\n' }, [target]);

        expect(spanOf(res, 'a')).toBe('• target');
    });
});

describe('multiple highlights — edit before / between / inside one / after', () => {
    const raw = '# Doc\n\nfirst block\n\nsecond block\n\nthird block\n';

    function three() {
        return [
            rawRange(raw, 'first block', 'one'),
            rawRange(raw, 'second block', 'two'),
            rawRange(raw, 'third block', 'three'),
        ];
    }

    it('edit BEFORE all of them shifts all three', () => {
        const res = reconcile(raw, { from: raw.indexOf('first'), insert: 'PRE\n\n' }, three());

        expect(spanOf(res, 'one')).toBe('first block');
        expect(spanOf(res, 'two')).toBe('second block');
        expect(spanOf(res, 'three')).toBe('third block');
    });

    it('edit BETWEEN two highlights shifts only the ones after it', () => {
        const res = reconcile(raw, { from: raw.indexOf('second'), insert: 'MID\n\n' }, three());

        expect(spanOf(res, 'one')).toBe('first block');
        expect(spanOf(res, 'two')).toBe('second block');
        expect(spanOf(res, 'three')).toBe('third block');
    });

    it('edit INSIDE the middle highlight grows only that one', () => {
        const res = reconcile(raw, { from: raw.indexOf('second') + 6, insert: 'XX' }, three());

        expect(spanOf(res, 'one')).toBe('first block');
        expect(spanOf(res, 'two')).toBe('secondXX block');
        expect(spanOf(res, 'three')).toBe('third block');
    });

    it('edit AFTER all of them leaves all three untouched', () => {
        const res = reconcile(raw, { from: raw.length, insert: '\ntrailing\n' }, three());

        expect(spanOf(res, 'one')).toBe('first block');
        expect(spanOf(res, 'two')).toBe('second block');
        expect(spanOf(res, 'three')).toBe('third block');
    });

    it('deleting the middle highlight drops it and keeps the others', () => {
        const from = raw.indexOf('second block');
        const res = reconcile(raw, { from, to: from + 'second block'.length }, three());

        expect(res.dropped).toContain('two');
        expect(spanOf(res, 'one')).toBe('first block');
        expect(spanOf(res, 'three')).toBe('third block');
    });
});

// Snapping is the resolution limit of the mapping, so pin it directly: a bound landing
// inside a stripped marker has no display counterpart and must snap to a leaf edge.
describe('marker snapping', () => {
    it('a range starting inside a bold marker snaps onto the visible text', () => {
        const raw = 'plain **bold** tail';
        const t = tree(raw);
        // Start inside the '**' opener, end after the word.
        const span = t.projectRange({ from: raw.indexOf('**') + 1, to: raw.indexOf('bold') + 4 });

        expect(covered(t.text, span)).toBe('bold');
    });

    it('a range covering only a marker collapses to null', () => {
        const raw = 'plain **bold** tail';
        const t = tree(raw);
        const at = raw.indexOf('**');
        expect(t.projectRange({ from: at, to: at + 2 })).toBeNull();
    });
});
