import { JSX } from "solid-js";
import { TabSplitPaneFrame } from "../containers/TabSplitPane";
import { SplitPaneFrame } from "../containers/SplitPane";
import { ViewBlock } from "../containers/Tabs";
import { ToolbarHost } from "../toolbar/ToolbarHost";
import appStyles from "../styles/App.module.css";

export class PaneWorkspace implements ViewBlock {
    // Workspace owns nested scroll hosts; never structurally empty.
    ownsScroll: boolean = true;

    toolbar: ToolbarHost;

    // Panel pane + editor tab frame share this plain (non-tab) frame, so the
    // panel gets a resize divider but is never a tab-drop target.
    private outerFrame: SplitPaneFrame<ViewBlock>;

    constructor(splitFrame: TabSplitPaneFrame, toolbar: ToolbarHost) {
        this.toolbar = toolbar;

        // panelView owns its scroll (ownsScroll=true); placed directly as a pane
        // now that the SelfManagedScrollPane wrapper is gone.
        this.outerFrame = new SplitPaneFrame(true, [toolbar.panelView, splitFrame]);
        // Hand the toolbar the panel/editor fraction setters so collapse/expand
        // resizes them; the toolbar applies the initial split from its open state.
        toolbar.bindFractions(
            this.outerFrame.fractionSetters[0],
            this.outerFrame.fractionSetters[1],
        );
    }

    getVisual(): () => JSX.Element {
        return () => (
            <div class={appStyles.percolatePane}>
                <div class={appStyles.workspaceRow}>
                    {this.toolbar.getActivityBar()()}
                    {this.outerFrame.getVisual()()}
                </div>
            </div>
        );
    }
}
