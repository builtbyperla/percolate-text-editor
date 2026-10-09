import { describe, it, expect, vi } from 'vitest';
import { ContextItem, ContextView } from '../src/annotation/ContextItem';
import { FixedTextDataModel } from '../src/textmodel/FixedTextDataModel';
import { contextRegistry } from '../src/interactions/ContextRegistry';
import { sourceContextRegistry } from '../src/interactions/SourceContextRegistry';
import { userSettings } from '../src/UserSettings';
import {
    prepareEvidenceSnapshot, createSingleSnapshot,
} from '../src/interactions/EvidenceSnapshotBuilder';
import { EvidenceTree, setEvidenceSource } from '../src/interactions/EvidenceTree';
import { ChatFlow } from '../src/chat/ChatFlow';
import { TextBlock } from '../src/chat/ChatBlockModel';
import type { AgentClient } from '../src/agent/AgentClient';
import type { AgentEvent, ControlResponsesDTO, SessionSnapshot, UserInteractionDTO } from '../shared/agentProtocol';
import { withRoot } from './reactive';

// The send seam has three jobs: ASSEMBLE a snapshot from included items (a value
// copy), CLEAR the consumed highlights on press, and QUEUE a send pressed while a
// reply streams (draining as one combined turn when it settles). These tests pair
// the unit level (assembly) with the intended behaviour (clear-on-press, queue).

// A ContextView tagged with a sourceId so its items group together. clear() is a
// spy so a test can assert whether the OLD teardown path fired (it must not) — it
// is no longer part of ContextView, which is exactly the point that test makes.
function owner(sourceId: string, fullText = 'alpha beta gamma', contextPresentation: 'text' | 'code' = 'text'): ContextView & { clear: ReturnType<typeof vi.fn> } {
    const model = new FixedTextDataModel(fullText);
    return {
        sourceId,
        contextPresentation,
        label: `WHOLE:${sourceId}`,
        getDataSource: () => model,
        scrollToItem: () => {},
        getSubViews: () => [],
        clear: vi.fn(),
    };
}

// A registered slice (ranged) item, routed through the SOURCE registry so it
// lands in both the flat registry (evidence) and its per-source bucket (views) —
// the same path a real highlight takes, which is what clear-on-press must undo.
function slice(o: ContextView, start: number, end: number): ContextItem {
    const item = new ContextItem(o);
    item.setRange(start, end);
    sourceContextRegistry.add(item);
    return item;
}

class FakeAgentClient implements AgentClient {
    readonly available = true;
    readonly sent: UserInteractionDTO[] = [];
    rejectSend = false;
    private listener?: (event: AgentEvent) => void;
    private readonly session: SessionSnapshot = { id: 'session-1', agent: 'fake', displayName: 'Test', archived: false, state: 'IDLE', createdAt: 1, updatedAt: 1, messages: [], steeringPolicy: 'QUEUE', approvalMode: 'ask' };
    async createSession() { return this.session; }
    async listSessions() { return [this.session]; }
    async loadSession() { return this.session; }
    async forkSession() { return this.session; }
    async renameSession(_id: string, displayName: string) { this.session.displayName = displayName; return this.session; }
    async archiveSession() { this.session.archived = true; }
    onEvent(_id: string, cb: (event: AgentEvent) => void) { this.listener = cb; return () => { this.listener = undefined; }; }
    async send(input: UserInteractionDTO): Promise<{ accepted: true }> {
        if (this.rejectSend) throw new Error('send rejected');
        this.sent.push(input);
        const id = `user-${this.sent.length}`;
        this.listener?.({ type: 'text-start', sessionId: input.sessionId, messageId: id, role: 'user', evidence: input.evidence, attachments: input.attachments });
        this.listener?.({ type: 'text-delta', sessionId: input.sessionId, messageId: id, delta: input.text });
        this.listener?.({ type: 'text-end', sessionId: input.sessionId, messageId: id, status: 'done' });
        return { accepted: true };
    }
    async respond(_input: ControlResponsesDTO) { return { accepted: true } as const; }
    async cancel() {}
    async stop() {}
    async undo() {}
    async contextStats() { return { totalMessages: 0, activeMessages: 0, compactedMessages: 0, estimatedTokens: 0 }; }
    async compact() { return this.session; }
    async setPaused() {}
    async setApprovalMode(_sessionId: string, mode: SessionSnapshot['approvalMode']) { this.session.approvalMode = mode; }
    emit(event: AgentEvent) { this.listener?.(event); }
}

