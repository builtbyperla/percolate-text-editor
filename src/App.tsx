import { createEffect, type Component } from 'solid-js';
import { LiveTextComponent } from './annotation/TextViewCore';
import { LiveContainerComponent } from './containers/LiveContainer';
import { SplitPaneFrame } from './containers/SplitPane';
import { AdvancedSplitPaneFrame } from './containers/AdvancedSplitPane';
import { TabSplitPaneFrame } from './containers/TabSplitPane';
import { EvidencePane } from './featurepanes/EvidenceBlock';
import { ActivityPane, AgentToolsPane, createActivityToolTab, createContextToolTab, createSessionsToolTab, SessionsPane } from './featurepanes/AgentToolsPane';
import { TabContainer, ViewBlock } from './containers/Tabs';
import { FileTab, MarkdownTab, DiffTab, SampleTab } from './containers/tabKinds';
import { LiveTextBox } from './components/CoreVisuals';
import { AppContainer } from './appcore/AppContainer';
import { PaneWorkspace } from './appcore/PaneWorkspace';
import { SideAgentPanel } from './appcore/SideAgentPanel';
import { BuilderArea } from './agentbench/BuilderArea';
import { DualTextView } from './editor/DualTextView';
import { MarkdownView } from './markdown/MarkdownView';
import { DiffView } from './editor/diff/DiffView';
import { FileSystemProvider } from './fileexplorer/FileSystemProvider';
import { InMemoryFileProvider } from './fileexplorer/InMemoryFileProvider';
import { DesktopFileSystemProvider } from './fileexplorer/DesktopFileSystemProvider';
import { FixedTargetRouter, TopLeftRouter } from './fileexplorer/OpenTargetRouter';
import { TabPaneUtils } from './utility/TabPaneUtils';
import { FileExplorerView } from './fileexplorer/FileExplorerView';
import { ToolbarHost } from './toolbar/ToolbarHost';
import { SettingsToolbarModule } from './toolbar/SettingsToolbarModule';
import { InteractionToolbarModule } from './toolbar/InteractionToolbarModule';
import { SettingsWindowProvider } from './settings/SettingsWindow';
import { TerminalToolbarModule } from './toolbar/TerminalToolbarModule';
import { AgentChatPane } from './chat/AgentChatPane';
import { ToolBlock } from './chat/ChatBlockModel';
import { createAgentClient } from './agent/createAgentClient';
import { viewLocator } from './interactions/ViewLocator';
import { SourceId, TemporarySource } from './textmodel/SourceId';
import { PtyProvider } from './terminal/PtyProvider';
import { DesktopPtyProvider } from './terminal/DesktopPtyProvider';
import { NullPtyProvider } from './terminal/NullPtyProvider';
import { TerminalTabContainer } from './terminal/TerminalTabContainer';
import { SearchProvider } from './search/SearchProvider';
import { DesktopSearchProvider } from './search/DesktopSearchProvider';
import { NullSearchProvider } from './search/NullSearchProvider';
import { SearchView } from './search/SearchView';
import { DemoTour } from './demo/DemoTour';
import { seedDemoWorkspace } from './demo/seedDemoWorkspace';
import { DEMO_DIRS, DEMO_FILES, TRACE_PY } from './demo/demoFiles';
import { userSettings } from './UserSettings';
import { PreselectAction } from './interactions/PreselectManager';
import { applyAppearanceTheme } from './theme/appearanceThemes';
import { AppTitleBar } from './appcore/AppTitleBar';
import styles from './styles/App.module.css';
const App: Component = () => {
    createEffect(() => applyAppearanceTheme(
        userSettings.appearance.customTheme() ?? userSettings.appearance.theme(),
    ));

    const sampleCodeText = `[2026-04-16 09:12:03] INFO  agent=planner    task_id=t-881  Received task: "Summarize Q1 sales report and flag anomalies"
[2026-04-16 09:12:03] DEBUG agent=planner    task_id=t-881  Decomposing task into subtasks
[2026-04-16 09:12:04] INFO  agent=planner    task_id=t-881  Subtasks: [fetch_report, parse_data, detect_anomalies, summarize]
[2026-04-16 09:12:04] INFO  agent=retriever  task_id=t-881  Fetching document: "Q1_sales_2026.pdf"
[2026-04-16 09:12:05] DEBUG agent=retriever  task_id=t-881  Vector search top-k=5 query="Q1 sales figures"
[2026-04-16 09:12:05] DEBUG agent=retriever  task_id=t-881  Hit: chunk_id=c-204 score=0.91
[2026-04-16 09:12:05] DEBUG agent=retriever  task_id=t-881  Hit: chunk_id=c-205 score=0.87
[2026-04-16 09:12:06] INFO  agent=retriever  task_id=t-881  Retrieved 5 chunks (2,340 tokens)
[2026-04-16 09:12:06] INFO  agent=analyst    task_id=t-881  Parsing revenue data from chunks
[2026-04-16 09:12:07] DEBUG agent=analyst    task_id=t-881  Parsed 12 rows, 4 columns
[2026-04-16 09:12:07] WARN  agent=analyst    task_id=t-881  Missing value in row 7 col "region" — imputing with prior month
[2026-04-16 09:12:08] INFO  agent=analyst    task_id=t-881  Running anomaly detection (z-score threshold=2.5)
[2026-04-16 09:12:08] WARN  agent=analyst    task_id=t-881  Anomaly: Feb APAC revenue $1.2M vs expected $3.4M (z=-3.1)
[2026-04-16 09:12:09] INFO  agent=summarizer task_id=t-881  Generating summary (model=claude-sonnet-4-6)
[2026-04-16 09:12:11] DEBUG agent=summarizer task_id=t-881  Prompt tokens=1820 completion_tokens=312
[2026-04-16 09:12:11] INFO  agent=summarizer task_id=t-881  Summary complete
[2026-04-16 09:12:11] INFO  agent=planner    task_id=t-881  All subtasks complete — returning result
`;

    // const container = new LiveContainerComponent();
    const textbox1 = new LiveTextComponent({"text" : `>>> running plan_task("research competitors in vector db space")
[planner] starting...
[planner] messages so far: 0
[planner] calling model...
[planner] got response, checking for tool calls
[planner] tool_call: search_web("top vector databases 2026")
  -> calling search_web...
  -> result: ['Pinecone', 'Weaviate', 'Qdrant', 'Chroma', 'pgvector']
[planner] tool_call: search_web("Pinecone pricing and limits")
  -> calling search_web...
  -> result: {'free_tier': '2GB', 'paid': '$0.096/hr', 'max_dims': 20000}
[planner] tool_call: search_web("Weaviate vs Qdrant benchmark 2026")
  -> calling search_web...
  -> ConnectionError: timed out after 5s
  -> retrying (1/2)...
  -> result: {'latency_ms': {'weaviate': 12, 'qdrant': 8}, 'recall': {'weaviate': 0.97, 'qdrant': 0.98}}
[planner] messages so far: 6
[planner] no more tool calls, generating final answer
[planner] done. total tool calls: 3, retries: 1
output: "Qdrant leads on latency (8ms) and recall (0.98). Pinecone is easiest to set up..."
`});
    const textbox2 = new LiveTextComponent({"text" : `{
  "resourceSpans": [{
    "resource": { "attributes": [{ "key": "service.name", "value": "agent-orchestrator" }] },
    "scopeSpans": [{
      "spans": [
        {
          "traceId": "3f2a1b4c8e9d0f7a",
          "spanId": "a1b2c3d4",
          "parentSpanId": null,
          "name": "agent.run",
          "startTime": "2026-04-16T09:15:00.000Z",
          "endTime":   "2026-04-16T09:15:09.412Z",
          "status": { "code": "OK" },
          "attributes": { "task_id": "t-917", "task": "research competitors" }
        },
        {
          "traceId": "3f2a1b4c8e9d0f7a",
          "spanId": "b2c3d4e5",
          "parentSpanId": "a1b2c3d4",
          "name": "tool.call/search_web",
          "startTime": "2026-04-16T09:15:01.100Z",
          "endTime":   "2026-04-16T09:15:02.340Z",
          "status": { "code": "OK" },
          "attributes": { "query": "top vector databases 2026", "result_count": 5 }
        },
        {
          "traceId": "3f2a1b4c8e9d0f7a",
          "spanId": "c3d4e5f6",
          "parentSpanId": "a1b2c3d4",
          "name": "tool.call/search_web",
          "startTime": "2026-04-16T09:15:03.010Z",
          "endTime":   "2026-04-16T09:15:07.880Z",
          "status": { "code": "ERROR" },
          "attributes": { "query": "Weaviate vs Qdrant benchmark", "retry_count": 1, "error": "ConnectionTimeout" }
        },
        {
          "traceId": "3f2a1b4c8e9d0f7a",
          "spanId": "d4e5f6a7",
          "parentSpanId": "a1b2c3d4",
          "name": "llm.completion",
          "startTime": "2026-04-16T09:15:08.001Z",
          "endTime":   "2026-04-16T09:15:09.400Z",
          "status": { "code": "OK" },
          "attributes": { "model": "claude-sonnet-4-6", "prompt_tokens": 2840, "completion_tokens": 388 }
        }
      ]
    }]
  }]
}
`});

    // const taba = new SampleTab(new TemporarySource("Tab A"), container);
    // const tabContainerA = new TabContainer([taba]);

    // tabContainerA.setActiveTab(tabb);

    // Same Python text the demo tree serves as src/trace.py (see demoFiles.ts) —
    // here it is a scratch literal, there a provider-backed file.
    const editorSampleCode = TRACE_PY;
    const basicEditorId = new SourceId('scratch', 'basic-editor', 'Editor');
    const editor = new DualTextView(basicEditorId.full(), editorSampleCode);
    // Dev sample: load this tab straight into annotate (read-only) mode.
    editor.setAnnotateMode();
    // FileTab's ctor builds the actions (whole-source toggle; no Save here since
    // this sample view has no save binding) — no post-construction setActions.
    const editorTab = new FileTab(basicEditorId, editor, true);

    const editorMirror = new DualTextView(basicEditorId.full(), editorSampleCode);
    const editorMirrorTab = new FileTab(new TemporarySource(__DEMO__ ? "Editor" : "Editor (mirror)"), editorMirror, true);
    // In demo builds the mirror is the point of the layout (see the split below),
    // so it goes in its own pane rather than into the legacy sample container.
    if (!__DEMO__) {
        // tabContainerA.addTab(editorMirrorTab);
    } else {
        // Left pane edits, right pane annotates — the two sides of one shared
        // model, which is what makes the live fan visible without any action.
        editorMirror.setAnnotateMode();
        editor.setEditMode();
    }

    // Dev sample: the annotate-only markdown reader view.
    const markdownSample = `# Markdown Reader

A paragraph with **bold**, *italic*, and \`inline code\` spans that
strip their markers when rendered.

## Bullets

- first item
  - nested item a
  - nested item b
- second item

A trailing paragraph after the list.

\`\`\`ts
const atomic = "code fences render but aren't sub-selectable";
\`\`\`
`;
    const markdownId = new SourceId('scratch', 'sample-markdown', 'Markdown');
    const markdownView = new MarkdownView(markdownId.full(), markdownSample);
    const markdownTab = new MarkdownTab(markdownId, markdownView, true);

    const diffOld = `function greet(name) {
  const msg = "hello " + name;
  console.log(msg);
  return msg;
}

const legacy = true;
const remove_me_a = 1;
const remove_me_b = 2;

export { greet };
`;
    const diffNew = `function greet(name) {
  const msg = \`hello \${name}\`;
  console.log(msg);
  return msg;
}

const added_x = 10;
const added_y = 20;
const added_z = 30;
const legacy = true;

export { greet };
`;
    const diffId = new SourceId('scratch', 'sample-diff', 'diff-example');
    const diffView = new DiffView(diffId.full(), diffOld, diffNew);
    const diffTab = new DiffTab(diffId, diffView, true);

    const tabContainerC = __DEMO__
        ? new TabContainer([])
        : new TabContainer([editorTab, markdownTab, diffTab]);

    // TabContainers are ViewBlocks now — placed directly as panes, no wrapper.
    const splitFrame = new TabSplitPaneFrame(true, [tabContainerC]);

    viewLocator.setRoot(splitFrame);

    const fileProvider: FileSystemProvider = window.desktopBridge
        ? new DesktopFileSystemProvider(window.desktopBridge)
        : __DEMO__
            ? new InMemoryFileProvider(DEMO_DIRS, DEMO_FILES)
            : new InMemoryFileProvider();
    const openRouter = new TopLeftRouter(splitFrame);
    const fileExplorer = new FileExplorerView(fileProvider, openRouter);

    const searchProvider: SearchProvider = window.desktopBridge
        ? new DesktopSearchProvider(window.desktopBridge)
        : new NullSearchProvider();
    const searchView = new SearchView(searchProvider, openRouter, fileProvider);

    // Interaction and general settings stay independently reachable as compact
    // rail panels; the general panel also opens the full settings window.
    const toolbar = new ToolbarHost([
        fileExplorer,
        searchView,
        new InteractionToolbarModule(),
        new SettingsToolbarModule(),
    ]);

    const terminalContainer = __DEMO__ ? undefined : (() => {
        const ptyProvider: PtyProvider = window.desktopBridge
            ? new DesktopPtyProvider(window.desktopBridge)
            : new NullPtyProvider();
        return new TerminalTabContainer(ptyProvider);
    })();

    const paneWorkspace = new PaneWorkspace(splitFrame, toolbar);

    // Tool views occupy only the upper box. The chat pane remains a sibling in
    // the split, so switching tools never remounts or replaces the chat flow.
    const evidencePane = new EvidencePane();
    const chatPane = new AgentChatPane(createAgentClient());
    chatPane.flow.onFileEditSettled = (sessionId, artifactId) => {
        const tabId = new SourceId('diff', `${sessionId}:${artifactId}`).full();
        for (const container of TabPaneUtils.bfs_walk_tab_containers(splitFrame)) {
            const tab = container.tabs.find(candidate => candidate.id === tabId);
            if (tab) {
                void container.closeTab(tab).catch(error => chatPane.flow.reportError(
                    error instanceof Error ? error.message : 'Unable to close file diff.',
                ));
                break;
            }
        }
    };
    chatPane.onOpenFileEdit = block => {
        void (async () => {
            const ref = block.getFileEdit();
            const sessionId = chatPane.flow.getSessionId();
            if (!ref || !sessionId) return;
            const sourceId = new SourceId('diff', `${sessionId}:${ref.artifactId}`, ref.path);
            for (const container of TabPaneUtils.bfs_walk_tab_containers(splitFrame)) {
                const tab = container.tabs.find(candidate => candidate.id === sourceId.full());
                if (tab) { container.selectTab(tab); return; }
            }
            const target = openRouter.resolveTarget({ name: ref.path, path: ref.path, kind: 'file' });
            const buffer = chatPane.flow.fileEditBuffer(ref);
            await buffer.load();
            const content = buffer.getContent();
            if (!content || content.settled) return;
            const view = new DiffView(sourceId.full(), content.before ?? '', content.after ?? '', {
                buffer,
                status: () => {
                    if (chatPane.flow.getSessionId() !== sessionId) return 'skipped';
                    const current = chatPane.flow.store.getBlocks().find(candidate => candidate instanceof ToolBlock && candidate.toolCallId === block.toolCallId) as ToolBlock | undefined;
                    return current?.getStatus() ?? 'skipped';
                },
                onAction: action => void chatPane.chooseAction(block.toolCallId, action),
            });
            const tab = new DiffTab(sourceId, view);
            target.addTab(tab);
            target.selectTab(tab);
        })().catch(error => chatPane.flow.reportError(error instanceof Error ? error.message : 'Unable to open file diff.'));
    };
    const agentToolsPane = new AgentToolsPane(
        [
            createContextToolTab(evidencePane),
            createSessionsToolTab(new SessionsPane(chatPane.flow)),
            createActivityToolTab(new ActivityPane(chatPane.flow, blockId => chatPane.revealBlock(blockId))),
        ],
    );
    const chatSplitFrame = new AdvancedSplitPaneFrame(false, [agentToolsPane, chatPane]);
    chatSplitFrame.fractionSetters[0](0.33);
    chatSplitFrame.fractionSetters[1](0.67);
    agentToolsPane.setCollapseListener((collapsed) => {
        if (collapsed) {
            chatSplitFrame.shrinkPane(agentToolsPane, agentToolsPane.minimumPaneSize);
        } else {
            chatSplitFrame.unshrinkPane(agentToolsPane);
        }
    });

    const appContainer = new AppContainer(
        paneWorkspace,
        new SideAgentPanel(chatSplitFrame),
        terminalContainer,
    );

    if (!__DEMO__) {
        const terminalModule = new TerminalToolbarModule(
            () => appContainer.toggleTerminalPane(),
            () => appContainer.getTerminalVisible(),
        );
        toolbar.modules.push(terminalModule);
    }

    if (__DEMO__) {
        void seedDemoWorkspace(splitFrame, fileProvider, openRouter, chatPane, diffTab).catch(
            (err: unknown) => console.error('demo seed failed', err),
        );
    }

    return (
        <SettingsWindowProvider>
            <div class={styles.appShell}>
                {!__DEMO__ && <AppTitleBar />}
                <main class={styles.appContent}>
                    {appContainer.getVisual()()}
                </main>
                <PreselectAction />
                {__DEMO__ && <DemoTour />}
            </div>
        </SettingsWindowProvider>
    );
};

export default App;
