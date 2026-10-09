import { TabContainer, type Tab } from '../containers/Tabs';
import { TabSplitPaneFrame } from '../containers/TabSplitPane';
import { DualTextView } from '../editor/DualTextView';
import { MarkdownDualView } from '../markdown/MarkdownDualView';
import { TabPaneUtils } from '../utility/TabPaneUtils';
import { openFileInEditor } from '../fileexplorer/openFileInEditor';
import type { FileSystemProvider, FsEntry } from '../fileexplorer/FileSystemProvider';
import type { OpenTargetRouter } from '../fileexplorer/OpenTargetRouter';
import type { AgentChatPane } from '../chat/AgentChatPane';
import { ContextItem } from '../annotation/ContextItem';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import { SplitPaneFrame } from '../containers/SplitPane';

const ORCHESTRATOR: FsEntry = {
    name: 'orchestrator.ts',
    path: 'inmemory:/src/orchestrator.ts',
    kind: 'file',
};

const WRITEUP: FsEntry = {
    name: 'run-2291.md',
    path: 'inmemory:/src/run-2291.md',
    kind: 'file',
};

function seedAnnotation(view: DualTextView): void {
    const item = new ContextItem(view);
    item.setRange(179, 390);
    item.setNote('Log the start time for the tool call');
    sourceContextRegistry.add(item);
}

function seedChat(chatPane: AgentChatPane): void {
    const store = chatPane.flow.store;

    store.applyUpdate({ blockId: 'demo-user-1', role: 'user', delta: 'lets set up some unit tests' });
    store.applyUpdate({ blockId: 'demo-user-1', done: true });

    store.applyUpdate({
        blockId: 'demo-tool-1',
        kind: 'tool',
        type: 'read',
        subject: 'src/orchestrator.ts',
        done: true,
    });

    store.applyUpdate({
        blockId: 'demo-assistant-1',
        role: 'assistant',
        delta:
            '## Cross-reference\n\nThe run completed, but `s-1` retried before ' +
            'succeeding — so a third of the wall time was **backoff**, not work. ' +
            '`StepRunner.retried` records it; nothing reads it yet.',
    });
    store.applyUpdate({ blockId: 'demo-assistant-1', done: true });
}

export async function seedDemoWorkspace(
    splitFrame: TabSplitPaneFrame,
    provider: FileSystemProvider,
    router: OpenTargetRouter,
    chatPane: AgentChatPane,
    diffTab: Tab,
): Promise<void> {
    // Left pane: two real files, the orchestrator reselected so it lands active
    // (opening the write-up second left ITS tab selected).
    await openFileInEditor(ORCHESTRATOR, provider, router);
    await openFileInEditor(WRITEUP, provider, router);

    const left = firstContainer(splitFrame);

    const writeupTab = left?.getTabsList().find(t => t.id.includes('run-2291.md'));
    const writeupView = writeupTab?.view;
    if (writeupView instanceof MarkdownDualView && writeupView.getMode() === 'raw') {
        writeupView.toggleMode();
    }

    const mainTab = left?.getTabsList().find(t => t.id.includes('orchestrator.ts'));
    if (left && mainTab) left.selectTab(mainTab);

    if (mainTab) {
        const mirrorTab = mainTab.copy();
        const mirror = mirrorTab.view as DualTextView;
        // Right side annotates while the left edits — one model, two modes, which
        // is what makes the live fan visible without the visitor doing anything.
        mirror.setAnnotateMode();
        // Diff rides along in the right pane, behind the mirror: reachable in one click
        // without displacing the annotate view the split exists to show.
        const right = new TabContainer([mirrorTab, diffTab]);
        splitFrame.addPane(right);
        right.selectTab(mirrorTab);

        seedAnnotation(mirror);
    }

    seedChat(chatPane);
}

// The leftmost tab container in the frame — where the router landed the files.
function firstContainer(frame: TabSplitPaneFrame): TabContainer | null {
    for (const c of TabPaneUtils.bfs_walk_tab_containers(frame)) return c;
    return null;
}
