import type { ContextItem, ContextView } from '../annotation/ContextItem';
import type { Tab, TabContainer, ViewBlock } from '../containers/Tabs';
import type { TabSplitPaneFrame } from '../containers/TabSplitPane';
import { TabPaneUtils } from '../utility/TabPaneUtils';

export interface RevealCandidate {
    container: TabContainer;
    tab: Tab;
    view: ContextView;
    active: boolean;
}

function asContextView(view: object): ContextView | null {
    const candidate = view as Partial<ContextView>;
    return typeof candidate.sourceId === 'string'
        && typeof candidate.scrollToItem === 'function'
        && typeof candidate.getSubViews === 'function'
        ? candidate as ContextView
        : null;
}

export interface ContextViewHost {
    getContextViews(): ContextView[];
}

function asHost(view: object): ContextViewHost | null {
    const candidate = view as Partial<ContextViewHost>;
    return typeof candidate.getContextViews === 'function'
        ? candidate as ContextViewHost
        : null;
}

export class ViewLocator {
    private root: TabSplitPaneFrame | null = null;

    setRoot(root: TabSplitPaneFrame): void {
        this.root = root;
    }

    findItem(item: ContextItem): RevealCandidate | null {
        if (this.root == null) return null;

        const sourceId = item.groupKey();
        let fallback: RevealCandidate | null = null;

        for (const container of TabPaneUtils.bfs_walk_tab_containers(this.root)) {
            const activeTab = container.getActiveTab();
            for (const tab of container.getTabsList()) {
                const view = this.matchIn(tab.view, sourceId);
                if (view == null) continue;

                const candidate: RevealCandidate = {
                    container, tab, view, active: tab === activeTab,
                };
                // Tier 1: already visible. Nothing beats it, so stop here.
                if (candidate.active) return candidate;
                // Tier 2: open but backgrounded. Keep the first and keep looking —
                // an active hit in a later container still wins.
                fallback ??= candidate;
            }
        }

        return fallback;
    }

    showItem(item: ContextItem): boolean {
        const hit = this.findItem(item);
        if (hit == null) return false;

        if (!hit.active) hit.container.selectTab(hit.tab);
        hit.view.scrollToItem(item);
        return true;
    }

    private matchIn(view: ViewBlock, sourceId: string): ContextView | null {
        const host = asHost(view);
        if (host != null) {
            for (const hosted of host.getContextViews()) {
                const match = this.matchView(hosted, sourceId);
                if (match != null) return match;
            }
        }

        const asView = asContextView(view);
        return asView != null ? this.matchView(asView, sourceId) : null;
    }

    // A view or one of its own sub-views, by source.
    private matchView(view: ContextView, sourceId: string): ContextView | null {
        if (view.sourceId === sourceId) return view;
        for (const sub of view.getSubViews()) {
            if (sub.sourceId === sourceId) return sub;
        }
        return null;
    }
}

export const viewLocator = new ViewLocator();
