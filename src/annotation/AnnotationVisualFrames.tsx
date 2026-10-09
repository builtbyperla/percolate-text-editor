import { Component, JSX, Accessor, ParentComponent, Show, createSignal, createMemo, Setter, createContext, useContext } from 'solid-js';
import { Trash2, Send } from 'lucide-solid';
import styles from '../styles/VisualFrame.module.css';
import { sendToAgent } from '../chat/ChatFlow';
import { AnnotatableComponent, ContextItem } from './ContextItem';
import { AnchoredPortal, AnchorParams } from './AnchoredPortal';
import { Noteable, noteInputsManager } from '../interactions/NotesManager';
import { userSettings } from '../UserSettings';
import { windowrefregistry } from '../appcore/WindowRefRegistry';

export interface NoteAnchorParent {
    noteLayer(): NoteLayerProps;
    editorLayer(): NoteLayerProps;
}

export interface NoteLayerProps {
    clampAnchor?: string;
    bumperAnchor?: string;
    portalMount?: HTMLElement;
    requireMount?: boolean;
    paramsFor?: AnchorParamsFactory;
    strategy?: string;
}

export type AnchorParamsFactory = (
    spanAnchor: string,
    clampAnchor?: string,
    bumperAnchor?: string,
) => AnchorParams;

// Editors render at the document layer so the app root is an external anchor,
// not an ancestor of the positioned element. Wait for that anchor to mount;
// otherwise the app clamp is invalid and the browser drops the whole inset.
export function appEditorLayer(clampAnchor?: string): NoteLayerProps {
    const appRef = windowrefregistry.map.get(APP_VIEWPORT_ANCHOR);
    const appMounted = appRef?.() != null;
    return {
        // This is the editor's local placement boundary. App-wide visibility is
        // applied separately by editorAnchorParams, so the two constraints do
        // not overwrite one another.
        clampAnchor,
        portalMount: appMounted ? document.body : undefined,
        // The math always references the app anchor. Never render into a body
        // fallback when that anchor has not been registered and mounted.
        requireMount: true,
        paramsFor: editorAnchorParams,
        strategy: 'editor/app-viewport',
    };
}

export function startAnchorNameFor(spanName: string): string {
    return `${spanName}-start`;
}

export interface AnchorWrapperProps {
    spanAnchor: Accessor<string>;
    children: JSX.Element;
}

interface NoteLayerContextValue {
    clampAnchor: Accessor<string | undefined>;
    bumperAnchor: Accessor<string | undefined>;
    portalMount: Accessor<HTMLElement | undefined>;
    requireMount: Accessor<boolean>;
    paramsFor: Accessor<AnchorParamsFactory>;
    strategy: Accessor<string>;
}

const NoteLayerContext = createContext<NoteLayerContextValue>();

function useNoteLayer(): NoteLayerContextValue {
    const layer = useContext(NoteLayerContext);
    if (!layer) throw new Error('A note anchor wrapper needs a note layer');
    return layer;
}

export const APP_VIEWPORT_ANCHOR = '--app-viewport';

const ABOVE_GAP = 6;
const SIDE_GAP = 4;
const CLAMP_MARGIN = 20;
const MIN_NOTE_SLOT = 52;
const EDITOR_WIDTH = 200;
const EDITOR_HALF_HEIGHT = 55;

function aboveSpanParams(spanAnchor: string, bumperAnchor?: string): AnchorParams {
    return {
        left: `anchor(${spanAnchor} left)`,
        bottom: `calc(anchor(${spanAnchor} top) + ${ABOVE_GAP}px)`,
        positionAnchor: spanAnchor,
        style: {
            // If above-anchor placement crosses a vertical viewport edge, move
            // inline with the anchor. Horizontal clamp insets remain in force.
            'position-try-fallbacks': '--note-inline-right-top, --note-inline-right-bottom',
            'position-visibility': 'anchors-visible',
            ...(bumperAnchor ? {
                '--note-bumper-top': `anchor(${bumperAnchor} top)`,
                '--note-bumper-bottom': `anchor(${bumperAnchor} bottom)`,
            } : {}),
        },
    };
}

function clampNoteHorizontally(base: AnchorParams, start: string, viewport: string): AnchorParams {
    const viewportRight = `anchor(${viewport} right)`;
    return {
        ...base,
        left: `max(calc(anchor(${viewport} left) + ${CLAMP_MARGIN}px), min(${start}, calc(${viewportRight} - ${MIN_NOTE_SLOT + CLAMP_MARGIN}px)))`,
        right: `calc(${viewportRight} + ${CLAMP_MARGIN}px)`,
    };
}

