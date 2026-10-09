import { describe, expect, it } from 'vitest';
import { closeBrackets, deleteBracketPair, insertBracket } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { indentUnit, matchBrackets } from '@codemirror/language';
import {
    addsSelectionRange,
    beginsRectangularSelection,
    caretLineDecorations,
    coreTypingExtensions,
    coreTypingKeymap,
    smartTab,
} from '../src/editor/editorInput';
import { editorAcceptanceFixture } from './fixtures/editorAcceptance';

function runCommand(state: EditorState, command: typeof smartTab): EditorState {
    let result: Transaction | null = null;
    expect(command({ state, dispatch: transaction => { result = transaction; } })).toBe(true);
    expect(result).not.toBeNull();
    return result!.state;
}

describe('core editor typing ergonomics', () => {
    it('inserts spaces to the next indentation stop instead of a literal tab', () => {
        const state = EditorState.create({
            doc: ' value',
            selection: { anchor: 1 },
            extensions: [indentUnit.of('    '), EditorState.tabSize.of(4)],
        });

        const next = runCommand(state, smartTab);

        expect(next.doc.toString()).toBe('    value');
        expect(next.selection.main.head).toBe(4);
        expect(next.doc.toString()).not.toContain('\t');
    });

    it('applies smart Tab independently at multiple carets', () => {
        const state = EditorState.create({
            doc: 'a\n  b',
            selection: EditorSelection.create([
                EditorSelection.cursor(0),
                EditorSelection.cursor(4),
            ]),
            extensions: [
                indentUnit.of('    '),
                EditorState.tabSize.of(4),
                EditorState.allowMultipleSelections.of(true),
            ],
        });

        const next = runCommand(state, smartTab);

        expect(next.doc.toString()).toBe('    a\n    b');
        expect(next.selection.ranges).toHaveLength(2);
    });

    it('uses a tab character when the file indentation unit is tabs', () => {
        const state = EditorState.create({
            doc: 'value',
            selection: { anchor: 0 },
            extensions: [indentUnit.of('\t'), EditorState.tabSize.of(4)],
        });

        expect(runCommand(state, smartTab).doc.toString()).toBe('\tvalue');
    });

    it('indents complete lines when Tab is pressed with a selection', () => {
        const state = EditorState.create({
            doc: 'one\ntwo',
            selection: { anchor: 0, head: 7 },
            extensions: [indentUnit.of('  ')],
        });

        const next = runCommand(state, smartTab);

        expect(next.doc.toString()).toBe('  one\n  two');
    });

    it('closes brackets and quotes and deletes an empty pair together', () => {
        let state = EditorState.create({
            doc: '',
            extensions: [javascript(), closeBrackets()],
        });

        const bracket = insertBracket(state, '(');
        expect(bracket).not.toBeNull();
        state = bracket!.state;
        expect(state.doc.toString()).toBe('()');
        expect(state.selection.main.head).toBe(1);

        state = runCommand(state, deleteBracketPair);
        expect(state.doc.toString()).toBe('');

        const quote = insertBracket(state, '"');
        expect(quote).not.toBeNull();
        expect(quote!.state.doc.toString()).toBe('""');
    });

    it('enables multiple selections in the shared input extension', () => {
        const state = EditorState.create({ extensions: [coreTypingExtensions] });
        expect(state.facet(EditorState.allowMultipleSelections)).toBe(true);
        expect(coreTypingKeymap.some(binding => binding.key === 'Backspace')).toBe(true);
    });

    it('uses IDE-style gestures for disconnected and rectangular selections', () => {
        expect(addsSelectionRange({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(true);
        expect(addsSelectionRange({ altKey: false, ctrlKey: false, metaKey: true, shiftKey: false })).toBe(true);
        expect(addsSelectionRange({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: false })).toBe(true);
        expect(addsSelectionRange({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: true })).toBe(false);

        expect(beginsRectangularSelection({ altKey: true, button: 0, shiftKey: true })).toBe(true);
        expect(beginsRectangularSelection({ altKey: true, button: 0, shiftKey: false })).toBe(false);
    });

    it('hides active-line decorations while characters are selected', () => {
        const cursor = EditorState.create({ doc: 'one\ntwo', selection: { anchor: 1 } });
        const selection = EditorState.create({ doc: 'one\ntwo', selection: { anchor: 1, head: 6 } });

        expect(caretLineDecorations(cursor).size).toBe(1);
        expect(caretLineDecorations(selection).size).toBe(0);
    });

    it('finds matching brackets in the permanent nested TypeScript fixture', () => {
        const source = editorAcceptanceFixture.typescript;
        const opening = source.indexOf('{');
        const state = EditorState.create({
            doc: source,
            extensions: [javascript({ typescript: true }), coreTypingExtensions],
        });

        const match = matchBrackets(state, opening, 1);
        expect(match?.matched).toBe(true);
        expect(match?.end).toBeDefined();
    });
});
