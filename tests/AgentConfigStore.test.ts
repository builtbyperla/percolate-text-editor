// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentConfigStore } from '../electron/agent/AgentConfigStore';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe('AgentConfigStore', () => {
    it('persists provider metadata but never exposes key contents from get()', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'percolate-agent-config-')); directories.push(directory);
        const filename = path.join(directory, 'settings.json');
        const keyFile = path.join(directory, 'openai.key');
        await writeFile(keyFile, 'secret-token\n');
        const store = new AgentConfigStore(filename); await store.initialize();

        await store.update({ model: 'gpt-test', apiKeyFile: keyFile });

        expect(store.get()).toEqual({ provider: 'openai', model: 'gpt-test', apiKeyFile: keyFile });
        expect(await store.resolve()).toMatchObject({ model: 'gpt-test', apiKey: 'secret-token' });
        expect(await readFile(filename, 'utf8')).not.toContain('secret-token');
    });

    it('loads persisted settings for the next application run', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'percolate-agent-config-')); directories.push(directory);
        const filename = path.join(directory, 'settings.json');
        const first = new AgentConfigStore(filename); await first.update({ model: 'gpt-persisted' });
        const reopened = new AgentConfigStore(filename); await reopened.initialize();
        expect(reopened.get().model).toBe('gpt-persisted');
    });

    it('persists Anthropic as a provider without exposing its key contents', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'percolate-agent-config-')); directories.push(directory);
        const filename = path.join(directory, 'settings.json'); const keyFile = path.join(directory, 'anthropic.key');
        await writeFile(keyFile, 'anthropic-secret\n');
        const store = new AgentConfigStore(filename); await store.update({ provider: 'anthropic', model: 'claude-test', apiKeyFile: keyFile });

        const reopened = new AgentConfigStore(filename); await reopened.initialize();
        expect(reopened.get()).toEqual({ provider: 'anthropic', model: 'claude-test', apiKeyFile: keyFile });
        expect(await reopened.resolve()).toMatchObject({ provider: 'anthropic', apiKey: 'anthropic-secret' });
        expect(await readFile(filename, 'utf8')).not.toContain('anthropic-secret');
    });
});
