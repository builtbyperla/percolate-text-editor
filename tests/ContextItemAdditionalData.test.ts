import { describe, it, expect } from 'vitest';
import { ContextItem, ContextView } from '../src/annotation/ContextItem';
import { FixedTextDataModel } from '../src/textmodel/FixedTextDataModel';

// Tier-1: the generic additionalData() hook. A ContextItem exposes whatever richer,
// consumer-specific payload its origin chooses to attach (e.g. a diff owner returns the
// coordinator's agent payload). Owners that attach nothing return undefined, so ordinary
// items carry no extra data — the agent path stays flat for them.

function owner(over: Partial<ContextView> = {}): ContextView {
    const model = new FixedTextDataModel('');
    return {
        sourceId: 'test',
        label: '',
        getDataSource: () => model,
        scrollToItem: () => {},
        getSubViews: () => [],
        ...over,
    };
}

describe('ContextItem.additionalData()', () => {
    it('is undefined when no callback is threaded in', () => {
        const item = new ContextItem(owner());
        expect(item.additionalData()).toBeUndefined();
    });

    it('returns the threaded callback payload when provided', () => {
        const payload = { kind: 'diff', side: 'old' };
        // additionalData is threaded at construction (2nd arg), pulled on demand — not a
        // reactive accessor, so a producer's live reads can't feed the reactive graph.
        const item = new ContextItem(owner(), () => payload);
        expect(item.additionalData()).toBe(payload);
    });
});
