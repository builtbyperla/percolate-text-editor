import { createSignal, Accessor, Setter } from 'solid-js';
import type { ContextItem } from '../annotation/ContextItem';

class ContextRegistry {
    // Core data
    items: Accessor<ContextItem[]>;
    private setItems: (fn: (prev: ContextItem[]) => ContextItem[]) => void;

    // User settings
    shouldShowNote: Accessor<boolean>;
    setNoteVisibility: Setter<boolean>;

    constructor() {
        const [get, set] = createSignal<ContextItem[]>([]);
        this.items = get;
        this.setItems = set;

        const [getDisplay, setDisplay] = createSignal(true);
        this.shouldShowNote = getDisplay;
        this.setNoteVisibility = setDisplay;
    }

    private sameEntry(a: ContextItem, b: ContextItem): boolean {
        if (a === b) return true;
        return a.isWholeSource() && b.isWholeSource() && a.groupKey() === b.groupKey();
    }

    addItem(item: ContextItem) {
        this.setItems(prev => prev.some(i => this.sameEntry(i, item)) ? prev : [...prev, item]);
    }

    // Removes the equivalent entry, not just the identical one — a view can drop a
    // whole-source item another view on the same source registered.
    removeItem(item: ContextItem) {
        this.setItems(prev => prev.filter(i => !this.sameEntry(i, item)));
    }

    toggleDisplay() {
        this.setNoteVisibility(!this.shouldShowNote());
    }

}

export const contextRegistry = new ContextRegistry();
