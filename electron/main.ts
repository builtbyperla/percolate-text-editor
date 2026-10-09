// Namespace import instead of named — Electron 43's runtime module has
// property getters that don't survive Rollup's default named-import interop.
// `electron.app` resolves correctly; `import { app }` from 'electron' does not.
import * as electron from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import * as pty from 'node-pty';
import { rgPath } from '@vscode/ripgrep';
import {
    FS_CHANNELS,
    FsEntryDTO,
    FsStatDTO,
    WATCH_CHANNELS,
    WORKSPACE_WATCH_CHANNELS,
    FileEventDTO,
    FileEventKindDTO,
    PTY_CHANNELS,
    PtySpawnDTO,
    PtyExitDTO,
    SEARCH_CHANNELS,
    SearchQueryDTO,
    SearchMatchDTO,
    AGENT_CHANNELS,
} from './ipcChannels';
import type { AgentSettingsUpdateDTO, ApprovalMode, ControlResponsesDTO, UserInteractionDTO } from '../shared/agentProtocol';
import { AgentService } from './agent/AgentService';
import { SessionRepository } from './agent/SessionRepository';
import { AgentConfigStore } from './agent/AgentConfigStore';
import { ToolRegistry } from './agent/ToolRegistry';
import { isIgnoredPath } from './ignoreRules';
import { buildRgArgs, parseRgLine } from './searchCore';
import { APP_METADATA } from '../src/appMetadata';

const { app, BrowserWindow, ipcMain } = electron;

// electron-vite injects this in dev; absent in packaged builds.
const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];
const APP_ICON_PATH = DEV_SERVER_URL
    ? path.join(app.getAppPath(), 'public', 'app-icon.png')
    : path.join(__dirname, '../renderer/app-icon.png');

// The workspace root the renderer opens. Resolved in MAIN (which has a full
// Node runtime) — never in the sandboxed preload, whose `process` is a shim
// with no `cwd()`. Passed to the preload via additionalArguments below; this
// is the same way VS Code hands its sandboxed renderer its workspace path.
const ROOT_ARG_PREFIX = '--percolate-root=';
const workspaceRoot = process.cwd();

// Set this before ready so the macOS application menu and dock use the same
// product name as the renderer-owned title bar.
app.setName(APP_METADATA.name);

// The single application window. Held so lifecycle events (activate on macOS)
// can bring it back without spawning duplicates.
let mainWindow: electron.BrowserWindow | null = null;
let agentService: AgentService;
let agentConfig: AgentConfigStore;

