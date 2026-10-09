import { describe, expect, it } from 'vitest';
import { firstMessageDisplayName, nextForkDisplayName } from '../shared/sessionDisplayName';

describe('session display names', () => {
    it('clips and normalizes the first message', () => {
        expect(firstMessageDisplayName('  Fix\n  the    toolbar  ', [])).toBe('Fix the toolbar');
        const title = firstMessageDisplayName('A'.repeat(70), []);
        expect(title).toBe(`${'A'.repeat(59)}…`);
    });

    it('numbers duplicate titles and forks', () => {
        expect(firstMessageDisplayName('Fix the toolbar', ['Fix the toolbar', 'Fix the toolbar (2)'])).toBe('Fix the toolbar (3)');
        expect(nextForkDisplayName('Fix the toolbar (3)', ['Fix the toolbar (4)'])).toBe('Fix the toolbar (5)');
        expect(firstMessageDisplayName('Fix the toolbar', ['Fix the toolbar'], 'New session (2)')).toBe('Fix the toolbar (2)');
    });
});
