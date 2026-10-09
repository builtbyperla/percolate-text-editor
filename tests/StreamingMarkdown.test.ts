import { describe, it, expect } from 'vitest';
import { scanStreamingMarkdown } from '../src/markdown/StreamingMarkdown';

// Tier-1 pure: the lightweight live scanner (string -> RenderedLine[]). Verifies
// eager-resolve (marks/prefixes resolve without a newline), the open-run hold
// (unclosed marks stay literal), code-fence state, and the extended-markdown
// fall-through (tables/images render literal, upgraded only at settle by the full
// parser). See notes/STREAMING_MARKDOWN.md.

describe('scanStreamingMarkdown', () => {
    it('resolves a heading prefix live (before the line ends)', () => {
        const [line] = scanStreamingMarkdown('## Sum');
        expect(line.kind).toBe('heading');
        expect(line.depth).toBe(2);
        expect(line.spans.map(s => s.text).join('')).toBe('Sum');
    });

    it('resolves a bullet prefix live', () => {
        const [line] = scanStreamingMarkdown('- item');
        expect(line.kind).toBe('bullet');
        expect(line.spans.map(s => s.text).join('')).toBe('item');
    });

    it('resolves a CLOSED inline mark to a styled span (no newline needed)', () => {
        const [line] = scanStreamingMarkdown('a **bold** b');
        const styled = line.spans.find(s => s.text === 'bold');
        expect(styled?.style?.['font-weight']).toBe(700);
    });

    it('holds an OPEN inline run literal until its closer arrives', () => {
        const [line] = scanStreamingMarkdown('a **bol');
        // No styled span yet — the unclosed run is literal.
        expect(line.spans.every(s => s.style == null)).toBe(true);
        expect(line.spans.map(s => s.text).join('')).toBe('a **bol');
    });

    it('renders inline code with the mono style', () => {
        const [line] = scanStreamingMarkdown('run `code` now');
        const styled = line.spans.find(s => s.text === 'code');
        // The token, not a literal stack: the mono family is themed in global.css
        // (--font-mono), so the span carries the var() and the resolution happens in
        // CSS. Asserting 'monospace' here would test the stylesheet, which jsdom does
        // not compute anyway.
        expect(styled?.style?.['font-family']).toBe('var(--font-mono)');
    });

    it('collects a fence body into ONE code line and drops the markers', () => {
        const lines = scanStreamingMarkdown('```\nfoo\nbar\n```');
        const code = lines.filter(l => l.kind === 'code');
        expect(code.length).toBe(1);
        expect(code[0].raw).toBe('foo\nbar');
    });

    it('keeps an UNCLOSED fence as an open code block (still streaming)', () => {
        const lines = scanStreamingMarkdown('```\nfoo\nba');
        const code = lines.filter(l => l.kind === 'code');
        expect(code.length).toBe(1);
        expect(code[0].raw).toBe('foo\nba');
    });

    it('drops a blank block-separator line (matches mdast; no phantom gap at settle)', () => {
        const lines = scanStreamingMarkdown('## Summary\n\nI can see it.');
        expect(lines.map(l => l.kind)).toEqual(['heading', 'paragraph']);
    });

    it('KEEPS blank lines inside a fence (real content)', () => {
        const lines = scanStreamingMarkdown('```\nfoo\n\nbar\n```');
        const code = lines.filter(l => l.kind === 'code');
        expect(code[0].raw).toBe('foo\n\nbar');
    });

    it('falls through extended markdown (a table row) to literal paragraph text', () => {
        const [line] = scanStreamingMarkdown('| col | col |');
        expect(line.kind).toBe('paragraph');
        expect(line.spans.map(s => s.text).join('')).toBe('| col | col |');
    });
});
