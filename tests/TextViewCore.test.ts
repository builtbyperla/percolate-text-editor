import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render } from '@solidjs/testing-library';
import { withRoot } from './reactive';
import {
    buildInnerText, buildTextView, describeSections, highlight, sectionStarts, claimedStarts,
} from './factories/text';
import { sourceContextRegistry } from '../src/interactions/SourceContextRegistry';

afterEach(cleanup);

describe('InnerText offset math (pure reads)', () => {
    it('getText returns the full text and a capped preview', () => {
        withRoot(() => {
            const inner = buildInnerText('hello world');
            expect(inner.getText()).toBe('hello world');
            expect(inner.getText(5)).toBe('hello');
        });
    });

    // Replaces sectionGlobalStart: the sums it computed on demand are now baked
    // into each section as segStart at build time. Offset -> section resolution
    // moved to the DOM-driven backward path (resolvePosition), which is covered
    // against a real render in SelectionMapping.
    it('an unsplit text is one section starting at 0', () => {
        withRoot(() => {
            const inner = buildInnerText('hello world');
            expect(sectionStarts(inner)).toEqual([0]);
            expect(claimedStarts(inner)).toEqual([0]);
        });
    });
});

describe('InnerText highlight split/merge (signal-backed)', () => {
    it('leaves pointerup for enclosing interactions and activates only on click', () => {
        const { comp, inner } = buildTextView('hello world');
        highlight(comp, 0, 5);
        const section = inner.sections.find(s => !s.isPlainText())!;
        const setActive = vi.spyOn(section.noteable, 'setActive');
        const { container } = render(() => comp.getVisual()());
        const span = container.querySelector('[data-kind="highlighted"]') as HTMLElement;
        const release = vi.fn();
        const click = vi.fn();
        container.addEventListener('pointerup', release);
        container.addEventListener('click', click);

        span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

        expect(release).toHaveBeenCalledOnce();
        expect(setActive).not.toHaveBeenCalled();

        span.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(setActive).toHaveBeenCalledOnce();
        expect(click).toHaveBeenCalledOnce();
    });

    it('a highlight splits a single block into [plain, highlight, plain]', () => {
        withRoot(() => {
            const { comp, inner } = buildTextView('hello world'); // len 11
            highlight(comp, 2, 7); // highlight "llo w"
            expect(describeSections(inner)).toEqual([
                { kind: 'plain', text: 'he' },
                { kind: 'highlight', text: 'llo w' },
                { kind: 'plain', text: 'orld' },
            ]);
            // Text is preserved across the split.
            expect(inner.getText()).toBe('hello world');
        });
    });

    it('highlighting from offset 0 drops the empty left plain segment', () => {
        withRoot(() => {
            const { comp, inner } = buildTextView('hello world');
            highlight(comp, 0, 5); // "hello"
            expect(describeSections(inner)).toEqual([
                { kind: 'highlight', text: 'hello' },
                { kind: 'plain', text: ' world' },
            ]);
        });
    });

    // Every section knows its own global start, and it must agree with the layout.
    // The forward render tolerates a wrong segStart (the text still paints), but
    // the backward path stamps it as data-pos-x and reads it back to resolve
    // selections — so a disagreement here misplaces selections silently.
    it('sections claim global starts matching the actual layout', () => {
        withRoot(() => {
            const { comp, inner } = buildTextView('abcdefghij');
            highlight(comp, 2, 4);
            highlight(comp, 6, 8);
            // [ab][cd][ef][gh][ij]
            expect(sectionStarts(inner)).toEqual([0, 2, 4, 6, 8]);
            expect(claimedStarts(inner)).toEqual(sectionStarts(inner));
        });
    });

    it('ignores a degenerate (too-small) selection', () => {
        withRoot(() => {
            const { comp, inner } = buildTextView('hello world');
            highlight(comp, 2, 3); // length 1 -> ignored
            expect(describeSections(inner)).toEqual([
                { kind: 'plain', text: 'hello world' },
            ]);
        });
    });

    // Extending a highlight rightward is the one commit that leaves the item set
    // IDENTITY-EQUAL: addHighlight reuses the overlapped item and splices it back
    // over itself, mutating only its range (a plain field). Both change-detectors
    // key off that same field, so the whole layout used to go stale until a toggle
    // rebuilt the view. commitHighlight forces the rebuild instead.
    it('extending a highlight rightward grows it without a rebuild', () => {
        withRoot(() => {
            const { comp, inner } = buildTextView('hello world');
            highlight(comp, 2, 5); // [he][llo][ world]
            // Starts INSIDE the existing highlight: the reuse path.
            highlight(comp, 3, 8);
            expect(describeSections(inner)).toEqual([
                { kind: 'plain', text: 'he' },
                { kind: 'highlight', text: 'llo wo' }, // snapped to 2, extended to 8
                { kind: 'plain', text: 'rld' },
            ]);
        });
    });

    // Same reuse path, but the merged-away neighbor makes the item set shrink, so
    // this one was already caught by the membership guard. Kept as the companion
    // case so a regression in either can be told apart.
    it('extending across a second highlight merges them into one', () => {
        withRoot(() => {
            const { comp, inner } = buildTextView('abcdefghij');
            highlight(comp, 0, 2);
            highlight(comp, 6, 8);
            highlight(comp, 1, 7); // starts in the first, ends in the second
            expect(describeSections(inner)).toEqual([
                { kind: 'highlight', text: 'abcdefgh' },
                { kind: 'plain', text: 'ij' },
            ]);
        });
    });

    // Ranges are half-open, so a shared endpoint is adjacency, not overlap. Line
    // ranges end at the next line's start (rangeForLines keeps the trailing "\n"),
    // so selecting lines 1-2 then 3-4 touches at exactly one offset — the inclusive
    // comparisons used to merge them into one region.
    it('abutting selections stay separate instead of merging', () => {
        withRoot(() => {
            const { comp, inner } = buildTextView('abcdefghij');
            highlight(comp, 0, 4);
            highlight(comp, 4, 8); // starts exactly where the first ends
            expect(describeSections(inner)).toEqual([
                { kind: 'highlight', text: 'abcd' },
                { kind: 'highlight', text: 'efgh' },
                { kind: 'plain', text: 'ij' },
            ]);
        });
    });

    // The companion to the above: one offset of genuine overlap must still merge,
    // so the strict comparisons didn't simply disable merging.
    it('a one-character overlap still merges', () => {
        withRoot(() => {
            const { comp, inner } = buildTextView('abcdefghij');
            highlight(comp, 0, 4);
            highlight(comp, 3, 8); // shares offset 3 with the first
            expect(describeSections(inner)).toEqual([
                { kind: 'highlight', text: 'abcdefgh' },
                { kind: 'plain', text: 'ij' },
            ]);
        });
    });

    // The true no-op: fully inside an existing highlight, addHighlight returns the
    // set untouched. forceRender must not turn this into a visible rebuild.
    it('a selection inside an existing highlight changes nothing', () => {
        withRoot(() => {
            const { comp, inner } = buildTextView('hello world');
            highlight(comp, 2, 7);
            const before = inner.sections;
            highlight(comp, 3, 6);
            expect(describeSections(inner)).toEqual([
                { kind: 'plain', text: 'he' },
                { kind: 'highlight', text: 'llo w' },
                { kind: 'plain', text: 'orld' },
            ]);
            // Untouched, not rebuilt-to-the-same-shape.
            expect(inner.sections).toBe(before);
        });
    });

    // Deletion is a registry removal now, not a section splice: dropping the item
    // fans back through loadFromContext, which rebuilds the layout without it. The
    // merge-into-neighbors property is the same one removeHighlight used to assert.
    it('removing a highlight merges it back into its plain neighbors', () => {
        withRoot(() => {
            const { comp, inner } = buildTextView('hello world');
            highlight(comp, 2, 7); // -> [he][llo w][orld]
            const item = inner.sections.find(s => !s.isPlainText())!.getContextItem()!;
            sourceContextRegistry.remove(item);
            expect(describeSections(inner)).toEqual([
                { kind: 'plain', text: 'hello world' },
            ]);
            expect(inner.getText()).toBe('hello world');
        });
    });
});
