import { describe, it, expect } from 'vitest';
import { InMemoryFileProvider } from '../src/fileexplorer/InMemoryFileProvider';
import { FakeFileProvider } from './factories/fakes';

// Reference implementation of the FileSystemProvider seam: hardcoded tree, async
// shape that maps onto fetch()/ipc later.
describe('InMemoryFileProvider', () => {
    it('exposes the inmemory root path', () => {
        expect(new InMemoryFileProvider().rootPath()).toBe('inmemory:/');
    });

    it('lists the root directory', async () => {
        const p = new InMemoryFileProvider();
        const entries = await p.listDir('inmemory:/');
        expect(entries).toEqual([
            { name: 'src', path: 'inmemory:/src', kind: 'dir' },
            { name: 'README.md', path: 'inmemory:/README.md', kind: 'file' },
        ]);
    });

    it('lists a nested directory', async () => {
        const p = new InMemoryFileProvider();
        const names = (await p.listDir('inmemory:/src')).map(e => e.name);
        expect(names).toEqual(['main.ts', 'notes.md']);
    });

    it('rejects listing an unknown directory', async () => {
        const p = new InMemoryFileProvider();
        await expect(p.listDir('inmemory:/nope')).rejects.toThrow('No such directory');
    });

    it('reads a known file', async () => {
        const p = new InMemoryFileProvider();
        await expect(p.readFile('inmemory:/src/notes.md')).resolves.toBe(
            '- stub note one\n- stub note two\n',
        );
    });

    it('rejects reading an unknown file', async () => {
        const p = new InMemoryFileProvider();
        await expect(p.readFile('inmemory:/ghost.txt')).rejects.toThrow('No such file');
    });
});

// The seam itself: any FileSystemProvider is swappable. This proves the fake
// honors the same contract downstream tests can rely on.
describe('FakeFileProvider (seam stand-in)', () => {
    it('serves its own configured tree', async () => {
        const p = new FakeFileProvider(
            { 'fake:/': [{ name: 'a.txt', path: 'fake:/a.txt', kind: 'file' }] },
            { 'fake:/a.txt': 'contents' },
        );
        expect(p.rootPath()).toBe('fake:/');
        expect(await p.listDir('fake:/')).toHaveLength(1);
        await expect(p.readFile('fake:/a.txt')).resolves.toBe('contents');
        await expect(p.readFile('fake:/missing')).rejects.toThrow();
    });
});
