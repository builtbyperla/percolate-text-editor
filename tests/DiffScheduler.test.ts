import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiffScheduler, DIFF_DEBOUNCE_MS } from '../src/editor/diff/DiffScheduler';

// Tier-1 (pure): the debounced, superseding diff with a held snapshot. Core-risk
// assertions: (a) request() debounces and supersedes so a burst computes ONCE, (b) the
// last completed result is held and readable between recomputes, (c) subscribers are
// notified on each completed compute, (d) dispose cancels a pending compute. Uses fake
// timers to drive the debounce deterministically.

describe('DiffScheduler', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('recomputeNow computes synchronously and holds the snapshot', () => {
        const s = new DiffScheduler(() => ({ oldText: 'a\n', newText: 'a\nb\n' }));
        expect(s.current()).toEqual([]);      // empty until first compute
        s.recomputeNow();
        expect(s.current()).toHaveLength(1);   // one added-line hunk
    });

    it('request debounces: a burst of edits computes once, after the delay', () => {
        let texts = { oldText: 'a\n', newText: 'a\n' };
        const s = new DiffScheduler(() => texts);
        const seen = vi.fn();
        s.subscribe(seen);

        // Three rapid requests, each within the debounce window of the last (a third of
        // the delay apart), so each supersedes the previous timer.
        const step = Math.floor(DIFF_DEBOUNCE_MS / 3);
        s.request();
        vi.advanceTimersByTime(step);
        s.request();
        vi.advanceTimersByTime(step);
        s.request();
        // Nothing has fired yet (each request superseded the last).
        expect(seen).not.toHaveBeenCalled();

        texts = { oldText: 'a\n', newText: 'a\nX\n' };
        vi.advanceTimersByTime(DIFF_DEBOUNCE_MS); // let the final timer elapse
        expect(seen).toHaveBeenCalledTimes(1);    // computed exactly once
        expect(s.current()).toHaveLength(1);
    });

    it('reads the freshest texts at compute time, not at request time', () => {
        let texts = { oldText: 'a\n', newText: 'a\n' };
        const s = new DiffScheduler(() => texts);
        s.request();                            // requested while identical (no diff)
        texts = { oldText: 'a\n', newText: 'a\nB\n' };  // texts change before the timer fires
        vi.advanceTimersByTime(DIFF_DEBOUNCE_MS);
        expect(s.current()).toHaveLength(1);    // diffed the UPDATED texts
    });

    it('notifies every subscriber with the fresh snapshot', () => {
        const s = new DiffScheduler(() => ({ oldText: '', newText: 'x\n' }));
        const a = vi.fn();
        const b = vi.fn();
        s.subscribe(a);
        s.subscribe(b);
        s.recomputeNow();
        expect(a).toHaveBeenCalledWith(s.current());
        expect(b).toHaveBeenCalledWith(s.current());
    });

    it('unsubscribe stops notifications', () => {
        const s = new DiffScheduler(() => ({ oldText: '', newText: 'x\n' }));
        const cb = vi.fn();
        const off = s.subscribe(cb);
        off();
        s.recomputeNow();
        expect(cb).not.toHaveBeenCalled();
    });

    it('dispose cancels a pending compute', () => {
        const s = new DiffScheduler(() => ({ oldText: 'a\n', newText: 'a\nb\n' }));
        const cb = vi.fn();
        s.subscribe(cb);
        s.request();
        s.dispose();
        vi.advanceTimersByTime(DIFF_DEBOUNCE_MS);
        expect(cb).not.toHaveBeenCalled();      // the timer was cleared
    });
});
