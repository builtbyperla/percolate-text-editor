import { describe, it, expect } from 'vitest';
import { computeHunks } from '../src/editor/diff/DiffModel';

// Tier-1 (pure): line-level diff -> coalesced line-range hunks. The core-risk
// assertions are (a) contiguous changed runs coalesce into ONE hunk (block, not
// per-line), and (b) pure inserts/deletes carry a zero count on the untouched side
// with correct 1-based line anchors — that's what the CM6 decoration layer addresses.

describe('computeHunks', () => {
    it('identical texts produce no hunks', () => {
        const t = 'a\nb\nc\n';
        expect(computeHunks(t, t)).toEqual([]);
    });

    it('empty vs empty produces no hunks', () => {
        expect(computeHunks('', '')).toEqual([]);
    });

    it('a multi-line insertion is ONE hunk with oldCount 0', () => {
        const oldText = 'a\nb\n';
        const newText = 'a\nx\ny\nb\n';
        const hunks = computeHunks(oldText, newText);
        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toEqual({ oldStart: 2, oldCount: 0, newStart: 2, newCount: 2 });
    });

    it('a multi-line deletion is ONE hunk with newCount 0', () => {
        const oldText = 'a\nx\ny\nb\n';
        const newText = 'a\nb\n';
        const hunks = computeHunks(oldText, newText);
        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toEqual({ oldStart: 2, oldCount: 2, newStart: 2, newCount: 0 });
    });

    it('a modified line is ONE hunk spanning both sides (removed then added)', () => {
        const oldText = 'a\nOLD\nc\n';
        const newText = 'a\nNEW\nc\n';
        const hunks = computeHunks(oldText, newText);
        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toEqual({ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 });
    });

    it('adjacent changed lines coalesce into a single hunk', () => {
        const oldText = 'a\nb\nc\nd\n';
        const newText = 'a\nB\nC\nd\n';
        const hunks = computeHunks(oldText, newText);
        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toEqual({ oldStart: 2, oldCount: 2, newStart: 2, newCount: 2 });
    });

    it('separated changes produce distinct hunks', () => {
        const oldText = 'a\nb\nc\nd\ne\n';
        const newText = 'a\nB\nc\nd\nE\n';
        const hunks = computeHunks(oldText, newText);
        expect(hunks).toHaveLength(2);
        expect(hunks[0]).toEqual({ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 });
        expect(hunks[1]).toEqual({ oldStart: 5, oldCount: 1, newStart: 5, newCount: 1 });
    });

    it('insertion into empty text is one added hunk anchored at line 1', () => {
        const hunks = computeHunks('', 'x\ny\n');
        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toEqual({ oldStart: 1, oldCount: 0, newStart: 1, newCount: 2 });
    });

    it('anchors insertions and deletions at the first and last lines', () => {
        expect(computeHunks('a\nb\n', 'x\na\nb\n')).toEqual([
            { oldStart: 1, oldCount: 0, newStart: 1, newCount: 1 },
        ]);
        expect(computeHunks('a\nb\n', 'a\nb\nx\n')).toEqual([
            { oldStart: 3, oldCount: 0, newStart: 3, newCount: 1 },
        ]);
        expect(computeHunks('x\na\nb\n', 'a\nb\n')).toEqual([
            { oldStart: 1, oldCount: 1, newStart: 1, newCount: 0 },
        ]);
        expect(computeHunks('a\nb\nx\n', 'a\nb\n')).toEqual([
            { oldStart: 3, oldCount: 1, newStart: 3, newCount: 0 },
        ]);
    });

    it('handles a final line without a trailing newline', () => {
        // "b" (no newline) vs "B" (no newline): the last line still diffs correctly
        // rather than being swallowed as an ending.
        const hunks = computeHunks('a\nb', 'a\nB');
        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toEqual({ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 });
    });

    it('handles contiguous multi-line changes with internal blank lines', () => {
        // Regression test: a single contiguous edit containing internal blank lines
        // and short tokens should not fragment into multiple hunks due to coincidental
        // line matches. jsdiff's diffLines algorithm (used by structuredPatch) is
        // still line-equality based, but at least produces the minimal number of hunks
        // for the text structure, avoiding the old LCS "flush-on-every-equal" behavior.
        const oldText = 'line1\nline2\nline3\n';
        const newText = 'line1\nchanged\nblock\nwith\n\nblank\nline3\n';
        const hunks = computeHunks(oldText, newText);
        // The changed region is lines 2-6 on new (insertion of 4 lines), lines 2-2 on old (deletion of 1 line).
        // This should be ONE hunk (contiguous region), not fragmented.
        expect(hunks).toHaveLength(1);
        expect(hunks[0].oldStart).toBe(2);
        expect(hunks[0].oldCount).toBe(1);
        expect(hunks[0].newStart).toBe(2);
        expect(hunks[0].newCount).toBe(5);
    });
});
