import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { indentLess, indentMore } from '@codemirror/commands';
import { EditorSelection, EditorState, countColumn } from '@codemirror/state';
import type { Extension, StateCommand } from '@codemirror/state';
import {
    crosshairCursor,
    Decoration,
    drawSelection,
    dropCursor,
    highlightSpecialChars,
    rectangularSelection,
    EditorView,
} from '@codemirror/view';
import type { KeyBinding } from '@codemirror/view';
import { bracketMatching, getIndentUnit, indentUnit } from '@codemirror/language';

/** IDE-style additive selection: Option/Alt, plus CM6's platform defaults. */
export const addsSelectionRange = (event: Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): boolean =>
    event.metaKey || event.ctrlKey || (event.altKey && !event.shiftKey);

/** Reserve Option/Alt+Shift drag for a rectangular selection. */
export const beginsRectangularSelection = (event: Pick<MouseEvent, 'altKey' | 'button' | 'shiftKey'>): boolean =>
    event.button === 0 && event.altKey && event.shiftKey;

const activeLineDecoration = Decoration.line({ class: 'cm-activeLine' });

/** Highlight caret lines only when no range contains selected characters. */
export const caretLineDecorations = (state: EditorState) => {
    if (state.selection.ranges.some(range => !range.empty)) return Decoration.none;

    const starts = new Set(state.selection.ranges.map(range => state.doc.lineAt(range.head).from));
    return Decoration.set(Array.from(starts, from => activeLineDecoration.range(from)));
};

const caretLineHighlight = EditorView.decorations.compute(
    ['doc', 'selection'],
    caretLineDecorations,
);

/**
 * Insert whitespace to the next indentation stop at every caret. A non-empty
 * selection keeps the familiar IDE behavior of indenting the selected lines.
 */
export const smartTab: StateCommand = ({ state, dispatch }) => {
    if (state.selection.ranges.some(range => !range.empty)) {
        return indentMore({ state, dispatch });
    }

    const unitWidth = getIndentUnit(state);
    const usesTabs = state.facet(indentUnit).startsWith('\t');
    const spec = state.changeByRange(range => {
        const line = state.doc.lineAt(range.head);
        const column = countColumn(line.text, state.tabSize, range.head - line.from);
        const columns = unitWidth - column % unitWidth;
        const insert = usesTabs ? '\t' : ' '.repeat(columns);
        return {
            changes: { from: range.head, insert },
            range: EditorSelection.cursor(range.head + insert.length),
        };
    });
    dispatch(state.update(spec, { scrollIntoView: true, userEvent: 'input' }));
    return true;
};

export const coreTypingKeymap: readonly KeyBinding[] = [
    { key: 'Tab', run: smartTab, shift: indentLess },
    ...closeBracketsKeymap,
];

/** Core editing-surface behavior shared by ordinary and diff CodeMirror views. */
export const coreTypingExtensions: Extension = [
    closeBrackets(),
    bracketMatching(),
    drawSelection(),
    caretLineHighlight,
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.clickAddsSelectionRange.of(addsSelectionRange),
    rectangularSelection({ eventFilter: beginsRectangularSelection }),
    crosshairCursor(),
    highlightSpecialChars(),
];
