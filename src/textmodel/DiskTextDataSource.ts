import type { FileSystemProvider } from '../fileexplorer/FileSystemProvider';
import { SourceId } from './SourceId';
import type { TextDataModel } from './TextDataModel';
import type { TextDataSource } from './TextDataSource';
import { textModelRegistry } from './TextModelRegistry';

export class DiskTextDataSource implements TextDataSource {
    readonly id: SourceId;
    private loaded = false;

    constructor(path: string, private provider: FileSystemProvider) {
        this.id = new SourceId('file', path);
    }

    // Idempotent load. Callers must await this before getModel() the first time.
    // A second call after the model exists is a no-op (loaded flag).
    async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        const text = await this.provider.readFile(this.id.local());
        textModelRegistry.create(this.id.full(), text);
        this.loaded = true;
    }

    getModel(): TextDataModel {
        return textModelRegistry.create(this.id.full());
    }

    // Watcher event → fetch fresh contents → hand to the registry, which routes
    // to the model. Async because readFile is async; callers fire-and-forget.
    async onDiskChanged(): Promise<void> {
        const next = await this.provider.readFile(this.id.local());
        textModelRegistry.onDiskChanged(this.id.full(), next);
    }
}
