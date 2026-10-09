import { JSX, Show } from 'solid-js';
import type { TreeNode, ElementNode, TextLeaf, NodeKind, MarkStyle } from './MarkdownTree';
import { LiveComponent } from '../components/BaseComponents';
import type { ContextItem } from '../annotation/ContextItem';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import { NoteCoordinatorVisual, startAnchorNameFor, type NoteCoordinator } from '../annotation/AnnotationVisualFrames';
import mdStyles from '../styles/Markdown.module.css';
import hlStyles from '../styles/AnnotationHighlight.module.css';
import { CUT_ATTR } from '../styles/SplitMarkStyles';

// One stretch of a text leaf painting uniformly. A leaf splits into several runs only
// where a highlight starts or ends inside it.
export interface Run {
    text: string;
    start: number;                 // global DISPLAY offset — stamped as data-pos-x
    item: ContextItem | null;      // null => plain
    cutStart: boolean;
    cutEnd: boolean;
    padStart: boolean;
    padEnd: boolean;
}

function hasRoom(text: string, index: number): boolean {
    if (index < 0 || index >= text.length) return true;
    return /\s/.test(text[index]);
}

export function splitLeaf(start: number, text: string, items: ContextItem[]): Run[] {
    const end = start + text.length;
    // Every offset inside this leaf where the painting could change.
    const cuts = new Set<number>([start, end]);
    for (const item of items) {
        const r = item.getRange();
        if (r == null) continue;
        if (r.start > start && r.start < end) cuts.add(r.start);
        if (r.end > start && r.end < end) cuts.add(r.end);
    }
    const bounds = [...cuts].sort((a, b) => a - b);

    const runs: Run[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
        const from = bounds[i];
        const to = bounds[i + 1];
        if (to <= from) continue;
        // The item covering this stretch, if any. Runs are cut AT every item edge, so
        // a stretch is either fully inside an item or fully outside one.
        const item = items.find(it => {
            const r = it.getRange();
            return r != null && r.start <= from && to <= r.end;
        }) ?? null;
        runs.push({
            text: text.slice(from - start, to - start),
            start: from,
            item,
            cutStart: from > start,
            cutEnd: to < end,
            padStart: hasRoom(text, from - start - 1),
            padEnd: hasRoom(text, to - start),
        });
    }
    return runs;
}

interface Group {
    item: ContextItem | null;
    runs: Run[];
}

function groupChildren(node: ElementNode, runsOf: (leaf: TextLeaf) => Run[]): (Group | ElementNode)[] {
    const out: (Group | ElementNode)[] = [];
    let open: Group | null = null;
    for (const child of node.children) {
        if (child.type !== 'text') {
            // Structural nesting: close whatever is open and hand the element through.
            open = null;
            out.push(child);
            continue;
        }
        for (const run of runsOf(child)) {
            // Runs continue a group only while the item is identical.
            if (open != null && open.item === run.item) {
                open.runs.push(run);
            } else {
                open = { item: run.item, runs: [run] };
                out.push(open);
            }
        }
    }
    return out;
}

// Annotation-specific classes only. Typography belongs to the stylesheet; what stays
// here is what the ANNOTATION layer needs and a generic sheet cannot know about.
function kindClass(kind: NodeKind): string | undefined {
    switch (kind) {
        // Bullets/indent are rendered CHARACTERS in this view (they are counted in the
        // offset space), so the list must not also draw its own markers.
        case 'list': return mdStyles.plainList;
        default: return undefined;
    }
}

function withMarks(text: string, marks: MarkStyle[], cutStart: boolean, cutEnd: boolean): JSX.Element {
    let content: JSX.Element = text;
    for (let i = marks.length - 1; i >= 0; i--) {
        const inner = content;
        const mark = marks[i];
        const attrs = {
            'data-mark': mark.kind,
            ...(cutStart ? { [CUT_ATTR.start]: '' } : {}),
            ...(cutEnd ? { [CUT_ATTR.end]: '' } : {}),
        };
        switch (mark.kind) {
            case 'strong': content = <strong {...attrs}>{inner}</strong>; break;
            case 'emphasis': content = <em {...attrs}>{inner}</em>; break;
            case 'inlineCode': content = <code {...attrs}>{inner}</code>; break;
        }
    }
    return content;
}

function renderElement(el: ElementNode, children: JSX.Element): JSX.Element {
    const className = kindClass(el.kind);
    const style: JSX.CSSProperties | undefined = el.atomic && el.kind !== 'code'
        ? { 'user-select': 'none' }
        : undefined;

    switch (el.kind) {
        case 'document': return <>{children}</>;
        case 'paragraph': return <p class={className} style={style}>{children}</p>;
        case 'heading': {
            switch (Math.min(Math.max(el.depth ?? 1, 1), 6)) {
                case 1: return <h1 class={className} style={style}>{children}</h1>;
                case 2: return <h2 class={className} style={style}>{children}</h2>;
                case 3: return <h3 class={className} style={style}>{children}</h3>;
                case 4: return <h4 class={className} style={style}>{children}</h4>;
                case 5: return <h5 class={className} style={style}>{children}</h5>;
                default: return <h6 class={className} style={style}>{children}</h6>;
            }
        }
        case 'line': return <span class={className} style={style}>{children}</span>;
        case 'list': return <ul class={className} style={style}>{children}</ul>;
        case 'listItem': return <li class={className} style={style}>{children}</li>;
        case 'blockquote': return <blockquote class={className} style={style}>{children}</blockquote>;
        case 'table': return <table class={className} style={style}>{children}</table>;
        case 'tableRow': return <tr class={className} style={style}>{children}</tr>;
        case 'tableCell': return <td class={className} style={style}>{children}</td>;
        case 'code': return <pre class={className} style={style}>{children}</pre>;
        case 'thematicBreak': return <hr class={className} style={style} />;
        case 'break': return <br />;
    }
}

