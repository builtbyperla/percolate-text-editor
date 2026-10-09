import { EditorView } from '@codemirror/view';
import { TextDataModel } from '../textmodel/TextDataModel';

export class CmViewBinding {
    readonly viewKey: string;
    private model: TextDataModel;
    private view: EditorView;
    private unsubscribe: () => void;

    // True while we are applying a model-driven change into the view, so the
    // resulting updateListener fire is not bounced back out to the model.
    private applyingRemote = false;

    constructor(view: EditorView, model: TextDataModel, viewKey: string) {
        this.model = model;
        this.view = view;
        this.viewKey = viewKey;

        // In: mirror model changes into this view, skipping our own edits.
        this.unsubscribe = this.model.onChange((change) => {
            // Our own edit already lives in this view — skip it (exclude-originator).
            if (change.originViewKey === this.viewKey) return;
            const next = this.model.getValue();
            if (next === this.view.state.doc.toString()) return;
            this.applyingRemote = true;
            const changes = change.changes.length === this.view.state.doc.length
                ? change.changes
                : { from: 0, to: this.view.state.doc.length, insert: next };
            this.view.dispatch({ changes });
            this.applyingRemote = false;
        });
    }

    // True while applying a remote model change — callers use this to guard
    // their own updateListener from echoing the change back to the model.
    isApplyingRemote(): boolean {
        return this.applyingRemote;
    }

    dispose(): void {
        this.unsubscribe();
    }
}
