
import { computeHunks, DiffHunk } from './DiffModel';

export const DIFF_DEBOUNCE_MS = 80;

// Supplies the two texts to diff at compute time (read lazily, so the freshest buffers
// are diffed when the timer fires, not whatever they were when the edit happened).
export type TextPair = () => { oldText: string; newText: string };

export class DiffScheduler {
    // Last completed diff — the source of truth read between recomputes. Seeded empty;
    // callers should trigger an initial compute (or call recomputeNow) at construction.
    private snapshot: DiffHunk[] = [];

    // Pending trailing-debounce timer id (0 = none). A new request clears it first, so
    // only the latest scheduled compute survives (supersede / latest-wins).
    private timer: ReturnType<typeof setTimeout> | 0 = 0;

    private getTexts: TextPair;

    // Projections (CM6 decoration field, annotate InnerText) subscribe on mount and unsubscribe on teardown.
    private subscribers = new Set<(hunks: DiffHunk[]) => void>();

    // getTexts: lazy accessor for the current old/new text (read at compute time so the
    // freshest buffers are diffed).
    constructor(getTexts: TextPair) {
        this.getTexts = getTexts;
    }

    subscribe(cb: (hunks: DiffHunk[]) => void): () => void {
        this.subscribers.add(cb);
        return () => this.subscribers.delete(cb);
    }

    // The last completed diff. What every projection renders from between recomputes.
    current(): DiffHunk[] {
        return this.snapshot;
    }

    // Schedule a recompute. Supersedes any pending one so a burst of edits collapses to
    // a single trailing diff. Safe to call on every keystroke — that's the point.
    request(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = 0;
            this.recomputeNow();
        }, DIFF_DEBOUNCE_MS);
    }

    recomputeNow(): void {
        const { oldText, newText } = this.getTexts();
        this.snapshot = computeHunks(oldText, newText);
        for (const cb of this.subscribers) cb(this.snapshot);
    }

    // Cancel any pending compute (teardown). Idempotent.
    dispose(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = 0;
    }
}
