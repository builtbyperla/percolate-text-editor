// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateToolPolicy, QUICK_APPROVAL_DELAY_MS, toolAvailableToProvider } from '../electron/agent/ApprovalPolicy';
import type { ToolDefinition } from '../electron/agent/ToolRegistry';

function tool(category: ToolDefinition['category']): Pick<ToolDefinition, 'category'> {
    return { category };
}

describe('agent approval modes', () => {
    it('makes tools available in each mode', () => {
        for (const mode of ['ask', 'operate', 'timer-quick'] as const) {
            expect(toolAvailableToProvider(mode, tool('read'))).toBe(true);
            expect(toolAvailableToProvider(mode, tool('workspace_mutation'))).toBe(true);
        }
    });

    it('asks for operations in Ask and automates them in Operate', () => {
        expect(evaluateToolPolicy('ask', tool('workspace_mutation'), {})).toEqual({ disposition: 'ask' });
        expect(evaluateToolPolicy('ask', tool('command'), {})).toEqual({ disposition: 'ask' });
        expect(evaluateToolPolicy('operate', tool('workspace_mutation'), {})).toEqual({ disposition: 'automatic' });
        expect(evaluateToolPolicy('operate', tool('command'), {})).toEqual({ disposition: 'automatic' });
    });

    it('times operations in Timer while reads remain automatic', () => {
        expect(evaluateToolPolicy('timer-quick', tool('read'), {})).toEqual({ disposition: 'automatic' });
        expect(evaluateToolPolicy('timer-quick', tool('workspace_mutation'), {})).toEqual({ disposition: 'timed', delayMs: QUICK_APPROVAL_DELAY_MS });
        expect(evaluateToolPolicy('timer-quick', tool('command'), {})).toEqual({ disposition: 'timed', delayMs: QUICK_APPROVAL_DELAY_MS });
    });

    it('keeps hard-gated tools explicit in every mode', () => {
        for (const mode of ['ask', 'timer-quick', 'operate'] as const) {
            expect(evaluateToolPolicy(mode, tool('always_ask'), {})).toEqual({ disposition: 'ask' });
        }
    });
});
