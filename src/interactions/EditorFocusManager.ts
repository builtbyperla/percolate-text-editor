import { Accessor, Setter, createSignal } from 'solid-js';

class EditorFocusManager {
    getFocused: Accessor<string | null>;
    private setFocused_: Setter<string | null>;

    constructor() {
        [this.getFocused, this.setFocused_] = createSignal<string | null>(null);
    }

    // Keyed by the editor's sourceId (its dataKey), not a view id: the
    // edit<->annotate toggle rebuilds the view, and focus should survive that.
    focus(sourceId: string) {
        this.setFocused_(sourceId);
    }

    isFocused(sourceId: string | null): boolean {
        return sourceId != null && this.getFocused() === sourceId;
    }
}

export const editorFocusManager = new EditorFocusManager();
