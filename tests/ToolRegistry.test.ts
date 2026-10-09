// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../electron/agent/ToolRegistry';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('ToolRegistry', () => {
    it('reads files under the workspace root', async () => {
        const registry = new ToolRegistry(process.cwd());
        const output = await registry.get('read_file')!.execute({ path: 'package.json' }, new AbortController().signal);
        expect(output).toContain('percolate');
    });

    it('rejects paths outside the workspace after resolving symlinks', async () => {
        const registry = new ToolRegistry(process.cwd());
        await expect(registry.get('list_directory')!.execute({ path: '..' }, new AbortController().signal)).rejects.toThrow('outside the workspace');
    });

    it('searches text without invoking a shell', async () => {
        const registry = new ToolRegistry(process.cwd());
        const output = await registry.get('search_text')!.execute({ query: 'percolate', path: 'package.json' }, new AbortController().signal);
        expect(output).toContain('percolate');
    });

    it('atomically replaces a file and supports conflict-checked undo', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-tools-')); const undo = await mkdtemp(path.join(tmpdir(), 'percolate-undo-'));
        try {
            const target = path.join(root, 'sample.txt'); await writeFile(target, 'before');
            const registry = new ToolRegistry(root, false, undo);
            const output = await registry.get('write_file')!.execute({ path: 'sample.txt', content: 'after' }, new AbortController().signal);
            const operationId = output.match(/undoOperationId: ([0-9a-f-]+)/)?.[1];
            expect(operationId).toBeTruthy(); expect(await readFile(target, 'utf8')).toBe('after');
            expect((await readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);

            const reopenedRegistry = new ToolRegistry(root, false, undo);
            await reopenedRegistry.get('undo_file_write')!.execute({ operationId }, new AbortController().signal);
            expect(await readFile(target, 'utf8')).toBe('before');
            await expect(reopenedRegistry.get('undo_file_write')!.execute({ operationId }, new AbortController().signal)).rejects.toThrow('already been undone');
        } finally { await rm(root, { recursive: true, force: true }); await rm(undo, { recursive: true, force: true }); }
    });

    it('refuses undo when another writer changed the committed file', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-tools-')); const undo = await mkdtemp(path.join(tmpdir(), 'percolate-undo-'));
        try {
            const target = path.join(root, 'sample.txt'); await writeFile(target, 'before');
            const registry = new ToolRegistry(root, false, undo);
            const output = await registry.get('write_file')!.execute({ path: 'sample.txt', content: 'agent' }, new AbortController().signal);
            const operationId = output.match(/undoOperationId: ([0-9a-f-]+)/)?.[1]; await writeFile(target, 'human edit');
            await expect(registry.get('undo_file_write')!.execute({ operationId }, new AbortController().signal)).rejects.toThrow('Undo conflict');
            expect(await readFile(target, 'utf8')).toBe('human edit');
        } finally { await rm(root, { recursive: true, force: true }); await rm(undo, { recursive: true, force: true }); }
    });

    it('applies one exact edit atomically and makes it undoable', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-tools-')); const undo = await mkdtemp(path.join(tmpdir(), 'percolate-undo-'));
        try {
            const target = path.join(root, 'sample.txt'); await writeFile(target, 'alpha\nbeta\ngamma\n');
            const registry = new ToolRegistry(root, false, undo);
            const output = await registry.get('edit_file')!.execute({ path: 'sample.txt', oldText: 'beta', newText: 'changed' }, new AbortController().signal);
            const operationId = output.match(/undoOperationId: ([0-9a-f-]+)/)?.[1];
            expect(output).toContain('Edited sample.txt');
            expect(await readFile(target, 'utf8')).toBe('alpha\nchanged\ngamma\n');
            await new ToolRegistry(root, false, undo).get('undo_file_write')!.execute({ operationId }, new AbortController().signal);
            expect(await readFile(target, 'utf8')).toBe('alpha\nbeta\ngamma\n');
        } finally { await rm(root, { recursive: true, force: true }); await rm(undo, { recursive: true, force: true }); }
    });

    it('rejects missing or ambiguous edit matches without changing the file', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-tools-')); const target = path.join(root, 'sample.txt');
        try {
            await writeFile(target, 'same same'); const registry = new ToolRegistry(root);
            await expect(registry.get('edit_file')!.execute({ path: 'sample.txt', oldText: 'same', newText: 'new' }, new AbortController().signal)).rejects.toThrow('not unique');
            await expect(registry.get('edit_file')!.execute({ path: 'sample.txt', oldText: 'missing', newText: 'new' }, new AbortController().signal)).rejects.toThrow('not found');
            expect(await readFile(target, 'utf8')).toBe('same same');
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('removes a newly created file when its write is undone', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-tools-')); const undo = await mkdtemp(path.join(tmpdir(), 'percolate-undo-'));
        try {
            const registry = new ToolRegistry(root, false, undo);
            const output = await registry.get('write_file')!.execute({ path: 'new.txt', content: 'created' }, new AbortController().signal);
            const operationId = output.match(/undoOperationId: ([0-9a-f-]+)/)?.[1];
            await registry.get('undo_file_write')!.execute({ operationId }, new AbortController().signal);
            await expect(readFile(path.join(root, 'new.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        } finally { await rm(root, { recursive: true, force: true }); await rm(undo, { recursive: true, force: true }); }
    });

    it('rejects writes through symlinks that leave the workspace', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-tools-')); const outside = await mkdtemp(path.join(tmpdir(), 'percolate-outside-'));
        try {
            const outsideFile = path.join(outside, 'secret.txt'); await writeFile(outsideFile, 'safe'); await symlink(outsideFile, path.join(root, 'linked.txt'));
            const registry = new ToolRegistry(root);
            await expect(registry.get('write_file')!.execute({ path: 'linked.txt', content: 'unsafe' }, new AbortController().signal)).rejects.toThrow('outside the workspace');
            expect(await readFile(outsideFile, 'utf8')).toBe('safe');
        } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
    });

    it('runs commands without a shell and reports structured exit metadata', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-tools-'));
        try {
            const registry = new ToolRegistry(root);
            const output = await registry.get('run_command')!.execute({
                command: process.execPath,
                args: ['-e', 'process.stdout.write("hello"); process.stderr.write("warning")'],
            }, new AbortController().signal);
            expect(output).toContain('exitCode: 0');
            expect(output).toContain('truncated: false');
            expect(output).toContain('stdout:\nhello');
            expect(output).toContain('stderr:\nwarning');
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('stops a running command through its abort signal', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-tools-'));
        try {
            const registry = new ToolRegistry(root); const controller = new AbortController();
            const running = registry.get('run_command')!.execute({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }, controller.signal);
            setTimeout(() => controller.abort(), 20);
            await expect(running).rejects.toThrow('stopped by user');
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('confines command working directories to the workspace', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-tools-'));
        try {
            const registry = new ToolRegistry(root);
            await expect(registry.get('run_command')!.execute({ command: process.execPath, cwd: '..' }, new AbortController().signal)).rejects.toThrow('outside the workspace');
        } finally { await rm(root, { recursive: true, force: true }); }
    });
});
