import { contextBridge, ipcRenderer } from 'electron';
import {
    FS_CHANNELS,
    FsEntryDTO,
    FsStatDTO,
    WATCH_CHANNELS,
    WORKSPACE_WATCH_CHANNELS,
    FileEventDTO,
    PTY_CHANNELS,
    PtySpawnDTO,
    PtyExitDTO,
    SEARCH_CHANNELS,
    SearchQueryDTO,
    SearchMatchDTO,
    AGENT_CHANNELS,
} from './ipcChannels';
import type { AgentEvent, AgentSettingsDTO, AgentSettingsUpdateDTO, ApprovalMode, AttachmentSupportDTO, ContextStatsDTO, ControlResponsesDTO, FileEditContentDTO, FileEditRefDTO, SessionSnapshot, SessionSummary, UserInteractionDTO } from '../shared/agentProtocol';

// The desktop bridge — the ONLY surface the renderer sees for reaching main.
// contextIsolation is on, so `window.desktopBridge = ...` is silently rejected;
// we must go through contextBridge.exposeInMainWorld, which deep-clones the
// object across the isolated-world boundary.
//
// Shape mirrors FileSystemProvider one-to-one. DesktopFileSystemProvider on
// the renderer side is a thin marshaller — it holds a rootPath and delegates
// every method to the corresponding bridge call.
const fs = {
    chooseFile: (): Promise<string | null> => ipcRenderer.invoke(FS_CHANNELS.chooseFile),
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke(FS_CHANNELS.chooseFolder),
    chooseNewFile: (defaultPath?: string): Promise<string | null> =>
        ipcRenderer.invoke(FS_CHANNELS.chooseNewFile, defaultPath),
    listDir: (path: string): Promise<FsEntryDTO[]> => ipcRenderer.invoke(FS_CHANNELS.listDir, path),
    readFile: (path: string): Promise<string> => ipcRenderer.invoke(FS_CHANNELS.readFile, path),
    writeFile: (path: string, contents: string): Promise<void> =>
        ipcRenderer.invoke(FS_CHANNELS.writeFile, path, contents),
    stat: (path: string): Promise<FsStatDTO> => ipcRenderer.invoke(FS_CHANNELS.stat, path),
    mkdir: (path: string): Promise<void> => ipcRenderer.invoke(FS_CHANNELS.mkdir, path),
    delete: (path: string): Promise<void> => ipcRenderer.invoke(FS_CHANNELS.delete, path),
    rename: (from: string, to: string): Promise<void> =>
        ipcRenderer.invoke(FS_CHANNELS.rename, from, to),
};

// Watcher subscription surface. Each call opens a dedicated event channel and
// returns a Dispose that both removes the local listener and asks main to
// close the FSWatcher. Closures can't cross contextBridge, so the callback is
// stored on THIS side; only a serializable watchId travels main-ward.
//
// Random UUID keys the channel so two subscribers on the same path each get
// their own stream (an editor open + a peer view or future workspace-wide
// watcher can co-exist without stepping on each other's dispose).
//
// `globalThis.crypto` is Web Crypto, which IS present in a sandboxed preload
// (unlike `process.cwd()`) — minting the id here keeps watch() synchronous, so
// the Dispose returns without an await. Not the Node `crypto` module.
const watch = {
    watch: (targetPath: string, cb: (e: FileEventDTO) => void): (() => void) => {
        const watchId = globalThis.crypto.randomUUID();
        const channel = `${WATCH_CHANNELS.event}${watchId}`;
        const listener = (_e: unknown, payload: FileEventDTO) => cb(payload);
        ipcRenderer.on(channel, listener);
        void ipcRenderer.invoke(WATCH_CHANNELS.start, watchId, targetPath);
        return () => {
            ipcRenderer.off(channel, listener);
            void ipcRenderer.invoke(WATCH_CHANNELS.stop, watchId);
        };
    },

    // Subscribe to the ONE session-scoped recursive workspace watcher. Same
    // shape as watch(), but no path — the root is main's workspaceRoot, so only
    // the structural events (add/unlink/addDir/unlinkDir) come back, driving the
    // live file tree. Callback held preload-side; only the id crosses.
    watchWorkspace: (cb: (e: FileEventDTO) => void): (() => void) => {
        const watchId = globalThis.crypto.randomUUID();
        const channel = `${WORKSPACE_WATCH_CHANNELS.event}${watchId}`;
        const listener = (_e: unknown, payload: FileEventDTO) => cb(payload);
        ipcRenderer.on(channel, listener);
        void ipcRenderer.invoke(WORKSPACE_WATCH_CHANNELS.start, watchId);
        return () => {
            ipcRenderer.off(channel, listener);
            void ipcRenderer.invoke(WORKSPACE_WATCH_CHANNELS.stop, watchId);
        };
    },
};

