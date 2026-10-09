import { describe, it, expect } from 'vitest';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';
import { DiffScheduler } from '../src/editor/diff/DiffScheduler';
import { DiffTextSource } from '../src/editor/diff/DiffTextSource';
import { computeHunks } from '../src/editor/diff/DiffModel';

// Tier-1: applyHunk with ACCEPT semantics — make the target `side` adopt the OTHER
// side's version of that hunk, applied through the child model's applyEdit (native CM6
// change path). After accepting every hunk on a side, that side's text should equal the
// other side's. Cases cover the DiffHunk contract edges: modify, pure insertion, pure
// deletion, and a final line without a trailing newline.

function makeSource(oldText: string, newText: string) {
    const oldModel = new CmTextDataModel(oldText);
    const newModel = new CmTextDataModel(newText);
    const scheduler = new DiffScheduler(() => ({
        oldText: oldModel.getValue(),
        newText: newModel.getValue(),
    }));
    scheduler.recomputeNow();
    const source = new DiffTextSource('diff::sample', oldModel, newModel, scheduler);
    return { source, oldModel, newModel };
}

describe('DiffTextSource.applyHunk (accept: target adopts other side)', () => {
    it('accepts a modified line onto the old side (old := new)', () => {
        const { source, oldModel } = makeSource('a\nOLD\nc\n', 'a\nNEW\nc\n');
        const [hunk] = computeHunks('a\nOLD\nc\n', 'a\nNEW\nc\n');
        source.applyHunk(hunk, 'old');
        expect(oldModel.getValue()).toBe('a\nNEW\nc\n');
    });

    it('accepts an added block onto the old side (pure insertion)', () => {
        // new inserted x,y after line 1; accepting onto old inserts them there.
        const { source, oldModel } = makeSource('a\nb\n', 'a\nx\ny\nb\n');
        const [hunk] = computeHunks('a\nb\n', 'a\nx\ny\nb\n');
        source.applyHunk(hunk, 'old');
        expect(oldModel.getValue()).toBe('a\nx\ny\nb\n');
    });

    it('accepts a deletion onto the old side (pure deletion: old drops the lines)', () => {
        // new deleted x,y; accepting onto old removes them so old matches new.
        const { source, oldModel } = makeSource('a\nx\ny\nb\n', 'a\nb\n');
        const [hunk] = computeHunks('a\nx\ny\nb\n', 'a\nb\n');
        source.applyHunk(hunk, 'old');
        expect(oldModel.getValue()).toBe('a\nb\n');
    });

    it('accepts a change onto the new side (new := old), the other direction', () => {
        const { source, newModel } = makeSource('a\nOLD\nc\n', 'a\nNEW\nc\n');
        const [hunk] = computeHunks('a\nOLD\nc\n', 'a\nNEW\nc\n');
        source.applyHunk(hunk, 'new');
        expect(newModel.getValue()).toBe('a\nOLD\nc\n'); // new adopts old
    });

    it('handles a final line without a trailing newline', () => {
        const { source, oldModel } = makeSource('a\nb', 'a\nB');
        const [hunk] = computeHunks('a\nb', 'a\nB');
        source.applyHunk(hunk, 'old');
        expect(oldModel.getValue()).toBe('a\nB');
    });

    it('accepting every hunk makes the target side equal the other side', () => {
        const oldText = 'keep1\nchangeme\nkeep2\ngone\nkeep3\n';
        const newText = 'keep1\nCHANGED\nkeep2\nkeep3\nADDED\n';
        const { source, oldModel } = makeSource(oldText, newText);
        const hunks = computeHunks(oldText, newText);
        // Apply from the BOTTOM up so earlier hunks' offsets aren't shifted by later edits.
        for (const h of [...hunks].reverse()) source.applyHunk(h, 'old');
        expect(oldModel.getValue()).toBe(newText);
    });
});
