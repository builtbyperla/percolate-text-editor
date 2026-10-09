import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '../electron/agent/ToolRegistry';

const roots: string[] = [];
async function setup() {
    const root = await mkdtemp(path.join(tmpdir(), 'percolate-file-edit-test-'));
    roots.push(root);
    return { root, tools: new ToolRegistry(root, false, path.join(root, '.undo'), path.join(root, '.edits')) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('file edit attempt', () => {
    it('applies the final editable buffer and keeps one historical patch', async () => {
        const { root, tools } = await setup();
        await writeFile(path.join(root, 'file.txt'), 'before\n');
        const ref = await tools.prepareFileEdit('provider-call-id', 'write_file', { path: 'file.txt', content: 'agent\n' });
        expect((await tools.readFileEdit(ref.artifactId)).after).toBe('agent\n');
        expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('before\n');

        await tools.updateFileEdit(ref.artifactId, 0, 'user\n');
        const result = await tools.applyFileEdit(ref.artifactId, new AbortController().signal);
        expect(result.userModified).toBe(true);
        expect(result.output).toContain('undoOperationId:');
        expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('user\n');
        expect(await tools.settleFileEdit(ref.artifactId)).toBe(true);
        const history = await tools.readFileEdit(ref.artifactId);
        expect(history).toMatchObject({ settled: true, userModified: true });
        expect(history.patch).toContain('+user');
        expect(history.after).toBeUndefined();
    });

    it('rejects a changed baseline and never overwrites it', async () => {
        const { root, tools } = await setup();
        await writeFile(path.join(root, 'file.txt'), 'before');
        const ref = await tools.prepareFileEdit('call', 'write_file', { path: 'file.txt', content: 'agent' });
        await writeFile(path.join(root, 'file.txt'), 'other');
        await expect(tools.applyFileEdit(ref.artifactId, new AbortController().signal)).rejects.toThrow('Edit conflict');
        expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('other');
        await tools.settleFileEdit(ref.artifactId);
        expect((await tools.readFileEdit(ref.artifactId)).patch).toContain('+agent');
    });

    it('uses the exact unique edit to seed the buffer and reports reverted edits as unchanged', async () => {
        const { root, tools } = await setup();
        await writeFile(path.join(root, 'file.txt'), 'one two');
        const ref = await tools.prepareFileEdit('call', 'edit_file', { path: 'file.txt', oldText: 'two', newText: 'three' });
        expect((await tools.readFileEdit(ref.artifactId)).after).toBe('one three');
        await tools.updateFileEdit(ref.artifactId, 0, 'different');
        await tools.updateFileEdit(ref.artifactId, 1, 'one three');
        expect(await tools.settleFileEdit(ref.artifactId)).toBe(false);
        expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('one two');
    });

    it('restores a pending buffer after reopening and prevents a second stale edit from applying', async () => {
        const { root, tools } = await setup();
        await writeFile(path.join(root, 'file.txt'), 'start');
        const first = await tools.prepareFileEdit('one', 'write_file', { path: 'file.txt', content: 'first' });
        const second = await tools.prepareFileEdit('two', 'write_file', { path: 'file.txt', content: 'second' });
        const reopened = new ToolRegistry(root, false, path.join(root, '.undo'), path.join(root, '.edits'));
        expect((await reopened.readFileEdit(first.artifactId)).after).toBe('first');
        await reopened.updateFileEdit(first.artifactId, 0, 'reviewed');
        await reopened.applyFileEdit(first.artifactId, new AbortController().signal);
        await reopened.settleFileEdit(first.artifactId);
        await expect(tools.applyFileEdit(second.artifactId, new AbortController().signal)).rejects.toThrow('Edit conflict');
        expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('reviewed');
    });
});
