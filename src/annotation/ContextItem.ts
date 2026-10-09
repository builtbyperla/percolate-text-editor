import { Accessor, JSX, Setter, createSignal } from 'solid-js';
import { contextRegistry } from '../interactions/ContextRegistry';
import { viewLocator } from '../interactions/ViewLocator';
import type { TextDataModel } from '../textmodel/TextDataModel';

// How much of a whole-source item's text stands in for it as a preview. A ranged item
// shows its exact slice instead, however long that is.
export const PREVIEW_CHARS = 60;

export interface AnnotatableComponent {
    id: string;
    getFrameEl: Accessor<HTMLElement | undefined>;
    setFrameEl: Setter<HTMLElement | undefined>;
    getPreviewText(): string;
}

export interface SelectionResolver {
    resolveSelection(range: Range): ContextRegionPiece[];
}

export interface ViewSelectionHandler {
    onSelectionEnd(e: PointerEvent): void;
}

// The item's own minted id plus its scope. Used for serialization/debugging, not
// for tiebacks.
export interface ContextMetadata {
    id: string;
    range: ContextRange | null;
}

export interface ContextRange {
    start: number;
    end: number;
}

export interface ContextRegionPiece {
    view: ContextView;
    start: number;
    end: number;
}

// A pull callback returning an annotation's richer payload for downstream consumers (the agent context).
export type AdditionalDataFn = () => {} | undefined;

export interface FullSourceOverride {
    label: string;
    additionalData: unknown;
}

export interface ContextView {
    readonly sourceId: string;

    // How a sent excerpt should be shown in chat. Text views keep their natural
    // line breaks; editor views opt into numbered source lines.
    readonly contextPresentation?: 'text' | 'code';

    // Display name for the group's header row.
    readonly label: string;

    getDataSource(): TextDataModel;

    scrollToItem(item: ContextItem): void;

    getSubViews(): ContextView[];

    additionalData?: AdditionalDataFn;
}

export class ContextItem {
    getNote: Accessor<string>;
    setNote: Setter<string>;

    getIncluded: Accessor<boolean>;
    setIncluded: Setter<boolean>;

    getText: Accessor<string> = () => this.getPreviewText();

    protected getRangeSignal: Accessor<ContextRange | null>;
    protected setRangeSignal: Setter<ContextRange | null>;

    readonly view: ContextView;
    readonly metadata: ContextMetadata;

    readonly additionalData: AdditionalDataFn;

    constructor(view: ContextView, additionalData: AdditionalDataFn = () => undefined) {
        this.view = view;
        this.metadata = { id: crypto.randomUUID(), range: null};

        [this.getNote, this.setNote] = createSignal("");
        [this.getIncluded, this.setIncluded] = createSignal(true);
        [this.getRangeSignal, this.setRangeSignal] = createSignal<ContextRange | null>(null);

        this.additionalData = additionalData;
    }

    getSourceType(): string {
        return this.metadata.range != null ? 'segment' : 'text';
    }

    // Grouping key for the evidence pane's per-source tree. Every view has an id,
    // so grouping needs no per-item fallback.
    groupKey(): string {
        return this.view.sourceId;
    }

    // Display label for the group's header row.
    groupLabel(): string {
        return this.view.label;
    }

    // Note text when present and the pane is in note-display mode; otherwise this item's
    // preview text. (Was Selectable.displayText.)
    get displayText(): string {
        const note = this.getNote();
        return note.trim().length > 0 && contextRegistry.shouldShowNote()
            ? note
            : this.getPreviewText();
    }

    // Derive the snippet directly instead of owning a memo. ContextItems may be created
    // by selection event handlers, outside a Solid root; callers that read this method
    // reactively still track both the source and range signals in their own owner.
    getPreviewText(): string {
        const text = this.view.getDataSource().displayText();
        const range = this.getRangeSignal();
        return range != null
            ? text.slice(range.start, range.end)
            : text.slice(0, PREVIEW_CHARS);
    }

    // A source item may supply a richer whole-source representation at send time.
    getFullSourceOverride(): FullSourceOverride | undefined {
        return undefined;
    }

    isWholeSource(): boolean {
        return this.metadata.range == null;
    }

    setRange(start: number, end: number): void {
        this.metadata.range = { start, end };
        this.setRangeSignal({ start, end });
    }

    getRange(): ContextRange | null {
        return this.metadata.range;
    }

    scrollIntoView(): void {
        if (viewLocator.showItem(this)) return;
        this.view.scrollToItem(this);
    }

    // Add/remove this item from the evidence pane. Idempotent via the registry.
    register(): void {
        contextRegistry.addItem(this);
    }

    deregister(): void {
        contextRegistry.removeItem(this);
    }
}

export class RegionContextItem extends ContextItem {
    private regions: ContextRegionPiece[] = [];

    setRegions(pieces: ContextRegionPiece[]): void {
        this.regions = pieces;
        this.metadata.range = pieces.length > 0
            ? { start: pieces[0].start, end: pieces[pieces.length - 1].end }
            : null;
        this.setRangeSignal(this.metadata.range);
    }

    getRegions(): ContextRegionPiece[] {
        return this.regions;
    }

    // Each piece against its own view's live display text, in document order.
    getPreviewText(): string {
        return this.regions
            .map(p => p.view.getDataSource().displayText().slice(p.start, p.end))
            .join('');
    }

    scrollIntoView(): void {
        (this.regions[0]?.view ?? this.view).scrollToItem(this);
    }
}
