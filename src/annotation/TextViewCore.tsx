import { Accessor, Component, JSX, Setter, createSignal, For } from 'solid-js';
import { LiveComponent, LiveData } from '../components/BaseComponents';
import { NoteCoordinator } from './AnnotationVisualFrames';
import { ContextItem, ContextRange } from './ContextItem';
import { AnnotationTextView } from './AnnotationTextView';
import { ViewBlock } from '../containers/Tabs';
import { componentRegistry } from '../ComponentRegistry';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import { RenderLayer, PlainRenderLayer, RenderUnit, BuildInput, DocPosition } from './RenderLayer';
import { TextDataModel } from '../textmodel/TextDataModel';
import { FixedTextDataModel } from '../textmodel/FixedTextDataModel';
import { RenderUnitVisual } from './TextRenderVisuals';

type SegmentPosition = number;

export type TextRepr = (PlainTextSegment | TextHighlight);

export interface Decoration {
    from: number;
    to: number;
    color?: string;
    className?: string;
    style?: JSX.CSSProperties;
}

function renderDecorated(text: string, segStart: number, decorations: Decoration[]): JSX.Element {
    if (decorations.length === 0) return text;
    const segEnd = segStart + text.length;
    const parts: JSX.Element[] = [];
    let pos = segStart;
    for (const d of decorations) {
        const from = Math.max(d.from, segStart);
        const to = Math.min(d.to, segEnd);
        if (to <= from) continue;
        if (from > pos) parts.push(text.slice(pos - segStart, from - segStart));
        const style: JSX.CSSProperties = { ...(d.color ? { color: d.color } : {}), ...(d.style ?? {}) };
        parts.push(<span class={d.className} style={d.className ? undefined : style}>{text.slice(from - segStart, to - segStart)}</span>);
        pos = to;
    }
    if (pos < segEnd) parts.push(text.slice(pos - segStart));
    return parts;
}

export interface ContentRenderer {
    render(text: string, segStart: number, decorations: Decoration[]): JSX.Element;
    renderHighlighted?(text: string, segStart: number, decorations: Decoration[]): JSX.Element;
}

// Default renderer: inline decorated text (syntax color / markdown inline marks).
// The fallback whenever a segment has no special renderer.
export const decoratedRenderer: ContentRenderer = {
    render: (text, segStart, decorations) => renderDecorated(text, segStart, decorations),
};

export interface FragmentOptions {
    text: string;
    position: number;
    parent: AnnotationTextView;

    // paint + position — computed by buildUnits, carried by the fragment (§3.4)
    segStart?: number;
    decorations?: Decoration[];
    renderer?: ContentRenderer;

    // highlight-only — omit both for a plain fragment
    context?: ContextItem;             // present => highlight; reconstruction reuses it
    noteable?: NoteCoordinator | null;   // null mints a fresh frame
}

export function makeFragment(opts: FragmentOptions): TextRepr {
    if (opts.context != null) {
        return new TextHighlight(opts);
    }
    return new PlainTextSegment(
        opts.text, opts.position, opts.segStart ?? 0,
        opts.decorations ?? [], opts.renderer ?? decoratedRenderer,
    );
}

// Need to store segment number always, regular uses direct segment number, others use segment maps [position to block]
export class PlainTextSegment {
    getText: Accessor<string>;
    setText: Setter<string>;
    getPosition: Accessor<SegmentPosition>;
    setPosition: Setter<SegmentPosition>;

    segStart: number;
    decorations: Decoration[];

    renderer: ContentRenderer;

    constructor(text: string, position: SegmentPosition, segStart: number = 0, decorations: Decoration[] = [], renderer: ContentRenderer = decoratedRenderer) {
        [this.getText, this.setText] = createSignal(text);
        [this.getPosition, this.setPosition] = createSignal(position);
        this.segStart = segStart;
        this.decorations = decorations;
        this.renderer = renderer;
    }

    isPlainText() {
        return true;
    }

    getNote() {
        // No-op for compatability
        return null;
    }

    setNote(_note: string) {
        // No-op for compatability
        return;
    }

    getContextItem(): ContextItem | null {
        return null;
    }

    getNoteInterface(): NoteCoordinator | null {
        return null;
    }
}

