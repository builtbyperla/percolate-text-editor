
import type {
    FsEntryDTO,
    FsStatDTO,
    FileEventDTO,
    PtySpawnDTO,
    PtyExitDTO,
    SearchQueryDTO,
    SearchMatchDTO,
} from '../../electron/ipcChannels';
import type { AgentEvent, AgentSettingsDTO, AgentSettingsUpdateDTO, ApprovalMode, AttachmentSupportDTO, ContextStatsDTO, ControlResponsesDTO, FileEditContentDTO, FileEditRefDTO, SessionSnapshot, SessionSummary, UserInteractionDTO } from '../../shared/agentProtocol';

interface DesktopBridgeFs {
    chooseFile(): Promise<string | null>;
    chooseFolder(): Promise<string | null>;
    chooseNewFile(defaultPath?: string): Promise<string | null>;
    listDir(path: string): Promise<FsEntryDTO[]>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, contents: string): Promise<void>;
    stat(path: string): Promise<FsStatDTO>;
    mkdir(path: string): Promise<void>;
    delete(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
}

interface DesktopBridgeWatch {
    watch(path: string, cb: (e: FileEventDTO) => void): () => void;
    watchWorkspace(cb: (e: FileEventDTO) => void): () => void;
}

// Pty subscription surface. spawn resolves the main-minted session id; onData/
// onExit return a synchronous Dispose (listener held in preload) like watch.
interface DesktopBridgePty {
    spawn(opts: PtySpawnDTO): Promise<string>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    kill(id: string): Promise<void>;
    onData(id: string, cb: (chunk: string) => void): () => void;
    onExit(id: string, cb: (e: PtyExitDTO) => void): () => void;
}

interface DesktopBridgeSearch {
    run(
        query: SearchQueryDTO,
        onMatch: (m: SearchMatchDTO) => void,
        onDone: () => void,
    ): () => void;
}
interface DesktopBridgeAgent {
    attachmentSupport(): Promise<AttachmentSupportDTO | undefined>;
    createSession(agent?: string): Promise<SessionSummary>;
    listSessions(): Promise<SessionSummary[]>;
    loadSession(id: string): Promise<SessionSnapshot>;
    forkSession(id: string, throughBlockId?: string): Promise<SessionSnapshot>;
    renameSession(id: string, displayName: string): Promise<SessionSummary>;
    archiveSession(id: string): Promise<void>;
    send(input: UserInteractionDTO): Promise<{ accepted: true }>;
    respond(input: ControlResponsesDTO): Promise<{ accepted: true }>;
    cancel(sessionId: string): Promise<void>;
    stop(sessionId: string): Promise<void>;
    undo(sessionId: string, toolCallId: string): Promise<void>;
    readFileEdit(sessionId: string, artifactId: string): Promise<FileEditContentDTO>;
    updateFileEdit(sessionId: string, artifactId: string, revision: number, content: string): Promise<FileEditRefDTO>;
    contextStats(sessionId: string): Promise<ContextStatsDTO>;
    compact(sessionId: string): Promise<SessionSnapshot>;
    setPaused(sessionId: string, paused: boolean): Promise<void>;
    setApprovalMode(sessionId: string, mode: ApprovalMode): Promise<void>;
    getSettings(): Promise<AgentSettingsDTO>;
    updateSettings(value: AgentSettingsUpdateDTO): Promise<AgentSettingsDTO>;
    chooseApiKeyFile(): Promise<AgentSettingsDTO>;
    revealApiKeyFile(): Promise<void>;
    onEvent(sessionId: string, cb: (event: AgentEvent) => void): () => void;
}

export interface DesktopBridge {
    fs: DesktopBridgeFs;
    watch: DesktopBridgeWatch;
    pty: DesktopBridgePty;
    search: DesktopBridgeSearch;
    agent: DesktopBridgeAgent;
    rootPath: string;
    platform: NodeJS.Platform;
}

declare global {
    interface Window {
        desktopBridge?: DesktopBridge;
    }
}
