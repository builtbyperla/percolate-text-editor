import { describe, expect, it } from 'vitest';
import { FileEditBuffer } from '../src/chat/FileEditBuffer';
import type { AgentClient } from '../src/agent/AgentClient';

describe('editable file proposal', () => {
    it('flushes the latest typed contents in order before approval', async () => {
        let text = 'agent';
        let revision = 0;
        let releaseFirst!: () => void;
        const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve; });
        const client = {
            readFileEdit: async () => ({ before: 'before', after: text, revision, settled: false }),
            updateFileEdit: async (_session: string, _id: string, expected: number, next: string) => {
                if (revision === 0) await firstWrite;
                expect(expected).toBe(revision);
                text = next;
                revision++;
                return { artifactId: 'edit', path: 'file.txt', baseSha256: null, revision };
            },
        } as unknown as AgentClient;
        const buffer = new FileEditBuffer('session', { artifactId: 'edit', path: 'file.txt', baseSha256: null, revision: 0 }, client);
        await buffer.load();
        buffer.edit('first');
        buffer.edit('final');
        releaseFirst();
        await buffer.flush();
        expect(text).toBe('final');
        expect(revision).toBe(2);
        expect(buffer.patch()).toContain('+final');
    });
});