// Pty subscription surface. spawn/write/resize/kill are addressed by the id
// main mints; onData/onExit open an id-scoped listener and return a Dispose,
// exactly like watch. Closures can't cross contextBridge, so the callback is
// held HERE and only the serializable id + data travel the wire.
const pty = {
    spawn: (opts: PtySpawnDTO): Promise<string> => ipcRenderer.invoke(PTY_CHANNELS.spawn, opts),
    write: (id: string, data: string): Promise<void> => ipcRenderer.invoke(PTY_CHANNELS.write, id, data),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
        ipcRenderer.invoke(PTY_CHANNELS.resize, id, cols, rows),
    kill: (id: string): Promise<void> => ipcRenderer.invoke(PTY_CHANNELS.kill, id),
    onData: (id: string, cb: (chunk: string) => void): (() => void) => {
        const channel = `${PTY_CHANNELS.data}${id}`;
        const listener = (_e: unknown, chunk: string) => cb(chunk);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.off(channel, listener);
    },
    onExit: (id: string, cb: (e: PtyExitDTO) => void): (() => void) => {
        const channel = `${PTY_CHANNELS.exit}${id}`;
        const listener = (_e: unknown, payload: PtyExitDTO) => cb(payload);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.off(channel, listener);
    },
};

// Search subscription surface. run() mints a searchId, opens id-scoped result
// + done channels, and fires the search; matches stream to onMatch, then onDone
// fires once. Returns a Dispose that cancels the rg child and removes both
// listeners. Callbacks held preload-side (can't cross contextBridge); only the
// id + serializable query/match travel the wire.
const search = {
    run: (
        query: SearchQueryDTO,
        onMatch: (m: SearchMatchDTO) => void,
        onDone: () => void,
    ): (() => void) => {
        const searchId = globalThis.crypto.randomUUID();
        const resultChannel = `${SEARCH_CHANNELS.result}${searchId}`;
        const doneChannel = `${SEARCH_CHANNELS.done}${searchId}`;
        const onResult = (_e: unknown, m: SearchMatchDTO) => onMatch(m);
        const onDoneListener = () => onDone();
        ipcRenderer.on(resultChannel, onResult);
        ipcRenderer.once(doneChannel, onDoneListener);
        void ipcRenderer.invoke(SEARCH_CHANNELS.run, searchId, query);
        return () => {
            ipcRenderer.off(resultChannel, onResult);
            ipcRenderer.off(doneChannel, onDoneListener);
            void ipcRenderer.invoke(SEARCH_CHANNELS.cancel, searchId);
        };
    },
};