export class InnerText<L extends RenderLayer = RenderLayer> {
    sections: TextRepr[] = []; // Individual spans
    getSectionsSignal!: Accessor<TextRepr[]>;
    setSectionsSignal!: Setter<TextRepr[]>;

    // The renderable units the RenderLayer produced (§2.1). Replaces the per-variant
    // getLineItems/setLineItems pairs.
    getUnits!: Accessor<RenderUnit[]>;
    setUnits!: Setter<RenderUnit[]>;

    getFrameEl!: Accessor<HTMLElement | undefined>;
    setFrameEl!: Setter<HTMLElement | undefined>;
    parent: AnnotationTextView;

    dataSource!: TextDataModel;

    // The projection strategy (§3). Supplied by the subclass; the base carries the
    // plain layer, so the base IS the plain variant.
    protected renderLayer: L;

    constructor(parent: AnnotationTextView, text?: string, renderLayer?: L) {
        this.parent = parent;
        this.renderLayer = renderLayer ?? (new PlainRenderLayer() as unknown as L);
        this.baseSetup(text ?? "");
        if (new.target === InnerText) this.extendedSetup();
    }

    // Phase 1, in the base ctor: seed sections, signals, and the dataSource handle.
    // Touches no subclass state, and never builds.
    protected baseSetup(text: string) {
        [this.getFrameEl, this.setFrameEl] = createSignal<HTMLElement | undefined>(undefined);
        [this.getSectionsSignal, this.setSectionsSignal] = createSignal<TextRepr[]>([]);
        [this.getUnits, this.setUnits] = createSignal<RenderUnit[]>([]);
        this.dataSource = new FixedTextDataModel(text);
        this.setBaseText(text);
    }

    protected extendedSetup() {
        this.rebuildUnits();
    }

    getText(count?: number) {
        const fulltext = this.dataSource.displayText();
        if (count != null && count > 0) {
            return fulltext.slice(0, count);
        }
        return fulltext;
    }

    rebuildUnits(from: number = 0, to: number = this.getText().length) {
        const input: BuildInput = {
            sections: this.sections,
            dataSource: this.dataSource,
            parent: this.parent,
        };
        const result = this.renderLayer.buildUnits(input, from, to);
        const { units, sourceLines } = result;
        // Post-passes over the already-emitted units (§3.5): per-unit stamping, then
        // one publish for the whole walk. No-ops unless the layer overrides them.
        units.forEach((unit, i) => this.renderLayer.stampUnit(unit, i, sourceLines?.[i] ?? i + 1));
        this.renderLayer.publish(result);
        this.setUnits([...units]);
    }

    setBaseText(text: string) {
        this.dataSource.setValue(text);
        this.sections = [new PlainTextSegment(text, 0)];
    }

    updateData(text: string, items: ContextItem[]) {
        this.dataSource.setValue(text);
        this.loadFromContext(items, true);
        this.onSectionsUpdate();
    }

    loadFromContext(items: ContextItem[], skipRender=false) {
        const fullText = this.getText();

        const ranged = items
            .map(it => ({ item: it, range: it.getRange() }))
            .filter((e): e is { item: ContextItem; range: ContextRange } => e.range != null)
            .sort((a, b) => a.range.start - b.range.start);

        const newSections: TextRepr[] = [];
        let cursor = 0;
        for (const { item, range } of ranged) {
            const { start, end } = range;

            if (start < cursor || end > fullText.length || start >= end) {
                const cause = start >= end ? 'collapsed'
                    : end > fullText.length ? 'past-eof'
                    : 'overlaps-previous';
                sourceContextRegistry.reportInvalid(
                    this.parent.sourceId, item,
                    `${cause}: range [${start}, ${end}] invalid against cursor ${cursor} / length ${fullText.length}`
                );
                continue;
            }

            if (start > cursor) {
                newSections.push(new PlainTextSegment(fullText.slice(cursor, start), 0, cursor));
            }
            newSections.push(makeFragment({
                text: fullText.slice(start, end), position: 0, segStart: start,
                parent: this.parent, context: item, noteable: null,
            }));
            cursor = end;
        }
        if (cursor < fullText.length) {
            newSections.push(new PlainTextSegment(fullText.slice(cursor), 0, cursor));
        }

        this.sections = newSections;
        if (!skipRender) {
            this.onSectionsUpdate();
        }
    }

