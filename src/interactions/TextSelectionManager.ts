
export interface SelectionOrigin {
    onSelectionEnd(e: PointerEvent): void;
}

export class TextSelectionManager {
    private origin: SelectionOrigin | null = null;

    private gestureActive: boolean = false;

    constructor() {
        document.addEventListener('pointerup', (e) => this.onDocumentPointerUp(e), true);
    }

    claim(view: SelectionOrigin, e: PointerEvent): void {
        if (this.gestureActive) return;
        if (!this.isSelectionGesture(e)) return;
        this.origin = view;
        this.gestureActive = true;
    }

    // Is this press the start of a text selection, as opposed to a widget's own click?
    private isSelectionGesture(e: PointerEvent): boolean {
        // Secondary presses belong to the browser context menu, even if a native
        // text selection is already present under the pointer.
        if (e.button !== 0) return false;
        // Modified clicks are reserved gestures (alt/meta remove an existing
        // highlight), not selections — the editor routes them itself.
        if (e.altKey || e.metaKey || e.ctrlKey) return false;

        const el = e.target as Element | null;
        if (el == null) return true;
        // A widget subtree owns its press: the note editor ([data-widget]) and an
        // existing highlight, which handles its own open/remove.
        if (el.closest('[data-widget]')) return false;
        if (el.closest('[data-kind="highlighted"]')) return false;
        return true;
    }

    private onDocumentPointerUp(e: PointerEvent): void {
        if (!this.gestureActive) return;
        const view = this.origin;
        this.gestureActive = false;
        this.origin = null;
        view?.onSelectionEnd(e);
    }

    release(): void {
        this.gestureActive = false;
        this.origin = null;
    }
}

export const textSelectionManager = new TextSelectionManager();
