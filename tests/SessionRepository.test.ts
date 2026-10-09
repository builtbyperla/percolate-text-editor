// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SessionRepository } from '../electron/agent/SessionRepository';
import type { SessionSnapshot } from '../shared/agentProtocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function snapshot(): SessionSnapshot {
    return {
        id: 'one', agent: 'stub', displayName: 'Persisted', archived: false, state: 'IDLE', createdAt: 1, updatedAt: 2,
        steeringPolicy: 'APPEND', approvalMode: 'ask',
        messages: [{ id: 'message', role: 'user', status: 'done', createdAt: 2, blocks: [{ id: 'block', kind: 'text', role: 'user', content: 'hello', status: 'done' }] }],
    };
}

describe('SessionRepository', () => {
    it('atomically saves and hydrates sessions and messages', () => {
        const repository = new SessionRepository(':memory:'); const value = snapshot();
        repository.save(value);
        expect(repository.list()).toHaveLength(1);
        expect(repository.load(value.id)).toEqual(value);
        repository.close();
    });

    it('forks into an independent session with copied content', () => {
        const repository = new SessionRepository(':memory:'); const value = snapshot(); repository.save(value);
        const fork = repository.fork(value.id);
        expect(fork.id).not.toBe(value.id); expect(fork.displayName).toBe('Persisted (2)');
        expect(fork.messages[0].blocks[0]).toMatchObject({ kind: 'text', content: 'hello' });
        fork.messages[0].blocks[0].status = 'interrupted';
        expect(repository.load(value.id)?.messages[0].blocks[0].status).toBe('done');
        repository.close();
    });

    it('numbers repeated forks and keeps archived sessions out of the list', () => {
        const repository = new SessionRepository(':memory:'); const value = snapshot(); repository.save(value);
        expect(repository.fork(value.id).displayName).toBe('Persisted (2)');
        expect(repository.fork(value.id).displayName).toBe('Persisted (3)');
        repository.rename(value.id, 'Renamed');
        expect(repository.load(value.id)?.displayName).toBe('Renamed');
        repository.archive(value.id);
        expect(repository.list().map(session => session.displayName).sort()).toEqual(['Persisted (2)', 'Persisted (3)']);
        expect(repository.load(value.id)?.archived).toBe(true);
        repository.close();
    });

    it('persists a compaction cutoff without deleting transcript history', () => {
        const repository = new SessionRepository(':memory:'); const value = snapshot();
        value.messages.push({ id: 'summary', role: 'assistant', status: 'done', createdAt: 3, blocks: [{ id: 'summary', kind: 'text', role: 'assistant', content: 'summary', status: 'done' }] });
        value.contextCutoff = 1; repository.save(value);

        expect(repository.load(value.id)).toMatchObject({ contextCutoff: 1, messages: [{ id: 'message' }, { id: 'summary' }] });
        repository.close();
    });

    it('persists and forks the selected agent mode', () => {
        const repository = new SessionRepository(':memory:'); const value = snapshot();
        value.approvalMode = 'operate'; repository.save(value);

        expect(repository.load(value.id)?.approvalMode).toBe('operate');
        expect(repository.fork(value.id).approvalMode).toBe('operate');
        repository.close();
    });

    it('forks only through the selected message', () => {
        const repository = new SessionRepository(':memory:'); const value = snapshot();
        value.messages.push(
            { id: 'second', role: 'assistant', status: 'done', createdAt: 3, blocks: [{ id: 'second-block', kind: 'text', role: 'assistant', content: 'answer', status: 'done' }] },
            { id: 'third', role: 'user', status: 'done', createdAt: 4, blocks: [{ id: 'third-block', kind: 'text', role: 'user', content: 'later', status: 'done' }] },
        );
        repository.save(value);

        const fork = repository.fork(value.id, 'second-block');

        expect(fork.messages).toHaveLength(2);
        expect(fork.messages.map(message => message.blocks[0].kind === 'text' ? message.blocks[0].content : '')).toEqual(['hello', 'answer']);
        expect(() => repository.fork(value.id, 'missing')).toThrow('selected message');
        repository.close();
    });

    it('recovers stale active work without discarding pending approvals', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'percolate-sessions-'));
        const filename = path.join(directory, 'sessions.sqlite');
        try {
            const repository = new SessionRepository(filename);
            const stale = snapshot(); stale.state = 'CALLING_AGENT';
            stale.messages[0].role = 'assistant'; stale.messages[0].status = 'streaming';
            stale.messages[0].blocks[0].role = 'assistant'; stale.messages[0].blocks[0].status = 'streaming';
            const pending = snapshot(); pending.id = 'pending'; pending.state = 'WAITING_FOR_CONTROL';
            pending.messages = [{
                id: 'approval-message', role: 'assistant', status: 'done', createdAt: 5,
                blocks: [{
                    id: 'approval', kind: 'tool', role: 'assistant', toolCallId: 'approval', type: 'write_file', status: 'pending',
                    approval: { kind: 'timed', requestedAt: 5, autoApproveAt: 10_000 },
                }],
            }];
            repository.save(stale); repository.save(pending); repository.close();

            const reopened = new SessionRepository(filename);
            expect(reopened.load(stale.id)).toMatchObject({ state: 'IDLE', messages: [{ status: 'interrupted', blocks: [{ status: 'interrupted' }] }] });
            expect(reopened.load(pending.id)).toMatchObject({
                state: 'WAITING_FOR_CONTROL',
                messages: [{ blocks: [{ status: 'pending', approval: { kind: 'timed', requestedAt: 5, autoApproveAt: 10_000 } }] }],
            });
            reopened.close();
        } finally { await rm(directory, { recursive: true, force: true }); }
    });

    it('migrates legacy approval modes to Ask', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'percolate-session-mode-'));
        const filename = path.join(directory, 'sessions.sqlite');
        try {
            const repository = new SessionRepository(filename);
            for (const mode of ['ask_mutations', 'plan', 'slow', 'quick']) {
                const legacy = snapshot();
                legacy.id = mode;
                legacy.messages = [];
                legacy.approvalMode = mode as SessionSnapshot['approvalMode'];
                repository.save(legacy);
            }
            repository.close();

            const reopened = new SessionRepository(filename);
            for (const mode of ['ask_mutations', 'plan', 'slow']) {
                expect(reopened.load(mode)?.approvalMode).toBe('ask');
            }
            expect(reopened.load('quick')?.approvalMode).toBe('timer-quick');
            reopened.close();
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
});
