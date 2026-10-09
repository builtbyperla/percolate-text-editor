
import { structuredPatch } from 'diff';

export type DiffSide = 'old' | 'new';

// Accessor for a hunk's line range on one side (start line, line count, other side's count).
// Used by decorations/spacers to extract the relevant spans from a hunk without ternaries.
export class HunkSpan {
    constructor(
        public readonly start: number,
        public readonly count: number,
        public readonly otherCount: number,
    ) {}

    pad(): number { return this.otherCount - this.count; }
}

// A contiguous changed run, in 1-based LINE numbers on each side.
export class DiffHunk {
    constructor(
        public oldStart: number,
        public oldCount: number,
        public newStart: number,
        public newCount: number,
    ) {}

    span(side: DiffSide): HunkSpan {
        if (side === 'old') {
            return new HunkSpan(this.oldStart, this.oldCount, this.newCount);
        } else {
            return new HunkSpan(this.newStart, this.newCount, this.oldCount);
        }
    }
}

export function computeHunks(oldText: string, newText: string): DiffHunk[] {
    const patch = structuredPatch('', '', oldText, newText, '', '', { context: 0 });

    const hunks: DiffHunk[] = [];
    for (const hunk of patch.hunks) {
        // structuredPatch returns 1-based line numbers (unified diff format).
        // Count the number of deletions and additions in this hunk (skip context lines).
        let oldCount = 0;
        let newCount = 0;
        for (const line of hunk.lines) {
            if (line[0] === '-') oldCount++;
            else if (line[0] === '+') newCount++;
        }
        hunks.push(new DiffHunk(
            hunk.oldStart,
            oldCount,
            hunk.newStart,
            newCount
        ));
    }
    return hunks;
}
