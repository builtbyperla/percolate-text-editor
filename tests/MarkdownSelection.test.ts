import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { selectText, renderedText } from './factories/dom';
import { highlight } from './factories/text';
import { MarkdownInnerText, MarkdownInnerTextVisual } from '../src/markdown/MarkdownInnerText';
import { StreamingMarkdownBody } from '../src/markdown/StreamingMarkdown';
import { AnnotationTextView } from '../src/annotation/AnnotationTextView';
import { InnerText } from '../src/annotation/TextViewCore';

afterEach(cleanup);

// Minimal concrete AnnotationTextView with the markdown InnerText, so we exercise
// the REAL render + the base's resolveSelection offset math against the rendered
// DOM (nested bullet divs included) — the core risk from the plan.
class TestMarkdownView extends AnnotationTextView {
    readonly source = 'markdown';
    declare innerTextObject: MarkdownInnerText;
    createInnerText(text?: string): InnerText {
        return new MarkdownInnerText(this, text);
    }
}

// resolveSelection returns ContextRegionPiece[] (the base yields one for an owned,
// in-root selection). Unwrap the single piece's [start, end] for the offset assertions.
function offsets(comp: TestMarkdownView, range: Range): [number, number] {
    const pieces = comp.resolveSelection(range);
    expect(pieces).toHaveLength(1);
    return [pieces[0].start, pieces[0].end];
}

// Recreate a fresh component per test and render ONCE (setup — e.g. a highlight
// split — runs before render so the DOM under assertion is the final tree in one
// pass). Each gets a UNIQUE sourceId: sourceContextRegistry is a module-global
// singleton, so a shared id would let one test's highlight leak into the next via
// loadFromContext. Queries are scoped to this render's own container.
let seq = 0;
function renderMarkdown(raw: string, setup?: (c: TestMarkdownView) => void) {
    const comp = new TestMarkdownView(raw, null, `test-md-${seq++}`);
    setup?.(comp);
    const { container } = render(() => createComponent(MarkdownInnerTextVisual, { value: comp.innerTextObject }));
    const root = container.querySelector('.txt-inner') as HTMLElement;
    return { comp, root };
}

