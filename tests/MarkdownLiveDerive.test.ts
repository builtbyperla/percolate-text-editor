import { describe, it, expect } from 'vitest';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';
import { MarkdownView } from '../src/markdown/MarkdownView';
import { withRoot } from './reactive';

// Tier-2: the rendered markdown reader is a VIRTUALIZED view of a raw source — it
// subscribes to the shared model and re-derives on every raw edit. This covers the
// DATA half of that contract (no mount): an edit to the shared CmTextDataModel must
// reach the reader's flat display text synchronously via onChange -> rederive.
//
// The render half — that the mounted reader actually re-renders — is what regressed:
// MarkdownDualView used `<Show fallback={reader.getVisual()()}>`, and `fallback` is a
// plain prop evaluated EAGERLY when the JSX is built, so the reader's visual was
// captured once and never re-ran. Edits only appeared after a tab switch rebuilt the
// tree. That half needs a Tier-3 DOM test; this file pins the data path so a future
// break can be localized to one side or the other.

// The reader's own flat, display-space text: markers stripped, bullets glyphed.
function displayText(view: MarkdownView): string {
    return (view.getContextView() as unknown as { getText(): string }).getText();
}

describe('markdown reader re-derives from the shared raw model', () => {
    it('picks up a raw edit without a remount', () => {
        withRoot(() => {
            const raw = new CmTextDataModel('# Title\n\nfirst para\n');
            const reader = new MarkdownView('file:/notes.md::rendered', raw);

            expect(displayText(reader)).toContain('first para');

            // Same funnel the raw editor uses. The reader is subscribed via onChange,
            // so rederive runs before this returns.
            raw.setValue('# Title\n\nsecond para\n');

            expect(displayText(reader)).toContain('second para');
            expect(displayText(reader)).not.toContain('first para');
        });
    });

    it('stops deriving once disposed', () => {
        withRoot(() => {
            const raw = new CmTextDataModel('# Title\n\nkept\n');
            const reader = new MarkdownView('file:/disposed.md::rendered', raw);

            reader.dispose();
            raw.setValue('# Title\n\nignored\n');

            // dispose() drops the raw subscription; without it the reader would keep
            // re-deriving off a model it no longer belongs to.
            expect(displayText(reader)).not.toContain('ignored');
        });
    });
});
