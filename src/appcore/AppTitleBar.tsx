import type { Component } from 'solid-js';
import { APP_METADATA } from '../appMetadata';
import { InteractionModeControl } from '../interactions/InteractionModeControl';
import styles from '../styles/App.module.css';

/** The draggable surface that hosts Electron's native window controls. */
export const AppTitleBar: Component = () => (
    <header
        class={styles.appTitleBar}
        style={`--app-title-bar-height: ${APP_METADATA.windowChrome.titleBarHeight}px`}
    >
        {window.desktopBridge?.platform !== 'darwin' && (
            <span class={styles.appTitle}>{APP_METADATA.name}</span>
        )}
        <InteractionModeControl compact />
    </header>
);
