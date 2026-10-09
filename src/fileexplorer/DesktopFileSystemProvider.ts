import type { DesktopBridge } from '../electron/desktopBridge';
import { Dispose, FileEvent, FileSystemProvider, FsEntry, FsStat } from './FileSystemProvider';

export class DesktopFileSystemProvider implements FileSystemProvider {
    constructor(private bridge: DesktopBridge) {}

    rootPath(): string {
        return this.bridge.rootPath;
    }

    listDir(path: string): Promise<FsEntry[]> {
        return this.bridge.fs.listDir(path);
    }

    readFile(path: string): Promise<string> {
        return this.bridge.fs.readFile(path);
    }

    writeFile(path: string, contents: string): Promise<void> {
        return this.bridge.fs.writeFile(path, contents);
    }

    stat(path: string): Promise<FsStat> {
        return this.bridge.fs.stat(path);
    }

    mkdir(path: string): Promise<void> {
        return this.bridge.fs.mkdir(path);
    }

    delete(path: string): Promise<void> {
        return this.bridge.fs.delete(path);
    }

    rename(from: string, to: string): Promise<void> {
        return this.bridge.fs.rename(from, to);
    }

    watch(path: string, cb: (e: FileEvent) => void): Dispose {
        return this.bridge.watch.watch(path, cb);
    }

    watchWorkspace(cb: (e: FileEvent) => void): Dispose {
        return this.bridge.watch.watchWorkspace(cb);
    }
}
