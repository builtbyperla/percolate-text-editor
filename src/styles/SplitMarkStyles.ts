
const CUT_PROPERTIES = {
    start: [
        'padding-left',
        'margin-left',
        'border-top-left-radius',
        'border-bottom-left-radius',
        'border-left-width',
    ],
    end: [
        'padding-right',
        'margin-right',
        'border-top-right-radius',
        'border-bottom-right-radius',
        'border-right-width',
    ],
} as const;

export type CutSide = keyof typeof CUT_PROPERTIES;

export interface MarkProbe {
    kind: string;
    // The tag the mark renders as, so tag-based stylesheet rules (`.markdown-body code`)
    // apply to the probe too.
    tag: string;
    // Classes the real fragment carries, if any.
    className?: string;
}

export const INLINE_MARKS: MarkProbe[] = [
    { kind: 'inlineCode', tag: 'code' },
    { kind: 'strong', tag: 'strong' },
    { kind: 'emphasis', tag: 'em' },
];

// The attribute a fragment stamps per cut side. Absent = that edge is real, so the
// mark keeps its box there.
export const CUT_ATTR: Record<CutSide, string> = {
    start: 'data-cut-start',
    end: 'data-cut-end',
};

function probeMark(mark: MarkProbe, host: HTMLElement): Map<string, string> {
    const el = document.createElement(mark.tag);
    if (mark.className) el.className = mark.className;
    // Content so the element has a box at all; display is left to the cascade.
    el.textContent = 'x';
    host.appendChild(el);

    const computed = getComputedStyle(el);
    const resolved = new Map<string, string>();
    for (const side of ['start', 'end'] as CutSide[]) {
        for (const prop of CUT_PROPERTIES[side]) {
            const value = computed.getPropertyValue(prop);
            // Only properties that actually occupy space need neutralizing. Zero values
            // generate no rule, which keeps the sheet to what is genuinely needed.
            if (value && parseFloat(value) > 0) resolved.set(prop, value);
        }
    }

    host.removeChild(el);
    return resolved;
}

// The rules for one mark: one per cut side, listing only the properties that resolved non-zero on that side.
function rulesFor(mark: MarkProbe, resolved: Map<string, string>): string[] {
    const rules: string[] = [];
    for (const side of ['start', 'end'] as CutSide[]) {
        const props = CUT_PROPERTIES[side].filter(p => resolved.has(p));
        if (props.length === 0) continue;
        const body = props.map(p => `  ${p}: 0 !important;`).join('\n');
        rules.push(`${mark.tag}[${CUT_ATTR[side]}] {\n${body}\n}`);
    }
    return rules;
}

export function generateSplitMarkCss(marks: MarkProbe[], host: HTMLElement): string {
    const blocks: string[] = [
        '/* GENERATED — split-mark seam fixes. See SplitMarkStyles.ts. */',
    ];
    for (const mark of marks) {
        const resolved = probeMark(mark, host);
        blocks.push(...rulesFor(mark, resolved));
    }
    return blocks.join('\n\n');
}

let installed = false;

export function installSplitMarkStyles(marks: MarkProbe[] = INLINE_MARKS): void {
    if (installed) return;
    installed = true;

    const host = document.createElement('div');
    host.className = 'markdown-body';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
        'position:absolute;visibility:hidden;pointer-events:none;top:-9999px;left:-9999px;';
    document.body.appendChild(host);

    const css = generateSplitMarkCss(marks, host);

    document.body.removeChild(host);

    const style = document.createElement('style');
    style.setAttribute('data-generated', 'split-mark-styles');
    style.textContent = css;
    document.head.appendChild(style);
}
