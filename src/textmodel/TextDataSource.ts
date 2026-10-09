import { TextDataModel } from './TextDataModel';
import { textModelRegistry } from './TextModelRegistry';
import { SourceId } from './SourceId';

export interface TextDataSource {
    readonly id: SourceId;

    // The canonical model for this source. One per key (registry-enforced), so
    // every view of the source shares one buffer.
    getModel(): TextDataModel;

    onDiskChanged(): void | Promise<void>;
}

export class InMemoryTextDataSource implements TextDataSource {
    readonly id: SourceId;
    private initialContent?: string;

    constructor(id: SourceId, initialContent?: string) {
        this.id = id;
        this.initialContent = initialContent;
    }

    getModel(): TextDataModel {
        return textModelRegistry.create(this.id.full(), this.initialContent ?? '');
    }

    onDiskChanged(): void {
        const next = textModelRegistry.fetchExisting(this.id.full())?.getValue() ?? '';
        textModelRegistry.onDiskChanged(this.id.full(), next);
    }
}
