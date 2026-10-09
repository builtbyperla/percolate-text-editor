import { Accessor, Component, Show, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import { MessageCircle } from 'lucide-solid';
import { userSettings } from '../UserSettings';
import styles from '../styles/Preselect.module.css';

interface SelectionSnapshot {
    anchorNode: Node | null;
    anchorOffset: number;
    focusNode: Node | null;
    focusOffset: number;
}

interface PendingPreselect {
    owner: object;
    selection: SelectionSnapshot;
    range: Range;
    left: number;
    top: number;
    visible: boolean;
    commit: () => void;
}

const BUTTON_SIZE = 28;
const GAP = 8;

export function placePreselectButton(
    rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
    viewport: { width: number; height: number },
): { left: number; top: number } {
    const left = Math.max(GAP, Math.min(rect.right + GAP, viewport.width - BUTTON_SIZE - GAP));
    const above = rect.top - BUTTON_SIZE - GAP;
    const top = above >= GAP
        ? above
        : Math.max(GAP, Math.min(rect.bottom + GAP, viewport.height - BUTTON_SIZE - GAP));
    return { left, top };
}

function selectionStartRect(range: Range): Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'> | null {
    const start = range.cloneRange();
    start.collapse(true);
    const caret = start.getBoundingClientRect?.();
    if (caret && (caret.width || caret.height)) return caret;

    const rects = range.getClientRects?.();
    if (rects) {
        for (let i = 0; i < rects.length; i++) {
            if (rects[i].width || rects[i].height) return rects[i];
        }
    }
    return range.getBoundingClientRect?.() ?? null;
}

function selectionStartVisible(range: Range, rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>): boolean {
    if (rect.right < 0 || rect.left > window.innerWidth
        || rect.bottom < 0 || rect.top > window.innerHeight) return false;

    // A portaled action is outside the reader's scroll container. Check each
    // clipping ancestor so the button disappears when its text scrolls away.
    let ancestor = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as Element
        : range.startContainer.parentElement;
    while (ancestor) {
        const style = getComputedStyle(ancestor);
        const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
        const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
        if (clipX || clipY) {
            const bounds = ancestor.getBoundingClientRect();
            if ((clipX && bounds.width > 0 && (rect.right < bounds.left || rect.left > bounds.right))
                || (clipY && bounds.height > 0 && (rect.bottom < bounds.top || rect.top > bounds.bottom))) {
                return false;
            }
        }
        ancestor = ancestor.parentElement;
    }
    return true;
}

function snapshot(selection: Selection): SelectionSnapshot {
    return {
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset,
    };
}

function isSameSelection(saved: SelectionSnapshot): boolean {
    const current = window.getSelection();
    return !!current && !current.isCollapsed
        && current.anchorNode === saved.anchorNode
        && current.anchorOffset === saved.anchorOffset
        && current.focusNode === saved.focusNode
        && current.focusOffset === saved.focusOffset
        && !!saved.anchorNode?.isConnected && !!saved.focusNode?.isConnected;
}

class PreselectManager {
    readonly pending: Accessor<PendingPreselect | null>;
    private setPending: (pending: PendingPreselect | null) => void;

    constructor() {
        [this.pending, this.setPending] = createSignal<PendingPreselect | null>(null);
        document.addEventListener('pointerdown', e => {
            if (!(e.target as Element | null)?.closest('[data-preselect-action]')) this.dismiss();
        }, true);
        // The action is portaled to body, so scrolling any nested text pane
        // requires a fresh viewport position from the still-live range.
        document.addEventListener('scroll', () => this.refreshPosition(), true);
        document.addEventListener('selectionchange', () => {
            const pending = this.pending();
            if (pending && !isSameSelection(pending.selection)) this.dismiss();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') this.dismiss();
        });
        window.addEventListener('resize', () => this.refreshPosition());
    }

    private refreshPosition(): void {
        const pending = this.pending();
        if (!pending) return;
        if (!isSameSelection(pending.selection)) {
            this.dismiss();
            return;
        }
        const rect = selectionStartRect(pending.range);
        if (!rect) return;
        const visible = selectionStartVisible(pending.range, rect);
        const position = placePreselectButton(rect, {
            width: window.innerWidth, height: window.innerHeight,
        });
        if (position.left !== pending.left || position.top !== pending.top || visible !== pending.visible) {
            this.setPending({ ...pending, ...position, visible });
        }
    }

    // Called only after a claimed gesture has produced an owned native selection.
    // Offsets and context items are resolved later by the origin's existing path.
    guardSelection(owner: object, range: Range, event: PointerEvent, commit: () => void): boolean {
        if (userSettings.annotateLock() === 'annotation'
            || userSettings.nativeSelectionMode() === 'automatic') return false;

        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return false;
        const ownedRange = range.cloneRange();
        const selectionRect = selectionStartRect(ownedRange);
        const rect = selectionRect ?? {
            left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY,
        };
        const position = placePreselectButton(rect, {
            width: window.innerWidth, height: window.innerHeight,
        });
        this.setPending({ owner, selection: snapshot(selection), range: ownedRange,
            ...position, visible: !selectionRect || selectionStartVisible(ownedRange, selectionRect), commit });
        return true;
    }

    confirm(): void {
        const pending = this.pending();
        if (!pending || !isSameSelection(pending.selection)) {
            this.dismiss();
            return;
        }
        this.dismiss();
        pending.commit();
        window.getSelection()?.removeAllRanges();
    }

    dismiss(): void { this.setPending(null); }

    dismissFor(owner: object): void {
        if (this.pending()?.owner === owner) this.dismiss();
    }
}

export const preselectManager = new PreselectManager();

export const PreselectAction: Component = () => (
    <Show when={preselectManager.pending()}>
        {pending => (
            <Portal mount={document.body}>
                <button
                    type="button"
                    class={styles.action}
                    data-preselect-action
                    data-widget="preselect"
                    aria-label="Annotate selection"
                    title="Annotate selection"
                    style={{ left: `${pending().left}px`, top: `${pending().top}px`, display: pending().visible ? undefined : 'none' }}
                    onPointerDown={e => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    onClick={e => { e.stopPropagation(); preselectManager.confirm(); }}
                >
                    <MessageCircle size={14} />
                </button>
            </Portal>
        )}
    </Show>
);
