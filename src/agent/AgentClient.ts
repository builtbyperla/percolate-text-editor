import type { AgentEvent, ApprovalMode, AttachmentSupportDTO, ContextStatsDTO, ControlResponsesDTO, FileEditContentDTO, FileEditRefDTO, SessionSnapshot, SessionSummary, UserInteractionDTO } from '../../shared/agentProtocol';

export interface AgentClient {
    attachmentSupport?(): Promise<AttachmentSupportDTO | undefined>;
    readonly available: boolean;
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
    readFileEdit?(sessionId: string, artifactId: string): Promise<FileEditContentDTO>;
    updateFileEdit?(sessionId: string, artifactId: string, revision: number, content: string): Promise<FileEditRefDTO>;
    contextStats(sessionId: string): Promise<ContextStatsDTO>;
    compact(sessionId: string): Promise<SessionSnapshot>;
    setPaused(sessionId: string, paused: boolean): Promise<void>;
    setApprovalMode(sessionId: string, mode: ApprovalMode): Promise<void>;
    onEvent(sessionId: string, cb: (event: AgentEvent) => void): () => void;
}
