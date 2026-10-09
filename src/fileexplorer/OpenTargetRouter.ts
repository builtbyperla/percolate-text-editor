import { TabContainer } from '../containers/Tabs';
import { TabSplitPaneFrame } from '../containers/TabSplitPane';
import { TabPaneUtils } from '../utility/TabPaneUtils';
import { SourceId } from '../textmodel/SourceId';
import type { FsEntry } from './FileSystemProvider';

export interface OpenTargetRouter {
    resolveTarget(entry: FsEntry): TabContainer;
}

// Stub: always the one injected container (the right pane, for now).
export class FixedTargetRouter implements OpenTargetRouter {
    constructor(private target: TabContainer) {}

    resolveTarget(_entry: FsEntry): TabContainer {
        return this.target;
    }
}

export class TopLeftRouter implements OpenTargetRouter {
    root: TabSplitPaneFrame;

    constructor(root: TabSplitPaneFrame) {
        this.root = root;
    }

    resolveTarget(entry: FsEntry): TabContainer {
        const key = new SourceId('file', entry.path).full();
        let container: TabContainer | null = null;
        let firstContainer: TabContainer | null = null;
        let frameGenerator = TabPaneUtils.bfs_walk_tab_containers(this.root);
        for (let t of frameGenerator) {
            const tabs = t.getTabsList();
            if (firstContainer == null) {
                firstContainer = t;
            }

            for (let f of tabs) {
                if (f.id === key) {
                    container = t;
                    break;
                }
            }

            // Stop early if match found
            if (container != null) {
                break;
            }
        }

        // Not found case, use first container or create a new one
        if (container == null) {
            if (firstContainer == null) {
                container = new TabContainer([]);
                this.root.addPane(container);
            } else {
                container = firstContainer;
            }
        }

        console.log("Routing to", container);
        return container;
    }
}