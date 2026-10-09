import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/markdown/MarkdownModel';
import { buildTree, MarkdownTree, TextLeaf } from '../src/markdown/MarkdownTree';

// Tier-1 (pure): the reader annotates purely in DISPLAY space, so displayOffset is what
// correctness rests on — and that is exercised by the DOM selection tests in
// MarkdownSelection.test.ts. `textOffset` is kept as inert provenance (each leaf's raw
// origin); these tests just pin that it IS the real raw offset, so a future source-jump
// feature can trust it. No round-trip / conversion tests: annotations are per-mode and
// there is no raw<->display map to bridge.

function tree(raw: string): MarkdownTree {
    return buildTree(renderMarkdown(raw).tree);
}

// Leaves whose displayed text equals their raw slice (plain leaves). The bullet glyph
// leaf is the one same-length substitution where display != raw slice, so raw-slice
// assertions skip it; synthetic '\n' join leaves are zero-provenance and skipped too.
function plainLeaves(t: MarkdownTree, raw: string): TextLeaf[] {
    return t.leaves.filter(l => raw.slice(l.textOffset, l.textOffset + l.text.length) === l.text);
}

describe('markdown leaf provenance: textOffset is the raw offset', () => {
    it('heading — content leaf starts past the "# " marker', () => {
        const raw = '# Hello\n';
        const hello = tree(raw).leaves.find(l => l.text === 'Hello');
        expect(hello).toBeDefined();
        expect(hello!.textOffset).toBe(raw.indexOf('Hello'));
    });

    it('bold — the bold word\'s raw offset is inside the ** markers, not the display run', () => {
        const raw = 'A **bold** word\n';
        const bold = tree(raw).leaves.find(l => l.text === 'bold');
        expect(bold).toBeDefined();
        // Raw "bold" sits after "A **" — index 4 — even though it displays at 2.
        expect(bold!.textOffset).toBe(raw.indexOf('bold'));
        expect(bold!.displayOffset).toBe('A '.length);
    });

    it('every plain leaf round-slices from raw at its textOffset', () => {
        const raw = '# Title\n\nA **bold** and *em* and `code`.\n\n- one\n- two\n';
        for (const leaf of plainLeaves(tree(raw), raw)) {
            expect(raw.slice(leaf.textOffset, leaf.textOffset + leaf.text.length)).toBe(leaf.text);
        }
    });
});

describe('markdown leaf displayOffset: the reader\'s offset space is monotonic', () => {
    const samples = [
        ['heading', '# Hello\n'],
        ['bold', 'A **bold** and *em* text\n'],
        ['bullets', '- one\n- two\n  - nested\n'],
        ['table', '| a | b |\n| - | - |\n| 1 | 2 |\n'],
    ] as const;

    for (const [name, raw] of samples) {
        it(`${name} — leaves' displayOffset tile the flat text (no gap/overlap)`, () => {
            const t = tree(raw);
            // Each leaf begins exactly where the previous ended, EXCEPT the final leaf,
            // which trimTrailingNewline may shorten (its '\n' is dropped from `text`),
            // so we tile-check all but the last and bound the last within the string.
            for (let i = 1; i < t.leaves.length; i++) {
                const prev = t.leaves[i - 1];
                expect(t.leaves[i].displayOffset).toBe(prev.displayOffset + prev.text.length);
            }
            const last = t.leaves[t.leaves.length - 1];
            expect(last.displayOffset + last.text.length).toBeLessThanOrEqual(t.text.length + 1);
        });
    }
});
