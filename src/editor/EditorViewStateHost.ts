import { ChangeSet, EditorState } from '@codemirror/state';
import { Accessor, createMemo, createSignal } from 'solid-js';
import { FoldSnapshot, foldSnapshots } from './folding';

/**
 * View-local owner for CodeMirror presentation state.
 *
 * A mounted CM6 frame publishes each resulting EditorState here. While CM6 is
 * unmounted, native-view commands transact against the same cached state. The
 * native renderer consumes derived folds and never maintains a second fold store.
 */
export class EditorViewStateHost {
    readonly state: Accessor<EditorState | null>;
    readonly folds: Accessor<FoldSnapshot[]>;

    private setState: (state: EditorState | null) => void;

    constructor(initialState: EditorState | null = null) {
        [this.state, this.setState] = createSignal<EditorState | null>(initialState);
        this.folds = createMemo(() => {
            const state = this.state();
            return state == null ? [] : foldSnapshots(state);
        });
    }

    publish(state: EditorState | null): void {
        this.setState(state);
    }

    update(transform: (state: EditorState) => EditorState): EditorState | null {
        const current = this.state();
        if (!current) return null;
        const next = transform(current);
        if (next !== current) this.setState(next);
        return next;
    }

    /** Map cached presentation through an incremental model edit. */
    applyChanges(changes: ChangeSet): boolean {
        const current = this.state();
        if (!current || changes.length !== current.doc.length) return false;
        this.setState(current.update({ changes }).state);
        return true;
    }

    /** Full model replacements cannot safely preserve positional presentation state. */
    invalidateIfDocumentChanged(text: string): boolean {
        const current = this.state();
        if (!current || current.doc.toString() === text) return false;
        this.setState(null);
        return true;
    }
}
