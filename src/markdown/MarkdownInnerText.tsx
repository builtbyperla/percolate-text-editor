import { InnerText } from '../annotation/TextViewCore';
import { RenderLayer, RenderUnit, BuildInput } from '../annotation/RenderLayer';
import { buildTree, MarkdownTree } from './MarkdownTree';
import { renderTree } from './MarkdownRenderTree';
import { AnnotationTextView } from '../annotation/AnnotationTextView';
import type { ContextItem } from '../annotation/ContextItem';
import type { NoteCoordinator } from '../annotation/AnnotationVisualFrames';
import { renderMarkdown, MarkdownRender, RenderMarkdownOptions } from './MarkdownModel';
import { MarkdownDerivedModel } from './MarkdownDerivedModel';
import type { TextDataModel } from '../textmodel/TextDataModel';
import type { AnchorRange } from '../textmodel/AnnotationAnchors';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import mdStyles from '../styles/Markdown.module.css';
import chatMdStyles from '../styles/MarkdownChat.module.css';
import { createMemo, type Component } from 'solid-js';

export const DOCUMENT_THEME = 'markdown-body';
export const CHAT_THEME = chatMdStyles.chat;

class MarkdownRenderLayer extends RenderLayer {
    constructor(public model: MarkdownRender) {
        super();
    }

    buildUnits(input: BuildInput, _from: number, _to: number) {
        return { units: input.sections.map(section => new RenderUnit([section], undefined, 'span')) };
    }
}

export class MarkdownInnerText extends InnerText<MarkdownRenderLayer> {
    declare tree: MarkdownTree;
    // The typography classes this render wears, supplied by the container (see
    // RenderMarkdownOptions.theme). Defaults to the document look.
    declare theme: string;
    // The raw string the current tree was built from — the memo key for rederive, so a
    // rebuild that isn't a text change skips the parse. `declare` for the same reason.
    declare private lastRaw: string;
    declare private derived: MarkdownDerivedModel;
    // The raw model this reader is a derived view of, and our key in its tracked-set map.
    // Null for a standalone read-only tab over fixed text, where nothing ever edits.
    declare private rawModel: TextDataModel | null;
    declare private trackKey: string;
    declare private disposeTracking: () => void;

    constructor(parent: AnnotationTextView, raw?: string, renderOpts?: RenderMarkdownOptions) {
        const model = renderMarkdown(raw ?? '', renderOpts);
        const tree = buildTree(model.tree);
        // Seed the base with the FLAT RENDERED text (markers stripped, bullets
        // glyphed, inter-line '\n's kept) — the string the annotation core counts.
        super(parent, raw != null ? tree.text : undefined, new MarkdownRenderLayer(model));
        this.tree = tree;
        this.theme = renderOpts?.theme ?? DOCUMENT_THEME;
        this.lastRaw = raw ?? '';
        this.derived = new MarkdownDerivedModel(tree.text);
        this.dataSource = this.derived;
        this.rawModel = null;
        this.trackKey = parent.sourceId;
        this.disposeTracking = () => {};
        // Phase 2 (§2.2): the layer holds its model, so the first build is complete.
        this.extendedSetup();
    }

    attachRawModel(rawModel: TextDataModel): void {
        this.disposeTracking();
        this.rawModel = rawModel;
        this.disposeTracking = rawModel.trackRanges(this.trackKey, [], result => {
            this.onRangesMapped(rawModel.getValue(), result);
        });
        // Seed with whatever this view already holds (a reattach, or annotations restored
        // before the model arrived).
        this.syncTrackedRanges();
    }

    detachRawModel(): void {
        this.disposeTracking();
        this.disposeTracking = () => {};
        this.rawModel = null;
    }

    rederive(raw: string, items: ContextItem[]): void {
        if (raw === this.lastRaw) {
            // No text change (e.g. a new highlight): just rebuild sections.
            this.loadFromContext(items, true);
            return;
        }
        this.lastRaw = raw;
        this.tree = buildTree(renderMarkdown(raw).tree);
        this.derived.setValue(this.tree.text);

        this.loadFromContext(sourceContextRegistry.itemsFor(this.parent.sourceId), false);
    }

    onRangesMapped(newRaw: string, result: { survivors: AnchorRange[]; dropped: string[] }): void {
        const items = sourceContextRegistry.itemsFor(this.parent.sourceId);
        const byId = new Map(items.map(it => [it.metadata.id, it] as const));
        const projectionTree = buildTree(renderMarkdown(newRaw).tree);

        for (const s of result.survivors) {
            const item = byId.get(s.id);
            if (item == null) continue;
            const display = projectionTree.projectRange(s);
            if (display == null) sourceContextRegistry.remove(item);
            else item.setRange(display.from, display.to);
        }
        for (const id of result.dropped) {
            const item = byId.get(id);
            if (item) sourceContextRegistry.remove(item);
        }
        // Keep the raw model's tracked set in step with what actually survived.
        this.syncTrackedRanges();
    }

    syncTrackedRanges(): void {
        const anchors: AnchorRange[] = [];
        for (const item of sourceContextRegistry.itemsFor(this.parent.sourceId)) {
            const r = item.getRange();
            if (r == null) continue;   // whole-source items carry no anchor
            anchors.push({
                id: item.metadata.id,
                from: this.tree.displayToRaw(r.start),
                to: this.tree.displayToRaw(r.end),
            });
        }
        this.rawModel?.updateTrackedRanges(this.trackKey, anchors);
    }

}

export const MarkdownInnerTextVisual: Component<{ value: MarkdownInnerText }> = props => {
    const content = createMemo(() => {
        const sections = props.value.getSectionsSignal();
        const items: ContextItem[] = [];
        const frames = new Map<ContextItem, NoteCoordinator>();
        for (const seg of sections) {
            const item = seg.getContextItem();
            if (item == null) continue;
            items.push(item);
            const frame = seg.getNoteInterface();
            if (frame != null) frames.set(item, frame);
        }
        return renderTree(props.value.tree.root, {
            items,
            frameFor: item => frames.get(item) ?? null,
        });
    });

    return (
        <div
            class={`${props.value.theme} ${mdStyles.markdown} txt-inner`}
            ref={el => props.value.setFrameEl(el)}
        >
            {content()}
        </div>
    );
};