function reset() {
    for (const item of [...contextRegistry.items()]) sourceContextRegistry.remove(item);
    userSettings.evidence.setIncludeFullSource(true);
    // Stand in for the evidence pane: ChatFlow resolves this at send time. A
    // fresh tree per reset keeps virtual parents from leaking between tests.
    const tree = new EvidenceTree();
    setEvidenceSource({ groups: () => tree.group(contextRegistry.items()) });
}

// Group the registry's current items through a FRESH tree, so each call starts
// with an empty virtual-parent cache (no stand-ins carried between tests).
function currentGroups() {
    return new EvidenceTree().group(contextRegistry.items());
}

// ---------------------------------------------------------------------------
// Unit: assembly is a mapping, not a walk
// ---------------------------------------------------------------------------

describe('prepareEvidenceSnapshot', () => {
    it('captures numbered source lines around a selection and the start of a whole file', () => {
        withRoot(() => {
            reset();
            const source = owner('Editor', 'try:\nresult = await run()\nresults.append(result)\nreturn results', 'code');
            const selected = slice(source, 5, 25);
            userSettings.evidence.setIncludeFullSource(true);

            const { groups } = prepareEvidenceSnapshot(currentGroups());
            expect(groups[0].items[0].preview).toEqual({
                startLine: 1,
                lines: ['try:', 'result = await run()', 'results.append(result)'],
                selectedStartLine: undefined,
                selectedEndLine: undefined,
            });
            expect(groups[0].items[1].preview).toEqual({
                startLine: 1,
                lines: ['try:', 'result = await run()', 'results.append(result)'],
                selectedStartLine: 2,
                selectedEndLine: 2,
            });
            expect(groups[0].items.map(item => item.presentation)).toEqual(['code', 'code']);
            expect(selected.getPreviewText()).toBe('result = await run()');
        });
    });

    it('marks a rendered text selection for plain multiline display', () => {
        withRoot(() => {
            reset();
            const source = owner('Markdown', 'First paragraph\nSecond paragraph');
            const selected = slice(source, 0, source.getDataSource().displayText().length);
            const { groups } = prepareEvidenceSnapshot(currentGroups());
            const snapshot = groups[0].items.find(item => item.type === 'segment');
            expect(snapshot?.presentation).toBe('text');
            expect(snapshot?.label).toBe('First paragraph\nSecond paragraph');
            expect(selected.getPreviewText()).toBe(snapshot?.label);
        });
    });

    it('assembles one group per source with only included slices, and reports them consumed', () => {
        withRoot(() => {
            reset();
            const md = owner('Markdown');
            const editor = owner('Editor');
            const a = slice(md, 0, 5);
            const b = slice(md, 6, 10);
            const c = slice(editor, 0, 5);
            b.setIncluded(false); // excluded → neither shipped nor consumed
            // Isolate the slices: no whole-source virtual parent riding along.
            userSettings.evidence.setIncludeFullSource(false);

            const { groups, consumed } = prepareEvidenceSnapshot(currentGroups());

            expect(groups.map(g => g.sourceId)).toEqual(['Markdown', 'Editor']);
            expect(groups[0].items).toHaveLength(1); // a only, not b
            expect(groups[1].items).toHaveLength(1); // c
            expect(consumed).toContain(a);
            expect(consumed).toContain(c);
            expect(consumed).not.toContain(b);
        });
    });

    it('ships a derived virtual parent when include-full-source is on, but never consumes it', () => {
        withRoot(() => {
            reset();
            const md = owner('Markdown');
            const s = slice(md, 0, 5); // slice only → parent is a virtual stand-in

            userSettings.evidence.setIncludeFullSource(true);
            const on = prepareEvidenceSnapshot(currentGroups());
            // Parent (WHOLE:Markdown) + slice both ship.
            expect(on.groups[0].items).toHaveLength(2);
            // The virtual parent isn't in the registry, so it isn't consumed — only
            // the real slice is (it has a highlight to clear).
            expect(on.consumed).toEqual([s]);

            userSettings.evidence.setIncludeFullSource(false);
            const off = prepareEvidenceSnapshot(currentGroups());
            expect(off.groups[0].items).toHaveLength(1); // slice only
            expect(off.consumed).toEqual([s]);
        });
    });

    it('uses the full diff payload for an included source beside a diff selection', () => {
        withRoot(() => {
            reset();
            const source = owner('diff:proposal::new', 'after text', 'code');
            const diff = { kind: 'diff', side: 'new', diff: { oldText: 'before text', newText: 'after text', hunks: [] } };
            source.additionalData = () => diff;
            const selected = new ContextItem(source, () => diff);
            selected.setRange(0, 5);
            sourceContextRegistry.add(selected);

            const on = prepareEvidenceSnapshot(currentGroups());
            expect(on.groups[0].items[0]).toMatchObject({ label: 'Full diff', additionalData: diff });
            expect(on.groups[0].items[0].preview).toBeUndefined();
            expect(on.groups[0].items[1].label).toBe('after');

            userSettings.evidence.setIncludeFullSource(false);
            const off = prepareEvidenceSnapshot(currentGroups());
            expect(off.groups[0].items).toHaveLength(1);
        });
    });

    it('drops a group whose items are all excluded', () => {
        withRoot(() => {
            reset();
            const md = owner('Markdown');
            const s = slice(md, 0, 5);
            s.setIncluded(false);
            userSettings.evidence.setIncludeFullSource(false); // parent won't ship either

            const { groups, consumed } = prepareEvidenceSnapshot(currentGroups());
            expect(groups).toHaveLength(0);
            expect(consumed).toHaveLength(0);
        });
    });
});

