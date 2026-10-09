import { DiffTextSource, DiffSourceData } from './DiffTextSource';
import { DiffSide, DiffHunk } from './DiffModel';
import { EditorState } from '@codemirror/state';
import { userSettings } from '../../UserSettings';
import { FoldRange, LineFoldInfo, foldedRangeList, foldInfoForLine } from '../folding';

interface CoordinatedFoldView {
    currentFoldingState(): EditorState | null;
    applyCoordinatedFold(line: number, folded: boolean): boolean;
    refreshCoordinatedFoldControls(): void;
}

type DiffViewMode = 'edit' | 'annotate';

interface CoordinatedModeView {
    getTabMode(): () => string | undefined;
    setEditMode(): void;
    setAnnotateMode(): void;
}

// The scroll container for one diff side (the side's .readFrame). The coordinator holds
// one per side and mirrors scrollTop between them so the panes scroll in lockstep.
interface SideScroller {
    side: DiffSide;
    el: HTMLElement;
    detach: () => void;
}

export interface DiffContextPayload {
    kind: 'diff';
    side: DiffSide;
    diff: { oldText: string; newText: string; hunks: DiffHunk[] };
}

export class DiffContextCoordinator {
    constructor(private source: DiffTextSource) {}

    private scrollers = new Map<DiffSide, SideScroller>();

    // A scrollTop assignment schedules its scroll event for later, after the
    // assignment has returned. Remember the value written to each follower so
    // that delayed event is consumed instead of becoming a new source event.
    private expectedScroll = new Map<DiffSide, number>();
    private syncingFolds = false;

    private foldViews = new Map<DiffSide, CoordinatedFoldView>();
    private modeViews = new Map<DiffSide, CoordinatedModeView>();

    registerModeView(side: DiffSide, view: CoordinatedModeView): void {
        this.modeViews.set(side, view);
    }

    toggleMode(side: DiffSide): void {
        if (userSettings.annotateLock() !== 'unlocked') return;
        const origin = this.modeViews.get(side);
        if (!origin) return;
        const target: DiffViewMode = origin.getTabMode()() === 'edit' ? 'annotate' : 'edit';
        for (const view of this.modeViews.values()) {
            if (target === 'edit') view.setEditMode();
            else view.setAnnotateMode();
        }
    }

    registerFoldView(side: DiffSide, view: CoordinatedFoldView): void {
        this.foldViews.set(side, view);
        for (const registered of this.foldViews.values()) {
            registered.refreshCoordinatedFoldControls();
        }
    }

    coordinatedFoldInfo(side: DiffSide, state: EditorState, line: number): LineFoldInfo | null {
        const info = foldInfoForLine(state, line);
        return info && this.matchingFold(side, state, info.range) ? info : null;
    }

    toggleFold(side: DiffSide, line: number): boolean {
        const ownView = this.foldViews.get(side);
        const ownState = ownView?.currentFoldingState();
        if (!ownView || !ownState) return false;
        const own = this.coordinatedFoldInfo(side, ownState, line);
        const match = own && this.matchingFold(side, ownState, own.range);
        if (!own || !match) return false;

        const desired = !own.folded;
        const otherView = this.foldViews.get(otherSide(side));
        if (!otherView) return false;

        this.syncingFolds = true;
        try {
            return this.commitFoldPair(
                ownView, line, own.folded,
                otherView, match.line, match.info.folded,
                desired,
            );
        } finally {
            this.syncingFolds = false;
        }
    }

    unfoldLine(side: DiffSide, line: number): boolean {
        const ownView = this.foldViews.get(side);
        const state = ownView?.currentFoldingState();
        if (!ownView || !state || line < 1 || line > state.doc.lines) return false;

        const hiding = foldedRangeList(state).filter(range => {
            const start = state.doc.lineAt(range.from).number;
            const end = state.doc.lineAt(range.to).number;
            return start < line && line <= end;
        });
        if (hiding.length === 0) return false;

        this.syncingFolds = true;
        try {
            for (const range of hiding) {
                const match = this.matchingFold(side, state, range);
                if (match) {
                    this.foldViews.get(otherSide(side))?.applyCoordinatedFold(match.line, false);
                }
                ownView.applyCoordinatedFold(state.doc.lineAt(range.from).number, false);
            }
        } finally {
            this.syncingFolds = false;
        }
        return true;
    }

