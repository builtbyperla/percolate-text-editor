// DOM helpers for selection-mapping tests. The guiding idea: a test expresses
// intent as the *text it wants to select* ("select 'llo w'"), and these helpers
// resolve that against whatever the rendered DOM actually is. This keeps the
// tests robust as the render gains ornaments/gutters: if a non-text ornament
// ever leaks selectable characters, the resolved Range's toString() stops
// matching the requested substring and the test fails loudly.

// Concatenation of every text node under `root`, in document order. This is what
// the Range API sees — out-of-flow/empty ornaments contribute nothing here, so
// it equals the flat text model when the render is correct.
export function renderedText(root: HTMLElement): string {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let out = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out += n.nodeValue ?? '';
    return out;
}

// Resolve a flat offset (into renderedText) to the text node + local offset that
// contains it, walking through any interleaved ornaments/spans.
function locate(root: HTMLElement, offset: number): { node: Text; localOffset: number } {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const len = (n.nodeValue ?? '').length;
        if (offset <= seen + len) {
            return { node: n as Text, localOffset: offset - seen };
        }
        seen += len;
    }
    throw new Error(`offset ${offset} is past the rendered text (length ${seen})`);
}

// Build a Range selecting `needle` within the rendered text. `occurrence` picks
// which match (0-based) when the substring repeats. Throws if not found, so a
// mis-rendered ornament can't silently select the wrong thing.
export function selectText(root: HTMLElement, needle: string, occurrence = 0): Range {
    const flat = renderedText(root);
    let from = -1;
    for (let i = 0; i <= occurrence; i++) {
        from = flat.indexOf(needle, from + 1);
        if (from === -1) throw new Error(`"${needle}" (occurrence ${occurrence}) not found in rendered text ${JSON.stringify(flat)}`);
    }
    const start = locate(root, from);
    const end = locate(root, from + needle.length);
    const r = document.createRange();
    r.setStart(start.node, start.localOffset);
    r.setEnd(end.node, end.localOffset);
    return r;
}
