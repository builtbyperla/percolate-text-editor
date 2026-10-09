import { JSX } from 'solid-js/jsx-runtime';
import { Accessor, Show, createSignal } from 'solid-js';
import { StreamingMarkdownBody } from '../markdown/StreamingMarkdown';
import { MarkdownInnerText, MarkdownInnerTextVisual, CHAT_THEME } from '../markdown/MarkdownInnerText';
import { AnnotationTextView } from '../annotation/AnnotationTextView';
import { InnerText } from '../annotation/TextViewCore';
import {
    NoteCoordinator, ChatFlowNoteCoordinator, NoteAnchorParent, NoteLayerProps, appEditorLayer,
    containedMarkerNoteAnchorParams,
} from '../annotation/AnnotationVisualFrames';
import { AnnotatableComponent, ContextItem } from '../annotation/ContextItem';
import { ChatBlockStore, TextBlock } from './ChatBlockModel';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import { textSelectionManager } from '../interactions/TextSelectionManager';
import { preselectManager } from '../interactions/PreselectManager';
import { alog } from '../utility/AnchorDebug';

class LazyNoteAnchorParent implements NoteAnchorParent {
    constructor(private resolve: () => NoteAnchorParent | undefined) {}

    noteLayer = (): NoteLayerProps => this.resolve()?.noteLayer() ?? {};
    editorLayer = (): NoteLayerProps => this.resolve()?.editorLayer() ?? {};
}

class ChatBlockView extends AnnotationTextView {
    declare innerTextObject: MarkdownInnerText;
    constructor(raw: string, sourceId: string, private chatFrame: ChatTranscriptView) {
        super(raw, null, sourceId);
    }

    createInnerText(text?: string): InnerText {
        return new MarkdownInnerText(this, text, { theme: CHAT_THEME });
    }

    // Notes mount inside the transcript frame, not this one bubble (see class comment).
    createNoteFrame(highlight: AnnotatableComponent, item: ContextItem): NoteCoordinator {
        return new ChatFlowNoteCoordinator(
            highlight, new LazyNoteAnchorParent(() => this.chatFrame), item,
            () => sourceContextRegistry.remove(item));
    }
}

function resolveEndpoint(
    node: Node, offset: number, views: Map<string, ChatBlockView>,
): { blockId: string; localOffset: number } | null {
    const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element));
    const root = el?.closest('.txt-inner') as HTMLElement | null;
    if (root == null) return null;

    for (const [blockId, view] of views) {
        if (view.innerTextObject.getFrameEl() !== root) continue;
        const range = document.createRange();
        range.setStart(root, 0);
        range.setEnd(node, offset);
        return { blockId, localOffset: range.toString().length };
    }
    return null;
}

export class ChatTranscriptView implements NoteAnchorParent {
    private store: ChatBlockStore;
    private views = new Map<string, ChatBlockView>();
    private readonly root = createSignal<HTMLElement | undefined>();
    private readonly clamp = createSignal<HTMLElement | undefined>();
    private readonly clampName = `--chat-clamp-${crypto.randomUUID()}`;
    private readonly bumperName = `--chat-bumper-${crypto.randomUUID()}`;

    constructor(store: ChatBlockStore, private readonly getNotePortalMount: Accessor<HTMLElement | undefined>) {
        this.store = store;
        this.store.setBeforeReplace(() => this.dispose());
    }

    setRootEl(el: HTMLElement) {
        this.root[1](el);
        el.style.setProperty('anchor-name', this.bumperName);
        el.addEventListener('pointerdown', (e) => textSelectionManager.claim(this, e));
    }

    // The native selection, read live, if anchored inside this transcript (any block
    // root). Never cached — see TextSelectionManager for why a cache went stale.
    private ownedSelection(): Range | null {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return null;
        if (!this.getFrameEl()?.contains(selection.anchorNode)) return null;
        return selection.getRangeAt(0);
    }

    dispose(): void {
        preselectManager.dismissFor(this);
        for (const view of this.views.values()) {
            sourceContextRegistry.removeList([...sourceContextRegistry.itemsFor(view.sourceId)]);
            view.dispose();
        }
        this.views.clear();
    }

    setClampEl(el: HTMLElement) {
        this.clamp[1](el);
        el.style.setProperty('anchor-name', this.clampName);
        alog('clamp-mounted', {
            view: this.constructor.name,
            clampAnchor: this.clampName,
            clampEl: el,
        });
    }

