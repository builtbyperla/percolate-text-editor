import { Accessor, JSX, ParentProps, Show, createContext, createEffect, createSignal, onCleanup, useContext } from 'solid-js';
import { Portal } from 'solid-js/web';
import { X } from 'lucide-solid';
import { AgentSettings, AppearanceSettings } from './SettingsSections';
import styles from '../styles/Toolbar.module.css';

interface SettingsWindowContextValue {
    isOpen: Accessor<boolean>;
    open: () => void;
    close: () => void;
}

const SettingsWindowContext = createContext<SettingsWindowContextValue>();

export function useSettingsWindow(): SettingsWindowContextValue {
    const value = useContext(SettingsWindowContext);
    if (!value) throw new Error('useSettingsWindow must be used within SettingsWindowProvider');
    return value;
}

export function SettingsWindowProvider(props: ParentProps): JSX.Element {
    const [isOpen, setOpen] = createSignal(false);
    let previouslyFocused: HTMLElement | null = null;
    const open = () => {
        previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
    };
    const close = () => {
        setOpen(false);
        queueMicrotask(() => previouslyFocused?.focus());
    };
    const value: SettingsWindowContextValue = {
        isOpen,
        open,
        close,
    };

    createEffect(() => {
        if (!isOpen()) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        onCleanup(() => document.removeEventListener('keydown', onKeyDown, true));
    });

    return (
        <SettingsWindowContext.Provider value={value}>
            {props.children}
            <Show when={isOpen()}>
                <Portal>
                    <div
                        class={styles.settingsWindowBackdrop}
                        onClick={event => {
                            if (event.target === event.currentTarget) close();
                        }}
                    >
                        <div
                            class={styles.settingsWindow}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="full-settings-title"
                            aria-describedby="full-settings-description"
                        >
                            <header class={styles.settingsWindowHeader}>
                                <div>
                                    <h2 id="full-settings-title">Settings</h2>
                                    <p id="full-settings-description">Application configuration and appearance</p>
                                </div>
                                <button type="button" aria-label="Close settings" autofocus onClick={close}>
                                    <X size={18} />
                                </button>
                            </header>
                            <div class={styles.settingsWindowBody}>
                                <AgentSettings />
                                <AppearanceSettings />
                            </div>
                        </div>
                    </div>
                </Portal>
            </Show>
        </SettingsWindowContext.Provider>
    );
}
