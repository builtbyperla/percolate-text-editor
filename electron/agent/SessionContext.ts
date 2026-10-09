import { randomUUID } from 'node:crypto';
import type { ContextStatsDTO, MessageDTO, SessionSnapshot } from '../../shared/agentProtocol';
import { buildCompactionMessage } from '../../shared/contextCompaction';

export function activeContextMessages(snapshot: SessionSnapshot): MessageDTO[] {
    const cutoff = Math.min(snapshot.contextCutoff ?? 0, snapshot.messages.length);
    return snapshot.messages.slice(cutoff);
}

export function contextStats(snapshot: SessionSnapshot): ContextStatsDTO {
    const cutoff = Math.min(snapshot.contextCutoff ?? 0, snapshot.messages.length);
    const active = snapshot.messages.slice(cutoff);
    const characters = active.reduce((total, message) => total + JSON.stringify(message.blocks).length, 0);
    return {
        totalMessages: snapshot.messages.length,
        activeMessages: active.length,
        compactedMessages: cutoff,
        // This is deliberately labeled as an estimate in the UI. Exact token
        // counts depend on the selected provider's tokenizer and message framing.
        estimatedTokens: Math.ceil(characters / 4),
    };
}

export function compactContext(snapshot: SessionSnapshot): MessageDTO {
    return buildCompactionMessage(snapshot, randomUUID());
}
