import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { InteractionToolbarModule } from '../src/toolbar/InteractionToolbarModule';
import { SettingsToolbarModule } from '../src/toolbar/SettingsToolbarModule';
import { SettingsWindowProvider } from '../src/settings/SettingsWindow';
import { ToolbarHost } from '../src/toolbar/ToolbarHost';
import { userSettings } from '../src/UserSettings';

afterEach(() => {
    userSettings.setNativeSelectionMode('automatic');
    cleanup();
});

describe('settings surfaces', () => {
    it('keeps interaction and general quick settings in separate rail panels', async () => {
        const toolbar = new ToolbarHost([
            new InteractionToolbarModule(),
            new SettingsToolbarModule(),
        ]);
        const mounted = render(() => (
            <SettingsWindowProvider>
                {toolbar.getActivityBar()()}
                {toolbar.panelView.getVisual()()}
            </SettingsWindowProvider>
        ));

        await fireEvent.click(mounted.getByTitle('Interaction'));
        expect(mounted.getByText('Note previews')).toBeInTheDocument();
        const selectionMode = mounted.getByRole('group', { name: 'When selecting text to annotate' });
        const immediately = mounted.getByRole('radio', { name: /Annotate immediately/ }) as HTMLInputElement;
        const always = mounted.getByRole('radio', { name: /Always show an action/ }) as HTMLInputElement;
        expect(mounted.getAllByRole('radio', { name: /Annotate immediately|Always show an action/ })).toHaveLength(2);
        expect(selectionMode).toContainElement(immediately);
        expect(immediately.checked).toBe(true);
        await fireEvent.click(always);
        expect(userSettings.nativeSelectionMode()).toBe('always-action');
        expect(always.checked).toBe(true);
        await fireEvent.click(immediately);
        expect(userSettings.nativeSelectionMode()).toBe('automatic');
        expect(mounted.queryByText('Open full settings')).not.toBeInTheDocument();

        await fireEvent.click(mounted.getByTitle('Settings'));
        expect(mounted.getByText('Open full settings')).toBeInTheDocument();
        expect(mounted.getByLabelText('Color theme')).toBeInTheDocument();
        expect(mounted.getByText('Open Theme Lab')).toBeInTheDocument();
        expect(mounted.queryByText('Note previews')).not.toBeInTheDocument();
    });

    it('opens the full window through a portal and closes it by backdrop or Escape', async () => {
        const settings = new SettingsToolbarModule();
        const mounted = render(() => (
            <SettingsWindowProvider>
                {settings.getPanel()()}
            </SettingsWindowProvider>
        ));

        await fireEvent.click(mounted.getByText('Open full settings'));
        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        expect(dialog).toBeInTheDocument();
        expect(screen.getByText('Agent')).toBeInTheDocument();
        expect(screen.getByText('Appearance')).toBeInTheDocument();
        expect(screen.getAllByText('Open Theme Lab')).toHaveLength(2);

        await fireEvent.click(dialog);
        expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

        await fireEvent.click(dialog.parentElement!);
        expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();

        await fireEvent.click(mounted.getByText('Open full settings'));
        await fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    });
});