function registerAgentHandlers(): void {
    ipcMain.handle(AGENT_CHANNELS.attachmentSupport, () => agentService.attachmentSupport());
    ipcMain.handle(AGENT_CHANNELS.createSession, (e, agent?: string) => agentService.create(e.sender, agent));
    ipcMain.handle(AGENT_CHANNELS.listSessions, () => agentService.list());
    ipcMain.handle(AGENT_CHANNELS.loadSession, (e, id: string) => agentService.load(id, e.sender));
    ipcMain.handle(AGENT_CHANNELS.forkSession, (e, id: string, throughBlockId?: string) => agentService.fork(id, e.sender, throughBlockId));
    ipcMain.handle(AGENT_CHANNELS.renameSession, (_e, id: string, displayName: string) => agentService.rename(id, displayName));
    ipcMain.handle(AGENT_CHANNELS.archiveSession, (_e, id: string) => agentService.archive(id));
    ipcMain.handle(AGENT_CHANNELS.send, (_e, input: UserInteractionDTO) => agentService.send(input));
    ipcMain.handle(AGENT_CHANNELS.respond, (_e, input: ControlResponsesDTO) => agentService.respond(input));
    ipcMain.handle(AGENT_CHANNELS.cancel, (_e, id: string) => agentService.cancel(id));
    ipcMain.handle(AGENT_CHANNELS.stop, (_e, id: string) => agentService.stop(id));
    ipcMain.handle(AGENT_CHANNELS.undo, (_e, id: string, toolCallId: string) => agentService.undo(id, toolCallId));
    ipcMain.handle(AGENT_CHANNELS.readFileEdit, (_e, sessionId: string, artifactId: string) => agentService.readFileEdit(sessionId, artifactId));
    ipcMain.handle(AGENT_CHANNELS.updateFileEdit, (_e, sessionId: string, artifactId: string, revision: number, content: string) => agentService.updateFileEdit(sessionId, artifactId, revision, content));
    ipcMain.handle(AGENT_CHANNELS.contextStats, (_e, id: string) => agentService.contextStats(id));
    ipcMain.handle(AGENT_CHANNELS.compact, (_e, id: string) => agentService.compact(id));
    ipcMain.handle(AGENT_CHANNELS.setPaused, (_e, id: string, paused: boolean) => agentService.setPaused(id, paused));
    ipcMain.handle(AGENT_CHANNELS.setApprovalMode, (_e, id: string, mode: ApprovalMode) => agentService.setApprovalMode(id, mode));
    ipcMain.handle(AGENT_CHANNELS.getSettings, () => agentConfig.get());
    ipcMain.handle(AGENT_CHANNELS.updateSettings, (_e, value: AgentSettingsUpdateDTO) => {
        const provider = value.provider === 'anthropic' ? 'anthropic' : value.provider === 'openai' ? 'openai' : undefined;
        const changedProvider = provider != null && provider !== agentConfig.get().provider;
        return agentConfig.update({
            ...(provider ? { provider } : {}),
            ...(typeof value.model === 'string' ? { model: value.model } : {}),
            ...(changedProvider ? { apiKeyFile: undefined } : {}),
        });
    });
    ipcMain.handle(AGENT_CHANNELS.chooseApiKeyFile, async () => {
        const options: electron.OpenDialogOptions = { title: 'Choose API key file', properties: ['openFile'] };
        const result = mainWindow ? await electron.dialog.showOpenDialog(mainWindow, options) : await electron.dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths[0]) return agentConfig.get();
        return agentConfig.update({ apiKeyFile: result.filePaths[0] });
    });
    ipcMain.handle(AGENT_CHANNELS.revealApiKeyFile, () => {
        const filename = agentConfig.get().apiKeyFile;
        if (filename) electron.shell.showItemInFolder(filename);
    });
}