export interface RenderContext {
    items: ContextItem[];
    frameFor(item: ContextItem): NoteCoordinator | null;
}

function capClass(capStart: boolean, capEnd: boolean): string {
    if (capStart && capEnd) return hlStyles.full;
    if (capStart) return hlStyles.capStart;
    if (capEnd) return hlStyles.capEnd;
    return '';
}

function startAnchorName(frame: NoteCoordinator, span: RunSpan): string {
    return startAnchorNameFor(frame.spanAnchorName(span));
}

export class RunSpan extends LiveComponent {
    constructor(public runs: Run[], public item: ContextItem, public frame: NoteCoordinator) {
        super({});
    }

    getPreviewText(): string {
        return this.runs.map(r => r.text).join('');
    }

    handleClick(e: MouseEvent): void {
        const selection = window.getSelection();
        if (selection != null && !selection.isCollapsed) {
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            this.frame.setInactive();
            this.frame.updateNote('');
            sourceContextRegistry.remove(this.item);
        } else {
            this.frame.setActive();
        }
    }
}

function renderRunContent(run: Run, marks: MarkStyle[]): JSX.Element {
    return (
        <span class="txt-block" data-pos-x={run.start}>
            {withMarks(run.text, marks, run.cutStart, run.cutEnd)}
        </span>
    );
}

function renderGroup(
    group: Group,
    marksOf: (run: Run) => MarkStyle[],
    capStart: boolean,
    capEnd: boolean,
    ctx: RenderContext,
): JSX.Element {
    const content = <>{group.runs.map(r => renderRunContent(r, marksOf(r)))}</>;
    if (group.item == null) return content;
    const frame = ctx.frameFor(group.item);
    if (frame == null) return content;
    const span = new RunSpan(group.runs, group.item, frame);
    frame.register(span);
    return (
        <span
            class={`txt-block ${hlStyles.hl} ${capClass(capStart, capEnd)}`}
            data-kind="highlighted"
            data-pos-x={group.runs[0].start}
            ref={el => span.setFrameEl(el)}
            // A release can belong to an enclosing drag that merely ended here.
            // Click recognition proves the gesture itself began on this highlight.
            onClick={e => span.handleClick(e)}
            style={{ 'anchor-name': frame.spanAnchorName(span) }}
        >
            {/* The note renders from the ONE span the frame elected, so a highlight
                split across cells still shows a single note. */}
            <Show when={frame.rendersFrom(span)}>

                <span
                    class={hlStyles.startMarker}
                    aria-hidden="true"
                    style={{ 'anchor-name': startAnchorName(frame, span) }}
                />
                <NoteCoordinatorVisual value={frame} />
            </Show>
            {content}
        </span>
    );
}

export function renderTree(root: ElementNode, ctx: RenderContext): JSX.Element {
    // Split every leaf into runs, in document order, and remember each run's marks —
    // the group it lands in may mix runs from several leaves.
    const leafRuns = new Map<TextLeaf, Run[]>();
    const runMarks = new Map<Run, MarkStyle[]>();
    const ordered: Run[] = [];
    const collect = (node: TreeNode) => {
        if (node.type === 'text') {
            const runs = splitLeaf(node.displayOffset, node.text, ctx.items);
            leafRuns.set(node, runs);
            runs.forEach(r => runMarks.set(r, node.marks));
            ordered.push(...runs);
            return;
        }
        node.children.forEach(collect);
    };
    collect(root);
    const marksOf = (run: Run) => runMarks.get(run) ?? [];

    // Whether the run immediately before/after this group in the FLAT space carries the same item — i.e.
    const indexOf = new Map<Run, number>();
    ordered.forEach((r, i) => indexOf.set(r, i));
    const continuesInto = (from: Run, to: Run | undefined, item: ContextItem | null): boolean => {
        if (to == null || item == null || to.item !== item) return false;
        return from.start + from.text.length === to.start || to.start + to.text.length === from.start;
    };

    const frames = new Set<NoteCoordinator>();
    for (const run of ordered) {
        if (run.item == null) continue;
        const frame = ctx.frameFor(run.item);
        if (frame != null) frames.add(frame);
    }
    frames.forEach(f => f.resetRegistry());

    // Emit, reusing the runs decided above. Text children are consumed by the grouping
    // rather than visited individually, so `emit` only ever receives elements.
    const emit = (node: TreeNode): JSX.Element => {
        if (node.type === 'text') {
            // Unreachable via the element path below (groupChildren consumes leaves);
            // kept for a text root, which renders as its own runs with no wrapper.
            const runs = leafRuns.get(node) ?? [];
            return <>{runs.map(r => renderRunContent(r, node.marks))}</>;
        }
        const el = node as ElementNode;
        // A <br> is void: it takes no children and must not be given any.
        if (el.kind === 'break') return <br />;
        // Group this element's children, then emit: a group becomes one wrapper, a
        // nested element recurses.
        const children = groupChildren(el, leaf => leafRuns.get(leaf) ?? []).map(part => {
            if (!('runs' in part)) return emit(part);
            const first = part.runs[0];
            const last = part.runs[part.runs.length - 1];
            const before = ordered[(indexOf.get(first) ?? 0) - 1];
            const after = ordered[(indexOf.get(last) ?? 0) + 1];
            // Cap an edge unless the same highlight continues across it into another
            // element — the table-cell case, where the pieces must butt flush.
            return renderGroup(
                part,
                marksOf,
                !continuesInto(first, before, part.item),
                !continuesInto(last, after, part.item),
                ctx,
            );
        });
        return renderElement(el, children);
    };
    return emit(root);
}
