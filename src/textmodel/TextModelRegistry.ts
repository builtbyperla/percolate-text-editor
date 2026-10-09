import { CmTextDataModel, TextDataModel } from './TextDataModel';

class TextModelRegistry {
    private models = new Map<string, TextDataModel>();
    counts: Record<string, number> = {};

    fetchExisting(key: string): TextDataModel | null {
        return this.models.get(key) ?? null;
    }

    create(key: string, initialContent: string = ''): TextDataModel {
        const existing = this.models.get(key);
        if (existing) return existing;
        const model = new CmTextDataModel(initialContent, key);
        this.models.set(key, model);
        return model;
    }

    register(key: string): void {
        this.counts[key] = (this.counts[key] ?? 0) + 1;
    }

    release(key: string): void {
        this.counts[key] = (this.counts[key] ?? 0) - 1;
        if (this.counts[key] <= 0) {
            this.models.get(key)?.dispose();
            this.models.delete(key);
            this.counts[key] = 0;
        }
    }

    onDiskChanged(key: string, nextText: string): void {
        const model = this.models.get(key);
        if (!model) return;
        if (model instanceof CmTextDataModel) model.onDiskChanged(nextText);
    }

    // Watcher-driven delete. Same fan pattern as onDiskChanged: only CM6-backed
    // models track detached state.
    onDiskDeleted(key: string): void {
        const model = this.models.get(key);
        if (!model) return;
        if (model instanceof CmTextDataModel) model.onDiskDeleted();
    }

    rename(oldKey: string, newKey: string): void {
        if (oldKey === newKey) return;
        const model = this.models.get(oldKey);
        if (!model) return;
        if (this.models.has(newKey)) return;
        this.models.set(newKey, model);
        this.models.delete(oldKey);
        this.counts[newKey] = this.counts[oldKey] ?? 0;
        delete this.counts[oldKey];
    }
}

export const textModelRegistry: TextModelRegistry = new TextModelRegistry();
