import { codeFolding, ensureSyntaxTree, foldEffect, foldable } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { resolveLanguage } from '../src/editor/LanguageRouter';
import { EditorViewStateHost } from '../src/editor/EditorViewStateHost';
import { toggleFoldInState } from '../src/editor/folding';

const source = [
    'function folded() {',
    '  return true;',
    '}',
].join('\n');

function foldingState(): EditorState {
    const state = EditorState.create({
        doc: source,
        extensions: [resolveLanguage('state-host.ts', source) ?? [], codeFolding()],
    });
    expect(ensureSyntaxTree(state, state.doc.length, 100)).not.toBeNull();
    return state;
}

describe('EditorViewStateHost', () => {
    it('derives native fold snapshots from the published EditorState', () => {
        createRoot(dispose => {
            const state = foldingState();
            const line = state.doc.line(1);
            const range = foldable(state, line.from, line.to)!;
            const folded = state.update({ effects: foldEffect.of(range) }).state;
            const host = new EditorViewStateHost(folded);

            expect(host.folds()).toEqual([
                expect.objectContaining({ startLine: 1, endLine: 3 }),
            ]);
            dispose();
        });
    });

    it('applies native fold commands to its authoritative cached state', () => {
        createRoot(dispose => {
            const host = new EditorViewStateHost(foldingState());

            const next = host.update(state => toggleFoldInState(state, 1));

            expect(next).toBe(host.state());
            expect(host.folds()).toHaveLength(1);
            dispose();
        });
    });

    it('invalidates presentation state after an unrepresentable document replacement', () => {
        createRoot(dispose => {
            const host = new EditorViewStateHost(foldingState());

            expect(host.invalidateIfDocumentChanged(source)).toBe(false);
            expect(host.state()).not.toBeNull();
            expect(host.invalidateIfDocumentChanged('const replacement = true;')).toBe(true);
            expect(host.state()).toBeNull();
            expect(host.folds()).toEqual([]);
            dispose();
        });
    });
});
