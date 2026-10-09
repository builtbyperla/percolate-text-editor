// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentRuntime } from '../electron/agent/AgentRuntime';
import { ToolRegistry } from '../electron/agent/ToolRegistry';
import type { AgentEvent } from '../shared/agentProtocol';

const originalMode = process.env.AGENT_MODE;
afterEach(() => { if (originalMode == null) delete process.env.AGENT_MODE; else process.env.AGENT_MODE = originalMode; });

it('turns a stub write attempt into one editable, approval-gated tool call', async () => {
    process.env.AGENT_MODE = 'stub';
    const root = await mkdtemp(path.join(tmpdir(), 'percolate-edit-runtime-'));
    const fixture = path.join(root, 'tests/fixtures/agent-file-edit-preview.txt');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(fixture, 'Alpha\nBeta\nGamma\n');
    const tools = new ToolRegistry(root, true, path.join(root, '.undo'), path.join(root, '.edits'));
    const events: AgentEvent[] = [];
    const runtime = new AgentRuntime('session', event => events.push(event), tools);
    try {
        await runtime.send({ sessionId: 'session', text: 'Please check this file', steeringPolicy: 'QUEUE' });
        await vi.waitFor(() => expect(runtime.snapshot.state).toBe('WAITING_FOR_CONTROL'), { timeout: 5_000 });
        const block = runtime.snapshot.messages.flatMap(message => message.blocks)
            .find(candidate => candidate.kind === 'tool' && candidate.type === 'write_file');
        if (!block || block.kind !== 'tool' || !block.fileEdit) throw new Error('Expected a pending file edit.');
        expect(block.status).toBe('pending');
        expect(block.input).toEqual({ path: 'tests/fixtures/agent-file-edit-preview.txt', artifactId: block.fileEdit.artifactId });
        expect(await readFile(fixture, 'utf8')).toBe('Alpha\nBeta\nGamma\n');

        await runtime.updateFileEdit(block.fileEdit.artifactId, 0, 'Alpha\nBeta (reviewer)\nGamma\n');
        await runtime.respond({ sessionId: 'session', responses: { [block.toolCallId]: { kind: 'approved' } } });
        expect(block).toMatchObject({ status: 'done', userModified: true });
        expect(events.find(event => event.type === 'tool-end' && event.response.toolCallId === block.toolCallId))
            .toMatchObject({ response: { userModified: true } });
        expect(await readFile(fixture, 'utf8')).toBe('Alpha\nBeta (reviewer)\nGamma\n');
        expect((await runtime.readFileEdit(block.fileEdit.artifactId)).patch).toContain('Beta (reviewer)');
    } finally {
        await runtime.stop();
        runtime.dispose();
        await rm(root, { recursive: true, force: true });
    }
});

it('auto-approves an editable write when its Timer-mode countdown expires', async () => {
    process.env.AGENT_MODE = 'stub';
    const root = await mkdtemp(path.join(tmpdir(), 'percolate-timed-edit-runtime-'));
    const fixture = path.join(root, 'tests/fixtures/agent-file-edit-preview.txt');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(fixture, 'Alpha\nBeta\nGamma\n');
    const runtime = new AgentRuntime('session', () => undefined, new ToolRegistry(root, true, path.join(root, '.undo'), path.join(root, '.edits')));
    try {
        runtime.setApprovalMode('timer-quick');
        await runtime.send({ sessionId: 'session', text: 'Please update this file', steeringPolicy: 'QUEUE' });
        let block = runtime.snapshot.messages.flatMap(message => message.blocks)
            .find(candidate => candidate.kind === 'tool' && candidate.type === 'write_file');
        await vi.waitFor(() => {
            block = runtime.snapshot.messages.flatMap(message => message.blocks)
                .find(candidate => candidate.kind === 'tool' && candidate.type === 'write_file');
            expect(block).toMatchObject({ status: 'pending', approval: { kind: 'timed' } });
        }, { timeout: 3_000 });
        expect(await readFile(fixture, 'utf8')).toBe('Alpha\nBeta\nGamma\n');

        await vi.waitFor(() => expect(block).toMatchObject({ status: 'done', controlAction: { kind: 'automated_approval' } }), { timeout: 5_000 });
        expect(await readFile(fixture, 'utf8')).toBe('Alpha\nBeta (agent proposal)\nGamma\n');
    } finally {
        await runtime.stop();
        runtime.dispose();
        await rm(root, { recursive: true, force: true });
    }
});
