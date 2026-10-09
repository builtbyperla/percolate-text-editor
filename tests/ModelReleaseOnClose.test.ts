import { describe, it, expect } from 'vitest';
import { textModelRegistry } from '../src/textmodel/TextModelRegistry';

// The DualTextView leak: dispose() didn't release, so a closed view's dirty
// buffer lived on in the registry. Reopening the same source key surfaced the
// still-dirty model instead of the fresh cold read, which read as "the file
// I just discarded still has my edits."
//
// This test drives the registry directly (no DualTextView / no jsdom) — the
// contract is: refcount to zero means the model is gone. We can't wire up an
// integration test for DualTextView.dispose() at Tier 2 (jsdom + editor +
// signal graph is Tier 3 territory), so the registry contract stands in.
describe('textModelRegistry refcount lifecycle', () => {
    it('disposes and evicts the model when the last register is released', () => {
        const key = 'file:/leak-test-a';
        textModelRegistry.create(key, 'seed');
        textModelRegistry.register(key);

        expect(textModelRegistry.fetchExisting(key)).not.toBeNull();
        textModelRegistry.release(key);
        expect(textModelRegistry.fetchExisting(key)).toBeNull();
    });

    it('keeps the model alive while peer views still hold it', () => {
        // Mirror sample case: two DualTextViews on one key. Closing one must
        // NOT tear down the shared buffer — the other view is still projecting it.
        const key = 'file:/leak-test-b';
        textModelRegistry.create(key, 'seed');
        textModelRegistry.register(key);
        textModelRegistry.register(key);

        const shared = textModelRegistry.fetchExisting(key);
        textModelRegistry.release(key);
        expect(textModelRegistry.fetchExisting(key)).toBe(shared);

        textModelRegistry.release(key);
        expect(textModelRegistry.fetchExisting(key)).toBeNull();
    });

    it('a fresh create after full release yields a NEW model — not the ghost buffer', () => {
        // The regression that motivated this: reopen after Discard must cold-
        // read, not inherit the pre-close dirty state. If the registry hands
        // back the same instance, edits leak across the close/reopen boundary.
        const key = 'file:/leak-test-c';
        const first = textModelRegistry.create(key, 'v1');
        textModelRegistry.register(key);
        textModelRegistry.release(key);

        const second = textModelRegistry.create(key, 'v2');
        expect(second).not.toBe(first);
        expect(second.getValue()).toBe('v2');
    });
});
