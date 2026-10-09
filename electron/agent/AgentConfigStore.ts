import { readFile, rename, writeFile } from 'node:fs/promises';
import type { AgentSettingsDTO } from '../../shared/agentProtocol';

export interface ResolvedAgentSettings extends AgentSettingsDTO {
    apiKey?: string;
}

const defaults: AgentSettingsDTO = {
    provider: 'openai',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
};

export class AgentConfigStore {
    private settings: AgentSettingsDTO = { ...defaults };

    constructor(private readonly filename: string) {}

    async initialize(): Promise<void> {
        try {
            const value = JSON.parse(await readFile(this.filename, 'utf8')) as Partial<AgentSettingsDTO>;
            this.settings = normalize(value);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Unable to load agent settings:', error);
        }
    }

    get(): AgentSettingsDTO {
        return { ...this.settings };
    }

    async update(value: Partial<AgentSettingsDTO>): Promise<AgentSettingsDTO> {
        this.settings = normalize({ ...this.settings, ...value });
        const temporary = `${this.filename}.tmp`;
        await writeFile(temporary, `${JSON.stringify(this.settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, this.filename);
        return this.get();
    }

    async resolve(): Promise<ResolvedAgentSettings> {
        const apiKey = this.settings.apiKeyFile
            ? (await readFile(this.settings.apiKeyFile, 'utf8')).trim()
            : this.settings.provider === 'anthropic'
                ? process.env.ANTHROPIC_API_KEY
                : process.env.OPENAI_API_KEY;
        const environmentBaseURL = this.settings.provider === 'anthropic'
            ? process.env.ANTHROPIC_BASE_URL
            : process.env.OPENAI_BASE_URL;
        return { ...this.settings, apiKey, baseURL: this.settings.baseURL ?? environmentBaseURL };
    }
}

function normalize(value: Partial<AgentSettingsDTO>): AgentSettingsDTO {
    return {
        provider: value.provider === 'anthropic' ? 'anthropic' : 'openai',
        model: typeof value.model === 'string' && value.model.trim()
            ? value.model.trim()
            : value.provider === 'anthropic'
                ? 'claude-sonnet-4-5'
                : defaults.model,
        ...(typeof value.apiKeyFile === 'string' && value.apiKeyFile ? { apiKeyFile: value.apiKeyFile } : {}),
        ...(typeof value.baseURL === 'string' && value.baseURL.trim() ? { baseURL: value.baseURL.trim() } : {}),
    };
}
