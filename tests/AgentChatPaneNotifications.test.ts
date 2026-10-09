import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentChatPane } from '../src/chat/AgentChatPane';
import type { AgentClient } from '../src/agent/AgentClient';
import type { AgentEvent, ControlResponsesDTO, SessionSnapshot, UserInteractionDTO } from '../shared/agentProtocol';

class NotificationClient implements AgentClient {
    readonly available = true;
    readonly responses: ControlResponsesDTO[] = [];
    readonly sends: UserInteractionDTO[] = [];
    readonly modeChanges: SessionSnapshot['approvalMode'][] = [];
    private listener?: (event: AgentEvent) => void;
    private readonly session: SessionSnapshot = {
        id: 'notifications', agent: 'fake', displayName: 'Test', archived: false, state: 'IDLE', createdAt: 1, updatedAt: 1,
        messages: [], steeringPolicy: 'QUEUE', approvalMode: 'ask',
    };

    async createSession() { return this.session; }
    async listSessions() { return [this.session]; }
    async loadSession() { return this.session; }
    async forkSession() { return this.session; }
    async renameSession(_id: string, displayName: string) { this.session.displayName = displayName; return this.session; }
    async archiveSession() { this.session.archived = true; }
    async send(input: UserInteractionDTO) { this.sends.push(input); return { accepted: true } as const; }
    async respond(input: ControlResponsesDTO) { this.responses.push(input); return { accepted: true } as const; }
    async cancel() {}
    async stop() {}
    async undo() {}
    async contextStats() { return { totalMessages: 0, activeMessages: 0, compactedMessages: 0, estimatedTokens: 0 }; }
    async compact() { return this.session; }
    async setPaused() {}
    async setApprovalMode(_sessionId: string, mode: SessionSnapshot['approvalMode']) { this.session.approvalMode = mode; this.modeChanges.push(mode); }
    onEvent(_sessionId: string, listener: (event: AgentEvent) => void) { this.listener = listener; return () => { this.listener = undefined; }; }
    emit(event: AgentEvent) { this.listener?.(event); }
}

afterEach(cleanup);

async function paneWithTools(count: number) {
    const client = new NotificationClient();
    const pane = new AgentChatPane(client);
    // AgentChatPane initializes in the background; let list/load hydration finish
    // before arranging the turn directly in its store.
    await new Promise(resolve => setTimeout(resolve, 0));
    pane.flow.store.applyUpdate({ blockId: 'user', role: 'user', delta: 'do it', done: true, status: 'done' });
    for (let index = 0; index < count; index++) {
        pane.flow.store.applyUpdate({
            blockId: `tool-${index}`, kind: 'tool', role: 'assistant', toolCallId: `tool-${index}`,
            type: 'write_file', status: 'pending',
        });
    }
    return { client, pane };
}

