import type { ModelMessage } from 'ai';
import type { AttachmentSupportDTO, MessageDTO } from '../../shared/agentProtocol';

export type ProviderEvent =
    | {
        type: 'text-delta';
        delta: string;
    }
    | {
        type: 'tool-call';
        id: string;
        name: string;
        input: unknown;
    };

export interface MessageInterface {
    /** Absent means this agent does not accept file attachments. */
    readonly attachmentSupport?: AttachmentSupportDTO;
    transformForSend(messages: MessageDTO[]): ModelMessage[];
}

export interface Agent {
    readonly name: string;
    readonly messageInterface: MessageInterface;
    call(messages: MessageDTO[], signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
