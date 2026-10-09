// A node in the source tree. `path` is the opaque key the provider understands
// (also used as the editor model URI). Dirs have no content of their own.
export interface FsEntry {
    name: string;
    path: string;
    kind: 'file' | 'dir';
}

// Result of `stat` — cheap metadata read used before overwrite (mtime skew) and
// by the explorer for future sorting/detail rendering.
export interface FsStat {
    path: string;
    kind: 'file' | 'dir';
    size: number;
    mtimeMs: number;
}

// A watcher event kind. Follows chokidar's vocabulary so a desktop watcher can
// forward its raw event through the seam without translation loss.
export interface FileEvent {
    kind: 'change' | 'add' | 'unlink' | 'addDir' | 'unlinkDir';
    path: string;
}

// A disposer returned by any subscription seam (watch, pty listeners, ...).
export type Dispose = () => void;

export interface FileSystemProvider {
    rootPath(): string;
    listDir(path: string): Promise<FsEntry[]>;
    readFile(path: string): Promise<string>;

    writeFile(path: string, contents: string): Promise<void>;
    stat(path: string): Promise<FsStat>;
    mkdir(path: string): Promise<void>;
    delete(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;

    watch?(path: string, cb: (e: FileEvent) => void): Dispose;

    watchWorkspace?(cb: (e: FileEvent) => void): Dispose;
}
