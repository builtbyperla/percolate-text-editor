import { Accessor, Component, JSX, Setter, createSignal } from 'solid-js';
import { APP_VIEWPORT_ANCHOR, NoteCoordinator, DTVNoteCoordinator, NoteLayerProps, appEditorLayer, noteAnchorParams } from './AnnotationVisualFrames';
import { AnnotatableComponent, ContextItem, ContextView, ContextRegionPiece, SelectionResolver, ViewSelectionHandler, PREVIEW_CHARS } from './ContextItem';
import { InnerText, InnerTextVisual } from './TextViewCore';
import { revealElement } from '../utility/RevealScroll';
import { idService } from '../IdService';
import { LiveTextBox } from '../components/CoreVisuals';
import { TextDataModel } from '../textmodel/TextDataModel';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import { registrySources, SourceListener } from '../interactions/RegistrySources';
import { tabDragManager } from '../interactions/TabDragManager';
import { textSelectionManager } from '../interactions/TextSelectionManager';
import { preselectManager } from '../interactions/PreselectManager';
import { AnnotationLogic } from './AnnotationLogic';
import { alog } from '../utility/AnchorDebug';

export interface HighlightAnchorSupplInfo {
    viewportEl: Accessor<HTMLElement | undefined>,
    viewportAnchorName?: string
}

export abstract class AnnotationTextView implements AnnotatableComponent, ContextView, SourceListener, SelectionResolver, ViewSelectionHandler {
    id: string;

    readonly sourceId: string;

    getFrameEl: Accessor<HTMLElement | undefined>;
    setFrameEl: Setter<HTMLElement | undefined>;

    anchorInfo: HighlightAnchorSupplInfo | undefined;

    getClampEl: Accessor<HTMLElement | undefined>;
    private _setClampEl: Setter<HTMLElement | undefined>;
    getBumperEl: Accessor<HTMLElement | undefined>;
    private _setBumperEl: Setter<HTMLElement | undefined>;

    innerTextObject: InnerText;

    contextItem: ContextItem;

    datamodel: TextDataModel | null = null;

    // Guards dispose() against double-teardown: editor frames call dispose()
    // explicitly down their own spine AND it may run again from a view's teardown.
    private _disposed: boolean = false;

    get label(): string {
        return this.sourceId;
    }

    constructor(text?: string, textdatamodel?: TextDataModel | null, 
        sourceId?: string, 
        meta?: unknown,
        anchorInfo?: HighlightAnchorSupplInfo
    )
    {
        this.id = idService.requestId();
        this.sourceId = sourceId ?? crypto.randomUUID();
        [this.getFrameEl, this.setFrameEl] = createSignal<HTMLElement | undefined>(undefined);
        [this.getClampEl, this._setClampEl] = createSignal<HTMLElement | undefined>(undefined);
        [this.getBumperEl, this._setBumperEl] = createSignal<HTMLElement | undefined>(undefined);

        this.anchorInfo = anchorInfo;
        this.innerTextObject = this.createInnerText(text, meta);

        this.innerTextObject.loadFromContext(sourceContextRegistry.itemsFor(this.sourceId));
        registrySources.register(this.sourceId, this);
        if (textdatamodel) {
            this.datamodel = textdatamodel;
        }

        // One shared context item, threaded into both the note input and the
        // evidence pane so note/included live in a single place.
        this.contextItem = new ContextItem(this);

    }

    createInnerText(text?: string, meta?: unknown): InnerText {
        return new InnerText(this, text);
    }

    getPreviewText(): string {
        return this.getDataSource().displayText().slice(0, PREVIEW_CHARS);
    }

    getDataSource(): TextDataModel {
        return this.datamodel ?? this.innerTextObject.dataSource;
    }

    setClampEl(el: HTMLElement) {
        el.style.setProperty('anchor-name', this.clampAnchor());
        this._setClampEl(el);
        alog('clamp-mounted', {
            view: this.constructor.name,
            viewId: this.id,
            sourceId: this.sourceId,
            clampAnchor: this.clampAnchor(),
            clampEl: el,
        });
    }

    // The anchor-name a note's right edge clamps to. Stable per view; only
    // meaningful once setClampEl has stamped it onto the box element.
    clampAnchor(): string {
        return `--clamp-${this.id}`;
    }

    bumperAnchor(): string {
        return `--bumper-${this.id}`;
    }

    setBumperEl(el: HTMLElement) {
        el.style.setProperty('anchor-name', this.bumperAnchor());
        this._setBumperEl(el);
        alog('bumper-mounted', {
            view: this.constructor.name,
            bumperAnchor: this.bumperAnchor(),
            bumperEl: el,
        });
    }

    noteLayer(): NoteLayerProps {
        const clampEl = this.getClampEl();
        const bumperEl = this.getBumperEl();
        if (bumperEl) {
            return {
                // Code annotators can be horizontally scrollable. Mounting in
                // their content frame makes vertical collision content-relative;
                // deliberately omit the right clamp rather than shrinking a
                // truncated preview against the visible scrollport.
                portalMount: bumperEl,
                requireMount: true,
                paramsFor: noteAnchorParams,
                strategy: 'note/span-above/inner-content-unclamped',
            };
        }
        const clampAnchor = clampEl
            ? this.clampAnchor()
            : this.anchorInfo?.viewportAnchorName ?? APP_VIEWPORT_ANCHOR;
        return {
            clampAnchor,
            // The clamp must remain external to the positioned note: its opposing
            // left/right insets are what give the note a width to shrink within.
            portalMount: this.anchorInfo?.viewportEl() ?? (clampEl ? document.body : undefined),
            requireMount: clampEl != null || this.anchorInfo != null,
            paramsFor: noteAnchorParams,
            strategy: 'note/span-above',
        };
    }

