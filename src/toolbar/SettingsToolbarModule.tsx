import { JSX } from 'solid-js';
import { Maximize2, Settings } from 'lucide-solid';
import { ToolbarModule } from './ToolbarModule';
import { ThemeSettingRow } from '../settings/SettingsSections';
import { useSettingsWindow } from '../settings/SettingsWindow';
import { ThemeLab } from '../theme/ThemeLab';
import styles from '../styles/Toolbar.module.css';

function QuickSettingsPanel() {
    const settingsWindow = useSettingsWindow();
    return (
        <div class={styles.settingsPanel}>
            <button
                class={styles.openFullSettings}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={settingsWindow.isOpen()}
                onClick={settingsWindow.open}
            >
                <span>
                    <strong>Open full settings</strong>
                    <small>Agent, appearance, and advanced theme options</small>
                </span>
                <Maximize2 size={16} />
            </button>
            <section class={styles.settingsSection} aria-labelledby="quick-settings-heading">
                <h3 id="quick-settings-heading" class={styles.settingsSectionTitle}>Quick settings</h3>
                <ThemeSettingRow />
                <ThemeLab />
            </section>
        </div>
    );
}

export class SettingsToolbarModule extends ToolbarModule {
    readonly id = 'settings';
    readonly icon = <Settings size={18} />;
    readonly label = 'Settings';

    getPanel(): () => JSX.Element {
        return () => <QuickSettingsPanel />;
    }
}
