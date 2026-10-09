import { FileSystemProvider, FsEntry, FsStat } from './FileSystemProvider';

const ROOT = 'inmemory:/';

export const DEFAULT_DIRS: Record<string, FsEntry[]> = {
    [ROOT]: [
        { name: 'src', path: 'inmemory:/src', kind: 'dir' },
        { name: 'README.md', path: 'inmemory:/README.md', kind: 'file' },
    ],
    'inmemory:/src': [
        { name: 'main.ts', path: 'inmemory:/src/main.ts', kind: 'file' },
        { name: 'notes.md', path: 'inmemory:/src/notes.md', kind: 'file' },
    ],
};

export const DEFAULT_FILES: Record<string, string> = {
    'inmemory:/README.md':
        '# Demo Project\n\nThis file is served by the in-memory stub provider.\n',
    'inmemory:/src/main.ts':
        'export function main() {\n    console.log("hello from the stub");\n}\n',
    'inmemory:/src/notes.md':
        '- stub note one\n- stub note two\n',
};

export class InMemoryFileProvider implements FileSystemProvider {
    constructor(
        private dirs: Record<string, FsEntry[]> = { ...DEFAULT_DIRS },
        private files: Record<string, string> = { ...DEFAULT_FILES },
    ) {}

    rootPath(): string {
        return ROOT;
    }

    listDir(path: string): Promise<FsEntry[]> {
        const entries = this.dirs[path];
        return entries
            ? Promise.resolve(entries)
            : Promise.reject(new Error(`No such directory: ${path}`));
    }

    readFile(path: string): Promise<string> {
        const content = this.files[path];
        return content != null
            ? Promise.resolve(content)
            : Promise.reject(new Error(`No such file: ${path}`));
    }

    writeFile(path: string, contents: string): Promise<void> {
        this.files[path] = contents;
        return Promise.resolve();
    }

    stat(path: string): Promise<FsStat> {
        const content = this.files[path];
        if (content != null) {
            return Promise.resolve({ path, kind: 'file', size: content.length, mtimeMs: 0 });
        }
        if (this.dirs[path]) {
            return Promise.resolve({ path, kind: 'dir', size: 0, mtimeMs: 0 });
        }
        return Promise.reject(new Error(`No such path: ${path}`));
    }

    mkdir(path: string): Promise<void> {
        if (this.dirs[path] || this.files[path]) {
            return Promise.reject(new Error(`Path exists: ${path}`));
        }
        this.dirs[path] = [];
        return Promise.resolve();
    }

    delete(path: string): Promise<void> {
        if (this.files[path] != null) {
            delete this.files[path];
            return Promise.resolve();
        }
        if (this.dirs[path]) {
            delete this.dirs[path];
            return Promise.resolve();
        }
        return Promise.reject(new Error(`No such path: ${path}`));
    }

    rename(from: string, to: string): Promise<void> {
        if (this.files[from] != null) {
            this.files[to] = this.files[from];
            delete this.files[from];
            return Promise.resolve();
        }
        if (this.dirs[from]) {
            this.dirs[to] = this.dirs[from];
            delete this.dirs[from];
            return Promise.resolve();
        }
        return Promise.reject(new Error(`No such path: ${from}`));
    }

}
