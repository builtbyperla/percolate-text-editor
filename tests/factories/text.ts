import { LiveTextComponent, InnerText, TextRepr } from '../../src/annotation/TextViewCore';
import type { AnnotationTextView } from '../../src/annotation/AnnotationTextView';

// Build a real text view and hand back its InnerText. We use the concrete
// LiveTextComponent rather than a hand-rolled parent because InnerText's
// highlight path reaches into parent.innerTextObject, sourceId, and the shared
// registries — a real owner exercises that wiring honestly. Each call mints a
// fresh component (fresh id + random sourceId), so views don't collide.
//
// MUST run inside withRoot(): the component owns Solid signals.
export function buildInnerText(text: string): InnerText {
    const comp = new LiveTextComponent({ text });
    return comp.innerTextObject;
}

// The same, keeping the VIEW as well: highlighting is a view-level operation
// (it writes the source registry, which the sections are then rebuilt from), so
// any test that both mutates and inspects needs the pair.
export function buildTextView(text: string): { comp: LiveTextComponent; inner: InnerText } {
    const comp = new LiveTextComponent({ text });
    return { comp, inner: comp.innerTextObject };
}

// A compact view of the section layout for assertions: each section as
// { kind: 'plain' | 'highlight', text }.
export function describeSections(inner: InnerText): { kind: 'plain' | 'highlight'; text: string }[] {
    return inner.sections.map((s: TextRepr) => ({
        kind: s.isPlainText() ? 'plain' : 'highlight',
        text: s.getText(),
    }));
}

// Apply a highlight over [start, end) the way the app does. THE seam tests should
// use: commitHighlight writes the source registry and rebuilds sections from it,
// so a test exercises the real registry -> loadFromContext path rather than
// splicing sections directly. Lives here so a rename touches one call site.
//
// Sits on the VIEW, not the InnerText — the registry write is the view's, and the
// sections it rebuilds are downstream of it.
export function highlight(comp: AnnotationTextView, start: number, end: number): void {
    comp.commitHighlight(start, end);
}

// Each section's global start offset, derived by summing what precedes it. This
// is the invariant `segStart` must satisfy: a fragment's stamped offset is what
// the backward path (resolvePosition <- data-pos-x) reads back out of the DOM, so
// a section claiming the wrong start silently misplaces every selection in it.
export function sectionStarts(inner: InnerText): number[] {
    const out: number[] = [];
    let at = 0;
    for (const s of inner.sections) {
        out.push(at);
        at += s.getText().length;
    }
    return out;
}

// What each section BELIEVES its global start is (the stamped segStart), for
// checking against sectionStarts(). Divergence between the two is exactly the
// class of bug that renders correctly but resolves selections to wrong offsets.
export function claimedStarts(inner: InnerText): number[] {
    return inner.sections.map((s: TextRepr) => (s as unknown as { segStart: number }).segStart);
}
