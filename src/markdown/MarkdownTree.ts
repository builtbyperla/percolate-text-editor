import type {
    Root, RootContent, PhrasingContent,
    Heading, Paragraph, List, ListItem, Blockquote,
    Table, TableRow, TableCell, Code, Text, Strong, Emphasis, InlineCode,
} from 'mdast';
import { BULLET, INDENT_UNIT } from './MarkdownModel';

export interface TextLeaf {
    type: 'text';
    text: string;
    textOffset: number;
    displayOffset: number;
    marks: MarkStyle[];
}

export interface ElementNode {
    type: 'element';
    kind: NodeKind;
    children: TreeNode[];
    // table only: column count, so the grid can size its tracks from the source.
    columns?: number;
    lang?: string;
    // heading only: level 1-6, so the render emits a real h1..h6 and the stylesheet
    // supplies the scale rather than an inline font-size.
    depth?: number;
    // Whole-unit kinds (code/rule) are annotated as a unit: not sub-selectable, so a
    // drag cannot land inside them.
    atomic?: boolean;
}

export type TreeNode = TextLeaf | ElementNode;

export type NodeKind =
    | 'document' | 'paragraph' | 'heading' | 'line'
    | 'list' | 'listItem'
    | 'blockquote'
    | 'table' | 'tableRow' | 'tableCell'
    | 'code' | 'thematicBreak'
    // A hard line break (<br>). Zero characters: the break is visual, and the newline
    // it stands for is already counted in the surrounding block's text.
    | 'break';

export type MarkStyle =
    | { kind: 'strong' }
    | { kind: 'emphasis' }
    | { kind: 'inlineCode' };

const STRONG_STYLE: MarkStyle = { kind: 'strong' };
const EMPHASIS_STYLE: MarkStyle = { kind: 'emphasis' };
const CODE_STYLE: MarkStyle = { kind: 'inlineCode' };

class TreeBuilder {
    text = '';
    marks: MarkStyle[] = [];
    // Every leaf in document order — the raw<->display map the tree exposes. Collected
    // as it is built so the conversions scan a flat ordered list, not the nested tree.
    leaves: TextLeaf[] = [];

    leaf(value: string, rawOffset: number): TextLeaf {
        const displayOffset = this.text.length;
        this.text += value;
        const leaf: TextLeaf = { type: 'text', text: value, textOffset: rawOffset, displayOffset, marks: [...this.marks] };
        this.leaves.push(leaf);
        return leaf;
    }

    // Render `fn`'s output with `style` pushed onto the mark stack, so nested marks
    // compose (bold containing emphasis yields a leaf carrying both).
    withMark<T>(style: MarkStyle, fn: () => T): T {
        this.marks.push(style);
        const out = fn();
        this.marks.pop();
        return out;
    }
}

function element(kind: NodeKind, children: TreeNode[], extra?: Partial<ElementNode>): ElementNode {
    return { type: 'element', kind, children, ...extra };
}

function collapseSoftBreaks(value: string): string {
    return value.replace(/[^\S\n]*\n[^\S\n]*/g, ' ');
}

// Inline nodes. Marks push onto the stack; only 'text' and 'inlineCode' emit leaves.
function renderPhrasing(node: PhrasingContent, b: TreeBuilder): TreeNode[] {
    const rawStart = node.position?.start?.offset ?? 0;
    switch (node.type) {
        case 'text':
            return [b.leaf(collapseSoftBreaks((node as Text).value), rawStart)];
        case 'strong':
            return b.withMark(STRONG_STYLE, () =>
                (node as Strong).children.flatMap(c => renderPhrasing(c, b)));
        case 'emphasis':
            return b.withMark(EMPHASIS_STYLE, () =>
                (node as Emphasis).children.flatMap(c => renderPhrasing(c, b)));
        case 'inlineCode':
            return b.withMark(CODE_STYLE, () => [b.leaf((node as InlineCode).value, rawStart + 1)]);
        case 'break':
            return [element('break', [])];
        case 'html': {
            const value = (node as any).value as string;
            if (/^<br\s*\/?>$/i.test(value.trim())) return [element('break', [])];
            return [];
        }
        default: {
            // Unhandled inline (links etc.): render its text so the offset space stays
            // complete, with no mark of its own.
            const any = node as any;
            if (Array.isArray(any.children)) {
                return any.children.flatMap((c: PhrasingContent) => renderPhrasing(c, b));
            }
            if (typeof any.value === 'string') return [b.leaf(any.value, rawStart)];
            return [];
        }
    }
}

function renderInline(children: PhrasingContent[], b: TreeBuilder): TreeNode[] {
    return children.flatMap(c => renderPhrasing(c, b));
}

function join(b: TreeBuilder, rawEnd: number): TextLeaf {
    return b.leaf('\n', rawEnd);
}

function renderList(list: List, indent: number, b: TreeBuilder): TreeNode[] {
    const items: TreeNode[] = [];
    for (const item of list.children as ListItem[]) {
        const para = item.children.find(c => c.type === 'paragraph') as Paragraph | undefined;
        const kids: TreeNode[] = [];
        // The displayed marker is the indent + bullet glyph (e.g.
        const indentPrefix = INDENT_UNIT.repeat(indent);
        const itemStart = item.position?.start?.offset ?? 0;
        const markerStart = Math.max(0, itemStart - indentPrefix.length);
        kids.push(b.leaf(indentPrefix + BULLET, markerStart));
        if (para) kids.push(...renderInline(para.children, b));
        const lineEnd = para?.position?.end?.offset ?? item.position?.end?.offset ?? itemStart;
        kids.push(join(b, lineEnd));
        for (const child of item.children) {
            if (child.type === 'list') kids.push(...renderList(child as List, indent + 1, b));
        }
        items.push(element('listItem', kids));
    }
    return [element('list', items)];
}

