import { Accessor, Setter, createSignal } from 'solid-js';

export interface SelectableCallbacks {
    // Create + register the owner's context (e.g. add its ContextItem to the
    // evidence pane). Fired before onSelect when the owner becomes selected.
    createContext: () => void;
    // Side effects when the owner becomes selected (e.g. open its note editor).
    onSelect: () => void;
    // Side effects when the owner becomes deselected (e.g. deregister its
    // context, clear its note).
    onDeselect: () => void;
}

export class Selectable {
    getSelected: Accessor<boolean>;
    setSelected: Setter<boolean>;

    private callbacks: SelectableCallbacks;

    constructor(callbacks: SelectableCallbacks) {
        this.callbacks = callbacks;
        [this.getSelected, this.setSelected] = createSignal(false);
    }

    toggle() {
        if (this.getSelected()) {
            this.deselect();
        } else {
            this.select();
        }
    }

    select() {
        this.setSelected(true);
        this.callbacks.createContext();
        this.callbacks.onSelect();
    }

    deselect() {
        this.setSelected(false);
        this.callbacks.onDeselect();
    }

    // Signal-only reset (no callbacks). For bulk teardown where the owner already
    // handles its own context removal, avoiding re-entrant deregistration.
    clear() {
        this.setSelected(false);
    }
}
