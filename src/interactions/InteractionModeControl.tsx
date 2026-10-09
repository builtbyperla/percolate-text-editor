import type { Component } from 'solid-js';
import { Lock, LockOpen } from 'lucide-solid';
import { userSettings } from '../UserSettings';
import styles from '../styles/App.module.css';

interface InteractionModeControlProps {
    compact?: boolean;
    settingsShape?: boolean;
}

/**
 * Shared control for the global pane interaction lock. Every mounted instance
 * reads and writes the same UserSettings signal, so title-bar and Settings
 * controls always remain synchronized.
 */
export const InteractionModeControl: Component<InteractionModeControlProps> = props => (
    <div
        class={styles.lockToggleSegments}
        classList={{
            [styles.titleBarModeControl]: props.compact,
            [styles.settingsModeControl]: props.settingsShape,
        }}
        role="group"
        aria-label="Interaction mode"
    >
        <button
            type="button"
            class={styles.lockSegment}
            classList={{ [styles.lockSegmentActive]: userSettings.annotateLock() === 'unlocked' }}
            aria-label="Unlock interaction mode"
            aria-pressed={userSettings.annotateLock() === 'unlocked'}
            title="Unlocked"
            onClick={() => userSettings.setAnnotateLock('unlocked')}
        >
            <LockOpen size={12} />
        </button>
        <button
            type="button"
            class={styles.lockSegment}
            classList={{ [styles.lockSegmentActive]: userSettings.annotateLock() === 'annotation' }}
            aria-pressed={userSettings.annotateLock() === 'annotation'}
            onClick={() => userSettings.setAnnotateLock('annotation')}
        >
            <Lock size={12} /> Annotate
        </button>
        <button
            type="button"
            class={styles.lockSegment}
            classList={{ [styles.lockSegmentActive]: userSettings.annotateLock() === 'edit' }}
            aria-pressed={userSettings.annotateLock() === 'edit'}
            onClick={() => userSettings.setAnnotateLock('edit')}
        >
            <Lock size={12} /> Edit
        </button>
    </div>
);
