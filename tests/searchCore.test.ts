import { describe, it, expect } from 'vitest';
import { buildRgArgs, parseRgLine } from '../electron/searchCore';

// Pure ripgrep glue: arg-vector building and --json line parsing. No child
// process, no Electron — exactly the Tier-1 surface.

describe('buildRgArgs', () => {
    const root = '/work/root';

    it('always emits --json and an explicit search path last', () => {
        const args = buildRgArgs({ query: 'foo' }, root);
        expect(args[0]).toBe('--json');
        // Path MUST be the final arg: without it rg reads stdin and hangs.
        expect(args[args.length - 1]).toBe(root);
        // Query precedes the path, after the -- terminator.
        expect(args).toContain('foo');
        const dashIdx = args.indexOf('--');
        expect(dashIdx).toBeGreaterThan(-1);
        expect(args[dashIdx + 1]).toBe('foo');
        expect(args[dashIdx + 2]).toBe(root);
    });

    it('defaults to smart-case (-S) and fixed-strings (-F)', () => {
        const args = buildRgArgs({ query: 'foo' }, root);
        expect(args).toContain('-S');
        expect(args).toContain('-F');
        expect(args).not.toContain('-s');
    });

    it('caseSensitive swaps -S for -s', () => {
        const args = buildRgArgs({ query: 'foo', caseSensitive: true }, root);
        expect(args).toContain('-s');
        expect(args).not.toContain('-S');
    });

    it('regex drops -F (query treated as a pattern)', () => {
        const args = buildRgArgs({ query: 'fo+', regex: true }, root);
        expect(args).not.toContain('-F');
    });

    it('wholeWord adds -w', () => {
        expect(buildRgArgs({ query: 'foo', wholeWord: true }, root)).toContain('-w');
        expect(buildRgArgs({ query: 'foo' }, root)).not.toContain('-w');
    });

    it('passes ignore globs as --glob excludes', () => {
        const args = buildRgArgs({ query: 'foo' }, root);
        const globValues = args.filter((_, i) => args[i - 1] === '--glob');
        expect(globValues.some(g => g.includes('node_modules'))).toBe(true);
        expect(globValues.every(g => g.startsWith('!'))).toBe(true);
    });

    it('does not interpolate the query into any flag (passed as its own arg)', () => {
        // A query with shell metacharacters must remain a single positional arg,
        // never spliced into a flag — this is what keeps the spawn injection-safe.
        const args = buildRgArgs({ query: '$(rm -rf /)' }, root);
        expect(args).toContain('$(rm -rf /)');
    });
});

describe('parseRgLine', () => {
    // A real rg 15 --json match line (utf-8 text form).
    const matchLine = JSON.stringify({
        type: 'match',
        data: {
            path: { text: '/work/root/src/App.tsx' },
            lines: { text: "import { SearchView } from './search/SearchView';\n" },
            line_number: 33,
            absolute_offset: 1991,
            submatches: [{ match: { text: 'SearchView' }, start: 9, end: 19 }],
        },
    });

    it('parses a match into path/line/column/preview', () => {
        const m = parseRgLine(matchLine);
        expect(m).toEqual({
            path: '/work/root/src/App.tsx',
            line: 33,
            column: 10, // submatch start 9 (0-based) -> 1-based column
            preview: "import { SearchView } from './search/SearchView';", // trailing \n trimmed
        });
    });

    it('returns null for non-match events (begin/end/summary)', () => {
        expect(parseRgLine(JSON.stringify({ type: 'begin', data: { path: { text: '/x' } } }))).toBeNull();
        expect(parseRgLine(JSON.stringify({ type: 'end', data: {} }))).toBeNull();
        expect(parseRgLine(JSON.stringify({ type: 'summary' }))).toBeNull();
    });

    it('returns null for blank or malformed lines', () => {
        expect(parseRgLine('')).toBeNull();
        expect(parseRgLine('   ')).toBeNull();
        expect(parseRgLine('{not json')).toBeNull();
    });

    it('defaults column to 1 when a match has no submatches', () => {
        const line = JSON.stringify({
            type: 'match',
            data: { path: { text: '/x' }, lines: { text: 'hit\n' }, line_number: 2, submatches: [] },
        });
        expect(parseRgLine(line)?.column).toBe(1);
    });

    it('decodes base64 bytes when text is absent (non-utf8 path/line)', () => {
        const line = JSON.stringify({
            type: 'match',
            data: {
                path: { bytes: Buffer.from('/weird/päth').toString('base64') },
                lines: { bytes: Buffer.from('matched line\n').toString('base64') },
                line_number: 7,
                submatches: [{ match: { bytes: '' }, start: 0, end: 0 }],
            },
        });
        const m = parseRgLine(line);
        expect(m?.path).toBe('/weird/päth');
        expect(m?.preview).toBe('matched line');
        expect(m?.line).toBe(7);
    });

    it('returns null when the match has no path (nothing to open)', () => {
        const line = JSON.stringify({
            type: 'match',
            data: { path: {}, lines: { text: 'x\n' }, line_number: 1, submatches: [] },
        });
        expect(parseRgLine(line)).toBeNull();
    });
});