    synchronizeFoldChange(side: DiffSide, before: EditorState, after: EditorState): void {
        if (this.syncingFolds || before.doc !== after.doc) return;

        const beforeRanges = foldedRangeList(before);
        const afterRanges = foldedRangeList(after);
        const beforeKeys = new Set(beforeRanges.map(rangeKey));
        const afterKeys = new Set(afterRanges.map(rangeKey));

        this.syncingFolds = true;
        try {
            for (const range of afterRanges) {
                if (beforeKeys.has(rangeKey(range))) continue;
                const match = this.matchingFold(side, after, range);
                if (match) {
                    const other = this.foldViews.get(otherSide(side));
                    if (!other?.applyCoordinatedFold(match.line, true)) {
                        // The originating CM6 transaction already committed. Restore
                        // it when the paired side cannot accept the same presentation.
                        this.foldViews.get(side)?.applyCoordinatedFold(
                            after.doc.lineAt(range.from).number,
                            false,
                        );
                    }
                } else {
                    // Keyboard commands and CM6's inline placeholder bypass the ruler's
                    // compatibility filter. Reject an unmatched one-sided fold.
                    const line = after.doc.lineAt(range.from).number;
                    this.foldViews.get(side)?.applyCoordinatedFold(line, false);
                }
            }
            for (const range of beforeRanges) {
                if (afterKeys.has(rangeKey(range))) continue;
                const match = this.matchingFold(side, before, range);
                if (match) {
                    const other = this.foldViews.get(otherSide(side));
                    if (!other?.applyCoordinatedFold(match.line, false)) {
                        this.foldViews.get(side)?.applyCoordinatedFold(
                            before.doc.lineAt(range.from).number,
                            true,
                        );
                    }
                }
            }
        } finally {
            this.syncingFolds = false;
        }
    }

    /**
     * Commit a paired presentation change after both parser ranges were resolved.
     * JavaScript dispatch is synchronous, so no state can interleave between the
     * preflight in matchingFold and these writes. Roll back either unexpected
     * adapter failure to keep the panes aligned.
     */
    private commitFoldPair(
        first: CoordinatedFoldView,
        firstLine: number,
        firstBefore: boolean,
        second: CoordinatedFoldView,
        secondLine: number,
        secondBefore: boolean,
        desired: boolean,
    ): boolean {
        if (!first.applyCoordinatedFold(firstLine, desired)) return false;
        if (second.applyCoordinatedFold(secondLine, desired)) return true;

        first.applyCoordinatedFold(firstLine, firstBefore);
        second.applyCoordinatedFold(secondLine, secondBefore);
        return false;
    }

    /** Re-check paired folds after the scheduler publishes a new line mapping. */
    reconcileFolds(): void {
        if (this.syncingFolds) return;
        this.syncingFolds = true;
        try {
            for (const side of ['old', 'new'] as const) {
                const view = this.foldViews.get(side);
                const state = view?.currentFoldingState();
                if (!view || !state) continue;
                for (const range of foldedRangeList(state)) {
                    const match = this.matchingFold(side, state, range);
                    if (!match?.info.folded) {
                        view.applyCoordinatedFold(state.doc.lineAt(range.from).number, false);
                    }
                }
                view.refreshCoordinatedFoldControls();
            }
        } finally {
            this.syncingFolds = false;
        }
    }

