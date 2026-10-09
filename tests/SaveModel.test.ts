import { describe, it, expect } from 'vitest';
import { withRoot } from './reactive';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';
import { saveModel } from '../src/textmodel/saveModel';
import { FakeFileProvider } from './factories/fakes';

// saveModel is the Cmd/Ctrl-S seam: writeFile then markSaved. These tests exercise
// the state contract the dirty-dot decoration and close-on-dirty confirm depend on.
describe('saveModel', () => {
    it('writes the buffer contents to the provider under the given path', async () => {
        await withRoot(async () => {
            const model = new CmTextDataModel('initial');
            const provider = new FakeFileProvider({}, {});
            model.setValue('after edit');

            await saveModel(model, provider, 'fake:/foo.txt');

            expect(await provider.readFile('fake:/foo.txt')).toBe('after edit');
        });
    });

    it('flips isDirty back to false after a successful save', async () => {
        await withRoot(async () => {
            const model = new CmTextDataModel('initial');
            const provider = new FakeFileProvider({}, { 'fake:/f.txt': 'initial' });
            model.setValue('changed');
            expect(model.isDirty()()).toBe(true);

            await saveModel(model, provider, 'fake:/f.txt');

            expect(model.isDirty()()).toBe(false);
        });
    });

    it('leaves the model dirty when the write fails so the user can retry', async () => {
        await withRoot(async () => {
            const model = new CmTextDataModel('a');
            model.setValue('b');
            // Provider whose writeFile rejects — simulates a permission or IPC error.
            const provider = new FakeFileProvider();
            provider.writeFile = () => Promise.reject(new Error('EACCES'));

            await expect(saveModel(model, provider, 'fake:/nope')).rejects.toThrow('EACCES');
            // markSaved must NOT have run — the buffer is still dirty and the
            // dirty-dot decoration must still be lit.
            expect(model.isDirty()()).toBe(true);
        });
    });

    it('undoing the buffer back to the last-saved content reports clean without another save', () => {
        // State-based dirty (doc equality), not an edit counter: undo to the
        // saved doc clears the dot for free. This is the core CmTextDataModel
        // contract Step 3 depends on; assert it here so a regression on the
        // dirty math surfaces alongside saveModel's tests.
        withRoot(() => {
            const model = new CmTextDataModel('hello');
            model.setValue('hello world');
            expect(model.isDirty()()).toBe(true);
            model.setValue('hello');
            expect(model.isDirty()()).toBe(false);
        });
    });
});
