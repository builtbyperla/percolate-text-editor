import { EditorState, Extension, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { foldEffect, foldable, foldedRanges, unfoldEffect } from '@codemirror/language';

export interface FoldRange {
    from: number;
    to: number;
}

export interface FoldSnapshot extends FoldRange {
    startLine: number;
    endLine: number;
    hiddenLines: number;
}

export interface LineFoldInfo {
    range: FoldRange;
    folded: boolean;
}

export interface FoldingController {
    info: (state: EditorState, lineNumber: number) => LineFoldInfo | null;
    toggle: (view: EditorView, lineNumber: number) => boolean;
    onChange?: (before: EditorState, after: EditorState) => void;
}

/**
 * CodeMirror maps fold decorations through edits, including edits to a fold's
 * opening or closing delimiter. Keep only folds that still exactly correspond
 * to a parser-derived range in the updated document.
 */
export const validateFoldsOnChange: Extension = EditorState.transactionExtender.of(tr => {
    if (!tr.docChanged) return null;

    const effects: StateEffect<FoldRange>[] = [];
    foldedRanges(tr.state).between(0, tr.state.doc.length, (from, to) => {
        const line = tr.state.doc.lineAt(from);
        const current = foldable(tr.state, line.from, line.to);
        if (!current || current.from !== from || current.to !== to) {
            effects.push(unfoldEffect.of({ from, to }));
        }
    });
    return effects.length > 0 ? { effects } : null;
});

/** Source-line ↔ visible-row projection for the read-only folded rendering. */
export class FoldLineProjection {
    readonly visibleLineCount: number;

    constructor(
        readonly lineCount: number,
        readonly folds: readonly FoldSnapshot[],
    ) {
        const hidden = folds.reduce(
            (total, fold) => total + Math.max(0, fold.endLine - fold.startLine),
            0,
        );
        this.visibleLineCount = Math.max(1, lineCount - hidden);
    }

    sourceLineAtVisualRow(row: number): number {
        const target = Math.max(0, Math.min(row, this.visibleLineCount - 1));
        let sourceStart = 1;
        let visualStart = 0;

        for (const fold of this.folds) {
            const visibleThroughOpening = fold.startLine - sourceStart + 1;
            if (target < visualStart + visibleThroughOpening) {
                return sourceStart + target - visualStart;
            }
            visualStart += visibleThroughOpening;
            sourceStart = fold.endLine + 1;
        }
        return Math.min(this.lineCount, sourceStart + target - visualStart);
    }

    visualRowForSourceLine(line: number): number {
        const target = Math.max(1, Math.min(line, this.lineCount));
        let hiddenAbove = 0;
        for (const fold of this.folds) {
            if (target <= fold.startLine) break;
            if (target <= fold.endLine) {
                return fold.startLine - 1 - hiddenAbove;
            }
            hiddenAbove += fold.endLine - fold.startLine;
        }
        return target - 1 - hiddenAbove;
    }

    visibleSourceLines(first: number, count: number): number[] {
        const start = Math.max(0, first);
        const end = Math.min(this.visibleLineCount, start + Math.max(0, count));
        return Array.from({ length: Math.max(0, end - start) }, (_, index) =>
            this.sourceLineAtVisualRow(start + index));
    }
}

/** True when CodeMirror's fold state contains this exact syntax fold range. */
export function isFoldedRange(state: EditorState, range: FoldRange): boolean {
    let found = false;
    foldedRanges(state).between(range.from, range.to, (from, to) => {
        if (from === range.from && to === range.to) found = true;
    });
    return found;
}

/** Parser-derived folding information for a 1-based document line. */
export function foldInfoForLine(state: EditorState, lineNumber: number): LineFoldInfo | null {
    if (lineNumber < 1 || lineNumber > state.doc.lines) return null;
    const line = state.doc.line(lineNumber);
    const range = foldable(state, line.from, line.to);
    if (!range) return null;
    return { range, folded: isFoldedRange(state, range) };
}

/**
 * The outermost folded source ranges in document order. Nested folds may remain
 * in CodeMirror's state when their parent is folded, but the read-only projection
 * must replace an overlapping region only once.
 */
export function foldSnapshots(state: EditorState): FoldSnapshot[] {
    const raw = foldedRangeList(state);
    raw.sort((a, b) => a.from - b.from || b.to - a.to);

    const snapshots: FoldSnapshot[] = [];
    let coveredTo = -1;
    for (const range of raw) {
        if (range.from < coveredTo) continue;
        const startLine = state.doc.lineAt(range.from).number;
        const endLine = state.doc.lineAt(range.to).number;
        snapshots.push({
            ...range,
            startLine,
            endLine,
            hiddenLines: Math.max(1, endLine - startLine),
        });
        coveredTo = range.to;
    }
    return snapshots;
}

/** Every folded range, including folds nested inside a folded parent. */
export function foldedRangeList(state: EditorState): FoldRange[] {
    const raw: FoldRange[] = [];
    foldedRanges(state).between(0, state.doc.length, (from, to) => {
        if (to > from) raw.push({ from, to });
    });
    return raw;
}

/** Apply a fold toggle directly to a cached EditorState with no mounted view. */
export function toggleFoldInState(state: EditorState, lineNumber: number): EditorState {
    const info = foldInfoForLine(state, lineNumber);
    if (!info) return state;
    return state.update({
        effects: (info.folded ? unfoldEffect : foldEffect).of(info.range),
    }).state;
}

/** Set, rather than toggle, the parser-derived fold on a source line. */
export function setFoldInState(state: EditorState, lineNumber: number, folded: boolean): EditorState {
    const info = foldInfoForLine(state, lineNumber);
    if (!info || info.folded === folded) return state;
    return state.update({
        effects: (folded ? foldEffect : unfoldEffect).of(info.range),
    }).state;
}

export function setFoldInView(view: EditorView, lineNumber: number, folded: boolean): boolean {
    const info = foldInfoForLine(view.state, lineNumber);
    if (!info) return false;
    if (info.folded !== folded) {
        view.dispatch({ effects: (folded ? foldEffect : unfoldEffect).of(info.range) });
    }
    return true;
}

/** Unfold every collapsed range that visually hides the requested source line. */
export function unfoldLineInState(state: EditorState, lineNumber: number): EditorState {
    const containing = foldsHidingLine(state, lineNumber)
        .map(range => unfoldEffect.of(range));
    return containing.length > 0 ? state.update({ effects: containing }).state : state;
}

export function unfoldLineInView(view: EditorView, lineNumber: number): boolean {
    const containing = foldsHidingLine(view.state, lineNumber)
        .map(range => unfoldEffect.of(range));
    if (containing.length === 0) return false;
    view.dispatch({ effects: containing });
    return true;
}

function foldsHidingLine(state: EditorState, lineNumber: number): FoldSnapshot[] {
    if (lineNumber < 1 || lineNumber > state.doc.lines) return [];
    return foldedRangeList(state).map(range => {
        const startLine = state.doc.lineAt(range.from).number;
        const endLine = state.doc.lineAt(range.to).number;
        return {
            ...range,
            startLine,
            endLine,
            hiddenLines: Math.max(1, endLine - startLine),
        };
    }).filter(range => range.startLine < lineNumber && lineNumber <= range.endLine);
}

/** Toggle the parser-derived fold beginning on a 1-based document line. */
export function toggleFoldAtLine(view: EditorView, lineNumber: number): boolean {
    const info = foldInfoForLine(view.state, lineNumber);
    if (!info) return false;
    view.dispatch({
        effects: (info.folded ? unfoldEffect : foldEffect).of(info.range),
    });
    return true;
}
