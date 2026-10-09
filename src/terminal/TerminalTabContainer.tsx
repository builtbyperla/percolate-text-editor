import { JSX, Show } from 'solid-js';
import { TabBody, TabContainer } from '../containers/Tabs';
import { openNewTerminalTab } from './TerminalTabFactory';
import type { PtyProvider } from './PtyProvider';
import styles from '../styles/Terminal.module.css';

export class TerminalTabContainer extends TabContainer {
    constructor(private provider: PtyProvider) {
        super([]);
    }

    private openTerminal = (): void => {
        openNewTerminalTab(this, this.provider);
    };

    protected getHeaderVisual(): JSX.Element {
        return (
            <div class={styles.terminalToolbar}>
                {this.headerBar.getVisual()()}
                <button
                    class={styles.terminalNewButton}
                    title="New terminal"
                    aria-label="New terminal"
                    onClick={this.openTerminal}
                >
                    +
                </button>
            </div>
        );
    }

    protected getBodyVisual(): JSX.Element {
        return (
            <Show
                when={this.getTabs().length > 0}
                fallback={
                    <div class={styles.terminalEmpty}>
                        Click <span class={styles.terminalEmptyPlus}>+</span> to open a terminal
                    </div>
                }
            >
                <TabBody container={this} />
            </Show>
        );
    }

    getVisual(): () => JSX.Element {
        const base = super.getVisual();
        return () => <div class={styles.terminalContainer}>{base()}</div>;
    }
}
