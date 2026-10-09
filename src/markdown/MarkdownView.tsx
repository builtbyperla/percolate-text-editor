import { Component, JSX } from 'solid-js';
import { ViewBlock } from '../containers/Tabs';
import { AnnotatableComponent, ContextItem, ContextView } from '../annotation/ContextItem';
import { MarkdownDocNoteCoordinator, NoteCoordinator, NoteLayerProps, containedMarkerNoteAnchorParams } from '../annotation/AnnotationVisualFrames';
import { ContextViewHost } from '../interactions/ViewLocator';
import { AnnotationTextView } from '../annotation/AnnotationTextView';
import { InnerText } from '../annotation/TextViewCore';
import { MarkdownInnerText, MarkdownInnerTextVisual } from './MarkdownInnerText';
import { TextDataModel } from '../textmodel/TextDataModel';
import { FixedTextDataModel } from '../textmodel/FixedTextDataModel';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import mdStyles from '../styles/Markdown.module.css';

class MarkdownTextView extends AnnotationTextView {
    declare innerTextObject: MarkdownInnerText;

    private rawSource: TextDataModel;
    private disposeWatch: () => void = () => {};

    constructor(sourceId: string, rawSource: TextDataModel) {
        super(rawSource.getValue(), null, sourceId);
        this.rawSource = rawSource;

        (this.innerTextObject as MarkdownInnerText).attachRawModel(rawSource);

        // Re-derive the DISPLAY text when the raw text changes. A FixedTextDataModel never
        // fires this, so the standalone read-only path is a no-op subscription.
        this.disposeWatch = rawSource.onChange(() => this.rederive());
    }

    // Supply the markdown block-model InnerText instead of the flat base one.
    createInnerText(text?: string): InnerText {
        return new MarkdownInnerText(this, text);
    }

    createNoteFrame(highlight: AnnotatableComponent, item: ContextItem): NoteCoordinator {
        return new MarkdownDocNoteCoordinator(highlight, this, item,
            () => sourceContextRegistry.remove(item));
    }

    noteLayer(): NoteLayerProps {
        const clampEl = this.getClampEl();
        const frameEl = this.getFrameEl();
        return {
            portalMount: clampEl ? frameEl : undefined,
            clampAnchor: clampEl ? this.clampAnchor() : undefined,
            requireMount: true,
            paramsFor: containedMarkerNoteAnchorParams,
            strategy: 'note/start-marker-above/inner-frame-clamp',
        };
    }

    // Re-walk from the current raw text and reload this view's own annotations. Routes
    // through the markdown InnerText, which memoizes the parse on the raw string.
    private rederive(): void {
        const inner = this.innerTextObject as MarkdownInnerText;
        inner.rederive(this.rawSource.getValue(), sourceContextRegistry.itemsFor(this.sourceId));
    }

    onSourceContextItemsChange(items: ContextItem[]): void {
        super.onSourceContextItemsChange(items);
        (this.innerTextObject as MarkdownInnerText).syncTrackedRanges();
    }

    protected onItemsCommitted(): void {
        (this.innerTextObject as MarkdownInnerText).syncTrackedRanges();
    }

    getVisual(): () => JSX.Element {
        return () => <MarkdownTextViewVisual value={this} />;
    }

    onDirectClick(): void {
        // Read-only: no block-level select/deselect toggle for now.
        return;
    }

    dispose(): void {
        this.disposeWatch();
        (this.innerTextObject as MarkdownInnerText).detachRawModel();
        super.dispose();
    }
}

const MarkdownTextViewVisual: Component<{ value: MarkdownTextView }> = props => (
    <div
        class={mdStyles.frame}
        data-component-id={props.value.id}
        ref={(el: HTMLDivElement) => {
            props.value.setFrameEl(el);
        }}
        // Selection lives on the inner segments/highlights. pointerdown claims
        // the gesture; the selection manager informs this view at release.
        onpointerdown={(e: PointerEvent) => props.value.onMouseDown(e)}
    >
        <MarkdownInnerTextVisual value={props.value.innerTextObject} />
    </div>
);

export class MarkdownView implements ViewBlock, ContextViewHost {
    ownsScroll: boolean = true;

    readonly view: MarkdownTextView;

    constructor(sourceId: string, source: string | TextDataModel) {
        const rawSource = typeof source === 'string' ? new FixedTextDataModel(source) : source;
        this.view = new MarkdownTextView(sourceId, rawSource);
    }

    // The inner annotate view — the dual view reaches for it to expose the reader's
    // context views alongside the raw editor's.
    getContextView(): ContextView {
        return this.view;
    }

    // ContextViewHost: this shell isn't a ContextView (it has no source of its own),
    // but it holds the one that is — so a chip can reach the annotations inside it.
    getContextViews(): ContextView[] {
        return [this.view];
    }

    getVisual(): () => JSX.Element {
        return () => <MarkdownViewVisual value={this} />;
    }

    dispose() {
        this.view.dispose();
    }
}

const MarkdownViewVisual: Component<{ value: MarkdownView }> = props => (
    <div class={mdStyles.viewportShell}>
        <div class={mdStyles.scrollHost} ref={el => props.value.view.setClampEl(el)}>
            {props.value.view.getVisual()()}
        </div>
    </div>
);