describe('createSingleSnapshot', () => {
    it('uses the composer full-source rule while always including the pointed-at item', () => {
        withRoot(() => {
            reset();
            const md = owner('Markdown');
            const s = slice(md, 0, 5);
            s.setIncluded(false); // still ships — the user pointed at it

            const { groups, consumed } = createSingleSnapshot(s, currentGroups());
            expect(groups).toHaveLength(1);
            expect(groups[0].sourceId).toBe('Markdown');
            expect(groups[0].items.map(item => item.type)).toEqual(['text', 'segment']);
            expect(consumed).toEqual([s]);

            userSettings.evidence.setIncludeFullSource(false);
            const withoutFullSource = createSingleSnapshot(s, currentGroups());
            expect(withoutFullSource.groups[0].items.map(item => item.type)).toEqual(['segment']);
            expect(withoutFullSource.consumed).toEqual([s]);
        });
    });

    it('uses and consumes a selected whole-source parent just like the composer', () => {
        withRoot(() => {
            reset();
            const md = owner('Markdown');
            const whole = new ContextItem(md);
            whole.register();
            const s = slice(md, 0, 5);

            const { groups, consumed } = createSingleSnapshot(s, currentGroups());
            expect(groups[0].items.map(item => item.type)).toEqual(['text', 'segment']);
            expect(consumed).toEqual([whole, s]);
            whole.deregister();
        });
    });
});

// ---------------------------------------------------------------------------
// Behaviour: the renderer assembles evidence and waits for backend acceptance.
// Steering and queue ownership are covered by AgentRuntime tests.
// ---------------------------------------------------------------------------

