import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import { createTwoFilesPatch } from 'diff';
import type { ToolCategory } from './ApprovalPolicy';
import type { FileEditContentDTO, FileEditRefDTO } from '../../shared/agentProtocol';

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    category: ToolCategory;
    execute(input: unknown, signal: AbortSignal): Promise<string>;
}

interface ProviderToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

const MAX_TOOL_OUTPUT_BYTES = 128 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

interface UndoRecord {
    id: string;
    target: string;
    relativePath: string;
    beforeExists: boolean;
    beforeContent?: string;
    beforeHash?: string;
    afterHash: string;
    createdAt: number;
    undoneAt?: number;
}

interface FileEditRecord {
    id: string;
    toolCallId: string;
    toolName: 'write_file' | 'edit_file';
    path: string;
    target: string;
    beforeExists: boolean;
    baseSha256: string | null;
    initialSha256: string;
    revision: number;
    before?: string;
    after?: string;
    patch?: string;
    settled: boolean;
    userModified?: boolean;
}

export class ToolRegistry {
    private readonly tools = new Map<string, ToolDefinition>();
    private static readonly editLocks = new Map<string, Promise<void>>();

    constructor(
        private readonly workspaceRoot: string,
        enableStubTools = false,
        private readonly undoDirectory = defaultUndoDirectory(workspaceRoot),
        private readonly editDirectory = path.join(path.dirname(undoDirectory), 'agent-file-edits'),
    ) {
        this.add({
            name: 'ask_question',
            description: 'Ask the user one question when their preference is needed. Give short answer choices when useful; users may also type their own answer or skip. A skipped question supplies no answer or preference. Do not bundle multiple questions into one call.',
            category: 'question',
            inputSchema: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'One clear question, at most 500 characters' },
                    detail: { type: 'string', description: 'Optional context for the question' },
                    options: {
                        type: 'array', minItems: 2, maxItems: 6,
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string', description: 'Stable short identifier' },
                                label: { type: 'string', description: 'Short choice label' },
                                detail: { type: 'string', description: 'Optional explanation under the label' },
                            },
                            required: ['id', 'label'], additionalProperties: false,
                        },
                    },
                },
                required: ['question'], additionalProperties: false,
            },
            execute: async () => { throw new Error('Questions are resolved by user interaction.'); },
        });
        this.add({
            name: 'read_file',
            description: 'Read a UTF-8 text file inside the current workspace.',
            category: 'read',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Workspace-relative file path' },
                },
                required: ['path'],
                additionalProperties: false,
            },
            execute: async (input, signal) => {
                signal.throwIfAborted();
                const contents = await fs.readFile(await this.resolveWorkspacePath(requireString(input, 'path')), 'utf8');
                signal.throwIfAborted();
                return truncate(contents);
            },
        });
        this.add({
            name: 'search_text',
            description: 'Search text in files under the current workspace.',
            category: 'read',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    path: {
                        type: 'string',
                        description: 'Optional workspace-relative directory or file',
                    },
                },
                required: ['query'],
                additionalProperties: false,
            },
            execute: async (input, signal) => {
                const query = requireString(input, 'query');
                const requested = typeof input === 'object'
                    && input != null
                    && typeof (input as Record<string, unknown>).path === 'string'
                    ? (input as Record<string, string>).path
                    : '.';
                const target = await this.resolveWorkspacePath(requested);
                return runSearch(query, target, this.workspaceRoot, signal);
            },
        });
        this.add({
            name: 'list_directory',
            description: 'List entries in a directory inside the current workspace.',
            category: 'read',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Workspace-relative directory path; use . for the root',
                    },
                },
                required: ['path'],
                additionalProperties: false,
            },
            execute: async (input, signal) => {
                signal.throwIfAborted();
                const entries = await fs.readdir(await this.resolveWorkspacePath(requireString(input, 'path')), { withFileTypes: true });
                signal.throwIfAborted();
                return truncate(entries
                    .map(entry => `${entry.isDirectory() ? 'directory' : 'file'}\t${entry.name}`)
                    .join('\n'));
            },
        });
        this.add({
            name: 'write_file',
            description: 'Atomically replace or create a UTF-8 file inside the workspace. Returns an operation id that can be undone.',
            category: 'workspace_mutation',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Workspace-relative file path' },
                    content: { type: 'string', description: 'Complete replacement contents' },
                },
                required: ['path', 'content'],
                additionalProperties: false,
            },
            execute: (input, signal) => this.writeFile(input, signal),
        });
        this.add({
            name: 'edit_file',
            description: 'Atomically replace one exact, unique text occurrence in an existing workspace file. Returns an operation id that can be undone.',
            category: 'workspace_mutation',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    oldText: { type: 'string' },
                    newText: { type: 'string' },
                },
                required: ['path', 'oldText', 'newText'],
                additionalProperties: false,
            },
            execute: (input, signal) => this.editFile(input, signal),
        });
        this.add({
            name: 'undo_file_write',
            description: 'Undo a previous write_file operation if the file has not changed since that write.',
            category: 'workspace_mutation',
            inputSchema: {
                type: 'object',
                properties: {
                    operationId: { type: 'string' },
                },
                required: ['operationId'],
                additionalProperties: false,
            },
            execute: (input, signal) => this.undoFileWrite(input, signal),
        });
        this.add({
            name: 'run_command',
            description: 'Run an executable without a shell in a workspace directory.',
            category: 'command',
            inputSchema: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Executable name or absolute path; shell syntax is not supported' },
                    args: { type: 'array', items: { type: 'string' }, description: 'Arguments passed directly to the executable' },
                    cwd: { type: 'string', description: 'Optional workspace-relative working directory' },
                },
                required: ['command'],
                additionalProperties: false,
            },
            execute: (input, signal) => this.runCommand(input, signal),
        });
        if (enableStubTools) this.addStubOperation();
    }

    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    definitions(include: (tool: ToolDefinition) => boolean = () => true): ProviderToolDefinition[] {
        return [...this.tools.values()].filter(include).map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));
    }

    private add(tool: ToolDefinition): void {
        this.tools.set(tool.name, tool);
    }

    async prepareFileEdit(id: string, name: string, input: unknown): Promise<FileEditRefDTO> {
        if (name !== 'write_file' && name !== 'edit_file') throw new Error('Not a file edit tool.');
        const requested = requireString(input, 'path');
        const target = await this.resolveWritableWorkspacePath(requested);
        const before = await readOptional(target);
        if (name === 'edit_file' && before == null) throw new Error('Edit conflict: file does not exist.');
        let after: string;
        if (name === 'write_file') after = requireString(input, 'content');
        else {
            const oldText = requireString(input, 'oldText');
            const newText = requireString(input, 'newText');
            if (!oldText) throw new Error('edit_file oldText must not be empty.');
            const first = before!.indexOf(oldText);
            if (first < 0) throw new Error('Edit conflict: oldText was not found.');
            if (before!.indexOf(oldText, first + oldText.length) >= 0) throw new Error('Edit conflict: oldText is not unique.');
            after = before!.slice(0, first) + newText + before!.slice(first + oldText.length);
        }
        if (Buffer.byteLength(after) > MAX_WRITE_BYTES) throw new Error(`File contents exceed the ${MAX_WRITE_BYTES}-byte write limit.`);
        const record: FileEditRecord = {
            id: randomUUID(), toolCallId: id, toolName: name, path: path.relative(await fs.realpath(this.workspaceRoot), target), target,
            beforeExists: before != null, baseSha256: before == null ? null : hash(before),
            initialSha256: hash(after), revision: 0, before: before ?? '', after, settled: false,
        };
        await this.saveFileEdit(record);
        return this.editRef(record);
    }

    async readFileEdit(id: string): Promise<FileEditContentDTO> {
        const record = await this.loadFileEdit(id);
        return record.settled
            ? { patch: record.patch, revision: record.revision, settled: true, userModified: record.userModified }
            : { before: record.before, after: record.after, revision: record.revision, settled: false };
    }

    async updateFileEdit(id: string, revision: number, content: string): Promise<FileEditRefDTO> {
        return this.withEditLock(id, async () => {
            const record = await this.loadFileEdit(id);
            if (record.settled) throw new Error('This file edit has already settled.');
            if (record.revision !== revision) throw new Error('The proposed buffer changed. Reload it before editing.');
            if (Buffer.byteLength(content) > MAX_WRITE_BYTES) throw new Error(`File contents exceed the ${MAX_WRITE_BYTES}-byte write limit.`);
            record.after = content;
            record.revision++;
            await this.saveFileEdit(record);
            return this.editRef(record);
        });
    }

    async applyFileEdit(id: string, signal: AbortSignal): Promise<{ output: string; userModified: boolean }> {
        return this.withEditLock(id, async () => {
            const record = await this.loadFileEdit(id);
            if (record.settled || record.after == null) throw new Error('This file edit has already settled.');
            const finalContent = record.after;
            return this.withEditLock(record.target, async () => {
                const target = await this.resolveWritableWorkspacePath(record.path);
                if (target !== record.target) throw new Error('Edit conflict: file path changed.');
                const current = await readOptional(target);
                if ((current == null) !== !record.beforeExists || (current != null && hash(current) !== record.baseSha256)) {
                    throw new Error('Edit conflict: the workspace file changed since this proposal was created.');
                }
                signal.throwIfAborted();
                const output = await this.writeFile({ path: record.path, content: finalContent }, signal);
                return { output: record.toolName === 'edit_file' ? output.replace(/^Wrote /, 'Edited ') : output, userModified: hash(finalContent) !== record.initialSha256 };
            });
        });
    }

    async settleFileEdit(id: string): Promise<boolean> {
        return this.withEditLock(id, async () => {
            const record = await this.loadFileEdit(id);
            if (record.settled) return record.userModified ?? false;
            const before = record.before ?? '';
            const after = record.after ?? '';
            const patch = createTwoFilesPatch(`a/${record.path}`, `b/${record.path}`, before, after);
            record.patch = Buffer.byteLength(patch) <= 4 * MAX_WRITE_BYTES ? patch : '[Diff too large to retain]';
            record.userModified = hash(after) !== record.initialSha256;
            record.before = undefined;
            record.after = undefined;
            record.settled = true;
            await this.saveFileEdit(record);
            return record.userModified;
        });
    }

    private editRef(record: FileEditRecord): FileEditRefDTO {
        return { artifactId: record.id, path: record.path, baseSha256: record.baseSha256, revision: record.revision };
    }

    private fileEditPath(id: string): string {
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid file edit id.');
        return path.join(this.editDirectory, `${id}.json`);
    }

    private async loadFileEdit(id: string): Promise<FileEditRecord> {
        const record = JSON.parse(await fs.readFile(this.fileEditPath(id), 'utf8')) as FileEditRecord;
        if (record.id !== id) throw new Error('Invalid file edit record.');
        return record;
    }

    private async saveFileEdit(record: FileEditRecord): Promise<void> {
        await fs.mkdir(this.editDirectory, { recursive: true });
        const filename = this.fileEditPath(record.id);
        const temporary = `${filename}.${randomUUID()}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporary, filename);
    }

    private async withEditLock<T>(key: string, work: () => Promise<T>): Promise<T> {
        const previous = ToolRegistry.editLocks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => { release = resolve; });
        ToolRegistry.editLocks.set(key, current);
        await previous;
        try { return await work(); }
        finally {
            release();
            if (ToolRegistry.editLocks.get(key) === current) ToolRegistry.editLocks.delete(key);
        }
    }

    private async writeFile(input: unknown, signal: AbortSignal): Promise<string> {
        const requested = requireString(input, 'path');
        const content = requireString(input, 'content');
        if (Buffer.byteLength(content) > MAX_WRITE_BYTES) {
            throw new Error(`File contents exceed the ${MAX_WRITE_BYTES}-byte write limit.`);
        }
        signal.throwIfAborted();
        const target = await this.resolveWritableWorkspacePath(requested);
        const before = await readOptional(target);
        const operationId = randomUUID();
        const record: UndoRecord = {
            id: operationId,
            target,
            relativePath: path.relative(await fs.realpath(this.workspaceRoot), target),
            beforeExists: before != null,
            ...(before != null ? { beforeContent: before, beforeHash: hash(before) } : {}),
            afterHash: hash(content),
            createdAt: Date.now(),
        };
        await this.saveUndoRecord(record);
        try {
            await atomicReplace(target, content, signal);
        } catch (error) {
            await fs.rm(this.undoRecordPath(operationId), { force: true });
            throw error;
        }
        return `Wrote ${record.relativePath}\nundoOperationId: ${operationId}\nafterSha256: ${record.afterHash}`;
    }

    private async editFile(input: unknown, signal: AbortSignal): Promise<string> {
        const requested = requireString(input, 'path');
        const oldText = requireString(input, 'oldText');
        const newText = requireString(input, 'newText');
        if (!oldText) throw new Error('edit_file oldText must not be empty.');
        const current = await fs.readFile(await this.resolveWorkspacePath(requested), 'utf8');
        const first = current.indexOf(oldText);
        if (first < 0) throw new Error('Edit conflict: oldText was not found.');
        if (current.indexOf(oldText, first + oldText.length) >= 0) {
            throw new Error('Edit conflict: oldText is not unique.');
        }
        signal.throwIfAborted();
        const next = current.slice(0, first) + newText + current.slice(first + oldText.length);
        return (await this.writeFile({ path: requested, content: next }, signal)).replace(/^Wrote /, 'Edited ');
    }

    private async undoFileWrite(input: unknown, signal: AbortSignal): Promise<string> {
        const operationId = requireString(input, 'operationId');
        if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error('Invalid undo operation id.');
        const record = JSON.parse(await fs.readFile(this.undoRecordPath(operationId), 'utf8')) as UndoRecord;
        if (record.id !== operationId || record.undoneAt) {
            throw new Error('This file write has already been undone.');
        }
        const target = await this.resolveWritableWorkspacePath(record.relativePath);
        if (target !== record.target) {
            throw new Error('Undo target no longer resolves to the original workspace file.');
        }
        const current = await readOptional(target);
        if (current == null || hash(current) !== record.afterHash) {
            throw new Error('Undo conflict: the file changed after the agent write.');
        }
        signal.throwIfAborted();
        if (record.beforeExists) await atomicReplace(target, record.beforeContent ?? '', signal);
        else {
            signal.throwIfAborted();
            await fs.unlink(target);
        }
        record.undoneAt = Date.now();
        await this.saveUndoRecord(record);
        return `Undid write to ${record.relativePath}\noperationId: ${operationId}`;
    }

    private async runCommand(input: unknown, signal: AbortSignal): Promise<string> {
        const command = requireString(input, 'command');
        const record = typeof input === 'object' && input != null ? input as Record<string, unknown> : {};
        const args = record.args == null ? [] : requireStringArray(record.args, 'args');
        const requestedCwd = typeof record.cwd === 'string' ? record.cwd : '.';
        const cwd = await this.resolveWorkspacePath(requestedCwd);
        if (!(await fs.stat(cwd)).isDirectory()) {
            throw new Error('Command cwd must be a workspace directory.');
        }
        signal.throwIfAborted();
        return spawnCommand(command, args, cwd, signal);
    }

    private undoRecordPath(id: string): string {
        return path.join(this.undoDirectory, `${id}.json`);
    }

    private async saveUndoRecord(record: UndoRecord): Promise<void> {
        await fs.mkdir(this.undoDirectory, { recursive: true });
        const filename = this.undoRecordPath(record.id);
        const temporary = `${filename}.${randomUUID()}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporary, filename);
    }

    private addStubOperation(): void {
        this.add({
            name: 'update_stub_fixture',
            description: 'Update the dedicated development fixture to prove that approval-gated mutations work.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                },
                required: ['path'],
                additionalProperties: false,
            },
            category: 'workspace_mutation',
            execute: async (input, signal) => {
                signal.throwIfAborted();
                const requested = requireString(input, 'path');
                if (requested !== 'tests/fixtures/agent-stub-operation.json') {
                    throw new Error('The stub mutation is restricted to its dedicated fixture.');
                }
                const resolved = await this.resolveWorkspacePath(requested);
                const current = JSON.parse(await fs.readFile(resolved, 'utf8')) as { operationCount?: number };
                const next = {
                    operationCount: (current.operationCount ?? 0) + 1,
                    lastResult: 'approved',
                    note: 'Updated by the local agent stub after explicit approval.',
                };
                signal.throwIfAborted();
                await fs.writeFile(resolved, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
                return `Updated ${requested}\noperationCount: ${next.operationCount}\nlastResult: ${next.lastResult}`;
            },
        });
    }
    private async resolveWorkspacePath(requested: string): Promise<string> {
        const root = await fs.realpath(this.workspaceRoot);
        const resolved = await fs.realpath(path.resolve(root, requested));
        if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
            throw new Error('Tool path is outside the workspace.');
        }
        return resolved;
    }
    private async resolveWritableWorkspacePath(requested: string): Promise<string> {
        const root = await fs.realpath(this.workspaceRoot);
        const candidate = path.resolve(root, requested);
        if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
            throw new Error('Tool path is outside the workspace.');
        }
        const parent = await fs.realpath(path.dirname(candidate));
        if (parent !== root && !parent.startsWith(`${root}${path.sep}`)) {
            throw new Error('Tool path is outside the workspace.');
        }
        try {
            const existing = await fs.realpath(candidate);
            if (existing !== root && !existing.startsWith(`${root}${path.sep}`)) {
                throw new Error('Tool path is outside the workspace.');
            }
            return existing;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            return candidate;
        }
    }
}

