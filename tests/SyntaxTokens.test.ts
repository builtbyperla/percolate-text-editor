import { describe, expect, it } from 'vitest';
import { clipSyntaxTokens, tokenize } from '../src/editor/SyntaxTokens';

describe('annotator syntax ranges', () => {
    it('preserves colors across line and annotation boundaries', () => {
        const source = 'const first = calculate(1);\nconst second = calculate(2);\n';
        const tokens = tokenize(source, 'sample.ts');
        expect(tokens.length).toBeGreaterThan(0);

        const boundaries = [0, 3, source.indexOf('calculate'), source.indexOf('\n'),
            source.indexOf('\n') + 1, source.indexOf('second'), source.length];
        for (let i = 0; i < boundaries.length - 1; i++) {
            const from = boundaries[i];
            const to = boundaries[i + 1];
            const expected = tokens.filter(token => token.to > from && token.from < to)
                .map(token => ({
                    from: Math.max(token.from, from),
                    to: Math.min(token.to, to),
                    className: token.className,
                }));
            expect(clipSyntaxTokens(tokens, from, to)).toEqual(expected);
        }
    });
});
