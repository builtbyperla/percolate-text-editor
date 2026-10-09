import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { JSX } from 'solid-js';
import { SplitPaneFrame } from '../src/containers/SplitPane';
import { ViewBlock } from '../src/containers/Tabs';
import { ActivityPane, AgentToolTab, AgentToolsPane, SessionsPane } from '../src/featurepanes/AgentToolsPane';
import type { ChatFlow } from '../src/chat/ChatFlow';
import type { SessionSummary } from '../shared/agentProtocol';

afterEach(cleanup);

class TestView implements ViewBlock {
    ownsScroll = false;

    constructor(private readonly text: string, private readonly marker?: HTMLElement) {}

    getVisual(): () => JSX.Element {
        return () => this.marker ?? <div>{this.text}</div>;
    }
}

describe('AgentToolsPane', () => {
    it('shows the token estimate without internal message counts in the Activity header', async () => {
        let compactCalls = 0;
        const flow = {
            getContextStats: () => ({ totalMessages: 4, activeMessages: 3, compactedMessages: 1, estimatedTokens: 1240 }),
            store: { getRevision: () => 0 },
            getMessages: () => [],
            compact: async () => { compactCalls += 1; return true; },
        } as unknown as ChatFlow;
        const pane = new ActivityPane(flow, () => undefined);
        const mounted = render(() => pane.getVisual()());

        expect(mounted.getByLabelText('Active context')).toHaveTextContent('~1,240 tokens');
        expect(mounted.getByLabelText('Active context')).not.toHaveTextContent('active');
        expect(mounted.getByLabelText('Active context')).not.toHaveTextContent('compacted');
        expect(mounted.getByRole('tooltip')).toHaveTextContent('Estimate based on character count');
        expect(mounted.getByLabelText('Approximately 1,240 tokens')).toHaveAttribute('tabindex', '0');
        expect(mounted.queryByText('Current session')).not.toBeInTheDocument();
        expect(mounted.queryByText('Activity')).not.toBeInTheDocument();
        expect(mounted.queryByText('0')).not.toBeInTheDocument();

        await fireEvent.click(mounted.getByRole('button', { name: 'Compact' }));
        expect(compactCalls).toBe(1);
    });

    it('loads sessions once at startup without subscribing refresh to its own list update', async () => {
        const summary: SessionSummary = {
            id: 'raw-session-id', agent: 'stub', displayName: 'Stable session', archived: false,
            state: 'IDLE', createdAt: 1, updatedAt: 1,
        };
        let listCalls = 0;
        const flow = {
            getSessionId: () => summary.id,
            getContextStats: () => undefined,
            listSessions: () => {
                listCalls += 1;
                if (listCalls === 1) return Promise.resolve([summary]);
                // If refresh accidentally subscribes to its own list, keep the
                // second request pending so the regression test itself cannot spin.
                return new Promise<SessionSummary[]>(() => undefined);
            },
        } as unknown as ChatFlow;
        let pane: SessionsPane | undefined;
        const mounted = render(() => {
            pane ??= new SessionsPane(flow);
            return pane.getVisual()();
        });

        await waitFor(() => expect(mounted.getByText('Stable session')).toBeInTheDocument());
        await Promise.resolve();
        await Promise.resolve();

        expect(listCalls).toBe(1);
    });

    it('defaults to the first tool and swaps only the tool body', async () => {
        const context = new AgentToolTab('context', 'Context', new TestView('context body'), () => <span>C</span>);
        const sessions = new AgentToolTab('sessions', 'Sessions', new TestView('sessions body'), () => <span>S</span>);
        const tools = new AgentToolsPane([context, sessions]);

        const chatMarker = document.createElement('div');
        chatMarker.textContent = 'chat flow';
        const split = new SplitPaneFrame<ViewBlock>(false, [tools, new TestView('', chatMarker)]);
        const mounted = render(() => split.getVisual()());

        expect(mounted.getByText('context body')).toBeInTheDocument();
        expect(mounted.getByText('context body').parentElement?.parentElement).toHaveStyle({
            overflowY: 'auto',
        });
        expect(mounted.getByRole('tab', { name: 'Context' })).toHaveAttribute('aria-selected', 'true');
        const mountedChat = mounted.getByText('chat flow');

        await fireEvent.click(mounted.getByRole('tab', { name: 'Sessions' }));

        expect(mounted.queryByText('context body')).not.toBeInTheDocument();
        expect(mounted.getByText('sessions body')).toBeInTheDocument();
        expect(mounted.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
        expect(mounted.getByText('chat flow')).toBe(mountedChat);
    });

    it('hides the mounted tool body without removing its split-pane block', async () => {
        const context = new AgentToolTab('context', 'Context', new TestView('context body'), () => <span>C</span>);
        const tools = new AgentToolsPane([context]);
        let collapsed = false;
        tools.setCollapseListener((value) => { collapsed = value; });
        const mounted = render(() => tools.getVisual()());

        await fireEvent.click(mounted.getByRole('button', { name: 'Hide tool view' }));

        expect(collapsed).toBe(true);
        expect(mounted.getByText('context body')).toBeInTheDocument();
        expect(mounted.getByText('context body').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true');
        expect(mounted.getByRole('tab', { name: 'Context' })).toBeInTheDocument();
        expect(mounted.getByRole('button', { name: 'Show tool view' })).toHaveAttribute('aria-expanded', 'false');
    });
});