function clampNoteToContainingBlock(base: AnchorParams, start: string): AnchorParams {
    return {
        ...base,
        // Viewer notes are portaled into the clamp element itself. In that case
        // both bounds are local. Referencing that ancestor as an anchor makes the
        // inset invalid in Chromium and sends the wrapper to its static position.
        left: `max(${CLAMP_MARGIN}px, min(${start}, calc(100% - ${MIN_NOTE_SLOT + CLAMP_MARGIN}px)))`,
        right: `${CLAMP_MARGIN}px`,
    };
}

export function noteAnchorParams(spanAnchor: string, viewport?: string, bumperAnchor?: string): AnchorParams {
    const base = aboveSpanParams(spanAnchor, bumperAnchor);
    return viewport == null
        ? base
        : clampNoteHorizontally(base, `anchor(${spanAnchor} left)`, viewport);
}

export function containedNoteAnchorParams(spanAnchor: string, viewport?: string, bumperAnchor?: string): AnchorParams {
    const base = aboveSpanParams(spanAnchor, bumperAnchor);
    return viewport == null
        ? base
        : clampNoteToContainingBlock(base, `anchor(${spanAnchor} left)`);
}

export function markerNoteAnchorParams(spanAnchor: string, viewport?: string, bumperAnchor?: string): AnchorParams {
    const markerAnchor = startAnchorNameFor(spanAnchor);
    const base: AnchorParams = {
        left: `anchor(${markerAnchor} left)`,
        bottom: `calc(anchor(${markerAnchor} top) + ${ABOVE_GAP}px)`,
        positionAnchor: spanAnchor,
        style: {
            'position-try-fallbacks': '--note-inline-right-top, --note-inline-right-bottom',
            'position-visibility': 'anchors-visible',
            ...(bumperAnchor ? {
                '--note-bumper-top': `anchor(${bumperAnchor} top)`,
                '--note-bumper-bottom': `anchor(${bumperAnchor} bottom)`,
            } : {}),
        },
    };
    return viewport == null
        ? base
        : clampNoteHorizontally(base, `anchor(${markerAnchor} left)`, viewport);
}

export function containedMarkerNoteAnchorParams(spanAnchor: string, viewport?: string): AnchorParams {
    const markerAnchor = startAnchorNameFor(spanAnchor);
    const base: AnchorParams = {
        left: `anchor(${markerAnchor} left)`,
        bottom: `calc(anchor(${markerAnchor} top) + ${ABOVE_GAP}px)`,
        positionAnchor: spanAnchor,
        style: {
            'position-try-fallbacks': '--note-inline-right-top, --note-inline-right-bottom',
            'position-visibility': 'anchors-visible',
        },
    };
    return viewport == null
        ? base
        : clampNoteToContainingBlock(base, `anchor(${markerAnchor} left)`);
}

function clampEditorToSurface(base: AnchorParams, surface?: string): AnchorParams {
    if (surface == null) return base;
    return {
        ...base,
        // Keep the fixed-width editor reachable at the local pane's right edge
        // without forcing it to shrink. Its final app-wide clamp below keeps the
        // overhang visible.
        left: `min(${base.left}, anchor(${surface} right))`,
        top: `max(${base.top}, calc(anchor(${surface} top) + ${EDITOR_HALF_HEIGHT + SIDE_GAP}px))`,
    };
}

function clampEditorToApp(base: AnchorParams): AnchorParams {
    const appLeft = `anchor(${APP_VIEWPORT_ANCHOR} left)`;
    const appRight = `anchor(${APP_VIEWPORT_ANCHOR} right)`;
    const appTop = `anchor(${APP_VIEWPORT_ANCHOR} top)`;
    const appBottom = `anchor(${APP_VIEWPORT_ANCHOR} bottom)`;
    return {
        ...base,
        left: `clamp(${appLeft}, ${base.left}, calc(${appRight} - ${EDITOR_WIDTH}px))`,
        top: `clamp(calc(${appTop} + ${EDITOR_HALF_HEIGHT}px), ${base.top}, calc(${appBottom} - ${EDITOR_HALF_HEIGHT}px))`,
    };
}