function createWindow(): void {
    mainWindow = new BrowserWindow({
        title: APP_METADATA.windowTitle,
        icon: APP_ICON_PATH,
        width: 1400,
        height: 900,
        show: false,
        // Let the renderer draw the title-bar surface while Electron keeps the
        // platform-native traffic lights/window controls on top of it.
        titleBarStyle: 'hidden',
        ...(process.platform === 'darwin'
            ? { trafficLightPosition: { x: 12, y: 8 } }
            : {
                titleBarOverlay: {
                    color: '#fafafa',
                    symbolColor: '#6b7280',
                    height: APP_METADATA.windowChrome.titleBarHeight,
                },
            }),
        webPreferences: {
            // Secure defaults — anything less and the renderer can reach into Node.
            // The preload script is the ONLY trusted bridge to main-process capabilities.
            preload: path.join(__dirname, '../preload/index.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            // How the sandboxed preload learns the workspace root: appended to
            // its process.argv (which IS populated under sandbox, unlike cwd()).
            // A single readonly string, not a capability — the renderer still
            // reaches the filesystem only through the vetted IPC handlers.
            additionalArguments: [`${ROOT_ARG_PREFIX}${workspaceRoot}`],
        },
    });

    // Only show once the renderer's first paint is ready — avoids a flash of
    // empty chrome while Vite's HMR runtime is still warming up.
    mainWindow.once('ready-to-show', () => mainWindow?.show());

    if (DEV_SERVER_URL) {
        mainWindow.loadURL(DEV_SERVER_URL);
    } else {
        // Packaged path: renderer's index.html sits under out/renderer/ next
        // to out/main/ (electron-vite's default layout).
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
}

// ---- Filesystem IPC handlers ---------------------------------------------
//
// Each handler is a thin wrapper over node:fs. Errors are re-thrown so
// Electron marshals them back to the renderer's Promise rejection — the
// DesktopFileSystemProvider on the other side surfaces them like any
// FileSystemProvider error.
function registerFsHandlers(): void {
    ipcMain.handle(FS_CHANNELS.chooseFile, async (): Promise<string | null> => {
        const options: electron.OpenDialogOptions = {
            title: 'Open file',
            defaultPath: workspaceRoot,
            properties: ['openFile'],
        };
        const result = mainWindow
            ? await electron.dialog.showOpenDialog(mainWindow, options)
            : await electron.dialog.showOpenDialog(options);
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });

    ipcMain.handle(FS_CHANNELS.chooseFolder, async (): Promise<string | null> => {
        const options: electron.OpenDialogOptions = {
            title: 'Open folder',
            defaultPath: workspaceRoot,
            properties: ['openDirectory'],
        };
        const result = mainWindow
            ? await electron.dialog.showOpenDialog(mainWindow, options)
            : await electron.dialog.showOpenDialog(options);
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });

    ipcMain.handle(FS_CHANNELS.chooseNewFile, async (_e, defaultPath?: string): Promise<string | null> => {
        const options: electron.SaveDialogOptions = {
            title: 'New file',
            defaultPath: defaultPath || workspaceRoot,
            buttonLabel: 'Create',
        };
        const result = mainWindow
            ? await electron.dialog.showSaveDialog(mainWindow, options)
            : await electron.dialog.showSaveDialog(options);
        return result.canceled ? null : (result.filePath ?? null);
    });

    ipcMain.handle(FS_CHANNELS.listDir, async (_e, dirPath: string): Promise<FsEntryDTO[]> => {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.map(d => ({
            name: d.name,
            path: path.join(dirPath, d.name),
            kind: d.isDirectory() ? 'dir' : 'file',
        }));
    });

    ipcMain.handle(FS_CHANNELS.readFile, async (_e, filePath: string): Promise<string> => {
        return await fs.readFile(filePath, 'utf-8');
    });

    ipcMain.handle(FS_CHANNELS.writeFile, async (_e, filePath: string, contents: string): Promise<void> => {
        await fs.writeFile(filePath, contents, 'utf-8');
    });

    ipcMain.handle(FS_CHANNELS.stat, async (_e, targetPath: string): Promise<FsStatDTO> => {
        const s = await fs.stat(targetPath);
        return {
            path: targetPath,
            kind: s.isDirectory() ? 'dir' : 'file',
            size: s.size,
            mtimeMs: s.mtimeMs,
        };
    });

    ipcMain.handle(FS_CHANNELS.mkdir, async (_e, dirPath: string): Promise<void> => {
        await fs.mkdir(dirPath, { recursive: true });
    });

    ipcMain.handle(FS_CHANNELS.delete, async (_e, targetPath: string): Promise<void> => {
        await fs.rm(targetPath, { recursive: true, force: true });
    });

    ipcMain.handle(FS_CHANNELS.rename, async (_e, from: string, to: string): Promise<void> => {
        await fs.rename(from, to);
    });
}

// ---- Watcher IPC ---------------------------------------------------------
//
// One chokidar FSWatcher per active subscription — the renderer's
// DesktopFileSystemProvider.watch (called from the file explorer's openFile)
// registers a subscription per open file. Simple, matches Step 4's
// per-open-file scope (plan §11). Cleanup runs on watch:stop or when the
// owning window closes (whichever comes first) so a stale watcher can't leak
// past its owner.
const watchers = new Map<string, FSWatcher>();

function registerWatchHandlers(): void {
    ipcMain.handle(WATCH_CHANNELS.start, async (e, watchId: string, targetPath: string): Promise<void> => {
        // `ignoreInitial` suppresses the synthetic 'add' chokidar fires on
        // startup for existing files — the renderer only cares about real
        // subsequent changes. `awaitWriteFinish` coalesces multi-write saves
        // (editors often write via temp+rename or byte-by-byte) into one event
        // so the model doesn't reload mid-write and see truncated content.
        const w = chokidar.watch(targetPath, {
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 20 },
        });
        watchers.set(watchId, w);

        const eventChannel = `${WATCH_CHANNELS.event}${watchId}`;
        const sender = e.sender;

        // Forward every relevant chokidar event on the id-scoped channel. The
        // renderer's provider re-emits it as a FileEvent; downstream views
        // route by kind (change → reload, unlink → detach, ...). Sending
        // through the specific WebContents that started this subscription
        // (rather than broadcasting) keeps multi-window isolation intact even
        // though we only open one BrowserWindow today.
        const forward = (kind: FileEventKindDTO) => (chokidarPath: string) => {
            if (sender.isDestroyed()) return;
            const payload: FileEventDTO = { kind, path: chokidarPath };
            sender.send(eventChannel, payload);
        };
        w.on('change', forward('change'));
        w.on('add', forward('add'));
        w.on('unlink', forward('unlink'));
        w.on('addDir', forward('addDir'));
        w.on('unlinkDir', forward('unlinkDir'));
    });

    ipcMain.handle(WATCH_CHANNELS.stop, async (_e, watchId: string): Promise<void> => {
        const w = watchers.get(watchId);
        if (!w) return;
        watchers.delete(watchId);
        await w.close();
    });
}

// ---- Workspace watcher IPC -----------------------------------------------
//
// ONE recursive chokidar watcher on the workspace root, session-scoped rather
// than per-file — so it's a single nullable handle, not the Map above. Drives
// the live file tree: structural events (add/unlink/addDir/unlinkDir) route
// into the affected directory's listing on the renderer side. `ignored` skips
// node_modules/.git/etc; recursive watching floods on large repos without it,
// so it's load-bearing. `ignoreInitial` suppresses the startup add-storm; a
// rename arrives as unlink+add (possibly across dirs), which the renderer's
// re-list-the-dir reconciliation tolerates without assuming atomic moves.
let workspaceWatcher: FSWatcher | null = null;

function registerWorkspaceWatchHandler(): void {
    ipcMain.handle(WORKSPACE_WATCH_CHANNELS.start, async (e, watchId: string): Promise<void> => {
        // Idempotent: a second start (e.g. renderer reload) replaces the old
        // watcher rather than leaking a second recursive tree scan.
        if (workspaceWatcher) {
            await workspaceWatcher.close();
            workspaceWatcher = null;
        }
        const w = chokidar.watch(workspaceRoot, {
            ignoreInitial: true,
            ignored: (p: string) => isIgnoredPath(p),
            awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 20 },
        });
        workspaceWatcher = w;

        const eventChannel = `${WORKSPACE_WATCH_CHANNELS.event}${watchId}`;
        const sender = e.sender;

        // Same per-sender forward as the per-file watcher: route every
        // structural kind on the id-scoped channel, guarded against a window
        // that closed mid-scan.
        const forward = (kind: FileEventKindDTO) => (chokidarPath: string) => {
            if (sender.isDestroyed()) return;
            const payload: FileEventDTO = { kind, path: chokidarPath };
            sender.send(eventChannel, payload);
        };
        w.on('add', forward('add'));
        w.on('unlink', forward('unlink'));
        w.on('addDir', forward('addDir'));
        w.on('unlinkDir', forward('unlinkDir'));
        // `change` is intentionally NOT forwarded here — content edits are the
        // per-file watcher's job; the tree only cares about structure.
    });

    ipcMain.handle(WORKSPACE_WATCH_CHANNELS.stop, async (): Promise<void> => {
        if (!workspaceWatcher) return;
        const w = workspaceWatcher;
        workspaceWatcher = null;
        await w.close();
    });
}

