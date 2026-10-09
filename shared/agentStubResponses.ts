import responses from './agentStubResponses.json';

export interface AgentStubTool {
    type: string;
    subject: string;
    output: string;
    requiresApproval: boolean;
    input?: unknown;
}

export interface AgentStubTurn {
    tools: AgentStubTool[];
    response: string;
}

const fallback: AgentStubTurn = { tools: [], response: 'I received your context. This is a simulated local response.' };

/** Return a deterministic complete turn from the shared fixture, wrapping at EOF. */
export function agentStubTurn(index: number): AgentStubTurn {
    if (responses.length === 0) return fallback;
    const loopedIndex = ((index % responses.length) + responses.length) % responses.length;
    return responses[loopedIndex] ?? fallback;
}

/** Return a deterministic response from the shared fixture, wrapping at EOF. */
export function agentStubResponse(index: number): string {
    return agentStubTurn(index).response;
}
