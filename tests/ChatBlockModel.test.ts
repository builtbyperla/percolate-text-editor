import { describe, it, expect, vi } from 'vitest';
import { ChatBlockStore, TextBlock, ToolBlock } from '../src/chat/ChatBlockModel';

// Tier-1: the applyUpdate funnel is the single mutation path for the transcript's
// block list. Streaming-delta is the general case; append-only is its degenerate
// form (one update, full content, done: true) — same path, no branch. Blocks are
// signal-owning class instances: the store routes each update to the block, which
// applies it to its own signals; the array signal changes only on creation. See
// plan "Block model" / project_chat_transcript memory.

describe('ChatBlockStore.applyUpdate — text blocks', () => {
    it('creates a text block on the first update for an unseen id', () => {
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 'a', role: 'assistant', delta: 'hello' });
        const block = store.getBlocks()[0] as TextBlock;
        expect(block.kind).toBe('text');
        expect(block.role).toBe('assistant');
        expect(block.getContent()).toBe('hello');
        expect(block.ownsVisual()).toBe(false); // not settled yet
    });

    it('appends subsequent deltas to the existing block', () => {
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 'a', role: 'assistant', delta: 'hel' });
        store.applyUpdate({ blockId: 'a', delta: 'lo' });
        store.applyUpdate({ blockId: 'a', delta: ' world' });
        const block = store.getBlocks()[0] as TextBlock;
        expect(block.getContent()).toBe('hello world');
        expect(block.ownsVisual()).toBe(false);
    });

    it('settles a block on done, without requiring a further delta', () => {
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 'a', delta: 'hi' });
        store.applyUpdate({ blockId: 'a', done: true });
        const block = store.getBlocks()[0] as TextBlock;
        expect(block.getContent()).toBe('hi');
        expect(block.ownsVisual()).toBe(true);
    });

    it('append-only is the degenerate case: one update, full content, done', () => {
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 'a', role: 'user', delta: 'the whole message', done: true });
        const block = store.getBlocks()[0] as TextBlock;
        expect(block.getContent()).toBe('the whole message');
        expect(block.ownsVisual()).toBe(true);
    });

    it('addressing is by blockId, not tail-only: an update can target any existing block', () => {
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 'a', delta: 'first' });
        store.applyUpdate({ blockId: 'b', delta: 'second' });
        // Patch the FIRST block after the tail exists — addressing foresight for a
        // future late-resolving tool call, not tail-only streaming.
        store.applyUpdate({ blockId: 'a', delta: '!', done: true });
        const [a, b] = store.getBlocks() as TextBlock[];
        expect(a.getContent()).toBe('first!');
        expect(a.ownsVisual()).toBe(true);
        expect(b.getContent()).toBe('second');
        expect(b.ownsVisual()).toBe(false);
    });

    it('preserves block order as ids first appear', () => {
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 'x' });
        store.applyUpdate({ blockId: 'y' });
        store.applyUpdate({ blockId: 'z' });
        expect(store.getBlocks().map(b => b.id)).toEqual(['x', 'y', 'z']);
    });

    it('lastId() reflects the tail block', () => {
        const store = new ChatBlockStore();
        expect(store.lastId()).toBeUndefined();
        store.applyUpdate({ blockId: 'a' });
        store.applyUpdate({ blockId: 'b' });
        expect(store.lastId()).toBe('b');
    });

    it('carries evidence only from the creating update', () => {
        const store = new ChatBlockStore();
        const evidence = [{ sourceId: 'Editor', label: 'Editor', items: [{ label: 'x', note: '', type: 'segment' }] }];
        store.applyUpdate({ blockId: 'a', role: 'user', delta: 'msg', evidence, done: true });
        expect((store.getBlocks()[0] as TextBlock).evidence).toBe(evidence);
    });

    it('the array signal is stable across deltas: only creation replaces it', () => {
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 'a', delta: 'x' });
        const before = store.getBlocks();
        const blockBefore = before[0];
        store.applyUpdate({ blockId: 'a', delta: 'y' });
        store.applyUpdate({ blockId: 'a', done: true });
        // Same array identity and same block instance — a delta mutates the block's
        // signal, it does not rebuild the list (the fine-grained-reactivity point).
        expect(store.getBlocks()).toBe(before);
        expect(store.getBlocks()[0]).toBe(blockBefore);
    });
});

describe('ChatBlockStore.applyUpdate — tool blocks', () => {
    it('a whole tool call arrives create+done in one update, already resolved', () => {
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 't', kind: 'tool', type: 'read', subject: 'src/x.py', done: true });
        const block = store.getBlocks()[0] as ToolBlock;
        expect(block.kind).toBe('tool');
        expect(block.type).toBe('read');
        expect(block.getSubject()).toBe('src/x.py');
        expect(block.getStatus()).toBe('done');
        expect(block.ownsVisual()).toBe(true); // tool blocks always own their card
    });

    it('a streamed tool: opens running, appends output, settles with a final patch', () => {
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 't', kind: 'tool', type: 'run', subject: 'pytest' });
        const block = store.getBlocks()[0] as ToolBlock;
        expect(block.getStatus()).toBe('running');

        store.applyUpdate({ blockId: 't', delta: 'PASSED\n' });
        store.applyUpdate({ blockId: 't', delta: '2 passed\n' });
        expect(block.getOutput()).toBe('PASSED\n2 passed\n');

        store.applyUpdate({ blockId: 't', done: true, subject: 'pytest · exit 0' });
        expect(block.getStatus()).toBe('done');
        expect(block.getSubject()).toBe('pytest · exit 0');
    });

    it('a failed tool settles with status error', () => {
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 't', kind: 'tool', type: 'run' });
        store.applyUpdate({ blockId: 't', done: true, status: 'error' });
        expect((store.getBlocks()[0] as ToolBlock).getStatus()).toBe('error');
    });

    it('preserves timed approval metadata through live updates and hydration', () => {
        const approval = { kind: 'timed' as const, requestedAt: 1_000, autoApproveAt: 4_000 };
        const store = new ChatBlockStore();
        store.applyUpdate({ blockId: 'timed', kind: 'tool', type: 'run', status: 'pending', approval });
        expect((store.getBlocks()[0] as ToolBlock).getApproval()).toEqual(approval);

        store.replaceAll([{ id: 'saved', kind: 'tool', role: 'assistant', toolCallId: 'saved', type: 'run', status: 'pending', approval }]);
        expect((store.getBlocks()[0] as ToolBlock).getApproval()).toEqual(approval);
    });
});

describe('ChatBlockStore.replaceAll', () => {
    it('runs transcript cleanup before hydrating a different session', () => {
        const store = new ChatBlockStore(); const cleanup = vi.fn(); store.setBeforeReplace(cleanup);
        store.replaceAll([{ id: 'loaded', kind: 'text', role: 'assistant', content: 'saved', status: 'done' }]);
        expect(cleanup).toHaveBeenCalledOnce();
        expect((store.getBlocks()[0] as TextBlock).getContent()).toBe('saved');
    });
});
