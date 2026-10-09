import { JSX } from "solid-js";
import { SplitPaneFrame } from "../containers/SplitPane";
import { ViewBlock } from "../containers/Tabs";
import appStyles from "../styles/App.module.css";

export class SideAgentPanel implements ViewBlock {
    ownsScroll: boolean = true;
    splitFrame: SplitPaneFrame<ViewBlock>;

    constructor(splitFrame: SplitPaneFrame<ViewBlock>) {
        this.splitFrame = splitFrame;
    }

    getVisual(): () => JSX.Element {
        return () => (
            <div class={appStyles.chatPane}>
                {this.splitFrame.getVisual()()}
            </div>
        );
    }
}
