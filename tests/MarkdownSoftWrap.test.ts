import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { renderedText } from './factories/dom';
import { MarkdownInnerText, MarkdownInnerTextVisual } from '../src/markdown/MarkdownInnerText';
import { AnnotationTextView } from '../src/annotation/AnnotationTextView';
import { InnerText } from '../src/annotation/TextViewCore';

afterEach(cleanup);

// A concrete view over the markdown InnerText, same shape as MarkdownSelection's.
class TestMarkdownView extends AnnotationTextView {
    readonly source = 'markdown';
    declare innerTextObject: MarkdownInnerText;
    createInnerText(text?: string): InnerText {
        return new MarkdownInnerText(this, text);
    }
}

let seq = 0;
function renderMarkdown(raw: string) {
    const comp = new TestMarkdownView(raw, null, `test-softwrap-${seq++}`);
    const { container } = render(() => createComponent(MarkdownInnerTextVisual, { value: comp.innerTextObject }));
    const root = container.querySelector('.txt-inner') as HTMLElement;
    return { comp, root };
}

// A SOFT line break — a lone '\n' inside one source paragraph, typed to wrap the
// source — is what markdown collapses to a single space. Left literal it entered the
// flat offset space and rendered as a hard break under white-space: pre-wrap, so the
// author's source wrapping showed through the document mid-paragraph.
describe('Markdown soft-wrap collapse', () => {
    it('collapses an intra-paragraph soft wrap to a single space', () => {
        // The screenshot case: one paragraph the author wrapped across three source
        // lines. It must read as one flowing paragraph, not three.
        const raw = 'A paragraph with **bold**, *italic*, and `inline code`\nspans that\nstrip their markers when rendered.\n';
        const { comp } = renderMarkdown(raw);
        const flat = comp.innerTextObject.getText();
        expect(flat).toBe('A paragraph with bold, italic, and inline code spans that strip their markers when rendered.');
        // No literal newline survives inside the single paragraph.
        expect(flat).not.toContain('\n');
    });

    it('keeps the offset invariant — rendered DOM equals the flat model', () => {
        const raw = 'wraps here\nand continues\nto a period.\n';
        const { comp, root } = renderMarkdown(raw);
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });

    it('leaves the structural block-separator newline intact between paragraphs', () => {
        // A blank line is a real block boundary, NOT a soft wrap: the join '\n' between
        // the two paragraphs is still counted and rendered.
        const raw = 'first para\n\nsecond para\n';
        const { comp } = renderMarkdown(raw);
        expect(comp.innerTextObject.getText()).toBe('first para\nsecond para');
    });

    it('does not touch a hard break (<br> from trailing spaces)', () => {
        // A hard break is a `break` node, never a text '\n' — so the collapse cannot
        // reach it. It still renders as one <br> and adds no characters.
        const raw = 'line one  \nline two\n';
        const { comp, root } = renderMarkdown(raw);
        expect(root.querySelectorAll('br').length).toBe(1);
        expect(renderedText(root)).toBe(comp.innerTextObject.getText());
    });
});
