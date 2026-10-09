import { createSignal, JSX } from "solid-js";
import { Triangle } from "lucide-solid";
import { SplitPaneFrame } from "../containers/SplitPane";
import { PaneWorkspace } from "./PaneWorkspace"
import { SideAgentPanel } from "./SideAgentPanel"
import { PromptHost } from "./PromptHost"
import appStyles from "../styles/App.module.css";
import { Accessor, Setter } from "solid-js"
import { TabContainer, ViewBlock } from "../containers/Tabs";
import { APP_VIEWPORT_ANCHOR } from "../annotation/AnnotationVisualFrames";
import { windowrefregistry } from "./WindowRefRegistry";

class AppRowView implements ViewBlock {
    ownsScroll: boolean = true;
    splitFrame: SplitPaneFrame<ViewBlock>;

    constructor(paneWorkspace: PaneWorkspace, agentPanel: SideAgentPanel) {
        this.splitFrame = new SplitPaneFrame(true, [paneWorkspace, agentPanel]);
    }

    getVisual(): () => JSX.Element {
        return () => this.splitFrame.getVisual()();
    }
}

class AppContainer {
    getRef: Accessor<HTMLElement | undefined>;
    setRef: Setter<HTMLElement | undefined>;

    appRow: AppRowView;
    agentPanel: SideAgentPanel;

    // Horizontal row split (workspace | agent). Held for the agent toggle.
    rowSplit: SplitPaneFrame<ViewBlock>;

    // Outer vertical split (app row / terminal). Held for the terminal toggle.
    outerSplit: SplitPaneFrame<ViewBlock>;
    // Absent in demo builds, which ship no terminal (no pty outside Electron).
    // toggleTerminalPane is then a no-op and nothing builds its rail button.
    terminalContainer?: TabContainer;

    getShowAgentPanel: Accessor<boolean>;
    setShowAgentPanel: Setter<boolean>;

    // Stores the agent fractional width for when it's hidden or shown so
    // it's restored to the right size
    _agentPaneWidthMemo: number;

    // Terminal-pane visibility + remembered fraction, same pattern as the agent
    // toggle. The terminal rail module reads getTerminalVisible for its glyph.
    getTerminalVisible: Accessor<boolean>;
    private setTerminalVisible: Setter<boolean>;
    private _terminalFractionMemo = 0.3;

    constructor(
        paneWorkspace: PaneWorkspace,
        agentPanel: SideAgentPanel,
        terminalContainer?: TabContainer,
    ) {
        this.agentPanel = agentPanel;
        this.terminalContainer = terminalContainer;

        // Horizontal row: workspace | agent panel.
        this.appRow = new AppRowView(paneWorkspace, agentPanel);
        this.rowSplit = this.appRow.splitFrame;

        // Show agent panel by default
        [this.getShowAgentPanel, this.setShowAgentPanel] = createSignal(true);

        // App-wide window ref
        [this.getRef, this.setRef] = createSignal<HTMLElement | undefined>(undefined);
        windowrefregistry.register(APP_VIEWPORT_ANCHOR, this.getRef);

        // Default to an even-ish split favoring the Percolate workspace.
        this.rowSplit.fractionSetters[0](0.75);
        this.rowSplit.fractionSetters[1](0.25);
        this._agentPaneWidthMemo = this.rowSplit.fractions[1]();

        // Outer vertical split: app row on top, terminal HIDDEN by default
        // (single pane at construction — toggled in by the terminal rail button).
        this.outerSplit = new SplitPaneFrame(false, [this.appRow]);
        [this.getTerminalVisible, this.setTerminalVisible] = createSignal(false);
    }

    toggleAgentPanel() {
        // Remove agent panel from split pane view or show it again
        // while storing its fractional width
        const show: boolean = !this.getShowAgentPanel();
        if (show) {
            this.rowSplit.addPane(this.agentPanel);
            this.rowSplit.fractionSetters[1](this._agentPaneWidthMemo);
            this.rowSplit.fractionSetters[0](1 - this._agentPaneWidthMemo);
        } else {
            this._agentPaneWidthMemo = this.rowSplit.fractions[1]();
            this.rowSplit.removePane(this.agentPanel);
        }
        this.setShowAgentPanel(show);

        // TODO: Probably want to refactor this into a custom split frame
        // to avoid non recoverable corrupted state bugs
    }

    // Show/hide the bottom terminal pane.
    toggleTerminalPane() {
        const terminal = this.terminalContainer;
        if (!terminal) return;

        const show = !this.getTerminalVisible();
        if (show) {
            this.outerSplit.addPane(terminal);
            this.outerSplit.fractionSetters[1](this._terminalFractionMemo);
            this.outerSplit.fractionSetters[0](1 - this._terminalFractionMemo);
        } else {
            this._terminalFractionMemo = this.outerSplit.fractions[1]();
            this.outerSplit.removePane(terminal);
        }
        this.setTerminalVisible(show);
    }

    getVisual(): () => JSX.Element {
        return () => (
            <div
                class={appStyles.workspace}
                style={{
                    'anchor-name': APP_VIEWPORT_ANCHOR,
                }}
                ref={(el) => {this.setRef(el);}}
            >
                {this.outerSplit.getVisual()()}

                <button
                    class={appStyles.agentToggleRail}
                    classList={{ [appStyles.active]: this.getShowAgentPanel() }}
                    title="Toggle agent panel"
                    onClick={() => this.toggleAgentPanel()}
                >
                    {/* A single rounded triangle points toward the panel's
                        current direction. */}
                    <span class={appStyles.agentToggleIcons}>
                        <Triangle
                            class={appStyles.agentToggleIcon}
                            classList={{ [appStyles.agentToggleIconOpen]: this.getShowAgentPanel() }}
                        />
                    </span>
                </button>

                {/* One-per-app modal host for promptConfirm — portaled to
                    document.body so it clears any overflow:hidden ancestor. */}
                <PromptHost />
            </div>
        );
    }
}

export { AppContainer };