// Fire-and-forget close-all. Called on window-all-closed so a lingering
// watcher doesn't hold file descriptors after the UI is gone. Closes both the
// per-file watchers and the session-scoped workspace watcher.
async function closeAllWatchers(): Promise<void> {
    const closes: Promise<void>[] = [];
    for (const w of watchers.values()) closes.push(w.close());
    watchers.clear();
    if (workspaceWatcher) {
        closes.push(workspaceWatcher.close());
        workspaceWatcher = null;
    }
    await Promise.allSettled(closes);
}

// ---- Pty IPC -------------------------------------------------------------
//
// One node-pty process per session, keyed by a main-minted id. The renderer's
// DesktopPtyProvider.spawn awaits the id, then addresses write/resize/kill by
// it and subscribes to the id-scoped data/exit channels. node-pty's own data
// and exit callbacks are forwarded straight through to the owning WebContents,
// same per-sender discipline as the watcher forwarder.
const ptys = new Map<string, pty.IPty>();

// Platform login shell. On Windows the pty host is PowerShell; elsewhere the
// user's $SHELL, falling back to a POSIX default. Matches what a fresh terminal
// tab would otherwise get from the OS.
function defaultShell(): string {
    if (process.platform === 'win32') return process.env['COMSPEC'] ?? 'powershell.exe';
    return process.env['SHELL'] ?? '/bin/bash';
}

