// Reused disposer alias so pty and fs-watcher subscriptions have the same shape.
// Terminal callers don't need to import from `fileexplorer/`; re-export here.
export type { Dispose } from '../fileexplorer/FileSystemProvider';
import type { Dispose } from '../fileexplorer/FileSystemProvider';

export interface PtySpawnOpts {
    shell?: string;
    cwd?: string;
    cols: number;
    rows: number;
    env?: Record<string, string>;
}

export interface PtySession {
    readonly id: string;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    onData(cb: (data: string) => void): Dispose;
    onExit(cb: (code: number) => void): Dispose;
    kill(): void;
    dispose(): void;
}

export interface PtyProvider {
    spawn(opts: PtySpawnOpts): Promise<PtySession>;
}
