// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../electron/agent/AgentRuntime';
import { ToolRegistry } from '../electron/agent/ToolRegistry';
import { toolAvailableToProvider } from '../electron/agent/ApprovalPolicy';
import { LocalMessageInterface } from '../electron/agent/VercelAgent';
import type { AgentEvent, SessionSnapshot, ToolBlockDTO } from '../shared/agentProtocol';
import responses from '../shared/agentStubResponses.json';

const question = {
    question: 'How dense should the log rows be?',
    options: [
        { id: 'compact', label: 'Compact' },
        { id: 'detailed', label: 'Detailed', detail: 'Show all metadata.' },
    ],
};

function queueQuestion(runtime: AgentRuntime, input: unknown = question) {
    return (runtime as unknown as {
        handleToolCalls(calls: { id: string; name: string; input: unknown }[], signal: AbortSignal): Promise<void>;
    }).handleToolCalls([{ id: 'question-1', name: 'ask_question', input }], new AbortController().signal);
}

function questionBlock(runtime: AgentRuntime): ToolBlockDTO {
    return runtime.snapshot.messages.flatMap(message => message.blocks)
        .find((block): block is ToolBlockDTO => block.kind === 'tool' && block.type === 'ask_question')!;
}

describe('ask_question tool', () => {
    it('is advertised in Ask mode and remains pending without an approval timer', async () => {
        const tools = new ToolRegistry(process.cwd());
        const definition = tools.get('ask_question')!;
        expect(toolAvailableToProvider('ask', definition)).toBe(true);
        expect(tools.definitions().some(tool => tool.function.name === 'ask_question')).toBe(true);

        const events: AgentEvent[] = [];
        const runtime = new AgentRuntime('question-session', event => events.push(structuredClone(event)), tools);
        runtime.setPaused(true);
        await queueQuestion(runtime);

        expect(questionBlock(runtime)).toMatchObject({ status: 'pending', input: question, subject: question.question });
        expect(questionBlock(runtime).approval).toBeUndefined();
        expect(events.some(event => event.type === 'tool-start' && event.call.type === 'ask_question')).toBe(true);
        runtime.dispose();
    });

    it('accepts a choice and preserves the answer across session reload', async () => {
        const tools = new ToolRegistry(process.cwd());
        const first = new AgentRuntime('question-session', () => undefined, tools);
        first.setPaused(true);
        await queueQuestion(first);
        const snapshot = structuredClone(first.snapshot) as SessionSnapshot;
        first.dispose();

        const restored = new AgentRuntime('question-session', () => undefined, tools, snapshot);
        expect(restored.snapshot.state).toBe('WAITING_FOR_CONTROL');
        restored.setPaused(true);
        await restored.respond({ sessionId: 'question-session', responses: {
            'question-1': { kind: 'answered', answer: { kind: 'option', optionId: 'detailed' } },
        } });
        expect(questionBlock(restored)).toMatchObject({
            status: 'done',
            controlAction: { kind: 'answered', answer: { kind: 'option', optionId: 'detailed' } },
        });
        expect(JSON.parse(questionBlock(restored).output!)).toEqual({
            status: 'answered', answer: { kind: 'option', optionId: 'detailed' }, label: 'Detailed',
        });
        await restored.respond({ sessionId: 'question-session', responses: {
            'question-1': { kind: 'skipped' },
        } });
        expect(questionBlock(restored).status).toBe('done');
        restored.dispose();
    });

    it('rejects an unknown option without settling, then accepts free text', async () => {
        const runtime = new AgentRuntime('question-session', () => undefined, new ToolRegistry(process.cwd()));
        runtime.setPaused(true);
        await queueQuestion(runtime);
        await expect(runtime.respond({ sessionId: 'question-session', responses: {
            'question-1': { kind: 'answered', answer: { kind: 'option', optionId: 'missing' } },
        } })).rejects.toThrow('Unknown question option');
        expect(questionBlock(runtime).status).toBe('pending');
        await runtime.respond({ sessionId: 'question-session', responses: {
            'question-1': { kind: 'answered', answer: { kind: 'text', text: '  Balanced  ' } },
        } });
        expect(JSON.parse(questionBlock(runtime).output!)).toMatchObject({
            status: 'answered', answer: { kind: 'text', text: 'Balanced' },
        });
        runtime.dispose();
    });

    it('skips an unanswered question when a new user message arrives', async () => {
        const runtime = new AgentRuntime('question-session', () => undefined, new ToolRegistry(process.cwd()));
        runtime.setPaused(true);
        await queueQuestion(runtime);
        await runtime.send({ sessionId: 'question-session', text: 'Continue without my preference.', steeringPolicy: 'QUEUE' });
        expect(questionBlock(runtime).status).toBe('skipped');
        expect(questionBlock(runtime).controlAction).toMatchObject({ kind: 'skipped' });
        expect(runtime.snapshot.messages.some(message => message.role === 'user')).toBe(true);
        const providerMessages = new LocalMessageInterface().transformForSend(runtime.snapshot.messages);
        expect(JSON.stringify(providerMessages)).toContain('skipped');
        runtime.dispose();
    });

    it('records explicit Skip as no answer', async () => {
        const runtime = new AgentRuntime('question-session', () => undefined, new ToolRegistry(process.cwd()));
        runtime.setPaused(true);
        await queueQuestion(runtime);
        await runtime.respond({ sessionId: 'question-session', responses: { 'question-1': { kind: 'skipped' } } });

        expect(questionBlock(runtime).status).toBe('skipped');
        expect(JSON.parse(questionBlock(runtime).output!)).toEqual({ status: 'skipped', reason: 'Skipped by user.' });
        const providerMessages = new LocalMessageInterface().transformForSend(runtime.snapshot.messages);
        const serialized = JSON.stringify(providerMessages);
        expect(serialized).toContain('How dense should the log rows be?');
        expect(serialized).not.toContain('optionId');
        runtime.dispose();
    });

    it('settles malformed questions as errors instead of leaving pending controls', async () => {
        const runtime = new AgentRuntime('question-session', () => undefined, new ToolRegistry(process.cwd()));
        runtime.setPaused(true);
        await queueQuestion(runtime, { question: 'Choose', options: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }] });
        expect(questionBlock(runtime).status).toBe('error');
        expect(questionBlock(runtime).output).toContain('unique');
        runtime.dispose();
    });

    it('raises the Q&A fixture turn in the desktop testing stub and resumes after an answer', async () => {
        const previousMode = process.env.AGENT_MODE;
        process.env.AGENT_MODE = 'stub';
        vi.useFakeTimers();
        try {
            const runtime = new AgentRuntime('question-session', () => undefined, new ToolRegistry(process.cwd(), false));
            for (let index = 0; index < responses.length; index++) {
                await runtime.send({ sessionId: 'question-session', text: `turn ${index}`, steeringPolicy: 'QUEUE' });
                await vi.runAllTimersAsync();
            }
            expect(questionBlock(runtime).status).toBe('pending');
            const id = questionBlock(runtime).toolCallId;
            await runtime.respond({ sessionId: 'question-session', responses: {
                [id]: { kind: 'answered', answer: { kind: 'option', optionId: 'balanced' } },
            } });
            await vi.runAllTimersAsync();
            expect(runtime.snapshot.state).toBe('IDLE');
            expect(questionBlock(runtime).status).toBe('done');
            expect(runtime.snapshot.messages.flatMap(message => message.blocks)
                .some(block => block.kind === 'text' && block.content.includes('I\'ll use that preference'))).toBe(true);
            runtime.dispose();
        } finally {
            vi.useRealTimers();
            if (previousMode == null) delete process.env.AGENT_MODE;
            else process.env.AGENT_MODE = previousMode;
        }
    });
});