    getFrameEl = this.root[0];

    noteLayer(): NoteLayerProps {
        const name = this.clamp[0]() ? this.clampName : undefined;
        return {
            portalMount: name ? this.getNotePortalMount() : undefined,
            clampAnchor: name,
            bumperAnchor: this.root[0]() ? this.bumperName : undefined,
            requireMount: true,
            paramsFor: containedMarkerNoteAnchorParams,
            strategy: 'note/start-marker-above/containing-block-clamp',
        };
    }

    editorLayer(): NoteLayerProps {
        return appEditorLayer(this.clamp[0]() ? this.clampName : undefined);
    }

    private renderStreamingBody(content: Accessor<string>): JSX.Element {
        // Compact heading scale so the live heading matches the settled
        // ChatBlockView's (createInnerText) — the pre/post-settle seam lines up.
        return StreamingMarkdownBody({ content, theme: CHAT_THEME });
    }

    private getOrCreateView(block: TextBlock): ChatBlockView {
        let view = this.views.get(block.id);
        if (view == null) {
            view = new ChatBlockView(block.getMarkdown(), `chat-${block.id}`, this);
            this.views.set(block.id, view);
        }
        return view;
    }

    renderBlockBody(block: TextBlock): JSX.Element {
        return (
            <Show
                when={block.ownsVisual()}
                fallback={this.renderStreamingBody(() => block.getMarkdown())}
            >
                <MarkdownInnerTextVisual value={this.getOrCreateView(block).innerTextObject} />
            </Show>
        );
    }

    onSelectionEnd(e: PointerEvent) {
        const range = this.ownedSelection();
        if (range == null) return;

        // Most cross-block selections have no commit path yet. At an exact block
        // boundary, however, the existing resolver can still produce one piece.
        // Resolve only that uncommon case before offering an action.
        const rootOf = (node: Node) =>
            (node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element)
                ?.closest('.txt-inner');
        const startRoot = rootOf(range.startContainer);
        const endRoot = rootOf(range.endContainer);
        if (!startRoot || !endRoot) return;
        if (startRoot !== endRoot) {
            const start = resolveEndpoint(range.startContainer, range.startOffset, this.views);
            const end = resolveEndpoint(range.endContainer, range.endOffset, this.views);
            if (!start || !end || this.resolveSelection(start, end).length !== 1) return;
        }

        if (preselectManager.guardSelection(this, range, e, () => {
            const current = this.ownedSelection();
            if (current) this.commitNativeSelection(current);
        })) return;

        this.commitNativeSelection(range);
    }

    private commitNativeSelection(range: Range): void {

        const start = resolveEndpoint(range.startContainer, range.startOffset, this.views);
        const end = resolveEndpoint(range.endContainer, range.endOffset, this.views);
        if (start == null || end == null) return;

        const pieces = this.resolveSelection(start, end);
        if (pieces.length === 0) return;

        this.addRegionHighlight(pieces);
    }

    private resolveSelection(
        start: { blockId: string; localOffset: number },
        end: { blockId: string; localOffset: number },
    ): { blockId: string; startOffset: number; endOffset: number }[] {
        const order = this.store.getBlocks().map(b => b.id).filter(id => this.views.has(id));
        const startIdx = order.indexOf(start.blockId);
        const endIdx = order.indexOf(end.blockId);
        if (startIdx === -1 || endIdx === -1) return [];

        const [loIdx, hiIdx] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const [loOffset, hiOffset] = startIdx <= endIdx
            ? [start.localOffset, end.localOffset]
            : [end.localOffset, start.localOffset];

        const pieces: { blockId: string; startOffset: number; endOffset: number }[] = [];
        for (let i = loIdx; i <= hiIdx; i++) {
            const blockId = order[i];
            const view = this.views.get(blockId)!;
            const fullLen = view.innerTextObject.getText().length;
            const from = i === loIdx ? loOffset : 0;
            const to = i === hiIdx ? hiOffset : fullLen;
            if (to > from) pieces.push({ blockId, startOffset: from, endOffset: to });
        }
        return pieces;
    }

    private addRegionHighlight(pieces: { blockId: string; startOffset: number; endOffset: number }[]) {
        if (pieces.length !== 1) return; // multi-segment: ignored for now (see above)

        const { blockId, startOffset, endOffset } = pieces[0];
        const view = this.views.get(blockId)!;
        view.commitHighlight(startOffset, endOffset);
    }
}
