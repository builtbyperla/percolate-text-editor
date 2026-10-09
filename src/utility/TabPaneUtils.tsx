import { SubNode, Tab, TabContainer } from "../containers/Tabs";
import { TabSplitPaneFrame } from "../containers/TabSplitPane";

export class TabPaneUtils {
    public static *bfs_walk_tab_containers(root: TabSplitPaneFrame): Generator<TabContainer> {
        let queue: SubNode[] = [root];
        while (queue.length > 0) {
            const node = queue.shift();
            console.log(queue, node);
            if (node instanceof TabSplitPaneFrame) {
                queue.push(...node.getPanes());
            } else if (node instanceof TabContainer) {
                yield node;
            }
        }
    }

    public static *bfs_walk_tab_frames(root: TabSplitPaneFrame): Generator<TabSplitPaneFrame> {
        let queue: SubNode[] = [root];
        while (queue.length > 0) {
            const node = queue.shift();
            if (node instanceof TabSplitPaneFrame) {
                yield node;
                queue.push(...node.getPanes());
            }
        }
    }

    public static *dfs_walk_frames(root: TabSplitPaneFrame): Generator<TabSplitPaneFrame> {
        let stack: SubNode[] = [root];
        while (stack.length > 0) {
            const node = stack.pop();
            if (node instanceof TabSplitPaneFrame) {
                yield node;
                stack.push(...node.getPanes());
            }
        }
    }
}