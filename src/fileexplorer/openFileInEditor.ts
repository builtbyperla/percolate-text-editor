import { SearchData } from '../containers/Tabs';
import { FileTab, MarkdownFileTab } from '../containers/tabKinds';
import { DualTextView } from '../editor/DualTextView';
import { MarkdownDualView } from '../markdown/MarkdownDualView';
import { SourceId } from '../textmodel/SourceId';
import { DiskTextDataSource } from '../textmodel/DiskTextDataSource';
import { textModelRegistry } from '../textmodel/TextModelRegistry';
import { FileSystemProvider, FsEntry } from './FileSystemProvider';
import { OpenTargetRouter } from './OpenTargetRouter';

export interface OpenFileOpts {
    searchData?: SearchData;
}

export async function openFileInEditor(
    entry: FsEntry,
    provider: FileSystemProvider,
    router: OpenTargetRouter,
    opts: OpenFileOpts = {},
): Promise<void> {
    const target = router.resolveTarget(entry); // editor-selection seam
    const sourceId = new SourceId('file', entry.path);
    const key = sourceId.full();

    // Dedupe: reopening a file reselects its existing tab, not a duplicate.
    const existing = target.tabs.find(t => t.id === key);
    if (existing) {
        // Select FIRST, then reveal: the reveal scrolls the editor's viewport,
        // which must be the mounted, active tab.
        target.selectTab(existing);
        if (opts.searchData) existing.revealSearch(opts.searchData);
        return;
    }

    const isMarkdown = /\.(md|markdown|mdown|mkd)$/i.test(entry.path);

    const source = new DiskTextDataSource(entry.path, provider);
    await source.ensureLoaded();

    const view: DualTextView | MarkdownDualView = isMarkdown
        ? new MarkdownDualView(key)
        : new DualTextView(key);

    view.attachSaveBinding(provider, entry.path);

    const tab = isMarkdown
        ? new MarkdownFileTab(sourceId, view as MarkdownDualView, true)
        : new FileTab(sourceId, view as DualTextView, true);

    let disposeWatcher: () => void = () => {};
    if (provider.watch) {
        disposeWatcher = provider.watch(entry.path, ev => {
            if (ev.kind === 'change') {
                source.onDiskChanged().catch(() => {});
            } else if (ev.kind === 'unlink') {
                textModelRegistry.onDiskDeleted(key);
            }
        });
    }
    view.attachFileBinding(disposeWatcher, () => {
        void target.closeTab(tab);
    });

    target.addTab(tab);
    // Select FIRST, then reveal (see the dedupe branch): the reveal needs the
    // tab mounted and active. A non-editor view no-ops inside revealSearch.
    target.selectTab(tab);
    if (opts.searchData) tab.revealSearch(opts.searchData);
}