export function editorAnchorParams(spanAnchor: string, clampAnchor?: string): AnchorParams {
    const base: AnchorParams = {
        left: `calc(anchor(${spanAnchor} right) + ${SIDE_GAP}px)`,
        top: `calc((anchor(${spanAnchor} top) + anchor(${spanAnchor} bottom)) / 2)`,
        positionAnchor: spanAnchor,
        style: { transform: 'translateY(-50%)' },
        interactive: true,
    };
    return clampEditorToApp(clampEditorToSurface(base, clampAnchor));
}

interface LayerAnchorWrapperProps extends AnchorWrapperProps {
    surface: 'note-view' | 'note-editor';
    coordinator: NoteCoordinator;
}

const LayerAnchorWrapper: ParentComponent<LayerAnchorWrapperProps> = props => {
    const layer = useNoteLayer();
    const params = createMemo(() => layer.paramsFor()(
        props.spanAnchor(),
        layer.clampAnchor(),
        layer.bumperAnchor(),
    ));

    return (
        <Show when={layer.requireMount()
            ? layer.portalMount()
            : layer.portalMount() ?? document.body} keyed>
            {target => (
                <AnchoredPortal
                    params={params}
                    mount={target}
                    debug={() => ({
                        surface: props.surface,
                        coordinator: props.coordinator.constructor.name,
                        noteId: props.coordinator.id,
                        spanAnchor: props.spanAnchor(),
                        markerAnchor: startAnchorNameFor(props.spanAnchor()),
                        clampAnchor: layer.clampAnchor(),
                        bumperAnchor: layer.bumperAnchor(),
                        strategy: layer.strategy(),
                    })}
                >
                    {props.children}
                </AnchoredPortal>
            )}
        </Show>
    );
};

export class NoteCoordinator extends Noteable {
    contextItem: ContextItem;

    coreComponent: AnnotatableComponent;
    parent: NoteAnchorParent;

    getNoteText: Accessor<string>;

    private commitHandler: (() => void) | null = null;

    private onDelete: (() => void) | null;

    items: AnnotatableComponent[] = [];
    private getItems: Accessor<AnnotatableComponent[]>;
    private setItems: Setter<AnnotatableComponent[]>;

    constructor(
        coreComponent: AnnotatableComponent,
        parent: NoteAnchorParent,
        contextItem: ContextItem,
        onDelete: (() => void) | null = null,
    ) {
        super(coreComponent.id);

        this.coreComponent = coreComponent;
        this.parent = parent;
        this.contextItem = contextItem;
        this.onDelete = onDelete;

        this.getNoteText = contextItem.getNote;

        [this.getItems, this.setItems] = createSignal<AnnotatableComponent[]>(this.items);

        this.firstSpan = () => this.getItems()[0] ?? this.coreComponent;
    }

    register(item: AnnotatableComponent) {
        this.items.push(item);
        this.setItems([...this.items]);
    }

    resetRegistry() {
        this.items = [];
        this.setItems([]);
    }

    firstSpan: Accessor<AnnotatableComponent>;

    rendersFrom(item: AnnotatableComponent): boolean {
        return this.firstSpan() === item;
    }

    spanAnchorName(item: AnnotatableComponent): string {
        return `--note-anchor-${this.id}-${item.id}`;
    }

    get note(): string | null {
        return this.contextItem.getNote();
    }

    getNote(): string {
        return this.contextItem.getNote();
    }

    onCommit(handler: (() => void) | null): void {
        this.commitHandler = handler;
    }

    commit(): void {
        const handler = this.commitHandler;
        this.commitHandler = null;
        handler?.();
    }

    setActive(): void {
        noteInputsManager.activate(this.id);
    }

    setInactive(): void {
        this.commitHandler = null;
        noteInputsManager.deactivate(this.id);
    }

    dispose(): void {
        this.setInactive();
        this.contextItem.setNote('');
    }

    canDelete(): boolean {
        return this.onDelete != null;
    }

    deleteAnnotation(): void {
        this.setInactive();
        this.onDelete?.();
    }

    updateNote(note: string) {
        this.contextItem.setNote(note);
    }

}

export class DTVNoteCoordinator extends NoteCoordinator {}
export class MarkdownDocNoteCoordinator extends NoteCoordinator {}
export class ChatFlowNoteCoordinator extends NoteCoordinator {}

export class RegionNoteCoordinator extends NoteCoordinator {}