function registerPtyHandlers(): void {
    ipcMain.handle(PTY_CHANNELS.spawn, async (e, opts: PtySpawnDTO): Promise<string> => {
        const id = randomUUID();
        const shell = opts.shell ?? defaultShell();
        // env is MERGED over process.env (never replacing it): a pty with a
        // stripped environment loses PATH and the shell can't find binaries.
        const proc = pty.spawn(shell, [], {
            name: 'xterm-256color',
            cols: opts.cols,
            rows: opts.rows,
            cwd: opts.cwd ?? os.homedir(),
            env: { ...process.env, ...opts.env } as Record<string, string>,
        });
        ptys.set(id, proc);

        const dataChannel = `${PTY_CHANNELS.data}${id}`;
        const exitChannel = `${PTY_CHANNELS.exit}${id}`;
        const sender = e.sender;

        // Forward shell output to the owning renderer. isDestroyed guards a
        // window that closed while the shell was still emitting.
        proc.onData(chunk => {
            if (sender.isDestroyed()) return;
            sender.send(dataChannel, chunk);
        });

        // On exit, notify the renderer (so it can print "[process exited]")
        // then drop the process from the table — a dead pty must not linger.
        proc.onExit(({ exitCode, signal }) => {
            if (!sender.isDestroyed()) {
                const payload: PtyExitDTO = { exitCode, signal };
                sender.send(exitChannel, payload);
            }
            ptys.delete(id);
        });

        return id;
    });

    ipcMain.handle(PTY_CHANNELS.write, async (_e, id: string, data: string): Promise<void> => {
        ptys.get(id)?.write(data);
    });

    ipcMain.handle(PTY_CHANNELS.resize, async (_e, id: string, cols: number, rows: number): Promise<void> => {
        // A resize on a torn-down id is a no-op, not an error — the renderer's
        // ResizeObserver can fire once after the session has already exited.
        ptys.get(id)?.resize(cols, rows);
    });

    ipcMain.handle(PTY_CHANNELS.kill, async (_e, id: string): Promise<void> => {
        const proc = ptys.get(id);
        if (!proc) return;
        ptys.delete(id);
        proc.kill();
    });
}

// Kill every live shell. Called on window-all-closed alongside the watchers so
// no orphaned shell process outlives the UI.
function killAllPtys(): void {
    for (const p of ptys.values()) {
        try {
            p.kill();
        } catch {
            // A pty that already exited throws on kill; nothing to clean up.
        }
    }
    ptys.clear();
}

// ---- Search IPC ----------------------------------------------------------
//
// One ripgrep child per active search, keyed by a renderer-minted searchId.
// rg's --json output streams on stdout; we buffer it into whole lines, parse
// each into a SearchMatchDTO, and forward on the id-scoped result channel (same
// per-sender discipline as watcher/pty). `done` fires when rg exits. A new
// search from the same panel cancels the prior one (the renderer disposes it),
// so at most one rg per panel runs at a time.
const searches = new Map<string, ChildProcessWithoutNullStreams>();

// Upper bound on forwarded matches per search — a pathological query (e.g. `.`
// with regex on a huge tree) would otherwise flood IPC. Past the cap we kill rg
// and send done; the UI shows a "results truncated" state.
const MAX_SEARCH_MATCHES = 2000;

