import { Accessor, Setter, createSignal } from 'solid-js';
import { EDITOR_FONT } from './CmEditorFrame';

export type RangeStamp = 'line' | 'spacer' | 'folded' | 'noedit';

// A non-line vertical insertion anchored BEFORE a 1-based document line.
export interface StampedRange {
    beforeLine: number;   // 1-based; the spacer sits just above this line
    heightPx: number;
    stamp: RangeStamp;
}

export class RangesDataModel {
    private getRanges_: Accessor<StampedRange[]>;
    private setRanges_: Setter<StampedRange[]>;

    constructor() {
        [this.getRanges_, this.setRanges_] = createSignal<StampedRange[]>([]);
    }

    // Reactive read of all stamped ranges (sorted by beforeLine). Consumers subscribe
    // by calling this inside a tracking scope.
    ranges(): StampedRange[] {
        return this.getRanges_();
    }

    // Replace all ranges (the diff extension recomputes the full set on every re-diff).
    setRanges(ranges: StampedRange[]) {
        const sorted = [...ranges].sort((a, b) => a.beforeLine - b.beforeLine);
        this.setRanges_(sorted);
    }

    // Total spacer pixels inserted strictly ABOVE the given 1-based line.
    spacerPxAbove(line: number): number {
        let px = 0;
        for (const r of this.getRanges_()) {
            if (r.beforeLine < line) px += r.heightPx;
        }
        return px;
    }

    // The pixel Y (top) of a 1-based document line, = (line-1) rows + all spacer pixels above it.
    lineTop(line: number): number {
        return (line - 1) * EDITOR_FONT.lineHeight + this.spacerPxAbove(line);
    }

    // Inverse of lineTop: the 1-based document line whose row contains pixel Y `px` (the top of the visible window).
    lineAtPx(px: number): number {
        const row = EDITOR_FONT.lineHeight;
        let spacerPx = 0;
        for (const r of this.getRanges_()) {
            // The pixel top of this spacer's line, in spacer-inclusive coords.
            const lineTopPx = (r.beforeLine - 1) * row + spacerPx;
            if (lineTopPx + r.heightPx <= px) {
                // Fully scrolled past this spacer: its pixels precede the window.
                spacerPx += r.heightPx;
            } else {
                // px sits at or before this spacer; no further spacers apply.
                break;
            }
        }
        return Math.max(1, Math.floor((px - spacerPx) / row) + 1);
    }

    // Total content height for `lineCount` lines including every spacer — the ruler
    // column height (so its scrollbar range matches CM6's spaced content).
    columnHeight(lineCount: number): number {
        return lineCount * EDITOR_FONT.lineHeight + this.spacerPxAbove(lineCount + 1);
    }
}