    private matchingFold(
        side: DiffSide,
        state: EditorState,
        range: FoldRange,
    ): { line: number; info: LineFoldInfo } | null {
        const otherState = this.foldViews.get(otherSide(side))?.currentFoldingState();
        if (!otherState) return null;

        const data = this.source.getData() as DiffSourceData;
        const startLine = state.doc.lineAt(range.from).number;
        const endLine = state.doc.lineAt(range.to).number;
        const otherStart = correspondingDiffLine(data.hunks, side, startLine);
        const otherEnd = correspondingDiffLine(data.hunks, side, endLine);
        if (otherStart == null || otherEnd == null) return null;

        const otherInfo = foldInfoForLine(otherState, otherStart);
        if (!otherInfo) return null;
        const candidateEnd = otherState.doc.lineAt(otherInfo.range.to).number;
        return candidateEnd === otherEnd
            ? { line: otherStart, info: otherInfo }
            : null;
    }

    registerScroller(side: DiffSide, el: HTMLElement) {
        this.scrollers.get(side)?.detach();
        this.expectedScroll.delete(side);

        const onScroll = () => this.mirrorScroll(side, el.scrollTop);
        el.addEventListener('scroll', onScroll, { passive: true });
        const detach = () => el.removeEventListener('scroll', onScroll);
        this.scrollers.set(side, { side, el, detach });

        // Align a freshly-mounted side to the other's current position (e.g. after a
        // toggle rebuilds one side's scroller while the other stayed put).
        const other = this.otherScroller(side);
        if (other && other.el.scrollTop !== el.scrollTop) {
            el.scrollTop = other.el.scrollTop;
            this.expectedScroll.set(side, el.scrollTop);
        }
    }

    private otherScroller(side: DiffSide): SideScroller | undefined {
        return this.scrollers.get(side === 'old' ? 'new' : 'old');
    }

    // Copy a user-driven position onto the other side. A matching expected value
    // is the delayed event from our own earlier assignment, not fresh input.
    private mirrorScroll(from: DiffSide, scrollTop: number) {
        const expected = this.expectedScroll.get(from);
        if (expected != null) {
            this.expectedScroll.delete(from);
            if (expected === scrollTop) return;
        }

        const other = this.otherScroller(from);
        if (!other || other.el.scrollTop === scrollTop) return;
        other.el.scrollTop = scrollTop;
        // Read back the applied value because the browser may clamp at the end
        // of a scroller whose range is temporarily shorter.
        this.expectedScroll.set(other.side, other.el.scrollTop);
    }

    // Detach all scroll listeners. Called when the diff view tears down.
    dispose() {
        for (const s of this.scrollers.values()) s.detach();
        this.scrollers.clear();
        this.expectedScroll.clear();
        this.foldViews.clear();
        this.modeViews.clear();
    }

    // The diff concern for a note on `side`: the before/after + hunks, tagged as a diff.
    // No slice — the item attaches this alongside its own text.
    diffPayload(side: DiffSide): DiffContextPayload {
        const data = this.source.getData() as DiffSourceData;
        return {
            kind: 'diff',
            side,
            diff: {
                oldText: data.oldModel.getValue(),
                newText: data.newModel.getValue(),
                hunks: data.hunks,
            },
        };
    }
}

const otherSide = (side: DiffSide): DiffSide => side === 'old' ? 'new' : 'old';

const rangeKey = (range: FoldRange): string => `${range.from}:${range.to}`;

/** Map a real source line to the real line occupying the same aligned diff row. */
export function correspondingDiffLine(
    hunks: readonly DiffHunk[],
    side: DiffSide,
    line: number,
): number | null {
    let delta = 0;
    for (const hunk of hunks) {
        const own = hunk.span(side);
        const other = hunk.span(otherSide(side));
        if (line < own.start) return line + (other.start - own.start);

        if (line < own.start + own.count) {
            const alignedIndex = Math.max(own.count, other.count) - own.count
                + line - own.start;
            const otherIndex = alignedIndex - (Math.max(own.count, other.count) - other.count);
            return otherIndex >= 0 && otherIndex < other.count
                ? other.start + otherIndex
                : null;
        }
        delta += other.count - own.count;
    }
    return line + delta;
}