describe('AgentChatPane turn notifications', () => {
    it('notifies the host when a reviewed file edit reaches a final action', async () => {
        const { client, pane } = await paneWithTools(0);
        const settled: string[] = [];
        pane.flow.onFileEditSettled = (_sessionId, artifactId) => settled.push(artifactId);
        const fileEdit = { artifactId: 'edit', path: 'sample.txt', baseSha256: null, revision: 0 };
        for (const status of ['done', 'rejected', 'skipped', 'error'] as const) {
            client.emit({ type: 'tool-end', sessionId: 'notifications', response: {
                id: `tool-${status}`, toolCallId: `tool-${status}`, type: 'write_file', status, fileEdit,
            } });
        }
        expect(settled).toEqual(['edit', 'edit', 'edit']);
    });

    it('keeps Send enabled for context-only submissions', async () => {
        const { pane } = await paneWithTools(0);
        const mounted = render(() => pane.getVisual()());

        expect(mounted.getByRole('button', { name: 'Send' })).not.toBeDisabled();
    });

    it('submits only once while a send is in flight, then allows another turn', async () => {
        const { client, pane } = await paneWithTools(0);
        let finishSend!: () => void;
        client.send = async input => {
            client.sends.push(input);
            await new Promise<void>(resolve => { finishSend = resolve; });
            return { accepted: true } as const;
        };
        pane.setDraft('first turn');

        const first = pane.submit();
        const duplicate = pane.submit();
        await vi.waitFor(() => expect(client.sends).toHaveLength(1));

        finishSend();
        await Promise.all([first, duplicate]);
        pane.setDraft('second turn');
        const second = pane.submit();
        await vi.waitFor(() => expect(client.sends.map(send => send.text)).toEqual(['first turn', 'second turn']));
        finishSend();
        await second;
    });

    it('changes the session agent mode from the composer', async () => {
        const { client, pane } = await paneWithTools(0);
        const mounted = render(() => pane.getVisual()());

        fireEvent.click(mounted.getByRole('button', { name: 'Agent mode: Ask' }));
        fireEvent.click(mounted.getByRole('menuitemradio', { name: /Operate/ }));
        await Promise.resolve();

        expect(client.modeChanges).toEqual(['operate']);
        expect(pane.flow.getApprovalMode()).toBe('operate');

        fireEvent.click(mounted.getByRole('button', { name: 'Agent mode: Operate' }));
        fireEvent.click(mounted.getByRole('menuitemradio', { name: /Timer/ }));
        await Promise.resolve();
        expect(client.modeChanges).toEqual(['operate', 'timer-quick']);
        expect(pane.flow.getApprovalMode()).toBe('timer-quick');
        expect(mounted.getByRole('button', { name: 'Agent mode: Timer' })).toBeTruthy();
        expect(mounted.queryByRole('menuitemradio', { name: /Plan|Slow/ })).toBeNull();
    });

    it('changes message mode from the selector beside Send', async () => {
        const { pane } = await paneWithTools(0);
        const mounted = render(() => pane.getVisual()());

        fireEvent.click(mounted.getByRole('button', { name: 'Message mode: Queue' }));
        fireEvent.click(mounted.getByRole('menuitemradio', { name: /Interrupt/ }));

        expect(pane.flow.getSteeringPolicy()).toBe('INTERRUPT');
        expect(mounted.getByRole('button', { name: 'Message mode: Interrupt' })).toBeTruthy();
    });

    it('shows a backend-authored deadline only while a timed tool is pending', async () => {
        const { pane } = await paneWithTools(0);
        const requestedAt = Date.now();
        pane.flow.store.applyUpdate({
            blockId: 'timed', kind: 'tool', role: 'assistant', toolCallId: 'timed', type: 'write_file', status: 'pending',
            approval: { kind: 'timed', requestedAt, autoApproveAt: requestedAt + 3_000 },
        });
        const mounted = render(() => pane.getVisual()());

        expect(mounted.getByText(/Auto-approves in/)).toBeTruthy();
        pane.flow.store.applyUpdate({ blockId: 'timed', kind: 'tool', status: 'running' });
        expect(mounted.queryByText(/Auto-approves in/)).toBeNull();
    });

    it('toggles the notification navigator from the status button action', async () => {
        const { pane } = await paneWithTools(1);

        expect(pane.getNotificationsOpen()).toBe(false);
        pane.showNotifications();
        expect(pane.getNotificationsOpen()).toBe(true);
        pane.showNotifications();
        expect(pane.getNotificationsOpen()).toBe(false);
    });

    it('renders the notification navigator when the status button is clicked', async () => {
        const { pane } = await paneWithTools(1);
        const mounted = render(() => pane.getVisual()());

        fireEvent.click(mounted.getByRole('button', { name: 'Pending tasks' }));

        expect(mounted.getByRole('region', { name: 'Notifications' })).toBeTruthy();
        expect(mounted.getByText('Approval requested')).toBeTruthy();
    });

    it('keeps the minified response editable without showing the notification button', async () => {
        const { client, pane } = await paneWithTools(1);
        pane.setMinified(true);
        const mounted = render(() => pane.getVisual()());
        const response = mounted.getByRole('textbox', { name: 'Response' });

        expect(mounted.queryByRole('button', { name: 'Pending tasks' })).toBeNull();
        fireEvent.input(response, { target: { value: 'Continue from here' } });
        expect(pane.getDraft()).toBe('Continue from here');

        fireEvent.keyDown(response, { key: 'Enter' });
        await vi.waitFor(() => expect(client.sends[0].text).toBe('Continue from here'));
    });

    it('submits and flushes the whole batch when the only actionable item is chosen', async () => {
        const { client, pane } = await paneWithTools(1);
        expect(pane.statusCount()).toBe(1);

        await pane.chooseAction('tool-0', { kind: 'approved' });

        expect(client.responses[0].responses).toEqual({ 'tool-0': { kind: 'approved' } });
        expect(pane.statusCount()).toBe(0);
    });

    it('stages inline choices for multiple actions and skips untouched items on proceed', async () => {
        const { client, pane } = await paneWithTools(2);

        await pane.chooseAction('tool-0', { kind: 'approved' });
        expect(client.responses).toHaveLength(0);
        expect(pane.stagedActionCount()).toBe(1);
        expect(pane.statusCount()).toBe(2);

        await pane.proceedWithChoices();

        expect(client.responses[0].responses).toEqual({
            'tool-0': { kind: 'approved' },
            'tool-1': { kind: 'skipped', reason: 'Omitted when proceeding with selected choices.' },
        });
        expect(pane.statusCount()).toBe(0);
    });

    it('commits a question answer with the other pending tool choices', async () => {
        const { client, pane } = await paneWithTools(1);
        pane.flow.store.applyUpdate({
            blockId: 'question', kind: 'tool', role: 'assistant', toolCallId: 'question',
            type: 'ask_question', status: 'pending', input: {
                question: 'How much detail?', options: [
                    { id: 'compact', label: 'Compact' },
                    { id: 'detailed', label: 'Detailed', detail: 'Show all fields.' },
                ],
            },
        });
        const mounted = render(() => pane.getVisual()());

        expect(mounted.queryByRole('button', { name: 'Answer question' })).toBeNull();
        expect(mounted.getByRole('button', { name: 'Proceed with choices' })).toBeDisabled();
        fireEvent.click(mounted.getByRole('radio', { name: /Detailed/ }));
        expect(client.responses).toHaveLength(0);
        expect(pane.stagedActionCount()).toBe(1);
        expect(mounted.getByText('Answer selected')).toBeTruthy();

        fireEvent.click(mounted.getByRole('button', { name: 'Proceed with choices' }));
        await vi.waitFor(() => expect(client.responses[0].responses).toEqual({
            'tool-0': { kind: 'skipped', reason: 'Omitted when proceeding with selected choices.' },
            question: { kind: 'answered', answer: { kind: 'option', optionId: 'detailed' } },
        }));
    });

    it('shows Answer question when it is the only pending control', async () => {
        const { client, pane } = await paneWithTools(0);
        pane.flow.store.applyUpdate({
            blockId: 'question', kind: 'tool', role: 'assistant', toolCallId: 'question',
            type: 'ask_question', status: 'pending', input: { question: 'How much detail?', options: [
                { id: 'compact', label: 'Compact' }, { id: 'detailed', label: 'Detailed' },
            ] },
        });
        const mounted = render(() => pane.getVisual()());

        expect(mounted.queryByRole('button', { name: 'Proceed with choices' })).toBeNull();
        fireEvent.click(mounted.getByRole('radio', { name: 'Compact' }));
        expect(client.responses).toHaveLength(0);
        fireEvent.click(mounted.getByRole('button', { name: 'Answer question' }));
        await vi.waitFor(() => expect(client.responses[0].responses.question).toEqual({ kind: 'answered', answer: { kind: 'option', optionId: 'compact' } }));
    });

    it('switches to shared commit if another pending tool appears after a selection', async () => {
        const { pane } = await paneWithTools(0);
        pane.flow.store.applyUpdate({
            blockId: 'question', kind: 'tool', role: 'assistant', toolCallId: 'question',
            type: 'ask_question', status: 'pending', input: { question: 'How much detail?', options: [
                { id: 'compact', label: 'Compact' }, { id: 'detailed', label: 'Detailed' },
            ] },
        });
        const mounted = render(() => pane.getVisual()());
        fireEvent.click(mounted.getByRole('radio', { name: 'Compact' }));

        pane.flow.store.applyUpdate({
            blockId: 'second-tool', kind: 'tool', role: 'assistant', toolCallId: 'second-tool',
            type: 'write_file', status: 'pending',
        });

        expect(mounted.queryByRole('button', { name: 'Answer question' })).toBeNull();
        expect(pane.stagedAction('question')).toEqual({ kind: 'answered', answer: { kind: 'option', optionId: 'compact' } });
        expect(mounted.getByRole('button', { name: 'Proceed with choices' })).not.toBeDisabled();
    });

    it('stages and clears a freeform answer when several controls are pending', async () => {
        const { pane } = await paneWithTools(1);
        pane.flow.store.applyUpdate({
            blockId: 'question', kind: 'tool', role: 'assistant', toolCallId: 'question',
            type: 'ask_question', status: 'pending', input: { question: 'What format?' },
        });
        const mounted = render(() => pane.getVisual()());
        const answer = mounted.getByRole('textbox', { name: 'Your own answer' });

        fireEvent.input(answer, { target: { value: 'JSON' } });
        expect(pane.stagedAction('question')).toEqual({ kind: 'answered', answer: { kind: 'text', text: 'JSON' } });
        fireEvent.input(answer, { target: { value: '' } });
        expect(pane.stagedAction('question')).toBeUndefined();
        expect(mounted.getByRole('button', { name: 'Proceed with choices' })).toBeDisabled();
    });

    it('stages question Skip until the shared proceed action', async () => {
        const { client, pane } = await paneWithTools(1);
        pane.flow.store.applyUpdate({
            blockId: 'question', kind: 'tool', role: 'assistant', toolCallId: 'question',
            type: 'ask_question', status: 'pending', input: { question: 'How much detail?' },
        });

        await pane.chooseAction('question', { kind: 'skipped' });
        expect(client.responses).toHaveLength(0);
        expect(pane.stagedActionCount()).toBe(1);
        await pane.proceedWithChoices();
        expect(client.responses[0].responses.question).toEqual({ kind: 'skipped' });
    });

    it('allows later activity in the same user turn to notify after a flush', async () => {
        const { pane } = await paneWithTools(1);
        await pane.chooseAction('tool-0', { kind: 'approved' });

        pane.flow.store.applyUpdate({
            blockId: 'tool-later', kind: 'tool', role: 'assistant', toolCallId: 'tool-later',
            type: 'write_file', status: 'pending',
        });

        expect(pane.statusCount()).toBe(1);
    });

    it('includes staged choices when a user message advances the turn', async () => {
        const { client, pane } = await paneWithTools(2);
        await pane.chooseAction('tool-0', { kind: 'rejected' });
        pane.setDraft('Continue another way');

        await pane.submit();

        expect(client.sends[0].responses).toEqual({ 'tool-0': { kind: 'rejected' } });
        expect(pane.stagedActionCount()).toBe(0);
        expect(pane.statusCount()).toBe(0);
    });
});
