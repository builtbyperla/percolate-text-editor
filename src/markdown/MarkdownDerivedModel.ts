import { ChangeSet } from '@codemirror/state';
import { CmTextDataModel } from '../textmodel/TextDataModel';
import { AnchorRange } from '../textmodel/AnnotationAnchors';

// The rendered markdown reader's own text data model: a DERIVED, display-space buffer holding the flattened render text (markers stripped, '- ' shown as '•', synthetic block '\n's).
export class MarkdownDerivedModel extends CmTextDataModel {
    constructor(initialFlat: string = '') {
        super(initialFlat);
    }

    rederive(newFlat: string, seed: AnchorRange[]): { survivors: AnchorRange[]; dropped: string[] } {
        const oldFlat = this.getValue();
        const changes = this.diffToChangeSet(oldFlat, newFlat);
        // Seed the tracked anchors from the reader's items (by id), then advance the flat
        // doc, then map the anchors through the SAME change — the editor's exact order.
        this.setAnnotationRanges(seed);
        this.applyChanges(changes);
        return this.mapAnnotations(changes);
    }

    private diffToChangeSet(oldFlat: string, newFlat: string): ChangeSet {
        let prefix = 0;
        const maxPrefix = Math.min(oldFlat.length, newFlat.length);
        while (prefix < maxPrefix && oldFlat[prefix] === newFlat[prefix]) prefix++;

        let suffix = 0;
        const maxSuffix = Math.min(oldFlat.length - prefix, newFlat.length - prefix);
        while (
            suffix < maxSuffix &&
            oldFlat[oldFlat.length - 1 - suffix] === newFlat[newFlat.length - 1 - suffix]
        ) suffix++;

        const from = prefix;
        const to = oldFlat.length - suffix;         // end of the changed span in OLD text
        const insert = newFlat.slice(prefix, newFlat.length - suffix);
        // Identical texts (from === to, empty insert) yield an empty ChangeSet.
        return ChangeSet.of([{ from, to, insert }], oldFlat.length);
    }
}
