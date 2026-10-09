import { describe, it, expect } from 'vitest';
import { withRoot } from './reactive';
import { DiskTextDataSource } from '../src/textmodel/DiskTextDataSource';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';
import { textModelRegistry } from '../src/textmodel/TextModelRegistry';
import { FakeFileProvider } from './factories/fakes';

// DiskTextDataSource is the seam FileExplorerView.openFile uses to seed the
// registry from disk and route watcher events through the same channel a save
// uses. Tests exercise the seam directly — no watcher, no view — so failures
// point at the source, not the wiring.
//
// Note: each test uses a unique path so per-test residue in the module-level
// registry doesn't leak. We don't attempt tearing down the registry (that
// would fight its refcount contract, which is validated by
// ModelReleaseOnClose.test.ts).
describe('DiskTextDataSource', () => {
    it('ensureLoaded seeds the registry with disk contents', async () => {
        await withRoot(async () => {
            const path = 'fake:/seed-unique.txt';
            const key = `file:${path}`;

            const provider = new FakeFileProvider({}, { [path]: 'from disk' });
            const source = new DiskTextDataSource(path, provider);

            expect(textModelRegistry.fetchExisting(key)).toBeNull();
            await source.ensureLoaded();

            const model = textModelRegistry.fetchExisting(key);
            expect(model).not.toBeNull();
            expect(model!.getValue()).toBe('from disk');
        });
    });

    it('ensureLoaded is idempotent — a second call does NOT clobber in-memory edits', async () => {
        // If ensureLoaded re-created the model on every call, the DualTextView
        // would lose live edits every time the file explorer's open flow ran.
        // The loaded-flag guard is what makes this safe.
        await withRoot(async () => {
            const path = 'fake:/idem-unique.txt';
            const key = `file:${path}`;

            const provider = new FakeFileProvider({}, { [path]: 'seed' });
            const source = new DiskTextDataSource(path, provider);
            await source.ensureLoaded();

            const model = textModelRegistry.fetchExisting(key) as CmTextDataModel;
            model.setValue('user edit');

            await source.ensureLoaded();
            expect(model.getValue()).toBe('user edit');
        });
    });

    it('onDiskChanged routes fresh contents to the model via the registry', async () => {
        await withRoot(async () => {
            const path = 'fake:/reload-unique.txt';
            const key = `file:${path}`;

            const provider = new FakeFileProvider({}, { [path]: 'v1' });
            const source = new DiskTextDataSource(path, provider);
            await source.ensureLoaded();

            // Mutate the on-disk file (via the same provider) and fire onDiskChanged.
            await provider.writeFile(path, 'v2 from disk');
            await source.onDiskChanged();

            const model = textModelRegistry.fetchExisting(key) as CmTextDataModel;
            expect(model.getValue()).toBe('v2 from disk');
        });
    });
});
