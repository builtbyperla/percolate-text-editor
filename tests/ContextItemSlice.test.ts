import { describe, it, expect, vi } from 'vitest';
import { ContextItem, ContextView, PREVIEW_CHARS } from '../src/annotation/ContextItem';
import { FixedTextDataModel } from '../src/textmodel/FixedTextDataModel';

// Tier-1: a sub-range ContextItem shows ITS OWN slice, not the whole source. Regression
// for the "preview shows the whole file" bug: the item derives its snippet by slicing the
// view's data source at the range, live, so it survives a later edit. A whole-source
// item (no setRange) shows a clipped preview of that same source.

function owner(fullText: string): ContextView {
    const model = new FixedTextDataModel(fullText);
    return {
        sourceId: 'test',
        label: `WHOLE:${fullText.slice(0, PREVIEW_CHARS)}`,
        getDataSource: () => model,
        scrollToItem: () => {},
        getSubViews: () => [],
    };
}

describe('ContextItem sub-range slice', () => {
    it('can be created outside a reactive owner without a disposal warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        new ContextItem(owner('alpha beta gamma'));

        expect(warn).not.toHaveBeenCalledWith(
            expect.stringContaining('computations created outside a `createRoot` or `render`'),
        );
        warn.mockRestore();
    });

    it('previews its own slice after setRange, not the whole source', () => {
        const item = new ContextItem(owner('alpha beta gamma'));
        item.setRange(6, 10); // "beta"
        expect(item.getPreviewText()).toBe('beta');
        expect(item.displayText).toBe('beta');
    });

    it('previews a clipped whole-source slice with no range', () => {
        const item = new ContextItem(owner('alpha beta gamma'));
        expect(item.getPreviewText()).toBe('alpha beta gamma');
    });

    it('clips the whole-source preview to PREVIEW_CHARS', () => {
        const long = 'x'.repeat(PREVIEW_CHARS + 40);
        const item = new ContextItem(owner(long));
        expect(item.getPreviewText()).toBe('x'.repeat(PREVIEW_CHARS));
    });

    it('re-slices when the range changes', () => {
        const item = new ContextItem(owner('alpha beta gamma'));
        item.setRange(6, 10);   // "beta"
        item.setRange(11, 16);  // "gamma"
        expect(item.getPreviewText()).toBe('gamma');
    });

    // The 0e230af regression, now enforced structurally: the snippet derives from the
    // LIVE source, so advancing the text re-derives it with no setRange call. A snapshot
    // taken at setRange would still read the pre-edit slice here.
    it('re-derives when the SOURCE text advances, with no setRange call', () => {
        const model = new FixedTextDataModel('alpha beta gamma');
        const item = new ContextItem({
            sourceId: 'test',
            label: '',
            getDataSource: () => model,
            scrollToItem: () => {},
            getSubViews: () => [],
        });

        item.setRange(6, 10);
        expect(item.getPreviewText()).toBe('beta');

        // Same offsets, different text underneath. The range is unchanged, so the new
        // snippet is whatever now sits at [6, 10) — a live re-derivation, not a re-stamp.
        model.setValue('alpha DELTA gamma');
        expect(item.getPreviewText()).toBe('DELT');
    });
});