function requireString(input: unknown, key: string): string {
    if (
        typeof input !== 'object'
        || input == null
        || typeof (input as Record<string, unknown>)[key] !== 'string'
    ) {
        throw new Error(`Tool input must include a string ${key}.`);
    }
    return (input as Record<string, string>)[key];
}

function requireStringArray(value: unknown, key: string): string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new Error(`Tool input ${key} must be an array of strings.`);
    }
    return value;
}

function truncate(value: string): string {
    const bytes = Buffer.byteLength(value);
    if (bytes <= MAX_TOOL_OUTPUT_BYTES) return value;
    const truncated = Buffer.from(value).subarray(0, MAX_TOOL_OUTPUT_BYTES).toString('utf8');
    return `${truncated}\n[output truncated: ${bytes - MAX_TOOL_OUTPUT_BYTES} bytes omitted]`;
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

async function readOptional(filename: string): Promise<string | undefined> {
    try {
        return await fs.readFile(filename, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

function defaultUndoDirectory(root: string): string {
    return path.join(os.tmpdir(), 'percolate-agent-undo', createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16));
}

async function atomicReplace(target: string, content: string, signal: AbortSignal): Promise<void> {
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(content, 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        signal.throwIfAborted();
        try {
            const stat = await fs.stat(target);
            await fs.chmod(temporary, stat.mode);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        signal.throwIfAborted();
        await fs.rename(temporary, target);
    } finally {
        await handle?.close().catch(() => undefined);
        await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
}

function runSearch(query: string, target: string, cwd: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(rgPath, ['--line-number', '--no-heading', '--color', 'never', '--', query, target], { cwd });
        const chunks: Buffer[] = [];
        let bytes = 0;
        let error = '';
        const abort = () => child.kill();
        signal.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', (chunk: Buffer) => {
            if (bytes < MAX_TOOL_OUTPUT_BYTES) {
                chunks.push(chunk.subarray(0, MAX_TOOL_OUTPUT_BYTES - bytes));
                bytes += chunk.length;
            }
        });
        child.stderr.on('data', chunk => {
            error += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', code => {
            signal.removeEventListener('abort', abort);
            if (signal.aborted) reject(new Error('Search cancelled.'));
            else if (code !== 0 && code !== 1) reject(new Error(error.trim() || `Search failed (${code}).`));
            else resolve(Buffer.concat(chunks).toString('utf8') + (bytes >= MAX_TOOL_OUTPUT_BYTES ? '\n[output truncated]' : ''));
        });
    });
}

function spawnCommand(command: string, args: string[], cwd: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, shell: false, env: process.env });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let captured = 0;
        let total = 0;
        let forceKill: ReturnType<typeof setTimeout> | undefined;
        const capture = (target: Buffer[], chunk: Buffer) => {
            total += chunk.length;
            if (captured >= MAX_TOOL_OUTPUT_BYTES) return;
            const part = chunk.subarray(0, MAX_TOOL_OUTPUT_BYTES - captured);
            target.push(part);
            captured += part.length;
        };
        const abort = () => {
            child.kill('SIGTERM');
            forceKill = setTimeout(() => {
                if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
            }, 1_000);
        };
        signal.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
        child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
        child.on('error', error => {
            signal.removeEventListener('abort', abort);
            if (forceKill) clearTimeout(forceKill);
            reject(error);
        });
        child.on('close', (code, exitSignal) => {
            signal.removeEventListener('abort', abort);
            if (forceKill) clearTimeout(forceKill);
            if (signal.aborted) {
                reject(new Error('Command stopped by user.'));
                return;
            }
            const out = Buffer.concat(stdout).toString('utf8');
            const err = Buffer.concat(stderr).toString('utf8');
            const metadata = [
                `exitCode: ${code ?? 'null'}`,
                `signal: ${exitSignal ?? 'none'}`,
                `capturedBytes: ${captured}`,
                `totalBytes: ${total}`,
                `truncated: ${total > captured}`,
            ].join('\n');
            resolve(`${metadata}\n\nstdout:\n${out}\nstderr:\n${err}`);
        });
    });
}
