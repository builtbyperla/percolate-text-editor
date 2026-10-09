import { JSX } from 'solid-js';
import { LineSquiggle, PencilSparkles, PenLine, TextCursor } from 'lucide-solid';
import { ToolbarModule } from './ToolbarModule';
import { userSettings, type NativeSelectionMode } from '../UserSettings';
import { SettingRow } from '../settings/SettingsSections';
import appStyles from '../styles/App.module.css';
import styles from '../styles/Toolbar.module.css';
import { InteractionModeControl } from '../interactions/InteractionModeControl';

const selectionActionOptions: { value: NativeSelectionMode; label: string; description: string }[] = [
    {
        value: 'automatic',
        label: 'Annotate immediately',
        description: 'The default. Create an annotation as soon as you finish selecting text.',
    },
    {
        value: 'always-action',
        label: 'Show a button',
        description: 'Use the button to manually create a selection from the selected text.',
    },
];

export class InteractionToolbarModule extends ToolbarModule {
    readonly id = 'interaction';
    readonly icon = <PencilSparkles size={18} />;
    readonly label = 'Interaction';

    getPanel(): () => JSX.Element {
        return () => (
            <div class={styles.settingsPanel}>
                <section class={styles.settingsSection} aria-labelledby="interaction-settings-heading">
                    <h3 id="interaction-settings-heading" class={styles.settingsSectionTitle}>Quick interaction settings</h3>
                    <SettingRow label="Note previews" hint="Whether notes stay open or are hidden.">
                        <button
                            class={`${appStyles.notesToggle} ${appStyles.settingsButtonControl}`}
                            classList={{ [appStyles.notesToggleActive]: userSettings.showPreviews() }}
                            onClick={() => userSettings.toggleNotesVisibility()}
                        >
                            <span class={appStyles.notesToggleDot} />
                            {userSettings.showPreviews() ? 'On' : 'Off'}
                        </button>
                    </SettingRow>

                    <SettingRow label="Interaction mode lock" hint="Lock all panes to annotate-mode or edit-mode. Unlock to toggle freely.">
                        <InteractionModeControl settingsShape />
                    </SettingRow>

                    <SettingRow label="Selection granularity" hint="Whether annotate view snaps to whole lines or uses character-based selection.">
                        <div class={`${appStyles.lockToggleSegments} ${appStyles.settingsModeControl}`}>
                            <button
                                class={appStyles.lockSegment}
                                classList={{ [appStyles.lockSegmentActive]: userSettings.annotationSelectMode() === 'char' }}
                                onClick={() => userSettings.setAnnotationSelectMode('char')}
                            >
                                <TextCursor size={12} /> Char
                            </button>
                            <button
                                class={appStyles.lockSegment}
                                classList={{ [appStyles.lockSegmentActive]: userSettings.annotationSelectMode() === 'line' }}
                                onClick={() => userSettings.setAnnotationSelectMode('line')}
                            >
                                <LineSquiggle size={12} /> Line
                            </button>
                        </div>
                    </SettingRow>

                    <fieldset class={styles.selectionActionGroup}>
                        <legend class={styles.settingLabel}>Auto-select highlights in unlocked mode</legend>
                        <div class={styles.selectionActionOptions}>
                            {selectionActionOptions.map(option => (
                                <label class={styles.selectionActionOption}>
                                    <input
                                        type="radio"
                                        name="native-selection-mode"
                                        value={option.value}
                                        checked={userSettings.nativeSelectionMode() === option.value}
                                        onChange={() => userSettings.setNativeSelectionMode(option.value)}
                                    />
                                    <span>
                                        <span class={styles.selectionActionTitle}>{option.label}</span>
                                        <span class={styles.selectionActionDescription}>{option.description}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <p class={styles.settingHint}>Line selection is unchanged.</p>
                    </fieldset>
                </section>
            </div>
        );
    }
}
