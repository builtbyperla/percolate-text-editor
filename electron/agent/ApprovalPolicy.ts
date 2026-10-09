import type { ApprovalMode } from '../../shared/agentProtocol';
import { QUICK_APPROVAL_DELAY_MS } from '../../shared/approvalProfiles';
import type { ToolDefinition } from './ToolRegistry';

export { QUICK_APPROVAL_DELAY_MS } from '../../shared/approvalProfiles';

export type ToolCategory = 'read' | 'workspace_mutation' | 'command' | 'always_ask' | 'question';

export type ApprovalDisposition =
    | { disposition: 'automatic' }
    | { disposition: 'ask' }
    | { disposition: 'timed'; delayMs: number }
    | { disposition: 'reject'; reason: string };

// Keep input in this seam even though the first policy only needs tool metadata.
// Future command policies can inspect the structured executable/argv input here
// without changing runtime orchestration or the public mode model.
export function evaluateToolPolicy(
    mode: ApprovalMode,
    tool: Pick<ToolDefinition, 'category'>,
    _input: unknown,
): ApprovalDisposition {
    if (tool.category === 'question') return { disposition: 'ask' };
    if (tool.category === 'read') return { disposition: 'automatic' };
    if (tool.category === 'always_ask') return { disposition: 'ask' };
    if (mode === 'ask') return { disposition: 'ask' };
    if (mode === 'timer-quick') return { disposition: 'timed', delayMs: QUICK_APPROVAL_DELAY_MS };
    return { disposition: 'automatic' };
}

export function toolAvailableToProvider(_mode: ApprovalMode, _tool: Pick<ToolDefinition, 'category'>): boolean {
    return true;
}