function renderTable(table: Table, b: TreeBuilder): ElementNode {
    const rows = table.children as TableRow[];
    const columns = rows.reduce((n, r) => Math.max(n, r.children.length), 0);
    const rowNodes: TreeNode[] = rows.map((row, rowIndex) => {
        const cellNodes = row.children as TableCell[];
        const cells = cellNodes.map((cell, cellIndex) => {
            // An empty cell is an element with no leaves: it occupies a slot and
            // contributes no characters.
            const kids = renderInline(cell.children as PhrasingContent[], b);
            const isLast = cellIndex === cellNodes.length - 1;
            if (isLast && rowIndex < rows.length - 1) kids.push(join(b, row.position?.end?.offset ?? 0));
            return element('tableCell', kids);
        });
        return element('tableRow', cells);
    });
    return element('table', rowNodes, { columns });
}

function renderBlock(node: RootContent, b: TreeBuilder): TreeNode[] {
    // The raw offset of the boundary just past this block — where its trailing '\n'
    // sits. Falls back to the block's own start when position is absent.
    const rawEnd = node.position?.end?.offset ?? node.position?.start?.offset ?? 0;
    switch (node.type) {
        case 'heading': {
            const h = node as Heading;
            // No inline size mark: the element IS an h1..h6, so the stylesheet supplies
            // the scale. A compact scale (the chat pane) overrides by class instead.
            const kids = renderInline(h.children, b);
            return [element('heading', [...kids, join(b, rawEnd)], { depth: h.depth })];
        }
        case 'paragraph':
            return [element('paragraph', [...renderInline((node as Paragraph).children, b), join(b, rawEnd)])];
        case 'list':
            return renderList(node as List, 0, b);
        case 'code': {
            const c = node as Code;
            const el = element('code', [b.leaf(c.value, node.position?.start?.offset ?? 0)], { lang: c.lang ?? undefined, atomic: true });
            return [el, join(b, rawEnd)];
        }
        case 'thematicBreak':
            return [element('thematicBreak', [], { atomic: true }), join(b, rawEnd)];
        case 'blockquote': {
            const q = node as Blockquote;
            const kids = (q.children as RootContent[]).flatMap(child => renderBlock(child, b));
            return [element('blockquote', kids)];
        }
        case 'table':
            return [renderTable(node as Table, b), join(b, rawEnd)];
        default: {
            // Unhandled block (html and anything new mdast yields): its raw text keeps
            // the offset space complete, with no chrome.
            const any = node as any;
            if (typeof any.value === 'string') {
                return [element('paragraph', [b.leaf(any.value, node.position?.start?.offset ?? 0), join(b, rawEnd)])];
            }
            return [];
        }
    }
}

export class MarkdownTree {
    constructor(
        readonly root: ElementNode,
        // The flat rendered string — what range.toString() must equal.
        readonly text: string,
        // Every leaf in document order.
        readonly leaves: readonly TextLeaf[],
    ) {}

    rawToDisplay(rawOffset: number, bias: 'start' | 'end'): number {
        if (this.leaves.length === 0) return 0;

        let lastEnd = 0;
        for (const leaf of this.leaves) {
            const rawStart = leaf.textOffset;
            const rawEnd = rawStart + leaf.text.length;

            if (rawOffset >= rawStart && rawOffset < rawEnd) {
                return leaf.displayOffset + (rawOffset - rawStart);
            }
            if (rawOffset < rawStart) {
                return bias === 'start' ? leaf.displayOffset : lastEnd;
            }
            lastEnd = leaf.displayOffset + leaf.text.length;
        }
        return lastEnd;
    }

    // Project a whole raw range into display space. Null when the projection collapses —
    // the range covered only markers, so it has no displayed characters to cover.
    projectRange(raw: { from: number; to: number }): { from: number; to: number } | null {
        const from = this.rawToDisplay(raw.from, 'start');
        const to = this.rawToDisplay(raw.to, 'end');
        return to > from ? { from, to } : null;
    }

    displayToRaw(displayOffset: number): number {
        if (this.leaves.length === 0) return 0;

        let lastRawEnd = 0;
        for (const leaf of this.leaves) {
            const dispStart = leaf.displayOffset;
            const dispEnd = dispStart + leaf.text.length;

            if (displayOffset >= dispStart && displayOffset < dispEnd) {
                return leaf.textOffset + (displayOffset - dispStart);
            }
            if (displayOffset < dispStart) return leaf.textOffset;
            lastRawEnd = leaf.textOffset + leaf.text.length;
        }
        return lastRawEnd;
    }
}

export function buildTree(tree: Root): MarkdownTree {
    const b = new TreeBuilder();
    const children = (tree.children as RootContent[]).flatMap(node => renderBlock(node, b));
    trimTrailingNewline(children, b);
    return new MarkdownTree(element('document', children), b.text, b.leaves);
}

// Remove the last leaf if it is the document-final '\n'. Done on the TREE (not just
// the string) so the leaf offsets stay in step with the flat text.
function trimTrailingNewline(children: TreeNode[], b: TreeBuilder): void {
    const last = (nodes: TreeNode[]): { parent: TreeNode[]; index: number } | null => {
        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            if (n.type === 'text') return { parent: nodes, index: i };
            const inner = last(n.children);
            if (inner) return inner;
        }
        return null;
    };
    const found = last(children);
    if (found == null) return;
    const leaf = found.parent[found.index] as TextLeaf;
    if (!leaf.text.endsWith('\n')) return;
    if (leaf.text === '\n') {
        found.parent.splice(found.index, 1);
    } else {
        leaf.text = leaf.text.slice(0, -1);
    }
    b.text = b.text.slice(0, -1);
}