// The coordinator owns the span. Context carries only the surrounding layer:
// its live frame element, clamp anchor, and portal mounts.
export const NoteCoordinatorVisual: Component<{ value: NoteCoordinator }> = props => {
    const noteConfig = createMemo(() => props.value.parent.noteLayer());
    const editorConfig = createMemo(() => props.value.parent.editorLayer());
    const noteLayer: NoteLayerContextValue = {
        clampAnchor: () => noteConfig().clampAnchor,
        bumperAnchor: () => noteConfig().bumperAnchor,
        portalMount: () => noteConfig().portalMount,
        requireMount: () => noteConfig().requireMount ?? false,
        paramsFor: () => noteConfig().paramsFor ?? noteAnchorParams,
        strategy: () => noteConfig().strategy ?? 'note/span-above',
    };
    const editorLayer: NoteLayerContextValue = {
        clampAnchor: () => editorConfig().clampAnchor,
        bumperAnchor: () => editorConfig().bumperAnchor,
        portalMount: () => editorConfig().portalMount,
        requireMount: () => editorConfig().requireMount ?? false,
        paramsFor: () => editorConfig().paramsFor ?? editorAnchorParams,
        strategy: () => editorConfig().strategy ?? 'editor/app-viewport',
    };
    return (
        <>
            <NoteLayerContext.Provider value={noteLayer}>
                <FloatingNoteArm value={props.value} span={props.value.firstSpan} />
            </NoteLayerContext.Provider>
            <NoteLayerContext.Provider value={editorLayer}>
                <NoteEditorArm value={props.value} span={props.value.firstSpan} />
            </NoteLayerContext.Provider>
        </>
    );
};

interface NoteArmProps {
    value: NoteCoordinator;
    span: Accessor<AnnotatableComponent>;
}

const FloatingNoteArm: Component<NoteArmProps> = props => {
    const [expanded, setExpanded] = createSignal(false);
    const spanAnchor = () => props.value.spanAnchorName(props.span());
    const visible = () => props.value.getNoteText().length > 0
        && !noteInputsManager.isActive(props.value.id)
        && !userSettings.autoHideNotes;
    return (
        <Show when={visible()}>
            <LayerAnchorWrapper spanAnchor={spanAnchor} surface="note-view" coordinator={props.value}>
                <FloatingNoteVisual text={props.value.getNoteText} expanded={expanded} />
            </LayerAnchorWrapper>
        </Show>
    );
};

const NoteEditorArm: Component<NoteArmProps> = props => {
    const spanAnchor = () => props.value.spanAnchorName(props.span());
    return (
        <Show when={noteInputsManager.isActive(props.value.id)}>
            <LayerAnchorWrapper spanAnchor={spanAnchor} surface="note-editor" coordinator={props.value}>
                <NoteEditorVisual value={props.value} />
            </LayerAnchorWrapper>
        </Show>
    );
};

const NoteEditorVisual: Component<{ value: NoteCoordinator }> = props => {
    const hide = () => props.value.setInactive();
    const send = async () => {
        if (await sendToAgent(props.value.getNote(), props.value.contextItem)) hide();
    };
    const onInput = (event: InputEvent) => {
        const value = (event.target as HTMLTextAreaElement).value;
        props.value.updateNote(value.trim() === '' ? '' : value);
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            props.value.commit();
            hide();
        }
    };
    return (
        <div class={styles.editor} data-widget="note-editor">
            <div class={styles.editorHeader}>
                <div class={styles.editorActions}>
                    <Show when={props.value.canDelete()}>
                        <button class={styles.headerButton} type="button" aria-label="Delete annotation"
                            title="Delete annotation" onPointerUp={() => props.value.deleteAnnotation()}>
                            <Trash2 size={13} />
                        </button>
                    </Show>
                    <button class={styles.headerButton} type="button" aria-label="Send to agent"
                        title="Send to agent" disabled={props.value.getNote().trim().length === 0}
                        onPointerUp={send}>
                        <Send size={13} />
                    </button>
                </div>
                <button class={styles.headerButton} type="button" aria-label="Close"
                    onPointerUp={event => { event.stopPropagation(); hide(); }}>
                    ×
                </button>
            </div>
            <textarea class={styles.bodyInput} placeholder="Type to enter text"
                ref={el => queueMicrotask(() => el.focus())}
                onInput={onInput} onKeyDown={onKeyDown}
                value={props.value.getNote()} />
        </div>
    );
};

const FloatingNoteVisual: Component<{
    text: Accessor<string>;
    expanded: Accessor<boolean>;
}> = props => (
    <div class={styles.noteRow}>
        <div class={styles.floatingnote} classList={{ [styles.preview]: !props.expanded() }}>
            {props.text()}
        </div>
    </div>
);