const agent = {
    attachmentSupport: (): Promise<AttachmentSupportDTO | undefined> => ipcRenderer.invoke(AGENT_CHANNELS.attachmentSupport),
    createSession: (name?: string): Promise<SessionSummary> => ipcRenderer.invoke(AGENT_CHANNELS.createSession, name),
    listSessions: (): Promise<SessionSummary[]> => ipcRenderer.invoke(AGENT_CHANNELS.listSessions),
    loadSession: (id: string): Promise<SessionSnapshot> => ipcRenderer.invoke(AGENT_CHANNELS.loadSession, id),
    forkSession: (id: string, throughBlockId?: string): Promise<SessionSnapshot> => ipcRenderer.invoke(AGENT_CHANNELS.forkSession, id, throughBlockId),
    renameSession: (id: string, displayName: string): Promise<SessionSummary> => ipcRenderer.invoke(AGENT_CHANNELS.renameSession, id, displayName),
    archiveSession: (id: string): Promise<void> => ipcRenderer.invoke(AGENT_CHANNELS.archiveSession, id),
    send: (input: UserInteractionDTO): Promise<{ accepted: true }> => ipcRenderer.invoke(AGENT_CHANNELS.send, input),
    respond: (input: ControlResponsesDTO): Promise<{ accepted: true }> => ipcRenderer.invoke(AGENT_CHANNELS.respond, input),
    cancel: (sessionId: string): Promise<void> => ipcRenderer.invoke(AGENT_CHANNELS.cancel, sessionId),
    stop: (sessionId: string): Promise<void> => ipcRenderer.invoke(AGENT_CHANNELS.stop, sessionId),
    undo: (sessionId: string, toolCallId: string): Promise<void> => ipcRenderer.invoke(AGENT_CHANNELS.undo, sessionId, toolCallId),
    readFileEdit: (sessionId: string, artifactId: string): Promise<FileEditContentDTO> => ipcRenderer.invoke(AGENT_CHANNELS.readFileEdit, sessionId, artifactId),
    updateFileEdit: (sessionId: string, artifactId: string, revision: number, content: string): Promise<FileEditRefDTO> => ipcRenderer.invoke(AGENT_CHANNELS.updateFileEdit, sessionId, artifactId, revision, content),
    contextStats: (sessionId: string): Promise<ContextStatsDTO> => ipcRenderer.invoke(AGENT_CHANNELS.contextStats, sessionId),
    compact: (sessionId: string): Promise<SessionSnapshot> => ipcRenderer.invoke(AGENT_CHANNELS.compact, sessionId),
    setPaused: (sessionId: string, paused: boolean): Promise<void> => ipcRenderer.invoke(AGENT_CHANNELS.setPaused, sessionId, paused),
    setApprovalMode: (sessionId: string, mode: ApprovalMode): Promise<void> => ipcRenderer.invoke(AGENT_CHANNELS.setApprovalMode, sessionId, mode),
    getSettings: (): Promise<AgentSettingsDTO> => ipcRenderer.invoke(AGENT_CHANNELS.getSettings),
    updateSettings: (value: AgentSettingsUpdateDTO): Promise<AgentSettingsDTO> => ipcRenderer.invoke(AGENT_CHANNELS.updateSettings, value),
    chooseApiKeyFile: (): Promise<AgentSettingsDTO> => ipcRenderer.invoke(AGENT_CHANNELS.chooseApiKeyFile),
    revealApiKeyFile: (): Promise<void> => ipcRenderer.invoke(AGENT_CHANNELS.revealApiKeyFile),
    onEvent: (sessionId: string, cb: (event: AgentEvent) => void): (() => void) => {
        const channel = `${AGENT_CHANNELS.event}${sessionId}`;
        const listener = (_e: unknown, event: AgentEvent) => cb(event);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.off(channel, listener);
    },
};

// The renderer also needs to know its own root path. Under sandbox:true the
// preload's `process` is a shim with no cwd() — main resolves the real path and
// hands it over on process.argv via webPreferences.additionalArguments. We read
// it back here (argv IS populated in a sandboxed preload) rather than computing
// it, so no Node capability is needed. Exposed as a resolved value since it
// never changes for the app lifetime.
const rootArg = process.argv.find(a => a.startsWith('--percolate-root='));
const rootPath: string = rootArg ? rootArg.slice('--percolate-root='.length) : '';
const platform = process.platform;

contextBridge.exposeInMainWorld('desktopBridge', { fs, watch, pty, search, agent, rootPath, platform });

// Type export consumed by the renderer's window augmentation
// (src/electron/desktopBridge.d.ts). Keeps the shape defined in one place.
export type DesktopBridge = {
    fs: typeof fs;
    watch: typeof watch;
    pty: typeof pty;
    search: typeof search;
    agent: typeof agent;
    rootPath: string;
    platform: NodeJS.Platform;
};
