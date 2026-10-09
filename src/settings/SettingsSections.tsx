import { JSX, Show, createSignal, onMount } from 'solid-js';
import { ExternalLink, FileKey } from 'lucide-solid';
import type { AgentSettingsDTO, AgentSettingsUpdateDTO } from '../../shared/agentProtocol';
import { userSettings } from '../UserSettings';
import styles from '../styles/Toolbar.module.css';
import { APPEARANCE_THEMES, AppearanceThemeId } from '../theme/appearanceThemes';
import { ThemeLab } from '../theme/ThemeLab';

export function SettingRow(props: { label: string; hint?: string; children: JSX.Element }) {
    return (
        <div class={styles.settingRow}>
            <div class={styles.settingLabel}>{props.label}</div>
            {props.children}
            {props.hint && <div class={styles.settingHint}>{props.hint}</div>}
        </div>
    );
}

export function ThemeSettingRow(props: { showHint?: boolean }) {
    return (
        <SettingRow
            label="Color theme"
            hint={props.showHint ? 'Changes the complete UI palette and syntax highlighting together.' : undefined}
        >
            <select
                class={styles.themeSelect}
                aria-label="Color theme"
                value={userSettings.appearance.theme()}
                onChange={event => {
                    const theme = event.currentTarget.value as AppearanceThemeId;
                    userSettings.appearance.setTheme(theme);
                    userSettings.appearance.setSyntaxTheme(theme);
                    userSettings.appearance.setCustomTheme(null);
                }}
            >
                {Object.values(APPEARANCE_THEMES).map(theme => (
                    <option value={theme.id}>{theme.label}</option>
                ))}
            </select>
        </SettingRow>
    );
}

export function AgentSettings() {
    const bridge = window.desktopBridge?.agent;
    const [settings, setSettings] = createSignal<AgentSettingsDTO>({ provider: 'openai', model: 'gpt-4o-mini' });
    const [status, setStatus] = createSignal(bridge ? 'Loading…' : 'Available in the desktop app.');

    onMount(() => {
        if (!bridge) return;
        void bridge.getSettings()
            .then(value => { setSettings(value); setStatus(''); })
            .catch(error => setStatus(error instanceof Error ? error.message : 'Unable to load agent settings.'));
    });

    const update = async (value: AgentSettingsUpdateDTO) => {
        if (!bridge) return;
        try {
            setStatus('Saving…');
            setSettings(await bridge.updateSettings(value));
            window.dispatchEvent(new Event('agent-settings-updated'));
            setStatus('Saved');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to save agent settings.');
        }
    };
    const chooseKeyFile = async () => {
        if (!bridge) return;
        try {
            setSettings(await bridge.chooseApiKeyFile());
            setStatus('Saved');
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Unable to choose key file.');
        }
    };
    const chooseProvider = async (provider: AgentSettingsDTO['provider']) => {
        const model = provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini';
        setSettings(current => ({ ...current, provider, model, apiKeyFile: undefined }));
        await update({ provider, model });
    };

    return (
        <section class={styles.settingsSection} aria-labelledby="agent-settings-heading">
            <h3 id="agent-settings-heading" class={styles.settingsSectionTitle}>Agent</h3>
            <SettingRow label="Provider" hint="Additional providers can plug into this setting without changing chat UI state.">
                <select class={styles.themeSelect} value={settings().provider} disabled={!bridge} onChange={event => void chooseProvider(event.currentTarget.value as AgentSettingsDTO['provider'])}>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                </select>
            </SettingRow>
            <SettingRow label="Model" hint="Used for new provider calls; active calls keep their current model.">
                <input
                    class={styles.settingsInput}
                    value={settings().model}
                    disabled={!bridge}
                    onInput={event => setSettings(current => ({ ...current, model: event.currentTarget.value }))}
                    onBlur={event => void update({ model: event.currentTarget.value })}
                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                />
            </SettingRow>
            <SettingRow label="API key file" hint="Only Electron main reads the file contents. The renderer receives its path, never the token.">
                <div class={styles.settingsFileActions}>
                    <button type="button" disabled={!bridge} onClick={() => void chooseKeyFile()}><FileKey size={13} /> Choose file</button>
                    <Show when={settings().apiKeyFile}>
                        <button type="button" onClick={() => void bridge?.revealApiKeyFile()}><ExternalLink size={13} /> Reveal</button>
                    </Show>
                </div>
                <div class={styles.settingsPath} title={settings().apiKeyFile}>
                    {settings().apiKeyFile ?? `Using ${settings().provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} when set`}
                </div>
            </SettingRow>
            <Show when={status()}><div class={styles.settingsStatus}>{status()}</div></Show>
        </section>
    );
}

export function AppearanceSettings() {
    return (
        <section class={styles.settingsSection} aria-labelledby="appearance-settings-heading">
            <h3 id="appearance-settings-heading" class={styles.settingsSectionTitle}>Appearance</h3>
            <ThemeSettingRow showHint />
            <ThemeLab />
        </section>
    );
}