describe('Markdown view rendering + selection', () => {
    it('leaves pointerup for enclosing interactions and activates only on click', () => {
        const { comp, root } = renderMarkdown('the quick brown fox\n', c => highlight(c, 4, 9));
        const frame = comp.innerTextObject.noteableAt(4)!;
        const setActive = vi.spyOn(frame, 'setActive');
        const span = root.querySelector('[data-kind="highlighted"]') as HTMLElement;
        const release = vi.fn();
        const click = vi.fn();
        root.addEventListener('pointerup', release);
        root.addEventListener('click', click);

        span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

        expect(release).toHaveBeenCalledOnce();
        expect(setActive).not.toHaveBeenCalled();

        span.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(setActive).toHaveBeenCalledOnce();
        expect(click).toHaveBeenCalledOnce();
    });

    it('renders content loaded after an initially empty mount', () => {
        const { comp, root } = renderMarkdown('');

        comp.innerTextObject.rederive('# Loaded later\n', []);

        expect(renderedText(root)).toBe('Loaded later');
    });

    it('renders headings with stripped markers', () => {
        const { root } = renderMarkdown('# Hello\n');
        expect(renderedText(root)).toBe('Hello');
    });

    it('renders inline bold/italic/code with stripped markers', () => {
        const { root } = renderMarkdown('A **bold** and *em* and `code`.\n');
        expect(renderedText(root)).toBe('A bold and em and code.');
    });

    it('renders nested bullets with glyph + indent as real characters', () => {
        const { root } = renderMarkdown('- one\n  - nested\n');
        const flat = renderedText(root);
        expect(flat).toContain('• one');
        expect(flat).toContain('  • nested');
    });

    it('maps a selection inside a heading to flat offsets', () => {
        const { comp, root } = renderMarkdown('# Heading\n');
        // "Heading" is flat offsets [0,7) — '#' is not in rendered text.
        const [a, b] = offsets(comp, selectText(root, 'Heading'));
        expect(comp.innerTextObject.getText().slice(a, b)).toBe('Heading');
    });

    it('maps a selection over stripped-inline bold', () => {
        const { comp, root } = renderMarkdown('A **bold** end.\n');
        const [a, b] = offsets(comp, selectText(root, 'bold'));
        expect(comp.innerTextObject.getText().slice(a, b)).toBe('bold');
    });

    it('maps a selection inside a nested bullet (glyph + indent counted)', () => {
        const { comp, root } = renderMarkdown('- one\n  - nested item\n');
        const [a, b] = offsets(comp, selectText(root, 'nested item'));
        expect(comp.innerTextObject.getText().slice(a, b)).toBe('nested item');
    });

    it('CROSS-BLOCK: a selection spanning two blocks maps consistently', () => {
        // Two paragraphs. The flat model has a join '\n' between them; the rendered
        // DOM omits it. This checks whether range.toString() (core path) stays in
        // sync with the flat offset string across a block boundary.
        const raw = 'first para\n\nsecond para\n';
        const { comp, root } = renderMarkdown(raw);
        const flatModel = comp.innerTextObject.getText();
        const [a, b] = offsets(comp, selectText(root, 'para'));
        // Should resolve the FIRST "para" (offsets into flat model).
        expect(flatModel.slice(a, b)).toBe('para');
    });

    it('OFFSET INVARIANT: rendered DOM text equals the flat model exactly', () => {
        // The join '\n's between blocks ARE rendered (kept in each line's text under
        // white-space:pre-wrap), so range.toString() (the core path, == renderedText)
        // matches the flat model with no undercount across boundaries.
        const raw = 'first para\n\nsecond para\n\n- a\n- b\n';
        const { comp, root } = renderMarkdown(raw);
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('adds a highlight over rendered text and splits the section', () => {
        const raw = 'the quick brown fox\n';
        // "quick" is at flat offsets [4,9); split before render (setup pattern).
        const { comp, root } = renderMarkdown(raw, c => highlight(c, 4, 9));
        // The section list now has a highlight over "quick".
        const hl = comp.innerTextObject.sections.find(s => !s.isPlainText());
        expect(hl).toBeTruthy();
        expect(hl!.getText()).toBe('quick');
        // Rendered DOM still equals the flat model (offsets intact post-split).
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('keeps a multi-line code fence whole (not line-split) and offset-consistent', () => {
        // The feature guarantee: a structured block is one markdown block, so a
        // multi-line code fence stays a single section and its text is intact — and
        // the rendered DOM still equals the flat model.
        const { comp, root } = renderMarkdown('```js\nconst x = 1;\nlet y = 2;\n```\n');
        const code = comp.innerTextObject.sections.find(s => s.getText().includes('const x'));
        expect(code!.getText()).toBe('const x = 1;\nlet y = 2;');
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('CELL: maps a selection inside a table cell to flat offsets', () => {
        // The feature goal: a table cell's text is ordinary flat, sub-selectable text
        // wearing grid chrome — so selecting a word in a cell resolves exactly like
        // selecting a word in a paragraph, through the same data-pos-x path.
        const raw = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n';
        const { comp, root } = renderMarkdown(raw);
        const [a, b] = offsets(comp, selectText(root, 'Alice'));
        expect(comp.innerTextObject.getText().slice(a, b)).toBe('Alice');
    });

    it('CELL: chrome adds no characters — rendered DOM equals the flat model', () => {
        // The invariant the whole design rests on: grid borders/quote bars are CSS, so
        // range.toString() (== renderedText) still matches the flat offset string.
        const raw = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n\n> a quote\n';
        const { comp, root } = renderMarkdown(raw);
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('QUOTE: maps a selection inside a blockquote to flat offsets', () => {
        const { comp, root } = renderMarkdown('> quoted words here\n');
        const [a, b] = offsets(comp, selectText(root, 'words'));
        expect(comp.innerTextObject.getText().slice(a, b)).toBe('words');
    });

    it('CELL: a highlight over one cell splits that cell only, offsets intact', () => {
        const raw = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n';
        const { comp, root } = renderMarkdown(raw, c => {
            const t = c.innerTextObject.getText();
            const from = t.indexOf('Alice');
            highlight(c, from, from + 'Alice'.length);
        });
        const hl = comp.innerTextObject.sections.find(s => !s.isPlainText());
        expect(hl!.getText()).toBe('Alice');
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('CROSS-CELL: a highlight spanning two cells is ONE flat range, offsets intact', () => {
        // A table is one InnerText / one flat offset space, so a cross-cell highlight is
        // an ordinary contiguous range — no multi-piece item involved.
        const raw = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n';
        const { comp, root } = renderMarkdown(raw, c => {
            const t = c.innerTextObject.getText();
            const from = t.indexOf('Alice');
            highlight(c, from, from + 'Alice30'.length);
        });
        const hl = comp.innerTextObject.sections.find(s => !s.isPlainText());
        expect(hl!.getText()).toBe('Alice30');
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('CELL: inline marks still render inside a cell (decorations survive chrome)', () => {
        const raw = '| Name | Age |\n| --- | --- |\n| **Bo** | 30 |\n';
        const { comp, root } = renderMarkdown(raw);
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
        // The bold marker is stripped; the text is intact inside the cell chrome.
        expect(renderedText(root)).toContain('Bo');
        expect(renderedText(root)).not.toContain('**');
    });

    it('NESTED MARKS: a containing mark does not duplicate the text it contains', () => {
        // Markdown marks NEST (a heading's whole-line style contains the inlineCode
        // ranges inside it). A flat cursor renderer emits the container as a sibling
        // span and re-slices text it already passed, rendering the heading twice.
        const { comp, root } = renderMarkdown('### `npm run dev` or `npm start`\n');
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
        expect(renderedText(root)).toBe('npm run dev or npm start');
    });

    it('NESTED MARKS: the containing mark wraps the contained one in the DOM', () => {
        const { root } = renderMarkdown('### `code` tail\n');
        // The heading is a real h3 (the stylesheet owns the scale) and the inline-code
        // mark nests INSIDE it — nesting is what keeps the text emitted exactly once.
        const heading = root.querySelector('h3') as HTMLElement;
        expect(heading).toBeTruthy();
        // Inline code is a real <code> element, not a styled span: the stylesheet owns
        // its look, and the generated split-mark rules key off the tag.
        expect(heading.querySelector('code')).toBeTruthy();
        expect(heading.textContent).toBe('code tail');
    });

    it('SPLIT MARKS: a mid-word highlight marks the cut sides, not the outer edges', () => {
        // The seam bug: a highlight starting mid-word cuts inline code into two <code>
        // elements, and each would otherwise render the FULL horizontal box — so the
        // stylesheet's padding appears twice in the middle of one word. The fragments
        // stamp which side was cut; the generated rules zero the box only there.
        // Highlight "er" — starts inside the inline code, so the mark is cut.
        const { comp, root } = renderMarkdown('`header` tail\n', c => highlight(c, 4, 6));

        const codes = Array.from(root.querySelectorAll('code'));
        expect(codes.length).toBe(2);
        // First fragment ("head"): its LEFT edge is the mark's real start, its right is
        // the cut. Second ("er") is the mirror.
        expect(codes[0].hasAttribute('data-cut-start')).toBe(false);
        expect(codes[0].hasAttribute('data-cut-end')).toBe(true);
        expect(codes[1].hasAttribute('data-cut-start')).toBe(true);
        expect(codes[1].hasAttribute('data-cut-end')).toBe(false);
        // The split is presentational only — the text is unchanged.
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('EDGES: a highlight paints flush — no side padding on any edge', () => {
        // Padding occupies space, so it always displaces something: mid-word it pushes
        // the highlighted characters off the rest of the word, and next to a space it
        // stacks on a gap that is already visible. Neither case reads as a pill, so the
        // highlight paints flush and only its corners mark where it ends.
        const cases: [string, number, number][] = [
            ['header tail\n', 1, 5],   // both edges mid-word
            ['header tail\n', 1, 6],   // mid-word start, space-adjacent end
            ['header tail\n', 7, 11],  // space-adjacent start, block boundary end
        ];
        for (const [raw, from, to] of cases) {
            const { root } = renderMarkdown(raw, c => highlight(c, from, to));
            const hl = root.querySelector('[data-kind="highlighted"]') as HTMLElement;
            expect(hl).toBeTruthy();
            expect(hl.style.paddingLeft).toBe('');
            expect(hl.style.paddingRight).toBe('');
            // The cap still marks the end of the highlight — only the padding is gone.
            expect(hl.className).toContain('full');
        }
    });

    it('SPLIT MARKS: an uncut mark keeps both edges', () => {
        // The ordinary case: no highlight touches the code, so it renders as one
        // element with its full box and stamps neither cut side.
        const { root } = renderMarkdown('`header` tail\n');
        const code = root.querySelector('code') as HTMLElement;
        expect(code).toBeTruthy();
        expect(code.hasAttribute('data-cut-start')).toBe(false);
        expect(code.hasAttribute('data-cut-end')).toBe(false);
    });

    it('NESTED MARKS: a highlight inside a heading splits without phantom text', () => {
        // The user-visible symptom of the duplication bug: the split moved the phantom
        // copy, so the highlight appeared offset over text that should not exist.
        const raw = '### `npm run dev` or `npm start`\n';
        const { comp, root } = renderMarkdown(raw, c => {
            const t = c.innerTextObject.getText();
            const from = t.indexOf('run dev');
            highlight(c, from, from + 'run dev'.length);
        });
        const hl = comp.innerTextObject.sections.find(s => !s.isPlainText());
        expect(hl!.getText()).toBe('run dev');
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });


    it('TABLE: renders ONE grid container, not one per cell', () => {
        // The structural fix: chrome is emitted once by the recursion that renders the
        // table node. Attaching it per fragment produced a separate single-cell grid
        // for every fragment, which is why the table never laid out as a grid.
        const raw = '| Command | Mode |\n| --- | --- |\n| dev | lite |\n';
        const { root } = renderMarkdown(raw);
        expect(root.querySelectorAll('table').length).toBe(1);
        expect(root.querySelectorAll('td').length).toBe(4);
        // Every row carries the SAME cell count. The row's counted '\n' lives inside
        // the last cell, not beside it — as a sibling it became an extra grid item and
        // shifted every following cell one column right.
        const perRow = Array.from(root.querySelectorAll('tr')).map(r => r.querySelectorAll('td').length);
        expect(perRow).toEqual([2, 2]);
    });

    it('TABLE: an empty cell occupies a slot and adds no characters', () => {
        // The cell holds no text, so it must render as a real (empty) slot rather than
        // collapsing the row — and it must contribute nothing to the offset space, or
        // every annotation after it shifts.
        const { comp, root } = renderMarkdown('| a | b |\n| --- | --- |\n|  | d |\n');
        const rows = Array.from(root.querySelectorAll('tr'));
        // Both rows keep their full column count, the empty cell included.
        expect(rows.map(r => r.querySelectorAll('td').length)).toEqual([2, 2]);
        const empty = rows[1].querySelectorAll('td')[0];
        expect(empty.textContent).toBe('');
        // No phantom characters: the rendered text still matches the flat model.
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('TABLE: annotating a cell does not fragment the table', () => {
        // The symptom that exposed the design fault: a highlight WRAPS leaf text, so
        // it cannot change the structure it sits in — the grid and cell count are
        // identical with and without the annotation.
        const raw = '| Command | Mode |\n| --- | --- |\n| dev | lite |\n';
        const { comp, root } = renderMarkdown(raw, c => {
            const t = c.innerTextObject.getText();
            const from = t.indexOf('lite');
            highlight(c, from, from + 'lite'.length);
        });
        expect(root.querySelectorAll('table').length).toBe(1);
        expect(root.querySelectorAll('td').length).toBe(4);
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('EDGES: a highlight inside one run caps both edges (full)', () => {
        const { root } = renderMarkdown('the quick brown fox\n', c => highlight(c, 4, 9));
        const hl = root.querySelector('[data-kind="highlighted"]') as HTMLElement;
        expect(hl.className).toContain('full');
    });

    it('EDGES: a highlight split across cells opens its inner edges', () => {
        // One highlight crossing a cell boundary must be several elements — the
        // boundary sits between them. Each caps only the edge whose neighbour paints
        // differently, so the pieces read as one continuous highlight.
        const raw = '| a | b |\n| --- | --- |\n| Alice | 30 |\n';
        const { root } = renderMarkdown(raw, c => {
            const t = c.innerTextObject.getText();
            const from = t.indexOf('Alice');
            highlight(c, from, from + 'Alice30'.length);
        });
        const hls = Array.from(root.querySelectorAll('[data-kind="highlighted"]'));
        expect(hls.length).toBeGreaterThan(1);
        expect(hls[0].className).toContain('capStart');
        expect(hls[0].className).not.toContain('capEnd');
        expect(hls[hls.length - 1].className).toContain('capEnd');
        expect(hls[hls.length - 1].className).not.toContain('capStart');
    });


    it('BR: an inline <br> renders as a break and costs zero characters', () => {
        // mdast parses "<br>" as an html node; dumping its source text is what made
        // "<br>" appear literally in the document. It renders as a real <br>, and
        // contributes NO characters — the newline it stands for is already counted in
        // the block's own text, so counting it here would shift every later offset.
        const { comp, root } = renderMarkdown('Runs the app.<br>\nSecond line.\n');
        expect(root.querySelectorAll('br').length).toBe(1);
        expect(renderedText(root)).not.toContain('<br>');
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('SEMANTIC: blocks render as real markdown tags', () => {
        // The render emits semantic elements so a stylesheet (github-markdown-css,
        // scoped to .markdown-body) supplies typography, instead of this view
        // hand-rolling it. It is also simply the correct markup.
        const raw = '## Title\n\npara\n\n> quoted\n\n- item\n\n| a | b |\n| --- | --- |\n| c | d |\n';
        const { root } = renderMarkdown(raw);
        expect(root.querySelector('h2')).toBeTruthy();
        expect(root.querySelector('p')).toBeTruthy();
        expect(root.querySelector('blockquote')).toBeTruthy();
        expect(root.querySelector('ul')).toBeTruthy();
        expect(root.querySelector('table')).toBeTruthy();
        expect(root.querySelector('td')).toBeTruthy();
    });

    it('highlighting a code block wraps it with the shared highlight, text intact', () => {
        // A code block uses the SAME highlight mechanism as everything else — one .hl
        // wrapper around the text — and only its PAINT differs (per-kind CSS, since a
        // flat tint would vanish against the block's own background). So the assertion
        // is on behavior: the block is highlighted, whole, and offsets are intact.
        const { comp, root } = renderMarkdown('```\ncode line\n```\n', c => {
            const t = c.innerTextObject.getText();
            const from = t.indexOf('code line');
            highlight(c, from, from + 'code line'.length);
        });
        const highlighted = root.querySelector('[data-kind="highlighted"]') as HTMLElement;
        expect(highlighted).toBeTruthy();
        // The block's content is whole inside the highlight, and still inside the
        // code box — the highlight wrapped it rather than replacing it.
        expect(highlighted.textContent).toContain('code line');
        expect(highlighted.closest('pre')).toBeTruthy();
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    // THE SETTLE SEAM. A reply renders twice: the lightweight scanner while it arrives,
    // then the full parse once it settles. Any disagreement shows as text shifting the
    // instant streaming ends, so the two are pinned to each other here.
    describe('streaming and settled renders agree', () => {
        // The settled half, rendered the way the chat shows it.
        function settled(raw: string): HTMLElement {
            const comp = new TestMarkdownView(raw, null, `test-seam-${seq++}`);
            const { container } = render(() => createComponent(MarkdownInnerTextVisual, { value: comp.innerTextObject }));
            return container.querySelector('.txt-inner') as HTMLElement;
        }

        // The streaming half, over the same source.
        function streaming(raw: string): HTMLElement {
            const { container } = render(() => StreamingMarkdownBody({ content: () => raw }));
            return container.firstElementChild as HTMLElement;
        }

        it('renders the same text for headings and paragraphs', () => {
            const raw = '## Title\nA paragraph.\n';
            expect(renderedText(streaming(raw))).toBe(renderedText(settled(raw)));
        });

        it('renders the same text for bullets, indent included', () => {
            // The indent is literal spaces in both halves, not padding on one side.
            const raw = '- one\n  - nested\n';
            expect(renderedText(streaming(raw))).toBe(renderedText(settled(raw)));
        });

        it('emits the same block tags', () => {
            const raw = '# Title\nBody text.\n';
            const tags = (root: HTMLElement) =>
                Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre'))
                    .map(el => el.tagName.toLowerCase());
            expect(tags(streaming(raw))).toEqual(tags(settled(raw)));
        });

        it('puts blocks at the same depth under the themed root', () => {
            // Block rhythm is written as `.chat > :first-child` / `> :last-child`, so an
            // extra wrapper on one half silently aims those resets at the wrapper and
            // leaves the real blocks with their margins. Same tags, different spacing.
            const raw = '# Title\nBody text.\n';
            const childTags = (root: HTMLElement) =>
                Array.from(root.children).map(el => el.tagName.toLowerCase());
            expect(childTags(streaming(raw))).toEqual(childTags(settled(raw)));
        });
    });
});