describe('ChatFlow send behaviour', () => {
    const userTurns = (flow: ChatFlow) =>
        flow.store.getBlocks().filter((b): b is TextBlock => b.kind === 'text' && b.role === 'user');

    it('clears consumed highlights after acceptance, via the source registry', async () => {
        await withRoot(async () => {
            reset();
            const md = owner('Markdown');
            const s = slice(md, 0, 5);
            expect(contextRegistry.items()).toContain(s);

            const client = new FakeAgentClient();
            const flow = new ChatFlow(client);
            await flow.initialize();
            expect(await flow.send('look at this')).toBe(true);

            // Both registries dropped it: evidence entry gone AND the view bucket
            // emptied (the fan clears the span everywhere).
            expect(contextRegistry.items()).not.toContain(s);
            expect(sourceContextRegistry.itemsFor('Markdown')).not.toContain(s);
            // The old flat-only teardown must NOT have run.
            expect(md.clear).not.toHaveBeenCalled();
        });
    });

    it('routes accepted backend events into the transcript with evidence', async () => {
        await withRoot(async () => {
            reset();
            const md = owner('Markdown');
            slice(md, 0, 5);

            const client = new FakeAgentClient();
            const flow = new ChatFlow(client);
            await flow.initialize();
            await flow.send('hello');

            const turns = userTurns(flow);
            expect(turns).toHaveLength(1);
            expect(turns[0].getContent()).toBe('hello');
            expect(turns[0].evidence?.[0].sourceId).toBe('Markdown');
        });
    });

    it('forwards sends while streaming with the selected steering policy', async () => {
        await withRoot(async () => {
            reset();
            const client = new FakeAgentClient();
            const flow = new ChatFlow(client);
            await flow.initialize();
            client.emit({ type: 'runtime-state', sessionId: 'session-1', state: 'CALLING_AGENT' });
            expect(flow.getStreaming()).toBe(true);
            flow.setSteeringPolicy('INTERRUPT');
            expect(await flow.send('replace the current request')).toBe(true);
            expect(client.sent[0].steeringPolicy).toBe('INTERRUPT');
        });
    });

    it('does not clear evidence or announce a turn when acceptance fails', async () => {
        await withRoot(async () => {
            reset();
            const md = owner('Markdown');
            const item = slice(md, 0, 5);
            const client = new FakeAgentClient(); client.rejectSend = true;
            const flow = new ChatFlow(client); await flow.initialize();
            const posted = vi.fn();
            flow.onTurnPosted = posted;
            expect(await flow.send('one')).toBe(false);
            expect(contextRegistry.items()).toContain(item);
            expect(posted).not.toHaveBeenCalled();
        });
    });

    it('sends selected context with an empty user message', async () => {
        await withRoot(async () => {
            reset();
            const md = owner('Markdown');
            const s = slice(md, 0, 5);

            const client = new FakeAgentClient();
            const flow = new ChatFlow(client);
            await flow.initialize();
            expect(await flow.send('   ')).toBe(true);
            expect(client.sent[0].text).toBe('');
            expect(client.sent[0].evidence?.[0].sourceId).toBe('Markdown');
            expect(contextRegistry.items()).not.toContain(s);
            expect(userTurns(flow)).toHaveLength(1);
        });
    });

    it('accepts a file-only message and keeps the attachment separate from evidence', async () => {
        await withRoot(async () => {
            reset();
            const client = new FakeAgentClient();
            const flow = new ChatFlow(client);
            await flow.initialize();
            const file = { name: 'report.pdf', mediaType: 'application/pdf', size: 3, data: 'YWJj' };
            expect(await flow.send('', undefined, [file])).toBe(true);
            expect(client.sent[0].attachments).toEqual([file]);
            expect(client.sent[0].evidence).toBeUndefined();
            expect(userTurns(flow)[0].attachments).toEqual([file]);
        });
    });

    it('returns false when both text and selected context are empty', async () => {
        await withRoot(async () => {
            reset();
            const client = new FakeAgentClient();
            const flow = new ChatFlow(client);
            await flow.initialize();

            expect(await flow.send('   ')).toBe(false);
            expect(client.sent).toHaveLength(0);
            expect(userTurns(flow)).toHaveLength(0);
        });
    });
});
