// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../electron/agent/AgentRuntime';
import type { AgentEvent, SessionSnapshot, SteeringPolicy, ToolBlockDTO } from '../shared/agentProtocol';
import { ToolRegistry, type ToolDefinition } from '../electron/agent/ToolRegistry';
import responses from '../shared/agentStubResponses.json';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('AgentRuntime steering and cancellation', () => {
    let previousMode: string | undefined;
    beforeEach(() => { previousMode = process.env.AGENT_MODE; process.env.AGENT_MODE = 'stub'; vi.useFakeTimers(); });
    afterEach(() => { if (previousMode == null) delete process.env.AGENT_MODE; else process.env.AGENT_MODE = previousMode; vi.useRealTimers(); });

    function setup() {
        const events: AgentEvent[] = [];
        // Steering tests use the simple streaming stub; the richer fixture
        // harness has dedicated approval tests below.
        const runtime = new AgentRuntime('session', event => events.push(event), new ToolRegistry(process.cwd(), false));
        const send = (text: string, steeringPolicy: SteeringPolicy = 'QUEUE') => runtime.send({ sessionId: 'session', text, steeringPolicy });
        return { runtime, events, send };
    }

    async function skipOpeningFileEdit(runtime: AgentRuntime) {
        await runtime.send({ sessionId: 'session', text: 'first turn', steeringPolicy: 'QUEUE' });
        if (vi.isFakeTimers()) await vi.runAllTimersAsync();
        else await vi.waitFor(() => expect(runtime.snapshot.state).toBe('WAITING_FOR_CONTROL'), { timeout: 3_000 });
        expect(runtime.snapshot.messages.flatMap(message => message.blocks)
            .some(block => block.kind === 'tool' && block.type === 'write_file' && block.status === 'pending')).toBe(true);
        await runtime.stop();
    }

    it('QUEUE records the second user input only after the active call settles', async () => {
        const { runtime, send } = setup();
        await send('first'); await send('second', 'QUEUE');
        expect(runtime.snapshot.messages.filter(message => message.role === 'user')).toHaveLength(1);
        await vi.runAllTimersAsync();
        expect(runtime.snapshot.messages.filter(message => message.role === 'user').map(message => message.blocks[0].kind === 'text' ? message.blocks[0].content : '')).toEqual(['first', 'second']);
    });

    it('APPEND records immediately and starts a follow-up only at the boundary', async () => {
        const { runtime, send } = setup();
        await send('first'); await send('appended', 'APPEND');
        expect(runtime.snapshot.messages.filter(message => message.role === 'user')).toHaveLength(2);
        expect(runtime.snapshot.messages.filter(message => message.role === 'assistant')).toHaveLength(1);
        await vi.runAllTimersAsync();
        expect(runtime.snapshot.messages.filter(message => message.role === 'assistant')).toHaveLength(2);
    });

    it('INTERRUPT settles the active output before recording and running the replacement', async () => {
        const { runtime, send } = setup();
        await send('first'); await vi.advanceTimersByTimeAsync(40); await send('replacement', 'INTERRUPT');
        await vi.runAllTimersAsync();
        const assistants = runtime.snapshot.messages.filter(message => message.role === 'assistant');
        expect(assistants).toHaveLength(2);
        expect(assistants[0].status).toBe('interrupted');
        expect(assistants[1].status).toBe('done');
        const firstAssistantIndex = runtime.snapshot.messages.indexOf(assistants[0]);
        const replacementIndex = runtime.snapshot.messages.findIndex(message => message.role === 'user' && message.blocks[0].kind === 'text' && message.blocks[0].content === 'replacement');
        expect(replacementIndex).toBeGreaterThan(firstAssistantIndex);
    });

    it('cancel preserves partial text and marks it interrupted', async () => {
        const { runtime, send } = setup();
        await send('first'); await vi.advanceTimersByTimeAsync(40); await runtime.cancel();
        const assistant = runtime.snapshot.messages.find(message => message.role === 'assistant')!;
        expect(assistant.status).toBe('interrupted');
        expect(assistant.blocks[0].kind === 'text' && assistant.blocks[0].content.length).toBeGreaterThan(0);
    });

    it('Break cancels the active call but preserves queued work', async () => {
        const { runtime, send } = setup();
        await send('first'); await send('second', 'QUEUE');
        await vi.advanceTimersByTimeAsync(40); await runtime.cancel();
        await vi.runAllTimersAsync();

        const users = runtime.snapshot.messages.filter(message => message.role === 'user');
        const assistants = runtime.snapshot.messages.filter(message => message.role === 'assistant');
        expect(users).toHaveLength(2);
        expect(assistants.map(message => message.status)).toEqual(['interrupted', 'done']);
    });

    it('Stop cancels the active call and discards queued work', async () => {
        const { runtime, send } = setup();
        await send('first'); await send('second', 'QUEUE');
        await vi.advanceTimersByTimeAsync(40); await runtime.stop();
        await vi.runAllTimersAsync();

        expect(runtime.snapshot.messages.filter(message => message.role === 'user')).toHaveLength(1);
        expect(runtime.snapshot.messages.filter(message => message.role === 'assistant').map(message => message.status)).toEqual(['interrupted']);
        expect(runtime.snapshot.state).toBe('IDLE');
    });

    it('Stop skips pending approvals so the turn cannot resume', async () => {
        const now = Date.now();
        const tool: ToolBlockDTO = { id: 'tool', kind: 'tool', role: 'assistant', toolCallId: 'tool', type: 'write_file', status: 'pending' };
        const initial: SessionSnapshot = {
            id: 'session', agent: 'stub', displayName: 'Pending', archived: false, state: 'WAITING_FOR_CONTROL', createdAt: now, updatedAt: now,
            messages: [{ id: 'message', role: 'assistant', status: 'done', createdAt: now, blocks: [tool] }],
            steeringPolicy: 'QUEUE', approvalMode: 'ask',
        };
        const events: AgentEvent[] = [];
        const runtime = new AgentRuntime('session', event => events.push(event), new ToolRegistry(process.cwd(), false), initial);

        await runtime.stop();

        expect(tool.status).toBe('skipped');
        expect(tool.controlAction).toEqual({ kind: 'skipped', reason: 'Stopped by user.' });
        expect(runtime.snapshot.state).toBe('IDLE');
        expect(events.some(event => event.type === 'tool-end' && event.response.status === 'skipped')).toBe(true);
    });

    it('re-arms future timed approvals for the remaining window and executes once', async () => {
        const execute = vi.fn(async () => 'changed');
        class CountingTools extends ToolRegistry {
            override get(name: string): ToolDefinition | undefined {
                if (name !== 'timed_write') return super.get(name);
                return { name, description: 'timed mutation', inputSchema: { type: 'object' }, category: 'workspace_mutation', execute };
            }
        }
        const now = Date.now();
        const tool: ToolBlockDTO = {
            id: 'timed', kind: 'tool', role: 'assistant', toolCallId: 'timed', type: 'timed_write', status: 'pending',
            approval: { kind: 'timed', requestedAt: now - 2_000, autoApproveAt: now + 1_000 },
        };
        const initial: SessionSnapshot = {
            id: 'session', agent: 'stub', displayName: 'Timed', archived: false, state: 'WAITING_FOR_CONTROL', createdAt: now, updatedAt: now,
            messages: [{ id: 'message', role: 'assistant', status: 'done', createdAt: now, blocks: [tool] }],
            steeringPolicy: 'QUEUE', approvalMode: 'timer-quick',
        };
        const runtime = new AgentRuntime('session', () => undefined, new CountingTools(process.cwd()), initial);
        runtime.setPaused(true);

        await vi.advanceTimersByTimeAsync(999);
        expect(execute).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(execute).toHaveBeenCalledOnce();
        expect(tool).toMatchObject({ status: 'done', controlAction: { kind: 'automated_approval' } });

        await runtime.respond({ sessionId: 'session', responses: { timed: { kind: 'approved' } } });
        expect(execute).toHaveBeenCalledOnce();
        runtime.dispose();
    });

    it('lets a manual response or Stop cancel a timed approval', async () => {
        const execute = vi.fn(async () => 'changed');
        class CountingTools extends ToolRegistry {
            override get(name: string): ToolDefinition | undefined {
                if (name !== 'timed_write') return super.get(name);
                return { name, description: 'timed mutation', inputSchema: { type: 'object' }, category: 'workspace_mutation', execute };
            }
        }
        const makeRuntime = (id: string) => {
            const now = Date.now();
            const tool: ToolBlockDTO = {
                id, kind: 'tool', role: 'assistant', toolCallId: id, type: 'timed_write', status: 'pending',
                approval: { kind: 'timed', requestedAt: now, autoApproveAt: now + 3_000 },
            };
            const initial: SessionSnapshot = {
                id, agent: 'stub', displayName: 'Timed', archived: false, state: 'WAITING_FOR_CONTROL', createdAt: now, updatedAt: now,
                messages: [{ id: `message-${id}`, role: 'assistant', status: 'done', createdAt: now, blocks: [tool] }],
                steeringPolicy: 'QUEUE', approvalMode: 'timer-quick',
            };
            return { runtime: new AgentRuntime(id, () => undefined, new CountingTools(process.cwd()), initial), tool };
        };

        const manual = makeRuntime('manual');
        manual.runtime.setPaused(true);
        await manual.runtime.respond({ sessionId: 'manual', responses: { manual: { kind: 'rejected' } } });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(manual.tool.status).toBe('rejected');
        expect(execute).not.toHaveBeenCalled();

        const stopped = makeRuntime('stopped');
        await stopped.runtime.stop();
        await vi.advanceTimersByTimeAsync(3_000);
        expect(stopped.tool.status).toBe('skipped');
        expect(execute).not.toHaveBeenCalled();
    });

    it('downgrades a timed approval that expired while closed to explicit approval', async () => {
        const execute = vi.fn(async () => 'changed');
        class CountingTools extends ToolRegistry {
            override get(name: string): ToolDefinition | undefined {
                if (name !== 'timed_write') return super.get(name);
                return { name, description: 'timed mutation', inputSchema: { type: 'object' }, category: 'workspace_mutation', execute };
            }
        }
        const now = Date.now();
        const tool: ToolBlockDTO = {
            id: 'stale', kind: 'tool', role: 'assistant', toolCallId: 'stale', type: 'timed_write', status: 'pending',
            approval: { kind: 'timed', requestedAt: now - 5_000, autoApproveAt: now - 2_000 },
        };
        const initial: SessionSnapshot = {
            id: 'session', agent: 'stub', displayName: 'Stale', archived: false, state: 'WAITING_FOR_CONTROL', createdAt: now, updatedAt: now - 1,
            messages: [{ id: 'message', role: 'assistant', status: 'done', createdAt: now, blocks: [tool] }],
            steeringPolicy: 'QUEUE', approvalMode: 'timer-quick',
        };
        const runtime = new AgentRuntime('session', () => undefined, new CountingTools(process.cwd()), initial);

        await vi.runAllTimersAsync();
        expect(tool.approval).toBeUndefined();
        expect(tool.status).toBe('pending');
        expect(execute).not.toHaveBeenCalled();
        runtime.dispose();
    });

    it('compacts idle context without deleting transcript history', () => {
        const now = Date.now();
        const initial: SessionSnapshot = {
            id: 'session', agent: 'stub', displayName: 'Long thread', archived: false, state: 'IDLE', createdAt: now, updatedAt: now,
            steeringPolicy: 'QUEUE', approvalMode: 'ask', messages: [
                { id: 'user', role: 'user', status: 'done', createdAt: now, blocks: [{ id: 'user', kind: 'text', role: 'user', content: 'Inspect the parser.', status: 'done' }] },
                { id: 'assistant', role: 'assistant', status: 'done', createdAt: now, blocks: [{ id: 'assistant', kind: 'text', role: 'assistant', content: 'The parser has one failing edge case.', status: 'done' }] },
            ],
        };
        const events: AgentEvent[] = [];
        const runtime = new AgentRuntime('session', event => events.push(event), new ToolRegistry(process.cwd(), false), initial);

        runtime.compact();

        expect(runtime.snapshot.messages).toHaveLength(3);
        expect(runtime.snapshot.contextCutoff).toBe(2);
        expect(runtime.getContextStats()).toMatchObject({ totalMessages: 3, activeMessages: 1, compactedMessages: 2 });
        expect(events).toEqual([]);
        expect(runtime.snapshot.messages[2].blocks[0]).toMatchObject({ origin: 'system' });
    });

    it('Stop aborts an approved running tool without starting another provider call', async () => {
        class SlowToolRegistry extends ToolRegistry {
            override get(name: string): ToolDefinition | undefined {
                if (name !== 'slow_write') return super.get(name);
                return {
                    name, description: 'slow mutation', inputSchema: { type: 'object' }, category: 'workspace_mutation',
                    execute: (_input, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
                };
            }
        }
        const now = Date.now();
        const tool: ToolBlockDTO = { id: 'slow', kind: 'tool', role: 'assistant', toolCallId: 'slow', type: 'slow_write', status: 'pending' };
        const initial: SessionSnapshot = {
            id: 'session', agent: 'stub', displayName: 'Pending', archived: false, state: 'WAITING_FOR_CONTROL', createdAt: now, updatedAt: now,
            messages: [{ id: 'message', role: 'assistant', status: 'done', createdAt: now, blocks: [tool] }],
            steeringPolicy: 'QUEUE', approvalMode: 'ask',
        };
        const runtime = new AgentRuntime('session', () => undefined, new SlowToolRegistry(process.cwd()), initial);

        const responding = runtime.respond({ sessionId: 'session', responses: { slow: { kind: 'approved' } } });
        expect(runtime.snapshot.state).toBe('RUNNING_TOOL');
        await runtime.stop(); await responding;

        expect(tool.status).toBe('skipped');
        expect(tool.output).toBe('Stopped by user.');
        expect(runtime.snapshot.messages.flatMap(message => message.blocks).filter(block => block.kind === 'text')).toHaveLength(0);
        expect(runtime.snapshot.state).toBe('IDLE');
    });

    it('undoes a completed transactional write and records the undo in the transcript', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-agent-write-')); const undo = await mkdtemp(path.join(tmpdir(), 'percolate-agent-undo-'));
        try {
            const target = path.join(root, 'sample.txt'); await writeFile(target, 'before');
            const tools = new ToolRegistry(root, false, undo);
            const output = await tools.get('write_file')!.execute({ path: 'sample.txt', content: 'after' }, new AbortController().signal);
            const now = Date.now();
            const write: ToolBlockDTO = { id: 'write', kind: 'tool', role: 'assistant', toolCallId: 'write', type: 'write_file', subject: 'sample.txt', input: { path: 'sample.txt', content: 'after' }, output, status: 'done', controlAction: { kind: 'approved' } };
            const initial: SessionSnapshot = {
                id: 'session', agent: 'stub', displayName: 'Write', archived: false, state: 'IDLE', createdAt: now, updatedAt: now,
                messages: [{ id: 'message', role: 'assistant', status: 'done', createdAt: now, blocks: [write] }],
                steeringPolicy: 'QUEUE', approvalMode: 'ask',
            };
            const runtime = new AgentRuntime('session', () => undefined, tools, initial);

            await runtime.undo('write');

            expect(await readFile(target, 'utf8')).toBe('before');
            expect(write.output).toContain('undoStatus: undone');
            const undoBlock = runtime.snapshot.messages.flatMap(message => message.blocks).find(block => block.kind === 'tool' && block.type === 'undo_file_write');
            expect(undoBlock).toMatchObject({ status: 'done', controlAction: { kind: 'approved' } });
        } finally { await rm(root, { recursive: true, force: true }); await rm(undo, { recursive: true, force: true }); }
    });

    it('ignores duplicate or unknown control responses', async () => {
        const { runtime } = setup();
        await runtime.respond({ sessionId: 'session', responses: { missing: { kind: 'approved' } } });
        expect(runtime.snapshot.messages).toHaveLength(0);
        expect(runtime.snapshot.state).toBe('IDLE');
    });

    it('defaults the Electron runtime to the real provider unless stub mode is explicit', () => {
        delete process.env.AGENT_MODE;
        const runtime = new AgentRuntime('session', () => undefined, new ToolRegistry(process.cwd(), false));
        expect(runtime.snapshot.agent).toBe('openai');
    });

    it('loops ordinary desktop stub replies through the shared JSON fixture', async () => {
        const { runtime, send } = setup();
        for (let index = 0; index <= responses.length; index++) {
            await send(`turn ${index}`);
            await vi.runAllTimersAsync();
        }
        const replies = runtime.snapshot.messages
            .filter(message => message.role === 'assistant')
            .map(message => message.blocks[0].kind === 'text' ? message.blocks[0].content : '');
        expect(replies[0]).toBe(responses[0].response);
        expect(replies.at(-1)).toBe(responses[0].response);
    });

    it('runs the interactive fixture scenario only after approval', async () => {
        vi.useRealTimers();
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-agent-stub-'));
        const fixtureDir = path.join(root, 'tests', 'fixtures');
        const fixturePath = path.join(fixtureDir, 'agent-stub-operation.json');
        await mkdir(fixtureDir, { recursive: true });
        await writeFile(fixturePath, '{"operationCount":0,"lastResult":"ready"}\n');
        try {
            const events: AgentEvent[] = [];
            const runtime = new AgentRuntime('session', event => events.push(structuredClone(event)), new ToolRegistry(root, true));
            await skipOpeningFileEdit(runtime);
            await runtime.send({ sessionId: 'session', text: 'Run the test operation', steeringPolicy: 'QUEUE' });
            await vi.waitFor(() => expect(runtime.snapshot.state).toBe('WAITING_FOR_CONTROL'), { timeout: 3_000 });

            const tools = runtime.snapshot.messages.flatMap(message => message.blocks).filter(block => block.kind === 'tool');
            const read = tools.find(block => block.type === 'read_file')!;
            const update = tools.find(block => block.type === 'update_stub_fixture')!;
            expect(read.status).toBe('done');
            expect(update.status).toBe('pending');
            expect(JSON.parse(await readFile(fixturePath, 'utf8')).operationCount).toBe(0);

            await runtime.respond({ sessionId: 'session', responses: { [update.toolCallId]: { kind: 'approved' } } });
            await vi.waitFor(() => expect(runtime.snapshot.state).toBe('IDLE'), { timeout: 3_000 });
            expect(update.status).toBe('done');
            expect(update.controlAction).toEqual({ kind: 'approved' });
            expect(JSON.parse(await readFile(fixturePath, 'utf8')).operationCount).toBe(1);
            expect(runtime.snapshot.messages.flatMap(message => message.blocks).some(block => block.kind === 'text' && block.content.includes('Approved operation completed'))).toBe(true);
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('keeps the fixture unchanged when the operation is rejected', async () => {
        vi.useRealTimers();
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-agent-stub-'));
        const fixtureDir = path.join(root, 'tests', 'fixtures'); const fixturePath = path.join(fixtureDir, 'agent-stub-operation.json');
        await mkdir(fixtureDir, { recursive: true }); await writeFile(fixturePath, '{"operationCount":0,"lastResult":"ready"}\n');
        try {
            const runtime = new AgentRuntime('session', () => undefined, new ToolRegistry(root, true));
            await skipOpeningFileEdit(runtime);
            await runtime.send({ sessionId: 'session', text: 'Test approvals', steeringPolicy: 'QUEUE' });
            await vi.waitFor(() => expect(runtime.snapshot.state).toBe('WAITING_FOR_CONTROL'), { timeout: 3_000 });
            const update = runtime.snapshot.messages.flatMap(message => message.blocks).find((block): block is ToolBlockDTO => block.kind === 'tool' && block.type === 'update_stub_fixture')!;
            await runtime.respond({ sessionId: 'session', responses: { [update.toolCallId]: { kind: 'rejected', reason: 'Not now' } } });
            await vi.waitFor(() => expect(runtime.snapshot.state).toBe('IDLE'), { timeout: 3_000 });
            expect(update.status).toBe('rejected');
            expect(JSON.parse(await readFile(fixturePath, 'utf8')).operationCount).toBe(0);
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('automates the stub mutation in Operate mode', async () => {
        vi.useRealTimers();
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-agent-operate-'));
        const fixtureDir = path.join(root, 'tests', 'fixtures'); const fixturePath = path.join(fixtureDir, 'agent-stub-operation.json');
        await mkdir(fixtureDir, { recursive: true }); await writeFile(fixturePath, '{"operationCount":0,"lastResult":"ready"}\n');
        try {
            const runtime = new AgentRuntime('session', () => undefined, new ToolRegistry(root, true));
            await skipOpeningFileEdit(runtime);
            runtime.setApprovalMode('operate');
            await runtime.send({ sessionId: 'session', text: 'Run the operation', steeringPolicy: 'QUEUE' });
            await vi.waitFor(() => expect(runtime.snapshot.state).toBe('IDLE'), { timeout: 3_000 });

            const update = runtime.snapshot.messages.flatMap(message => message.blocks)
                .find(block => block.kind === 'tool' && block.type === 'update_stub_fixture');
            expect(update).toMatchObject({ status: 'done', controlAction: { kind: 'automated_approval' } });
            expect(JSON.parse(await readFile(fixturePath, 'utf8')).operationCount).toBe(1);
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it('exposes and then auto-approves the stub mutation in Quick mode', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'percolate-agent-quick-'));
        const fixtureDir = path.join(root, 'tests', 'fixtures'); const fixturePath = path.join(fixtureDir, 'agent-stub-operation.json');
        await mkdir(fixtureDir, { recursive: true }); await writeFile(fixturePath, '{"operationCount":0,"lastResult":"ready"}\n');
        try {
            const events: AgentEvent[] = [];
            const runtime = new AgentRuntime('session', event => events.push(structuredClone(event)), new ToolRegistry(root, true));
            await skipOpeningFileEdit(runtime);
            runtime.setApprovalMode('timer-quick');
            await runtime.send({ sessionId: 'session', text: 'Run after review', steeringPolicy: 'QUEUE' });
            await vi.runAllTimersAsync();
            await vi.waitFor(() => expect(events.some(event => (
                event.type === 'tool-start' && event.call.type === 'update_stub_fixture' && event.call.approval?.kind === 'timed'
            ))).toBe(true));
            await vi.runAllTimersAsync();

            const pendingEvent = events.find((event): event is Extract<AgentEvent, { type: 'tool-start' }> => (
                event.type === 'tool-start' && event.call.type === 'update_stub_fixture' && event.call.approval?.kind === 'timed'
            ));
            expect(pendingEvent?.call).toMatchObject({ status: 'pending', approval: { kind: 'timed' } });
            const update = runtime.snapshot.messages.flatMap(message => message.blocks)
                .find(block => block.kind === 'tool' && block.type === 'update_stub_fixture');
            await vi.waitFor(() => expect(update?.status).toBe('done'));
            expect(update).toMatchObject({ status: 'done', controlAction: { kind: 'automated_approval' } });
            expect(JSON.parse(await readFile(fixturePath, 'utf8')).operationCount).toBe(1);
            runtime.dispose();
        } finally { await rm(root, { recursive: true, force: true }); }
    });
});
