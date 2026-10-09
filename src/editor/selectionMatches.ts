import { SearchCursor } from '@codemirror/search';
import {
    Decoration,
    EditorView,
    ViewPlugin,
    type DecorationSet,
    type ViewUpdate,
} from '@codemirror/view';

const MAX_SELECTION_LENGTH = 200;
const MAX_VISIBLE_MATCHES = 100;

/** Whether a regular selection is meaningful enough to highlight elsewhere. */
export function isSelectionMatchCandidate(text: string): boolean {
    if (!text || /^\s+$/u.test(text)) return false;

    return [...text].length > 1;
}

const matchDecoration = Decoration.mark({ class: 'cm-selectionMatch' });

function selectionMatchDecorations(view: EditorView): DecorationSet {
    const { state } = view;
    if (state.selection.ranges.length !== 1) return Decoration.none;

    const range = state.selection.main;
    if (range.empty || range.to - range.from > MAX_SELECTION_LENGTH) return Decoration.none;

    const query = state.sliceDoc(range.from, range.to);
    if (!isSelectionMatchCandidate(query)) return Decoration.none;

    const matches = [];
    for (const visibleRange of view.visibleRanges) {
        const cursor = new SearchCursor(state.doc, query, visibleRange.from, visibleRange.to);
        while (!cursor.next().done) {
            const { from, to } = cursor.value;
            if (from >= range.to || to <= range.from) {
                matches.push(matchDecoration.range(from, to));
                if (matches.length > MAX_VISIBLE_MATCHES) return Decoration.none;
            }
        }
    }
    return Decoration.set(matches);
}

/** Predicate-aware replacement for CodeMirror's highlightSelectionMatches(). */
export const filteredSelectionMatches = ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = selectionMatchDecorations(view);
    }

    update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged || update.viewportChanged) {
            this.decorations = selectionMatchDecorations(update.view);
        }
    }
}, {
    decorations: plugin => plugin.decorations,
});
