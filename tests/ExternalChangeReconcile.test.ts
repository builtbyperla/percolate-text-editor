import { describe, it, expect } from 'vitest';
import { withRoot } from './reactive';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';

// The reconciliation contract Step 4's external-change bar depends on.
// Tested at the model layer (Tier 1-adjacent) — no jsdom, no watcher, no
// FileExplorer. If any of these transitions regress, the bar will silently
// misbehave in the UI.
describe('CmTextDataModel disk reconciliation', () => {
    it('onDiskChanged on a CLEAN buffer silently replaces contents', () => {
        withRoot(() => {
            const model = new CmTextDataModel('v1');
            expect(model.isDirty()()).toBe(false);

            model.onDiskChanged('v2 from disk');

            expect(model.getValue()).toBe('v2 from disk');
            expect(model.isDirty()()).toBe(false);
            // No bar to show — the reload IS the new saved state.
            expect(model.getExternalChange()()).toBeNull();
        });
    });

    it('onDiskChanged on a DIRTY buffer surfaces the external change without touching the doc', () => {
        withRoot(() => {
            const model = new CmTextDataModel('v1');
            model.setValue('my edit');
            expect(model.isDirty()()).toBe(true);

            model.onDiskChanged('v2 from disk');

            // Doc is untouched — the user's edit wins until they resolve.
            expect(model.getValue()).toBe('my edit');
            expect(model.isDirty()()).toBe(true);
            expect(model.getExternalChange()()).toEqual({ nextText: 'v2 from disk' });
        });
    });

    it('acceptExternalChange overwrites with disk contents and clears dirty', () => {
        withRoot(() => {
            const model = new CmTextDataModel('v1');
            model.setValue('my edit');
            model.onDiskChanged('v2 from disk');

            model.acceptExternalChange();

            expect(model.getValue()).toBe('v2 from disk');
            expect(model.isDirty()()).toBe(false);
            expect(model.getExternalChange()()).toBeNull();
        });
    });

    it('dismissExternalChange clears the bar but leaves the buffer dirty', () => {
        withRoot(() => {
            const model = new CmTextDataModel('v1');
            model.setValue('my edit');
            model.onDiskChanged('v2 from disk');

            model.dismissExternalChange();

            expect(model.getValue()).toBe('my edit');
            expect(model.isDirty()()).toBe(true); // still diverges from disk
            expect(model.getExternalChange()()).toBeNull();
        });
    });

    it('a fresh onDiskChanged after dismiss re-raises the bar with the newer contents', () => {
        // A user who Keep-mines once should still be prompted when disk moves
        // again — otherwise a subsequent external write is silently lost.
        withRoot(() => {
            const model = new CmTextDataModel('v1');
            model.setValue('my edit');
            model.onDiskChanged('v2');
            model.dismissExternalChange();

            model.onDiskChanged('v3');
            expect(model.getExternalChange()()).toEqual({ nextText: 'v3' });
        });
    });

    it('onDiskDeleted flips detached and forces dirty', () => {
        withRoot(() => {
            const model = new CmTextDataModel('v1');
            expect(model.isDirty()()).toBe(false);
            expect(model.isDetached()()).toBe(false);

            model.onDiskDeleted();

            expect(model.isDetached()()).toBe(true);
            // Detach implies not-on-disk = dirty; save-from-detached recreates.
            expect(model.isDirty()()).toBe(true);
        });
    });

    it('markSaved after detached recreation clears both detached and dirty', () => {
        // Recreate-on-save path: user hits Save while detached; the file
        // explorer's writeFile succeeds and saveModel calls markSaved. The
        // model must clear BOTH flags so the bar disappears in one go.
        withRoot(() => {
            const model = new CmTextDataModel('v1');
            model.onDiskDeleted();
            expect(model.isDetached()()).toBe(true);
            expect(model.isDirty()()).toBe(true);

            model.markSaved();

            expect(model.isDetached()()).toBe(false);
            expect(model.isDirty()()).toBe(false);
        });
    });
});
