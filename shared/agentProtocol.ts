// Dependency-free wire contract shared by Electron main, preload, and renderer.
import type { QuestionAnswer } from './agentQuestion';

// Core agent state

export type Role = 'user' | 'assistant';
export type TextStatus = 'streaming' | 'done' | 'interrupted' | 'error';
export type ToolStatus = 'pending' | 'running' | 'done' | 'rejected' | 'skipped' | 'error';
export type RuntimeState =
    | 'IDLE'
    | 'CALLING_AGENT'
    | 'WAITING_FOR_CONTROL'
    | 'RUNNING_TOOL'
    | 'PAUSED'
    | 'CANCELLING'
    | 'FAILED';
export type SteeringPolicy = 'QUEUE' | 'INTERRUPT' | 'APPEND';
export type ApprovalMode = 'ask' | 'operate' | 'timer-quick';

// Evidence

export interface EvidenceSnapshotDTO {
    label: string;
    note: string;
    type: string;
    presentation?: 'text' | 'code';
    preview?: {
        startLine: number;
        lines: string[];
        selectedStartLine?: number;
        selectedEndLine?: number;
    };
    additionalData?: unknown;
}

export interface EvidenceGroupSnapshotDTO {
    sourceId: string;
    label: string;
    items: EvidenceSnapshotDTO[];
}

// File bytes are captured with the user turn so history does not depend on the
// original file remaining on disk. The base64 payload is never rendered in UI.
export interface AttachmentDTO {
    name: string;
    mediaType: string;
    size: number;
    data: string;
}

export interface AttachmentSupportDTO {
    mediaTypes: string[];
    maxFileBytes: number;
    maxTotalBytes: number;
}

export const STANDARD_ATTACHMENT_SUPPORT: AttachmentSupportDTO = {
    mediaTypes: ['image/png', 'image/jpeg', 'application/pdf'],
    maxFileBytes: 5 * 1024 * 1024,
    maxTotalBytes: 10 * 1024 * 1024,
};

// Conversation blocks and messages

export type ControlAction =
    | { kind: 'approved' }
    | { kind: 'automated_approval' }
    | { kind: 'rejected'; reason?: string }
    | { kind: 'skipped'; reason?: string }
    | { kind: 'answered'; answer: QuestionAnswer };

export interface TimedApprovalDTO {
    kind: 'timed';
    requestedAt: number;
    autoApproveAt: number;
}

export interface FileEditRefDTO {
    artifactId: string;
    path: string;
    baseSha256: string | null;
    revision: number;
}

export interface FileEditContentDTO {
    before?: string;
    after?: string;
    patch?: string;
    revision: number;
    settled: boolean;
    userModified?: boolean;
}

export interface ToolUseBlockDTO {
    id: string;
    toolCallId: string;
    type: string;
    subject?: string;
    input?: unknown;
    status: ToolStatus;
    controlAction?: ControlAction;
    approval?: TimedApprovalDTO;
    fileEdit?: FileEditRefDTO;
    userModified?: boolean;
}

export interface ToolResponseBlockDTO {
    id: string;
    toolCallId: string;
    type: string;
    subject?: string;
    output?: string;
    status: ToolStatus;
    controlAction?: ControlAction;
    approval?: TimedApprovalDTO;
    fileEdit?: FileEditRefDTO;
    userModified?: boolean;
}

export interface TextBlockDTO {
    id: string;
    kind: 'text';
    role: Role;
    content: string;
    status: TextStatus;
    /** Distinguishes provider-authored chat from local runtime notices. */
    origin?: 'agent' | 'system';
    /** Provider-only content for a system notice whose visible copy is concise. */
    contextContent?: string;
    evidence?: EvidenceGroupSnapshotDTO[];
    attachments?: AttachmentDTO[];
}

export interface ToolBlockDTO {
    id: string;
    kind: 'tool';
    role: Role;
    toolCallId: string;
    type: string;
    subject?: string;
    input?: unknown;
    output?: string;
    status: ToolStatus;
    controlAction?: ControlAction;
    approval?: TimedApprovalDTO;
    fileEdit?: FileEditRefDTO;
    userModified?: boolean;
}

export type BlockDTO = TextBlockDTO | ToolBlockDTO;

export interface MessageDTO {
    id: string;
    role: Role;
    status: TextStatus;
    blocks: BlockDTO[];
    createdAt: number;
}

// Sessions and context

export interface SessionSummary {
    id: string;
    agent: string;
    displayName: string;
    archived: boolean;
    state: RuntimeState;
    createdAt: number;
    updatedAt: number;
}

export interface ContextStatsDTO {
    totalMessages: number;
    activeMessages: number;
    compactedMessages: number;
    estimatedTokens: number;
}

export interface SessionSnapshot extends SessionSummary {
    messages: MessageDTO[];
    steeringPolicy: SteeringPolicy;
    approvalMode: ApprovalMode;
    /** Index of the first message retained as active provider context. */
    contextCutoff?: number;
}

// Provider settings

export type AgentProvider = 'openai' | 'anthropic';

export interface AgentSettingsDTO {
    provider: AgentProvider;
    model: string;
    apiKeyFile?: string;
    baseURL?: string;
}

export interface AgentSettingsUpdateDTO {
    provider?: AgentProvider;
    model?: string;
}

// Renderer-to-runtime commands

export interface UserInteractionDTO {
    sessionId: string;
    text: string;
    evidence?: EvidenceGroupSnapshotDTO[];
    attachments?: AttachmentDTO[];
    steeringPolicy: SteeringPolicy;
    responses?: Record<string, ControlAction>;
}

export interface ControlResponsesDTO {
    sessionId: string;
    responses: Record<string, ControlAction>;
}

// Runtime-to-renderer events

export type AgentEvent =
    | {
        type: 'file-edit-updated';
        sessionId: string;
        artifactId: string;
        revision: number;
    }
    | {
        type: 'text-start';
        sessionId: string;
        messageId: string;
        role: Role;
        origin?: 'agent' | 'system';
        evidence?: EvidenceGroupSnapshotDTO[];
        attachments?: AttachmentDTO[];
    }
    | {
        type: 'text-delta';
        sessionId: string;
        messageId: string;
        delta: string;
    }
    | {
        type: 'text-end';
        sessionId: string;
        messageId: string;
        status: TextStatus;
    }
    | {
        type: 'tool-start';
        sessionId: string;
        call: ToolUseBlockDTO;
    }
    | {
        type: 'tool-delta';
        sessionId: string;
        toolCallId: string;
        delta: string;
    }
    | {
        type: 'tool-end';
        sessionId: string;
        response: ToolResponseBlockDTO;
    }
    | {
        type: 'runtime-state';
        sessionId: string;
        state: RuntimeState;
    }
    | {
        type: 'runtime-error';
        sessionId: string;
        message: string;
    };
