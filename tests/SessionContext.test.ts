// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../shared/agentProtocol';
import { activeContextMessages, compactContext, contextStats } from '../electron/agent/SessionContext';

function session(): SessionSnapshot {
    return {
        id: 'context', agent: 'stub', displayName: 'Context', archived: false, state: 'IDLE', createdAt: 1, updatedAt: 1,
        steeringPolicy: 'QUEUE', approvalMode: 'ask',
        messages: [
            { id: 'one', role: 'user', status: 'done', createdAt: 1, blocks: [{ id: 'one', kind: 'text', role: 'user', content: 'Inspect the parser.', status: 'done' }] },
            { id: 'two', role: 'assistant', status: 'done', createdAt: 2, blocks: [{ id: 'two', kind: 'tool', role: 'assistant', toolCallId: 'tool', type: 'read_file', subject: 'parser.ts', output: 'file contents', status: 'done' }] },
        ],
    };
}

describe('session context compaction', () => {
    it('summarizes the active context without changing the original messages', () => {
        const value = session();
        const summary = compactContext(value);

        expect(value.messages).toHaveLength(2);
        expect(summary.blocks[0]).toMatchObject({ kind: 'text', role: 'assistant', status: 'done', origin: 'system' });
        expect(summary.blocks[0].kind === 'text' && summary.blocks[0].content).toBe('Context compacted · 2 messages summarized · original transcript retained.');
        expect(summary.blocks[0].kind === 'text' && summary.blocks[0].contextContent).toContain('Inspect the parser');
        expect(summary.blocks[0].kind === 'text' && summary.blocks[0].contextContent).toContain('read_file [done]');
    });

    it('counts only messages after the persisted cutoff as provider context', () => {
        const value = session(); value.contextCutoff = 1;

        expect(activeContextMessages(value).map(message => message.id)).toEqual(['two']);
        expect(contextStats(value)).toMatchObject({ totalMessages: 2, activeMessages: 1, compactedMessages: 1 });
        expect(contextStats(value).estimatedTokens).toBeGreaterThan(0);
    });
});
