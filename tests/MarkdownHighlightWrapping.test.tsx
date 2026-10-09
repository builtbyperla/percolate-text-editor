import { describe, it, expect } from 'vitest';
import { render } from 'solid-js/web';
import { renderMarkdown } from '../src/markdown/MarkdownModel';
import { buildTree } from '../src/markdown/MarkdownTree';
import { renderTree } from '../src/markdown/MarkdownRenderTree';
import type { ContextItem } from '../src/annotation/ContextItem';
import type { NoteCoordinator } from '../src/annotation/AnnotationVisualFrames';

// A highlight WRAPS what it covers: the marked-up content stays inside one .hl span.
// Wrappers break only where structure forces it — a table cell, a nested list, a block —
// never at an inline mark, because marks are not tree nodes at all (they ride on a leaf
// as `marks`, so `a **bold** word` is three sibling leaves under one paragraph).
//
// Fragmenting per leaf is the defect these pin: it split a highlight at every bold word
// or inline code span, which showed as `code`'s padding appearing mid-highlight.

function item(start: number, end: number): ContextItem {
    return { getRange: () => ({ start, end }) } as unknown as ContextItem;
}

// A stand-in for NoteCoordinator: renderGroup only needs the register/reset bracket, the
// note election, and an anchor name. Stubbing keeps these tests on the wrapper geometry
// rather than on the note machinery. `rendersFrom` is false so no note renders and
// textContent is the highlighted text alone.
function stubFrame(): NoteCoordinator {
    return {
        register: () => {},
        resetRegistry: () => {},
        rendersFrom: () => false,
        spanAnchorName: () => '--test-anchor',
    } as unknown as NoteCoordinator;
}

function renderMd(md: string, items: ContextItem[]): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { root } = buildTree(renderMarkdown(md).tree);
    // One frame per item, so distinct items stay distinct through the render.
    const frames = new Map<ContextItem, NoteCoordinator>();
    const frameFor = (it: ContextItem) => {
        if (!frames.has(it)) frames.set(it, stubFrame());
        return frames.get(it)!;
    };
    render(() => renderTree(root, { items, frameFor }) as any, host);
    return host;
}

function wrappers(host: HTMLElement): HTMLElement[] {
    return [...host.querySelectorAll('[data-kind="highlighted"]')] as HTMLElement[];
}

describe('markdown highlight wrapping', () => {
    it('wraps a highlight over plain text in one span', () => {
        const host = renderMd('a plain word', [item(0, 12)]);
        expect(wrappers(host).map(w => w.textContent)).toEqual(['a plain word']);
    });

    it('keeps a bold word INTERIOR to one wrapper', () => {
        const host = renderMd('a **bold** word', [item(0, 11)]);
        const hl = wrappers(host);
        expect(hl.map(w => w.textContent)).toEqual(['a bold word']);
        // The mark is inside the wrapper, not beside it.
        expect(hl[0].querySelector('strong')?.textContent).toBe('bold');
    });

    it('keeps inline code INTERIOR to one wrapper', () => {
        const host = renderMd('use `foo()` here', [item(0, 14)]);
        const hl = wrappers(host);
        expect(hl.map(w => w.textContent)).toEqual(['use foo() here']);
        expect(hl[0].querySelector('code')?.textContent).toBe('foo()');
    });

    it('does not cut a mark that lies wholly inside the highlight', () => {
        const host = renderMd('use `foo()` here', [item(0, 14)]);
        const code = host.querySelector('code')!;
        // No cut attributes: the mark keeps the stylesheet's padding on both sides.
        expect([...code.attributes].map(a => a.name).filter(n => n.startsWith('data-cut'))).toEqual([]);
    });

    it('still cuts a mark the highlight ends inside of', () => {
        // "use header here" — highlight covers "head" only, mid-mark.
        const host = renderMd('use `header` here', [item(4, 8)]);
        const cuts = [...host.querySelectorAll('code')].map(c =>
            [...c.attributes].map(a => a.name).filter(n => n.startsWith('data-cut')));
        // Two fragments: the first cut at its end, the second at its start.
        expect(cuts.length).toBe(2);
        expect(cuts[0].length + cuts[1].length).toBeGreaterThan(0);
    });

    it('breaks at a table cell boundary, one wrapper per cell', () => {
        // flat: "ab\ncd" — highlight "ab" spans two cells.
        const host = renderMd('| a | b |\n| - | - |\n| c | d |', [item(0, 2)]);
        expect(wrappers(host).map(w => w.textContent)).toEqual(['a', 'b']);
    });

    it('breaks at a nested list but not within an item', () => {
        // flat: "• outer\n  • inner\n• second"
        const host = renderMd('- outer\n  - inner\n- second', [item(0, 17)]);
        const texts = wrappers(host).map(w => w.textContent);
        // The outer item's leaves coalesce; the nested list is a separate element.
        expect(texts).toEqual(['• outer\n', '  • inner']);
    });

    it('breaks between paragraphs in a blockquote', () => {
        // flat: "first para\nsecond bold para"
        const host = renderMd('> first para\n>\n> second **bold** para', [item(0, 27)]);
        expect(wrappers(host).map(w => w.textContent)).toEqual(['first para\n', 'second bold para']);
    });

    it('keeps two distinct adjacent annotations as separate wrappers', () => {
        // Same paint, different items: they must not coalesce, or clicks and notes merge.
        const host = renderMd('abcdef', [item(0, 3), item(3, 6)]);
        expect(wrappers(host).map(w => w.textContent)).toEqual(['abc', 'def']);
    });

    it('stamps every run with its own flat offset', () => {
        const host = renderMd('a **bold** word', [item(0, 11)]);
        const positions = [...host.querySelectorAll('[data-pos-x]')].map(e => e.getAttribute('data-pos-x'));
        // Leaves at 0 ("a "), 2 ("bold"), 6 (" word") keep their stamps inside the wrapper.
        expect(positions).toContain('0');
        expect(positions).toContain('2');
        expect(positions).toContain('6');
    });
});
