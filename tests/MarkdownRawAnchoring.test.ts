import { describe, it, expect } from 'vitest';
// AnnotationTextView and TextViewCore import each other (TextViewCore's
// LiveTextComponent extends AnnotationTextView). Entering that cycle at MarkdownView
// evaluates the subclass before its base exists; the app never hits this because it
// enters via App.tsx, which reaches TextViewCore first. Import it here to fix the order.
import '../src/annotation/TextViewCore';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';
import { MarkdownView } from '../src/markdown/MarkdownView';
import { sourceContextRegistry } from '../src/interactions/SourceContextRegistry';
import { withRoot } from './reactive';

// Tier-2: the reader's annotations reconciled END TO END through the raw model.
//
// The reader is a derived display view, but it ANCHORS its annotations in raw
// coordinates on the raw model (trackRanges). On an edit the model maps them through the
// REAL ChangeSet and hands back survivors, which the reader projects into display space
// through the leaf correspondence. Nothing infers an edit position by diffing text.
//
// The case that matters is the one the old diff-based path got wrong: inserting a
// duplicate bullet ABOVE a highlight. A text diff cannot tell which of two identical
// bullets was inserted, so it placed the change on the highlight's boundary and GREW it.

let seq = 0;
function freshId(): string {
    return `file:/anchor-${seq++}.md`;
}

// The reader's annotate view, reached through the shell. Typed loosely: these are the
// base AnnotationTextView members the test drives.
function annotateView(view: MarkdownView) {
    return view.getContextView() as unknown as {
        innerTextObject: { getText(): string };
        commitHighlight(start: number, end: number): void;
    };
}

// Highlight `needle` in the reader's DISPLAY text — commitHighlight is the one funnel
// every view commits a selection through, so this is the real creation path.
function highlight(view: MarkdownView, needle: string) {
    const v = annotateView(view);
    const start = v.innerTextObject.getText().indexOf(needle);
    if (start < 0) throw new Error(`fixture error: ${JSON.stringify(needle)} not in display text`);
    v.commitHighlight(start, start + needle.length);
}

// How many secondary anchor sets the model holds. Reaches into a private field on
// purpose: whether a set was released is the whole assertion for the disposal cases, and
// nothing on the public surface reports it.
function trackedSetCount(model: CmTextDataModel): number {
    return (model as unknown as { trackedSets: Map<string, unknown> }).trackedSets.size;
}

// What the reader's single annotation currently covers in its display text.
function coveredText(view: MarkdownView, sourceId: string): string | null {
    const ranged = sourceContextRegistry.itemsFor(sourceId)
        .map(i => i.getRange())
        .filter(r => r != null);
    if (ranged.length === 0) return null;
    const r = ranged[0]!;
    return annotateView(view).innerTextObject.getText().slice(r.start, r.end);
}

describe('reader annotations anchored in raw space', () => {
    it('does not grow a highlight when a duplicate bullet is inserted above', () => {
        withRoot(() => {
            const sourceId = freshId();
            const raw = new CmTextDataModel('- one\n- two\n- target\n');
            const reader = new MarkdownView(sourceId, raw);

            highlight(reader, '• target');
            expect(coveredText(reader, sourceId)).toBe('• target');

            // Insert a bullet identical to one already present, ABOVE the highlight.
            raw.applyEdit({ from: raw.getValue().indexOf('- target'), to: raw.getValue().indexOf('- target'), insert: '- two\n' });

            expect(coveredText(reader, sourceId)).toBe('• target');
            reader.dispose();
        });
    });

    it('shifts a highlight when prose is inserted above it', () => {
        withRoot(() => {
            const sourceId = freshId();
            const raw = new CmTextDataModel('# Title\n\nalpha para\n\nbeta para\n');
            const reader = new MarkdownView(sourceId, raw);

            highlight(reader, 'beta para');

            const at = raw.getValue().indexOf('alpha para');
            raw.applyEdit({ from: at, to: at, insert: 'INSERTED para\n\n' });

            expect(coveredText(reader, sourceId)).toBe('beta para');
            reader.dispose();
        });
    });

    it('leaves a highlight untouched when the edit is below it', () => {
        withRoot(() => {
            const sourceId = freshId();
            const raw = new CmTextDataModel('# Title\n\nalpha para\n\nbeta para\n');
            const reader = new MarkdownView(sourceId, raw);

            highlight(reader, 'alpha para');

            raw.applyEdit({ from: raw.getValue().length, to: raw.getValue().length, insert: '\ntrailing\n' });

            expect(coveredText(reader, sourceId)).toBe('alpha para');
            reader.dispose();
        });
    });

    it('stops tracking once the reader is disposed', () => {
        withRoot(() => {
            const sourceId = freshId();
            const raw = new CmTextDataModel('# Title\n\nalpha para\n');
            const reader = new MarkdownView(sourceId, raw);

            highlight(reader, 'alpha para');
            reader.dispose();

            // The set is really gone, not merely inert — assert the model's own bookkeeping
            // rather than just "did not throw", which would pass on a leak.
            expect(trackedSetCount(raw)).toBe(0);
            expect(() => raw.applyEdit({ from: 0, to: 0, insert: 'PRE\n\n' })).not.toThrow();
        });
    });

    // A derived source is ONE source: peer views over the same markdown file share its
    // annotations (the context registry keys them by that id), so they share one tracked
    // set. Closing one peer must not untrack the set the survivor still reconciles
    // through — that failure is silent, the survivor's highlights simply start drifting.
    it('keeps tracking for a surviving peer when one peer is disposed', () => {
        withRoot(() => {
            const sourceId = freshId();
            const raw = new CmTextDataModel('# Title\n\nalpha para\n\nbeta para\n');
            const a = new MarkdownView(sourceId, raw);
            const b = new MarkdownView(sourceId, raw);

            highlight(a, 'beta para');
            expect(trackedSetCount(raw)).toBe(1);   // one SOURCE, one set — not one per view

            a.dispose();
            expect(trackedSetCount(raw)).toBe(1);   // b still needs it

            b.dispose();
            expect(trackedSetCount(raw)).toBe(0);   // last one out clears it
        });
    });
});
