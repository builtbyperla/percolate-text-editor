import { describe, expect, it } from 'vitest';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { TabContainer } from '../src/containers/Tabs';
import { makeTab } from './factories/panes';

describe('tab header area mode', () => {
    it('tracks the active tab decoration mode', () => {
        const tabs = [makeTab('annotated'), makeTab('plain')];
        let tabContainer!: TabContainer;
        let setMode!: (mode: string | undefined) => void;
        const mounted = render(() => {
            const [mode, updateMode] = createSignal<string | undefined>('annotate');
            setMode = updateMode;
            tabs[0].setModeAccessor(mode);
            tabContainer = new TabContainer(tabs);
            return tabContainer.headerBar.getVisual()();
        });
        const area = mounted.container.querySelector('[data-tabdroparea]');

        expect(area?.getAttribute('data-mode')).toBe('annotate');
        tabContainer.selectTab(tabs[1]);
        expect(area?.hasAttribute('data-mode')).toBe(false);
        tabContainer.selectTab(tabs[0]);
        expect(area?.getAttribute('data-mode')).toBe('annotate');
        setMode(undefined);
        expect(area?.hasAttribute('data-mode')).toBe(false);
        mounted.unmount();
    });
});
