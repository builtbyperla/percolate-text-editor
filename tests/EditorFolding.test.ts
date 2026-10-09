import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { codeFolding, ensureSyntaxTree, foldEffect, unfoldEffect } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import {
    FoldLineProjection,
    foldInfoForLine,
    foldSnapshots,
    isFoldedRange,
    toggleFoldInState,
    unfoldLineInState,
    validateFoldsOnChange,
} from '../src/editor/folding';

const source = [
    'function outer() {',
    '  const value = 1;',
    '  if (value) {',
    '    return value;',
    '  }',
    '}',
].join('\n');

function foldingState(): EditorState {
    const state = EditorState.create({
        doc: source,
        extensions: [javascript(), codeFolding(), validateFoldsOnChange],
    });
    // Folding is syntax-derived. Ensure the fixture is parsed before querying it,
    // just as CmEditorFrame force-parses its first viewport at mount.
    expect(ensureSyntaxTree(state, state.doc.length, 100)).not.toBeNull();
    return state;
}

describe('editor folding state', () => {
    it('finds parser-derived folds only on foldable lines', () => {
        const state = foldingState();

        expect(foldInfoForLine(state, 1)).not.toBeNull();
        expect(foldInfoForLine(state, 2)).toBeNull();
        expect(foldInfoForLine(state, 3)).not.toBeNull();
        expect(foldInfoForLine(state, 0)).toBeNull();
        expect(foldInfoForLine(state, state.doc.lines + 1)).toBeNull();
    });

    it('reports the same fold as folded after applying a fold effect', () => {
        let state = foldingState();
        const range = foldInfoForLine(state, 1)!.range;

        state = state.update({ effects: foldEffect.of(range) }).state;
        expect(isFoldedRange(state, range)).toBe(true);
        expect(foldInfoForLine(state, 1)?.folded).toBe(true);

        state = state.update({ effects: unfoldEffect.of(range) }).state;
        expect(isFoldedRange(state, range)).toBe(false);
        expect(foldInfoForLine(state, 1)?.folded).toBe(false);
    });

    it('maps a persisted fold through an edit before the folded region', () => {
        let state = foldingState();
        const original = foldInfoForLine(state, 1)!.range;
        state = state.update({ effects: foldEffect.of(original) }).state;

        const inserted = '// heading\n';
        state = state.update({ changes: { from: 0, insert: inserted } }).state;
        const mapped = { from: original.from + inserted.length, to: original.to + inserted.length };

        expect(isFoldedRange(state, mapped)).toBe(true);
        expect(foldInfoForLine(state, 2)?.folded).toBe(true);
        expect(state.doc.toString()).toBe(inserted + source);
    });

    it('keeps a fold when an ordinary edit preserves its parser range', () => {
        let state = foldingState();
        const original = foldInfoForLine(state, 1)!.range;
        state = state.update({ effects: foldEffect.of(original) }).state;

        const insertion = '  console.log(value);\n';
        const insertAt = state.doc.line(5).from;
        state = state.update({ changes: { from: insertAt, insert: insertion } }).state;
        const mapped = { from: original.from, to: original.to + insertion.length };

        expect(isFoldedRange(state, mapped)).toBe(true);
        expect(foldInfoForLine(state, 1)?.folded).toBe(true);
    });

    it('removes a fold when an edit invalidates its syntax range', () => {
        let state = foldingState();
        const range = foldInfoForLine(state, 1)!.range;
        state = state.update({ effects: foldEffect.of(range) }).state;

        const openingBrace = state.doc.line(1).text.lastIndexOf('{') + state.doc.line(1).from;
        state = state.update({
            changes: { from: openingBrace, to: openingBrace + 1 },
            userEvent: 'delete',
        }).state;

        expect(foldSnapshots(state)).toHaveLength(0);
        expect(foldInfoForLine(state, 1)).toBeNull();
    });

    it('restores an inner fold when its folded parent is expanded', () => {
        let state = foldingState();
        const inner = foldInfoForLine(state, 3)!.range;
        const outer = foldInfoForLine(state, 1)!.range;
        state = state.update({ effects: [foldEffect.of(inner), foldEffect.of(outer)] }).state;

        // The read-only projection renders overlapping folds only once.
        expect(foldSnapshots(state)).toEqual([
            expect.objectContaining({ startLine: 1, endLine: 6 }),
        ]);

        state = state.update({ effects: unfoldEffect.of(outer) }).state;

        expect(foldSnapshots(state)).toEqual([
            expect.objectContaining({ startLine: 3, endLine: 5 }),
        ]);
        expect(isFoldedRange(state, inner)).toBe(true);
    });

    it('unfolds every nested fold hiding a revealed line', () => {
        let state = foldingState();
        const inner = foldInfoForLine(state, 3)!.range;
        const outer = foldInfoForLine(state, 1)!.range;
        state = state.update({ effects: [foldEffect.of(inner), foldEffect.of(outer)] }).state;

        state = unfoldLineInState(state, 4);

        expect(foldSnapshots(state)).toHaveLength(0);
        expect(isFoldedRange(state, inner)).toBe(false);
        expect(isFoldedRange(state, outer)).toBe(false);
    });

    it('projects collapsed source lines onto the read-only visual rows', () => {
        let state = foldingState();
        state = toggleFoldInState(state, 1);
        const folds = foldSnapshots(state);
        const projection = new FoldLineProjection(state.doc.lines, folds);

        expect(folds).toEqual([expect.objectContaining({
            startLine: 1,
            endLine: 6,
            hiddenLines: 5,
        })]);
        expect(projection.visibleLineCount).toBe(1);
        expect(projection.visibleSourceLines(0, 10)).toEqual([1]);
        expect(projection.visualRowForSourceLine(4)).toBe(0);
    });

    it('unfolds a cached fold when revealing one of its hidden source lines', () => {
        let state = toggleFoldInState(foldingState(), 1);
        expect(foldSnapshots(state)).toHaveLength(1);

        state = unfoldLineInState(state, 4);

        expect(foldSnapshots(state)).toHaveLength(0);
        expect(state.doc.toString()).toBe(source);
    });

    it('keeps visual/source row mapping stable around a middle-document fold', () => {
        const projection = new FoldLineProjection(10, [{
            from: 10,
            to: 40,
            startLine: 3,
            endLine: 6,
            hiddenLines: 3,
        }]);

        expect(projection.visibleLineCount).toBe(7);
        expect(projection.visibleSourceLines(0, 7)).toEqual([1, 2, 3, 7, 8, 9, 10]);
        expect(projection.sourceLineAtVisualRow(3)).toBe(7);
        expect(projection.visualRowForSourceLine(5)).toBe(2);
        expect(projection.visualRowForSourceLine(8)).toBe(4);
    });
});