    editorLayer(): NoteLayerProps {
        const clampAnchor = this.getClampEl()
            ? this.clampAnchor()
            : this.anchorInfo?.viewportAnchorName;
        return appEditorLayer(clampAnchor);
    }

    createNoteFrame(highlight: AnnotatableComponent, item: ContextItem): NoteCoordinator {
        console.log("Creating note frame for highlight", highlight, this.datamodel);
        return new DTVNoteCoordinator(highlight, this, item,
            () => sourceContextRegistry.remove(item));
    }

    onDirectClick() {
    }

    onSourceContextItemsChange(items: ContextItem[]): void {
        this.innerTextObject.loadFromContext(items);
    }

    onSourceContextPositionsChange(items: ContextItem[]): void {
        const text = this.datamodel?.getValue();
        if (text == null) {
            this.innerTextObject.loadFromContext(items);
            return;
        }
        this.innerTextObject.updateData(text, items);
    }

    scrollToItem(item: ContextItem) {
        const section = this.innerTextObject.sections
            .find(seg => seg.getContextItem() === item);
        const span = section?.getNoteInterface()?.firstSpan()?.getFrameEl();

        revealElement(span ?? this.getFrameEl());
    }

    // ContextView: highlights are fragments, not views — this view reveals them
    // itself via scrollToItem, so it exposes no nested views.
    getSubViews(): ContextView[] {
        return [];
    }

    clear() {
        this.contextItem.deregister();
        this.dispose();
    }

    protected ownedSelection(): Range | null {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return null;
        if (!this.getFrameEl()?.contains(selection.anchorNode)) return null;
        return selection.getRangeAt(0);
    }

    resolveSelection(rng: Range): ContextRegionPiece[] {
        const anchor = rng.startContainer.parentElement;
        const root = anchor?.closest('.txt-inner') as HTMLElement | null;
        if (root == null) return [];

        const start = this.innerTextObject.resolvePosition(rng.startContainer, rng.startOffset);
        if (start == null) return [];

        const end = this.innerTextObject.resolvePosition(rng.endContainer, rng.endOffset);
        const endOffset = end?.offset ?? this.innerTextObject.getText().length;

        const [a, b] = start.offset <= endOffset
            ? [start.offset, endOffset]
            : [endOffset, start.offset];
        return [{ view: this, start: a, end: b }];
    }

    // ViewSelectionHandler: release entry, called by the selection manager on the
    // view that claimed this gesture. Reads the live selection and commits.
    onSelectionEnd(e: PointerEvent): void {
        // A tab drop releasing over this view's body is the drag system's event, not
        // a text-selection end. Let it bubble to the enclosing pane's drop handler.
        if (tabDragManager.isDragActive()) return;
        e.stopPropagation();

        // A subclass that consumes a gesture itself (the annotator's line-mode drag)
        // returns before calling up, so there is no flag to check here.

        // Read the native selection LIVE (never a cache — see ownedSelection). No
        // range of ours (collapsed, or the selection was never ours) → block-level click.
        const range = this.ownedSelection();
        if (range == null) {
            this.onDirectClick();
            return;
        }

        if (preselectManager.guardSelection(this, range, e, () => {
            const current = this.ownedSelection();
            if (current) this.commitNativeSelection(current);
        })) return;

        this.commitNativeSelection(range);
    }

    private commitNativeSelection(range: Range): void {
        for (const piece of this.resolveSelection(range)) {
            this.commitHighlight(piece.start, piece.end);
        }
    }

    commitHighlight(start: number, end: number) {
        if (end - start < 2) return;

        const before = sourceContextRegistry.itemsFor(this.sourceId);
        const candidate = [...before];
        const values = AnnotationLogic.addHighlight({ start, end, origin: this }, candidate);
        if (values === candidate) return;

        // `this` as origin: our own sections are rebuilt on the next line, so the
        // fan skips us and only peer views on this source rebuild.
        sourceContextRegistry.setItems(this.sourceId, values, this);
        this.innerTextObject.loadFromContext(values);
        this.onItemsCommitted();

        this.innerTextObject.noteableAt(start)?.setActive();
    }

    protected onItemsCommitted(): void {}

    onMouseDown(e: PointerEvent) {
        textSelectionManager.claim(this, e);
        e.stopPropagation();
    }

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        preselectManager.dismissFor(this);
        registrySources.deregister(this.sourceId, this);
    }

    getCoreVisual() {
        return () => <AnnotationTextViewCoreVisual value={this} />;
    }

    getVisual(): () => JSX.Element {
        return () => <AnnotationTextViewVisual value={this} />;
    }
}

const AnnotationTextViewVisual: Component<{ value: AnnotationTextView }> = props => (
    <AnnotationTextViewCoreVisual value={props.value} />
);

const AnnotationTextViewCoreVisual: Component<{ value: AnnotationTextView }> = props => (
    <LiveTextBox
        id={props.value.id}
        ref={(el: HTMLElement) => props.value.setFrameEl(el)}
        value={() => <InnerTextVisual value={props.value.innerTextObject} />}
        onpointerdown={(e: PointerEvent) => props.value.onMouseDown(e)}
    />
);
