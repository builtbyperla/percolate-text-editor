import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { withRoot } from './reactive';
import { InnerTextVisual, LiveTextComponent } from '../src/annotation/TextViewCore';
import { selectText, renderedText } from './factories/dom';
import { highlight } from './factories/text';

afterEach(cleanup);

// Render the real inner text visual and hand back the component plus
// its rendered .txt-inner root. Selections are built by *searching for the text
// to select* (see selectText), so the tests traverse whatever the real render
// produces — ornaments, gutters, split spans — rather than hand-picking a node.
//
// `setup` runs BEFORE render so any highlight split is already in the sections
// when the <For> paints — the DOM under assertion is the final post-split tree
// in one pass (no reliance on reactive re-render timing).
function renderText(text: string, setup?: (comp: LiveTextComponent) => void) {
    const comp = new LiveTextComponent({ text });
    setup?.(comp);
    const { container } = render(() => createComponent(InnerTextVisual, {
        value: comp.innerTextObject,
    }));
    const root = container.querySelector('.txt-inner') as HTMLElement;
    return { comp, root };
}

// resolveSelection returns ContextRegionPiece[] (the base yields 0 or 1). Assert the
// single-piece [start, end] against the owning view, or expect [] for a non-owner.
function offsets(comp: LiveTextComponent, range: Range): [number, number] | null {
    const pieces = comp.resolveSelection(range);
    if (pieces.length === 0) return null;
    expect(pieces).toHaveLength(1);
    expect(pieces[0].view).toBe(comp);
    return [pieces[0].start, pieces[0].end];
}

describe('AnnotationTextView selection mapping', () => {
    it('maps a mid-string selection to flat-string offsets', () => {
        const { comp, root } = renderText('hello world');
        // "llo w" sits at flat offsets 2..7.
        expect(offsets(comp, selectText(root, 'llo w'))).toEqual([2, 7]);
    });

    it('maps a selection that starts at offset 0', () => {
        const { comp, root } = renderText('hello world');
        expect(offsets(comp, selectText(root, 'hello'))).toEqual([0, 5]);
    });

    it('maps a selection reaching the end of the text', () => {
        const { comp, root } = renderText('abcdef');
        expect(offsets(comp, selectText(root, 'abcdef'))).toEqual([0, 6]);
    });

    it('rendered text equals the flat model (no ornament leaks characters)', () => {
        const { root } = renderText('hello world');
        expect(renderedText(root)).toBe('hello world');
    });

    it('maps offsets across a highlight split — note frames render out of flow', () => {
        const { comp, root } = withRoot(() =>
            // [he][llo w][orld]; the highlight's NoteableFrame renders out of flow,
            // so it must not shift measured offsets. Split before render.
            renderText('hello world', c => highlight(c, 2, 7)),
        );
        // The split really happened: three section blocks in the DOM.
        expect(root.querySelectorAll('.txt-block')).toHaveLength(3);
        // Select the trailing plain segment "orld" — still at flat offsets 7..11.
        expect(offsets(comp, selectText(root, 'orld'))).toEqual([7, 11]);
    });

    it('counts a blank-line highlight\'s newline but not its empty ornament', () => {
        const { comp, root } = withRoot(() =>
            // "a\n\nb": offsets a=0, \n=1, \n=2, b=3. Highlight the two newlines
            // [1,3) -> a blank-line TextHighlight that renders an empty ornament.
            renderText('a\n\nb', c => highlight(c, 1, 3)),
        );

        // The empty ornament is present in the DOM (class is CSS-module hashed)...
        expect(root.querySelector('[class*="emptyOrnament"]')).not.toBeNull();
        // ...but contributes zero characters: rendered text still equals the model.
        expect(renderedText(root)).toBe('a\n\nb');
        // And "b" maps to its true offset 3, proving the newlines counted and the
        // ornament did not.
        expect(offsets(comp, selectText(root, 'b'))).toEqual([3, 4]);
    });

    // Regression: with a SECOND highlight the sections after the first cut used to
    // be built claiming segStart 0, so their stamped data-pos-x named the top of the
    // document and every selection in them resolved against the wrong origin. One
    // highlight hid it — the leading plain section really does start at 0.
    it('maps offsets in later sections with multiple highlights', () => {
        const { comp, root } = withRoot(() =>
            // [ab][cd][ef][gh][ij] — two highlights, so three plain sections, two of
            // which start at a nonzero offset.
            renderText('abcdefghij', c => { highlight(c, 2, 4); highlight(c, 6, 8); }),
        );
        expect(renderedText(root)).toBe('abcdefghij');
        // The trailing plain section: only correct if it knows it starts at 8.
        expect(offsets(comp, selectText(root, 'ij'))).toEqual([8, 10]);
        // The plain section BETWEEN the two highlights, at 4..6.
        expect(offsets(comp, selectText(root, 'ef'))).toEqual([4, 6]);
        // And the second highlight's own span.
        expect(offsets(comp, selectText(root, 'gh'))).toEqual([6, 8]);
    });

    // Non-owner: the selection's START is outside this view's root, so this view does
    // not own it and resolveSelection yields NO piece (was: collapse-to-[0,0]).
    it('yields no piece when the selection start is outside any .txt-inner root', () => {
        const { comp } = renderText('hello world');
        const stray = document.createElement('span');
        stray.textContent = 'detached';
        document.body.appendChild(stray);
        const r = document.createRange();
        r.setStart(stray.firstChild!, 0);
        r.setEnd(stray.firstChild!, 3);
        expect(comp.resolveSelection(r)).toEqual([]);
        stray.remove();
    });

    // End-clamp: the START resolves inside this root (this view owns the selection),
    // but the END endpoint lands in a detached sibling and can't resolve. Instead of
    // collapsing, the end clamps to this view's own text end.
    it('clamps the end to text-end when the end endpoint is outside this root', () => {
        const { comp, root } = renderText('hello world');
        const stray = document.createElement('span');
        stray.textContent = 'detached';
        document.body.appendChild(stray);

        // Start inside the root at offset 0 (before "hello"); end in the stray node.
        const start = selectText(root, 'hello'); // a resolvable in-root start
        const r = document.createRange();
        r.setStart(start.startContainer, start.startOffset);
        r.setEnd(stray.firstChild!, 3);

        // Start resolves to 0; end is unresolvable → clamps to getText().length (11).
        expect(offsets(comp, r)).toEqual([0, 'hello world'.length]);
        stray.remove();
    });
});
