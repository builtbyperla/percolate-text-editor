import { describe, it, expect, beforeEach } from 'vitest';
import {
    promptConfirm,
    _getPromptQueue,
    _resolveHead,
    _clearQueueForTest,
} from '../src/appcore/promptConfirm';

// The queue is the head-only rendering contract PromptHost relies on: only the
// first pending prompt is visible; a second call arrives as a queue entry but
// only surfaces after the first resolves. Tests exercise the pure state layer
// (no DOM) so failures point at the model, not the modal.
describe('promptConfirm queue', () => {
    beforeEach(() => _clearQueueForTest());

    it('registers a pending entry visible on the queue accessor', () => {
        const q = _getPromptQueue();
        expect(q()).toHaveLength(0);
        promptConfirm({ title: 't', message: 'm', options: ['A', 'B'] });
        expect(q()).toHaveLength(1);
        expect(q()[0].spec.options).toEqual(['A', 'B']);
    });

    it('resolves the head with the chosen option and pops the queue', async () => {
        const p = promptConfirm({ title: 't', message: 'm', options: ['Save', 'Cancel'] });
        _resolveHead('Save');
        await expect(p).resolves.toBe('Save');
        expect(_getPromptQueue()()).toHaveLength(0);
    });

    it('serializes concurrent prompts — the second one becomes head only after the first resolves', async () => {
        const first = promptConfirm({ title: '1', message: '', options: ['A', 'B'] });
        const second = promptConfirm({ title: '2', message: '', options: ['C', 'D'] });
        const q = _getPromptQueue();

        // Both are queued; only the first is head-of-line.
        expect(q()).toHaveLength(2);
        expect(q()[0].spec.title).toBe('1');

        _resolveHead('B');
        await expect(first).resolves.toBe('B');

        // Second is now head; not settled yet.
        expect(q()).toHaveLength(1);
        expect(q()[0].spec.title).toBe('2');
        _resolveHead('D');
        await expect(second).resolves.toBe('D');
        expect(q()).toHaveLength(0);
    });

    it('resolves immediately with "" for a no-option spec', async () => {
        // Nothing to click, nothing to Esc — a callsite bug we surface loudly
        // rather than silently blocking on a modal with no buttons.
        await expect(promptConfirm({ title: 't', message: '', options: [] })).resolves.toBe('');
        expect(_getPromptQueue()()).toHaveLength(0);
    });

    it('_resolveHead is a no-op when the queue is empty', () => {
        // A stray keystroke resolver call after the modal already closed must
        // not throw (or resolve a phantom promise) — the queue guard is what
        // makes PromptHost's Esc/Enter listeners safe to leave attached.
        expect(() => _resolveHead('anything')).not.toThrow();
    });
});
