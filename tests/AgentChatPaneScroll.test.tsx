import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentChatPane } from '../src/chat/AgentChatPane';

afterEach(cleanup);

function mountPane() {
    const pane = new AgentChatPane();
    const mounted = render(() => pane.getVisual()());
    const root = mounted.container.querySelector<HTMLElement>('[data-tour="chat"]')!;
    const scroller = root.firstElementChild as HTMLDivElement;

    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 200 });

    return { pane, scroller };
}

describe('AgentChatPane auto-scroll', () => {
    it('follows store updates even when the user was far from the bottom', async () => {
        const { pane, scroller } = mountPane();
        await Promise.resolve();
        scroller.scrollTop = 20;

        pane.flow.store.applyUpdate({
            blockId: 'streaming-reply',
            role: 'assistant',
            delta: 'next streamed chunk',
        });
        await Promise.resolve();

        expect(scroller.scrollTop).toBe(1000);
    });

    it('keeps the explicit turn-posted scroll trigger', async () => {
        const { pane, scroller } = mountPane();
        await Promise.resolve();
        scroller.scrollTop = 20;

        pane.flow.onTurnPosted?.();
        await Promise.resolve();

        expect(scroller.scrollTop).toBe(1000);
    });
});
