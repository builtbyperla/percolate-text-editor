import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { selectText } from './factories/dom';
import { ChatBlockStore, TextBlock } from '../src/chat/ChatBlockModel';
import { ChatTranscriptView } from '../src/chat/ChatTranscriptView';
import { contextRegistry } from '../src/interactions/ContextRegistry';
import { RegionContextItem } from '../src/annotation/ContextItem';
import { PreselectAction, preselectManager } from '../src/interactions/PreselectManager';
import { userSettings } from '../src/UserSettings';

afterEach(() => {
    preselectManager.dismiss();
    userSettings.setNativeSelectionMode('automatic');
    window.getSelection()?.removeAllRanges();
    cleanup();
});

// Tier-2: exercises the REAL cross-block offset resolution against rendered DOM
// — the core risk the plan calls out (resolveEndpoint / resolvePieces). A
// same-block selection must behave exactly like a lone markdown view's highlight
// (see MarkdownSelection.test.ts).
//
// The prototype commits a highlight ONLY when the selection lands entirely in a
// single inner text; a cross-block (multi-segment) selection is deliberately
// IGNORED (see notes/MULTI_REGION_HIGHLIGHT.md — the region design is deferred,
// not removed). The frame still ROUTES every selection, so these tests assert
// the routing (same-block commits, cross-block is a no-op), guarding the seam
// where the multi-region branch slots back in.

let seq = 0;
function renderTranscript(blocks: { id: string; content: string }[]) {
    const store = new ChatBlockStore();
    for (const b of blocks) {
        store.applyUpdate({ blockId: `${b.id}-${seq}`, role: 'assistant', delta: b.content, done: true });
    }
    seq++;
    const transcript = new ChatTranscriptView(store, () => undefined);
    // The listener is attached to the ref'd root itself (setRootEl), which
    // Testing Library mounts as a CHILD of its own `container` wrapper — a
    // bubbling dispatch on `container` never reaches it, so tests dispatch on
    // this root directly, same as a real pointerup bubbling up from inside it.
    let root!: HTMLElement;
    render(() => (
        <div ref={el => { root = el; transcript.setRootEl(el); }}>
            <For each={store.getBlocks()}>
                {(block) => <div>{transcript.renderBlockBody(block as TextBlock)}</div>}
            </For>
            <PreselectAction />
        </div>
    ));
    const roots = [...root.querySelectorAll('.txt-inner')] as HTMLElement[];
    return { transcript, root, roots };
}

// Selects from `needleA` (in root A) to `needleB` (in root B) and fires the
// transcript's pointerup handling, mirroring how selectText builds a Range
// within one root — extended here to span two.
function selectAcross(rootA: HTMLElement, needleA: string, rootB: HTMLElement, needleB: string): Range {
    const rangeA = selectText(rootA, needleA);
    const rangeB = selectText(rootB, needleB);
    const r = document.createRange();
    r.setStart(rangeA.startContainer, rangeA.startOffset);
    r.setEnd(rangeB.endContainer, rangeB.endOffset);
    return r;
}

function fireSelection(container: HTMLElement, range: Range) {
    // Mirror a real gesture's order: pointerdown CLAIMS the gesture for the view
    // (textSelectionManager), the selection is made, and the manager's document
    // pointerup informs the claimant, which reads the live selection. No
    // selectionchange step — nothing caches a range any more, so the only thing
    // that must be true at release is that the native selection is set.
    container.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
}

describe('ChatTranscriptView cross-block selection', () => {
    it('a same-block selection waits for its action, then registers one ContextItem', () => {
        userSettings.setNativeSelectionMode('always-action');
        const { root, roots } = renderTranscript([
            { id: 'a', content: 'the quick brown fox\n' },
            { id: 'b', content: 'second block text\n' },
        ]);
        const before = contextRegistry.items().length;
        fireSelection(root, selectAcross(roots[0], 'quick', roots[0], 'quick'));
        expect(contextRegistry.items()).toHaveLength(before);
        const action = document.body.querySelector<HTMLButtonElement>('[data-preselect-action]');
        expect(action).not.toBeNull();
        action!.click();
        const added = contextRegistry.items().slice(before);
        expect(added.length).toBe(1);
        expect(added[0].getPreviewText()).toBe('quick');
        // Single-block: the plain setRange path, so a base ContextItem — the region
        // subclass is only for a commit that actually crossed origins.
        expect(added[0]).not.toBeInstanceOf(RegionContextItem);
    });

    it('a cross-block selection is ignored — no highlight is committed (multi-region deferred)', () => {
        const { root, roots } = renderTranscript([
            { id: 'a', content: 'the quick brown fox\n' },
            { id: 'b', content: 'second block text\n' },
        ]);
        const before = contextRegistry.items().length;
        fireSelection(root, selectAcross(roots[0], 'brown fox', roots[1], 'second block'));
        const added = contextRegistry.items().slice(before);
        expect(added.length).toBe(0); // pieces.length > 1: routed but not committed
        expect(document.body.querySelector('[data-preselect-action]')).toBeNull();
    });

    it('keeps a single-block selection that ends at the next block boundary', () => {
        userSettings.setNativeSelectionMode('always-action');
        const { root, roots } = renderTranscript([
            { id: 'a', content: 'the quick brown fox\n' },
            { id: 'b', content: 'second block text\n' },
        ]);
        const start = selectText(roots[0], 'brown fox');
        const next = selectText(roots[1], 'second');
        const range = document.createRange();
        range.setStart(start.startContainer, start.startOffset);
        range.setEnd(next.startContainer, next.startOffset);
        const before = contextRegistry.items().length;

        fireSelection(root, range);
        expect(contextRegistry.items()).toHaveLength(before);
        document.body.querySelector<HTMLButtonElement>('[data-preselect-action]')!.click();
        expect(contextRegistry.items().slice(before)).toHaveLength(1);
    });
});