function registerSearchHandlers(): void {
    ipcMain.handle(SEARCH_CHANNELS.run, async (e, searchId: string, query: SearchQueryDTO): Promise<void> => {
        // An empty query would make rg match everything; the renderer already
        // guards this, but treat it as an immediate no-result completion too.
        if (!query.query) {
            const doneChannel = `${SEARCH_CHANNELS.done}${searchId}`;
            if (!e.sender.isDestroyed()) e.sender.send(doneChannel, undefined);
            return;
        }

        // Replace any prior child under this id (renderer reuse without an
        // explicit cancel round-trip).
        searches.get(searchId)?.kill();

        const child = spawn(rgPath, buildRgArgs(query, workspaceRoot), { cwd: workspaceRoot });
        searches.set(searchId, child);

        const resultChannel = `${SEARCH_CHANNELS.result}${searchId}`;
        const doneChannel = `${SEARCH_CHANNELS.done}${searchId}`;
        const sender = e.sender;

        let matchCount = 0;
        let buffer = ''; // holds a partial trailing line between stdout chunks

        const finish = () => {
            if (searches.get(searchId) === child) searches.delete(searchId);
            if (!sender.isDestroyed()) sender.send(doneChannel, undefined);
        };

        child.stdout.setEncoding('utf-8');
        child.stdout.on('data', (chunk: string) => {
            if (sender.isDestroyed()) return;
            buffer += chunk;
            // Process every complete line; keep the last (possibly partial) piece
            // in the buffer for the next chunk.
            let nl: number;
            while ((nl = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, nl);
                buffer = buffer.slice(nl + 1);
                const match = parseRgLine(line);
                if (!match) continue;
                sender.send(resultChannel, match);
                if (++matchCount >= MAX_SEARCH_MATCHES) {
                    child.kill(); // 'close' below will send done
                    return;
                }
            }
        });

        // rg writes usage/errors to stderr; a bad regex exits non-zero. Drain it
        // (avoids back-pressure stalling the child); the empty result set is the
        // renderer's signal, so we don't surface stderr as a result.
        child.stderr.resume();

        child.on('error', finish); // e.g. rg binary missing
        child.on('close', finish);
    });

    ipcMain.handle(SEARCH_CHANNELS.cancel, async (_e, searchId: string): Promise<void> => {
        const child = searches.get(searchId);
        if (!child) return;
        searches.delete(searchId);
        child.kill();
    });
}

// Kill every live ripgrep child. Called on window-all-closed alongside the
// watchers and ptys so no orphaned search outlives the UI.
function killAllSearches(): void {
    for (const c of searches.values()) {
        try {
            c.kill();
        } catch {
            // Already-exited child; nothing to clean up.
        }
    }
    searches.clear();
}

app.whenReady().then(async () => {
    // BrowserWindow's icon covers Windows/Linux; macOS gets its application
    // icon from the Dock while running an unpackaged development build.
    if (process.platform === 'darwin') app.dock.setIcon(APP_ICON_PATH);

    agentConfig = new AgentConfigStore(path.join(app.getPath('userData'), 'agent-settings.json'));
    await agentConfig.initialize();
    const undoDirectory = path.join(app.getPath('userData'), 'agent-undo');
    agentService = new AgentService(
        new SessionRepository(path.join(app.getPath('userData'), 'agent-sessions.sqlite3')),
        agentConfig,
        () => new ToolRegistry(workspaceRoot, process.env.AGENT_MODE === 'stub', undoDirectory, path.join(app.getPath('userData'), 'agent-file-edits')),
    );
    registerFsHandlers();
    registerWatchHandlers();
    registerWorkspaceWatchHandler();
    registerPtyHandlers();
    registerSearchHandlers();
    registerAgentHandlers();
    createWindow();

    // macOS convention: re-open a window when the dock icon is clicked and no
    // windows are open. On Windows/Linux the app already quit at that point.
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Everywhere except macOS, closing the last window quits the app. Watchers
// are released here (rather than in per-window teardown) so a lingering
// subscription can't outlive the UI even on macOS, where the app process
// stays resident. A future multi-window build should key watchers by owning
// WebContents id and tear per-window instead.
app.on('window-all-closed', () => {
    void closeAllWatchers();
    killAllPtys();
    killAllSearches();
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => agentService?.close());
