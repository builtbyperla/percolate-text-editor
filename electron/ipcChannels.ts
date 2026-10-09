// Shared IPC channel contract. The single source of truth for the wire between
// main (handlers) and preload (invokers). The renderer never imports this file
// — it sees only the typed window.desktopBridge surface. Kept as string
// constants (not free literals) so a rename fails loudly at both ends.

// ---- Filesystem ----------------------------------------------------------
//
// One channel per FileSystemProvider method. Payloads are ordinary
// serializable objects — Electron's structured-clone IPC handles them
// without special encoding.
export const FS_CHANNELS = {
    chooseFile: 'fs:chooseFile',
    chooseFolder: 'fs:chooseFolder',
    chooseNewFile: 'fs:chooseNewFile',
    listDir: 'fs:listDir',
    readFile: 'fs:readFile',
    writeFile: 'fs:writeFile',
    stat: 'fs:stat',
    mkdir: 'fs:mkdir',
    delete: 'fs:delete',
    rename: 'fs:rename',
} as const;

// FsEntry / FsStat live in the renderer's FileSystemProvider module. Both sides
// use structural types — main returns plain objects that fit the shape, so we
// don't drag the renderer types across the process boundary. This is the same
// pattern DesktopFileSystemProvider uses on the other end.
export interface FsEntryDTO {
    name: string;
    path: string;
    kind: 'file' | 'dir';
}

export interface FsStatDTO {
    path: string;
    kind: 'file' | 'dir';
    size: number;
    mtimeMs: number;
}

// ---- Watch --------------------------------------------------------------
//
// One chokidar watcher per subscription (per-open-file scope; workspace-wide
// watching is deferred per plan §11). The renderer generates a watchId, opens
// a dedicated `watch:${watchId}` event channel, and calls watch:start with
// (id, path). Main assigns a FSWatcher, forwards its events on the channel.
// watch:stop tears down (called from the Dispose the preload returned).
//
// The event channel name is watchId-scoped, not path-scoped: two subscribers
// on the same path each get their own channel and can dispose independently.
export const WATCH_CHANNELS = {
    start: 'watch:start',
    stop: 'watch:stop',
    // Per-watcher event channel prefix. The full name is `${event}${watchId}`;
    // main sends via `win.webContents.send(...)`.
    event: 'watch:',
} as const;

// The kinds we forward. Mirrors chokidar's vocabulary 1:1 so a translation
// layer is unnecessary. `change` = file content changed on disk; `unlink` =
// file was deleted. The per-file watcher consumes change / unlink; the
// workspace watcher below routes the structural kinds (add / addDir /
// unlinkDir) into the tree.
export type FileEventKindDTO = 'change' | 'add' | 'unlink' | 'addDir' | 'unlinkDir';

export interface FileEventDTO {
    kind: FileEventKindDTO;
    path: string;
}

// ---- Workspace watch -----------------------------------------------------
//
// ONE session-scoped recursive chokidar watcher on the workspace root, kept
// separate from the per-file WATCH_CHANNELS Map: "per-file reconcile" (an open
// editor tracking its own file) and "tree structure" (the explorer reacting to
// create/delete/rename anywhere) are independent concerns that dispose
// independently. Same per-id-channel + Dispose discipline; the renderer mints
// the id, opens `workspaceWatch:${id}`, and calls start with just the id (no
// path — the root is main's `workspaceRoot`). Reuses FileEventDTO verbatim.
export const WORKSPACE_WATCH_CHANNELS = {
    start: 'workspaceWatch:start',
    stop: 'workspaceWatch:stop',
    event: 'workspaceWatch:',
} as const;

// ---- Pty -----------------------------------------------------------------
//
// One node-pty process per session. Spawn returns an id (minted in MAIN, not
// the renderer — main owns the process table, so the id is authoritative and a
// renderer can't collide two sessions). write/resize/kill are addressed by that
// id. Data/exit flow back on id-scoped channels the renderer subscribes to,
// mirroring the watcher pattern (per-id channel, per-id Dispose).
//
// Kept request/response symmetric with the fs channels: invoke() for the
// renderer→main commands, webContents.send() for the main→renderer streams.
export const PTY_CHANNELS = {
    spawn: 'pty:spawn',
    write: 'pty:write',
    resize: 'pty:resize',
    kill: 'pty:kill',
    // Per-session stream channel prefixes; full names are `${data}${id}` /
    // `${exit}${id}`. A prefix (not one shared channel) so two terminals never
    // cross-deliver and each disposes its own listener.
    data: 'pty:data:',
    exit: 'pty:exit:',
} as const;

// Spawn options crossing the wire. cols/rows are required (a zero-size pty
// renders garbage); shell/cwd fall back to platform defaults on the main side.
// env is merged over process.env in main, never replacing it wholesale.
export interface PtySpawnDTO {
    shell?: string;
    cwd?: string;
    cols: number;
    rows: number;
    env?: Record<string, string>;
}

// Exit payload. code is the process exit status; signal is set when the shell
// was terminated by a signal instead (node-pty reports both).
export interface PtyExitDTO {
    exitCode: number;
    signal?: number;
}

// ---- Search --------------------------------------------------------------
//
// Workspace search spawns ripgrep in MAIN, keyed by a renderer-minted searchId.
// Results STREAM back on an id-scoped channel (not one big invoke-return) so a
// large result set renders incrementally and can be cancelled mid-flight — same
// per-id-channel + Dispose discipline as watch/pty. `done` fires once when the
// rg process exits.
export const SEARCH_CHANNELS = {
    run: 'search:run',
    cancel: 'search:cancel',
    // Per-search stream channel prefixes; full names are `${result}${searchId}`
    // / `${done}${searchId}`. A prefix (not one shared channel) so two searches
    // never cross-deliver and each disposes its own listeners.
    result: 'search:result:',
    done: 'search:done:',
} as const;

// A search request crossing the wire. `query` is the literal or regex pattern;
// the flags map to ripgrep switches in main. cwd is always main's workspaceRoot,
// so it isn't sent.
export interface SearchQueryDTO {
    query: string;
    caseSensitive?: boolean;
    regex?: boolean;
    wholeWord?: boolean;
}

// One match, translated from ripgrep's --json `match` event. line/column are
// 1-based (rg's convention); preview is the matching line's text, trimmed of its
// trailing newline for display.
export interface SearchMatchDTO {
    path: string;
    line: number;
    column: number;
    preview: string;
}

// ---- Agent ---------------------------------------------------------------
export const AGENT_CHANNELS = {
    attachmentSupport: 'agent:attachmentSupport',
    createSession: 'agent:createSession', listSessions: 'agent:listSessions', loadSession: 'agent:loadSession', forkSession: 'agent:forkSession', renameSession: 'agent:renameSession', archiveSession: 'agent:archiveSession',
    send: 'agent:send', respond: 'agent:respond', cancel: 'agent:cancel', stop: 'agent:stop', undo: 'agent:undo', readFileEdit: 'agent:readFileEdit', updateFileEdit: 'agent:updateFileEdit', contextStats: 'agent:contextStats', compact: 'agent:compact', setPaused: 'agent:setPaused', setApprovalMode: 'agent:setApprovalMode', event: 'agent:event:',
    getSettings: 'agent:getSettings', updateSettings: 'agent:updateSettings', chooseApiKeyFile: 'agent:chooseApiKeyFile', revealApiKeyFile: 'agent:revealApiKeyFile',
} as const;
