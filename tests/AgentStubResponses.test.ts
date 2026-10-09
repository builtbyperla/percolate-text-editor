import { afterEach, describe, expect, it, vi } from 'vitest';
import responses from '../shared/agentStubResponses.json';
import { agentStubResponse } from '../shared/agentStubResponses';
import { DemoAgentClient } from '../src/agent/DemoAgentClient';
import type { AgentEvent } from '../shared/agentProtocol';

describe('shared agent stub responses', () => {
    afterEach(() => vi.useRealTimers());

    async function skipOpeningFileEdit(client: DemoAgentClient, sessionId: string) {
        await client.send({ sessionId, text: 'first turn', steeringPolicy: 'QUEUE' });
        await client.stop(sessionId);
    }

    it('loops back to the first JSON response', () => {
        expect(agentStubResponse(0)).toBe(responses[0].response);
        expect(agentStubResponse(responses.length)).toBe(responses[0].response);
    });

    it('shows attachments in localhost and carries them through the faux send path', async () => {
        const client = new DemoAgentClient('interactive');
        expect((await client.attachmentSupport())?.mediaTypes).toContain('application/pdf');
        expect(await new DemoAgentClient('passive').attachmentSupport()).toBeUndefined();

        const session = await client.createSession();
        const events: AgentEvent[] = [];
        client.onEvent(session.id, event => events.push(event));
        const file = { name: 'report.pdf', mediaType: 'application/pdf', size: 3, data: 'YWJj' };
        await client.send({ sessionId: session.id, text: '', attachments: [file], steeringPolicy: 'QUEUE' });

        expect(events.find(event => event.type === 'text-start' && event.role === 'user')).toMatchObject({ attachments: [file] });
        expect((await client.loadSession(session.id)).messages[0].blocks[0]).toMatchObject({ attachments: [file] });
        await client.stop(session.id);
    });

    it('shows a live file edit block in the first browser stub response', async () => {
        vi.useFakeTimers();
        const client = new DemoAgentClient('interactive');
        const session = await client.createSession();
        const events: AgentEvent[] = [];
        client.onEvent(session.id, event => events.push(event));

        await client.send({ sessionId: session.id, text: 'Check this file', steeringPolicy: 'QUEUE' });
        const pending = (await client.loadSession(session.id)).messages.flatMap(message => message.blocks)
            .find(block => block.kind === 'tool' && block.type === 'write_file');
        if (pending?.kind !== 'tool' || !pending.fileEdit) throw new Error('Expected a file edit stub block.');
        expect(pending).toMatchObject({ status: 'pending', input: { path: 'tests/fixtures/agent-file-edit-preview.txt' } });
        expect(await client.readFileEdit(session.id, pending.fileEdit.artifactId)).toMatchObject({
            after: 'Alpha\nBeta (agent proposal)\nGamma\n', settled: false,
        });

        await client.updateFileEdit(session.id, pending.fileEdit.artifactId, 0, 'Alpha\nBeta (reviewer)\nGamma\n');
        await client.respond({ sessionId: session.id, responses: { [pending.toolCallId]: { kind: 'approved' } } });
        await vi.runAllTimersAsync();
        expect(events.find(event => event.type === 'tool-end' && event.response.toolCallId === pending.toolCallId))
            .toMatchObject({ response: { status: 'done', userModified: true } });
        expect(await client.readFileEdit(session.id, pending.fileEdit.artifactId)).toMatchObject({ settled: true, userModified: true });
    });

    it('auto-approves the browser file edit after the Timer-mode countdown', async () => {
        vi.useFakeTimers();
        const client = new DemoAgentClient('interactive');
        const session = await client.createSession();
        await client.setApprovalMode(session.id, 'timer-quick');

        await client.send({ sessionId: session.id, text: 'Update this file', steeringPolicy: 'QUEUE' });
        let edit = (await client.loadSession(session.id)).messages.flatMap(message => message.blocks)
            .find(block => block.kind === 'tool' && block.type === 'write_file');
        expect(edit).toMatchObject({ status: 'pending', approval: { kind: 'timed' } });

        await vi.advanceTimersByTimeAsync(3_000);
        edit = (await client.loadSession(session.id)).messages.flatMap(message => message.blocks)
            .find(block => block.kind === 'tool' && block.type === 'write_file');
        expect(edit).toMatchObject({ status: 'done', controlAction: { kind: 'automated_approval' } });
        await client.stop(session.id);
    });

    it('drives successive browser-local replies from the looped fixture', async () => {
        vi.useFakeTimers();
        const client = new DemoAgentClient();
        const session = await client.createSession();
        const events: AgentEvent[] = [];
        client.onEvent(session.id, event => events.push(event));

        for (let index = 0; index <= responses.length; index++) {
            await client.send({ sessionId: session.id, text: `turn ${index}`, steeringPolicy: 'QUEUE' });
            const snapshot = await client.loadSession(session.id);
            if (snapshot.state === 'WAITING_FOR_CONTROL') {
                const pending = snapshot.messages.flatMap(message => message.blocks)
                    .find(block => block.kind === 'tool' && block.status === 'pending');
                if (pending?.kind === 'tool') await client.respond({ sessionId: session.id, responses: {
                    [pending.toolCallId]: pending.type === 'ask_question'
                        ? { kind: 'answered', answer: { kind: 'option', optionId: 'compact' } }
                        : { kind: 'approved' },
                } });
            }
            await vi.runAllTimersAsync();
        }

        const assistantIds = events
            .filter((event): event is Extract<AgentEvent, { type: 'text-start' }> => event.type === 'text-start' && event.role === 'assistant')
            .map(event => event.messageId);
        const replies = assistantIds.map(messageId => events
            .filter((event): event is Extract<AgentEvent, { type: 'text-delta' }> => event.type === 'text-delta' && event.messageId === messageId)
            .map(event => event.delta).join(''));

        expect(replies[0]).toBe(responses[0].response);
        expect(replies.at(-1)).toBe(responses[0].response);
        expect(events.some(event => event.type === 'tool-start' && event.call.type === 'read')).toBe(true);
        expect(events.some(event => event.type === 'tool-end' && event.response.type === 'run')).toBe(true);
    });

    it('makes browser-local tools actionable without performing a mutation', async () => {
        vi.useFakeTimers();
        const client = new DemoAgentClient('interactive');
        const session = await client.createSession();
        await skipOpeningFileEdit(client, session.id);
        const events: AgentEvent[] = [];
        client.onEvent(session.id, event => events.push(event));

        await client.send({ sessionId: session.id, text: 'check this', steeringPolicy: 'QUEUE' });
        const pending = events.find((event): event is Extract<AgentEvent, { type: 'tool-start' }> => event.type === 'tool-start' && event.call.status === 'pending');
        expect(pending?.call.type).toBe('run');
        expect((await client.loadSession(session.id)).state).toBe('WAITING_FOR_CONTROL');

        await client.respond({ sessionId: session.id, responses: { [pending!.call.toolCallId]: { kind: 'approved' } } });
        await vi.runAllTimersAsync();

        const completed = events.find(event => event.type === 'tool-end' && event.response.toolCallId === pending!.call.toolCallId);
        expect(completed?.type === 'tool-end' && completed.response.status).toBe('done');
        expect((await client.loadSession(session.id)).state).toBe('IDLE');
    });

    it('includes one answerable Q&A turn in the browser demo fixture', async () => {
        vi.useFakeTimers();
        const client = new DemoAgentClient('interactive');
        const session = await client.createSession();
        await client.setApprovalMode(session.id, 'operate');

        for (let index = 0; index < responses.length; index++) {
            await client.send({ sessionId: session.id, text: `turn ${index}`, steeringPolicy: 'QUEUE' });
        }
        const pending = (await client.loadSession(session.id)).messages.flatMap(message => message.blocks)
            .find(block => block.kind === 'tool' && block.type === 'ask_question');
        expect(pending).toMatchObject({ status: 'pending', input: { question: 'How much detail should each log row show?' } });
        if (pending?.kind !== 'tool') throw new Error('Expected a question tool block.');

        await client.respond({ sessionId: session.id, responses: {
            [pending.toolCallId]: { kind: 'answered', answer: { kind: 'option', optionId: 'balanced' } },
        } });
        await vi.runAllTimersAsync();
        const settled = (await client.loadSession(session.id)).messages.flatMap(message => message.blocks)
            .find(block => block.id === pending.id);
        expect(settled).toMatchObject({ status: 'done', controlAction: { kind: 'answered', answer: { kind: 'option', optionId: 'balanced' } } });
        expect((await client.loadSession(session.id)).state).toBe('IDLE');
    });

    it('supports Operate policy in the browser demo client', async () => {
        vi.useFakeTimers();
        const client = new DemoAgentClient('interactive');

        const operate = await client.createSession();
        await skipOpeningFileEdit(client, operate.id);
        await client.setApprovalMode(operate.id, 'operate');
        await client.send({ sessionId: operate.id, text: 'operate', steeringPolicy: 'QUEUE' });
        const operateRun = (await client.loadSession(operate.id)).messages.flatMap(message => message.blocks)
            .find(block => block.kind === 'tool' && block.type === 'run');
        expect(operateRun).toMatchObject({ status: 'done', controlAction: { kind: 'automated_approval' } });
        await client.stop(operate.id);
    });

    it('records compaction as a non-streamed system event with hidden provider context', async () => {
        const client = new DemoAgentClient('interactive');
        const session = await client.createSession();
        const events: AgentEvent[] = [];
        client.onEvent(session.id, event => events.push(event));
        await client.send({ sessionId: session.id, text: 'first turn', steeringPolicy: 'QUEUE' });
        await client.stop(session.id);
        events.length = 0;

        const compacted = await client.compact(session.id);
        const block = compacted.messages.at(-1)?.blocks[0];
        expect(block).toMatchObject({ kind: 'text', origin: 'system', content: expect.stringContaining('Context compacted') });
        expect(block?.kind === 'text' && block.contextContent).toContain('first turn');
        expect(events).toEqual([]);
    });

    it('lets Stop settle an Ask-mode browser approval as skipped', async () => {
        const client = new DemoAgentClient('interactive');
        const session = await client.createSession();
        await skipOpeningFileEdit(client, session.id);

        await client.send({ sessionId: session.id, text: 'ask first', steeringPolicy: 'QUEUE' });
        expect((await client.loadSession(session.id)).state).toBe('WAITING_FOR_CONTROL');
        await client.stop(session.id);

        const stopped = await client.loadSession(session.id);
        const run = stopped.messages.flatMap(message => message.blocks)
            .find(block => block.kind === 'tool' && block.type === 'run');
        expect(run).toMatchObject({ status: 'skipped', controlAction: { kind: 'skipped' } });
        expect(stopped.state).toBe('IDLE');
    });

    it('auto-approves Timer-mode demo tools and lets Stop win the deadline race', async () => {
        vi.useFakeTimers();
        const client = new DemoAgentClient('interactive');
        const quick = await client.createSession();
        await skipOpeningFileEdit(client, quick.id);
        await client.setApprovalMode(quick.id, 'timer-quick');
        await client.send({ sessionId: quick.id, text: 'quick run', steeringPolicy: 'QUEUE' });

        let run = (await client.loadSession(quick.id)).messages.flatMap(message => message.blocks)
            .find(block => block.kind === 'tool' && block.type === 'run');
        expect(run).toMatchObject({ status: 'pending', approval: { kind: 'timed' } });
        await vi.advanceTimersByTimeAsync(3_000);
        run = (await client.loadSession(quick.id)).messages.flatMap(message => message.blocks)
            .find(block => block.kind === 'tool' && block.type === 'run');
        expect(run).toMatchObject({ status: 'done', controlAction: { kind: 'automated_approval' } });
        await client.stop(quick.id);

        const stopped = await client.createSession();
        await skipOpeningFileEdit(client, stopped.id);
        await client.setApprovalMode(stopped.id, 'timer-quick');
        await client.send({ sessionId: stopped.id, text: 'slow run', steeringPolicy: 'QUEUE' });
        await client.stop(stopped.id);
        await vi.advanceTimersByTimeAsync(3_000);
        const stoppedRun = (await client.loadSession(stopped.id)).messages.flatMap(message => message.blocks)
            .find(block => block.kind === 'tool' && block.type === 'run');
        expect(stoppedRun).toMatchObject({ status: 'skipped', controlAction: { kind: 'skipped' } });
    });
});