    // BACKWARD (§3.6): a DOM node + offset resolved to a document position, delegated
    // to the render layer — only the thing that decided the cuts can read them back.
    resolvePosition(node: Node, offsetInNode: number): DocPosition | null {
        return this.renderLayer.resolvePosition(node, offsetInNode);
    }

    noteableAt(offset: number): NoteCoordinator | null {
        for (const seg of this.sections) {
            const rng = seg.getContextItem()?.getRange();
            if (rng && rng.start <= offset && offset < rng.end) {
                const frame = seg.getNoteInterface();
                if (frame != null) return frame;
            }
        }
        return null;
    }

    onSectionsUpdate() {
        this.refreshIndices();
        this.updateSectionsSignal();
        this.rebuildUnits();
    }

    updateSectionsSignal() {
        // Update the signal with the current sections value
        this.setSectionsSignal(this.sections.slice(0, this.sections.length));
    }

    refreshIndices() {
        // Convenience method while we are using index as position
        let i = 0;
        for (let s of this.sections) {
            s.setPosition(i);
            i += 1;
        }
    }
}

export const InnerTextVisual: Component<{ value: InnerText }> = props => (
    <span class="txt-inner" ref={el => props.value.setFrameEl(el)} style={{ position: 'relative', display: 'inline' }}>

        <For each={props.value.getUnits()}>
            {unit => <RenderUnitVisual value={unit} />}
        </For>
    </span>
);

export class LiveTextComponent extends AnnotationTextView implements ViewBlock {

    // ViewBlock contract: text flows inside the pane's scroll host, and a live
    // text block is never structurally empty.
    ownsScroll: boolean = false;

    constructor(data: LiveData) {
        super(data.text);
        componentRegistry.register(this, 'text');
    }
}

export class TextHighlight extends LiveComponent {
    // Text value
    getText: Accessor<string>;
    setText: Setter<string>;

    // Position tracking
    getPosition: Accessor<SegmentPosition>;
    setPosition: Setter<SegmentPosition>;

    // Component references
    parent: AnnotationTextView;
    contextItem: ContextItem;
    noteable: NoteCoordinator;
    _stale: boolean = false;

    // Syntax color decorations (annotate view). See PlainTextSegment.
    segStart: number;
    decorations: Decoration[];

    renderer: ContentRenderer;

    refEl?: HTMLElement;

    constructor(opts: FragmentOptions) {
        super({});
        this.parent = opts.parent;
        this.segStart = opts.segStart ?? 0;
        this.decorations = opts.decorations ?? [];
        this.renderer = opts.renderer ?? decoratedRenderer;

        [this.getText, this.setText] = createSignal(opts.text);
        [this.getPosition, this.setPosition] = createSignal(opts.position);

        this.contextItem = opts.context ?? new ContextItem(opts.parent);

        if (opts.noteable == null) {
            // The view mints the frame (default: inline right-edge, own-inner
            // clamp), so a view can choose a different placement / clamp parent.
            this.noteable = this.parent.createNoteFrame(this, this.contextItem);
        } else {
            this.noteable = opts.noteable;
        }
    }

    static createNew(opts: FragmentOptions): TextHighlight {
        const highlight = new TextHighlight(opts);
        highlight.activate();
        sourceContextRegistry.add(highlight.contextItem, highlight.parent);
        return highlight;
    }

    getNoteInterface(): NoteCoordinator | null {
        return this.noteable;
    }

    getContextItem(): ContextItem | null {
        return this.contextItem;
    }

    activate() {
        this.noteable.setActive()
    }

    hideNoteElements() {
        this.noteable.setInactive();
        this.noteable.updateNote("");
    }

    clear() {
        if (this._stale) return;
        this._stale = true;
        this.noteable.dispose();
        // Drop from the evidence pane. Shared context across split children, but
        // removeItem is idempotent so clearing any segment removes the one entry.
        this.contextItem.deregister();
    }

    getPreviewText(): string {
        return this.getText();
    }

    isPlainText() {
        return false;
    }

    handleSegmentClick(e: MouseEvent) {
        if (!window.getSelection()?.isCollapsed) {
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            this.hideNoteElements();
            sourceContextRegistry.remove(this.contextItem);
        } else {
            console.log("Setting noteable active");
            this.noteable.setActive();
        }
    }

    getNote() {
        return this.noteable.getNote();
    }

    setNote(note: string) {
        this.noteable.updateNote(note);
    }
}
