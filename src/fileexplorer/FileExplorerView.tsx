import { For, Show, createSignal, onMount, onCleanup, JSX } from 'solid-js';
import { FilePlus, FolderOpen } from 'lucide-solid';
import { ToolbarModule } from '../toolbar/ToolbarModule';
import { SourceId } from '../textmodel/SourceId';
import { FileSystemProvider, FsEntry } from './FileSystemProvider';
import { OpenTargetRouter } from './OpenTargetRouter';
import { openFileInEditor } from './openFileInEditor';
import fxStyles from '../styles/FileExplorer.module.css';
import toolbarStyles from '../styles/Toolbar.module.css';

function TreeNode(props: {
    entry: FsEntry;
    view: FileExplorerView;
    depth: number;
    startExpanded?: boolean;
}) {
    const [expanded, setExpanded] = createSignal(false);
    const [children, setChildren] = createSignal<FsEntry[]>([]);

    const loadChildren = async () => {
        if (children().length === 0)
            setChildren(await props.view.listDir(props.entry.path));
    };

    const reload = async () => {
        if (!expanded()) return;
        setChildren(await props.view.listDir(props.entry.path));
    };

    const onClick = async () => {
        if (props.entry.kind === 'file') return props.view.openFile(props.entry);
        if (!expanded()) await loadChildren();
        setExpanded(e => !e);
    };

    if (props.entry.kind === 'dir') {
        onMount(() => props.view.registerDir(props.entry.path, reload));
        onCleanup(() => props.view.unregisterDir(props.entry.path));
    }

    // Root folder opens itself so its contents show immediately.
    onMount(async () => {
        if (props.startExpanded && props.entry.kind === 'dir') {
            await loadChildren();
            setExpanded(true);
        }
    });

    return (
        <div>
            <div
                class={fxStyles.row}
                style={{ 'padding-left': `${props.depth * 12 + 8}px` }}
                onClick={onClick}
            >
                {props.entry.kind === 'dir' ? (expanded() ? '▾ ' : '▸ ') : '  '}
                {props.entry.name}
            </div>
            <Show when={expanded()}>
                <For each={children()}>
                    {c => <TreeNode entry={c} view={props.view} depth={props.depth + 1} />}
                </For>
            </Show>
        </div>
    );
}

export class FileExplorerView extends ToolbarModule {
    readonly id = 'files';
    readonly icon = '☰';
    readonly label = 'Files';

    private provider: FileSystemProvider;
    private router: OpenTargetRouter;
    private rootEntry: () => FsEntry;
    private setRootEntry: (entry: FsEntry) => void;

    private dirReloads = new Map<string, () => void>();
    private dirReloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private disposeWorkspaceWatch: (() => void) | null = null;

    constructor(provider: FileSystemProvider, router: OpenTargetRouter) {
        super();
        this.provider = provider;
        this.router = router;
        // The project root as a dir entry, rendered as the anchored top folder.
        // Root label derivation lives on SourceId now (deriveFileLabel).
        const root = provider.rootPath();
        [this.rootEntry, this.setRootEntry] = createSignal({
            name: new SourceId('file', root).label(),
            path: root,
            kind: 'dir',
        });

        if (this.provider.watchWorkspace) {
            this.disposeWorkspaceWatch = this.provider.watchWorkspace(ev => {
                this.reconcile(this.dirname(ev.path));
            });
        }
    }

    // Register/deregister a dir node's forced re-list. Called from TreeNode
    // mount/cleanup so the map only ever points at live, mounted dir nodes.
    registerDir(dirPath: string, reload: () => void): void {
        this.dirReloads.set(dirPath, reload);
    }

    unregisterDir(dirPath: string): void {
        this.dirReloads.delete(dirPath);
        const timer = this.dirReloadTimers.get(dirPath);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.dirReloadTimers.delete(dirPath);
        }
    }

    private reconcile(dirPath: string): void {
        if (!this.dirReloads.has(dirPath)) return;
        const existing = this.dirReloadTimers.get(dirPath);
        if (existing !== undefined) clearTimeout(existing);
        this.dirReloadTimers.set(
            dirPath,
            setTimeout(() => {
                this.dirReloadTimers.delete(dirPath);
                this.dirReloads.get(dirPath)?.();
            }, 60),
        );
    }

    // Parent directory of a path. String-only (no node:path in the renderer):
    // strip the trailing segment after the last separator. Handles both / and \.
    private dirname(p: string): string {
        const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
        return idx <= 0 ? p : p.slice(0, idx);
    }

    listDir(path: string): Promise<FsEntry[]> {
        return this.provider.listDir(path);
    }

    // Thin delegate to the shared opener — the tree and search converge on one
    // path so a file opens into the same deduped tab regardless of entry point.
    openFile(entry: FsEntry): Promise<void> {
        return openFileInEditor(entry, this.provider, this.router);
    }

    getHeaderActions(): JSX.Element {
        const desktopFs = window.desktopBridge?.fs;
        if (!desktopFs) return undefined;

        const fileName = (path: string) => {
            const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
            return separator >= 0 ? path.slice(separator + 1) : path;
        };

        const openChosenFolder = async () => {
            const path = await desktopFs.chooseFolder();
            if (!path) return;
            this.setRootEntry({ name: fileName(path), path, kind: 'dir' });
        };

        const createFile = async () => {
            const path = await desktopFs.chooseNewFile(this.rootEntry().path);
            if (!path) return;
            await this.provider.writeFile(path, '');
            this.reconcile(this.dirname(path));
            await this.openFile({
                name: fileName(path),
                path,
                kind: 'file',
            });
        };

        return (
            <div class={toolbarStyles.panelHeaderActions}>
                <button
                    type="button"
                    class={toolbarStyles.panelHeaderAction}
                    title="New file"
                    aria-label="New file"
                    onClick={() => void createFile()}
                >
                    <FilePlus size={16} />
                </button>
                <button
                    type="button"
                    class={toolbarStyles.panelHeaderAction}
                    title="Open folder"
                    aria-label="Open folder"
                    onClick={() => void openChosenFolder()}
                >
                    <FolderOpen size={16} />
                </button>
            </div>
        );
    }

    getPanel(): () => JSX.Element {
        return () => (
            <div class={fxStyles.tree}>
                <Show when={this.rootEntry()} keyed>
                    {entry => <TreeNode entry={entry} view={this} depth={0} startExpanded />}
                </Show>
            </div>
        );
    }
}
