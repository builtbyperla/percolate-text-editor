import { Accessor, Setter, createSignal } from 'solid-js';

export type NoteableID = string;

export abstract class Noteable {
    readonly id: NoteableID;

    constructor(id: NoteableID) {
        this.id = id;
    }

    abstract getNoteText: Accessor<string>;
    abstract setActive(): void;
    abstract setInactive(): void;
}

class NoteInputFramesManager {
    getActives: Accessor<Set<string>>;
    setActives: Setter<Set<string>>;

    constructor() {
        [this.getActives, this.setActives] = createSignal<Set<string>>(new Set<string>([]))
    }

    activate(id: string) {
        this.setActives(prev => new Set([id]));
    }

    deactivate(id: string) {
        let prev = new Set(this.getActives());
        prev.delete(id);
        this.setActives(prev);
    }

    isActive(id: string) {
        return this.getActives().has(id);
    }

}

export const noteInputsManager = new NoteInputFramesManager();
