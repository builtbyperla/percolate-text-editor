import { createSignal, type Accessor } from 'solid-js';
import { createTwoFilesPatch } from 'diff';
import type { AgentClient } from '../agent/AgentClient';
import type { FileEditContentDTO, FileEditRefDTO } from '../../shared/agentProtocol';

// One renderer-side projection of the persisted proposed buffer. Its write loop
// coalesces typing and flush() is awaited before any control response settles it.
export class FileEditBuffer {
    readonly getContent: Accessor<FileEditContentDTO | undefined>;
    private readonly setContent: (value: FileEditContentDTO | undefined) => void;
    readonly getError: Accessor<string | undefined>;
    private readonly setError: (value: string | undefined) => void;
    private desired: string | undefined;
    private writing?: Promise<void>;

    constructor(
        readonly sessionId: string,
        readonly ref: FileEditRefDTO,
        private readonly client: AgentClient,
    ) {
        [this.getContent, this.setContent] = createSignal<FileEditContentDTO | undefined>();
        [this.getError, this.setError] = createSignal<string | undefined>();
    }

    async load(): Promise<void> {
        if (this.writing || this.desired != null) return;
        if (!this.client.readFileEdit) throw new Error('File edit previews are unavailable.');
        const content = await this.client.readFileEdit(this.sessionId, this.ref.artifactId);
        if (!this.writing && this.desired == null) this.setContent(content);
    }

    patch(): string {
        const content = this.getContent();
        if (!content) return '';
        if (content.settled) return content.patch ?? '';
        return createTwoFilesPatch(`a/${this.ref.path}`, `b/${this.ref.path}`, content.before ?? '', content.after ?? '');
    }

    edit(value: string): void {
        const current = this.getContent();
        if (!current || current.settled) return;
        this.setContent({ ...current, after: value });
        this.desired = value;
        if (!this.writing) {
            this.writing = this.writeLoop().finally(() => { this.writing = undefined; });
            void this.writing.catch(() => {});
        }
    }

    async flush(): Promise<void> {
        while (this.writing) await this.writing;
        const error = this.getError();
        if (error) throw new Error(error);
    }

    private async writeLoop(): Promise<void> {
        try {
            while (this.desired != null) {
                const value = this.desired;
                this.desired = undefined;
                const current = this.getContent();
                if (!current) return;
                if (!this.client.updateFileEdit) throw new Error('File edit previews are unavailable.');
                const ref = await this.client.updateFileEdit(this.sessionId, this.ref.artifactId, current.revision, value);
                this.setContent({ ...this.getContent()!, revision: ref.revision });
                this.setError(undefined);
            }
        } catch (error) {
            this.setError(error instanceof Error ? error.message : 'Unable to save proposed edit.');
            throw error;
        }
    }
}
