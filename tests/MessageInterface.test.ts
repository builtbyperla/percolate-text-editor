// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LocalMessageInterface, VercelProviderAgent } from '../electron/agent/VercelAgent';
import type { MessageDTO, ToolStatus } from '../shared/agentProtocol';

function toolMessage(status: ToolStatus): MessageDTO {
    return { id: status, role: 'assistant', status: 'done', createdAt: 1, blocks: [{ id: status, kind: 'tool', role: 'assistant', toolCallId: status, type: 'read_file', status, output: status }] };
}

describe('LocalMessageInterface', () => {
    it('defaults to no attachment support and exposes provider capability explicitly', () => {
        expect(new LocalMessageInterface().attachmentSupport).toBeUndefined();
        expect(VercelProviderAgent.messageInterfaceFor({ provider: 'openai', model: 'gpt-4o-mini' }).attachmentSupport?.mediaTypes).toContain('application/pdf');
        expect(VercelProviderAgent.messageInterfaceFor({ provider: 'anthropic', model: 'claude-sonnet-4-5' }).attachmentSupport?.mediaTypes).toContain('application/pdf');
        expect(VercelProviderAgent.messageInterfaceFor({ provider: 'openai', model: 'text-only-model' }).attachmentSupport).toBeUndefined();
        expect(VercelProviderAgent.messageInterfaceFor({ provider: 'openai', model: 'gpt-4o-mini', baseURL: 'https://example.test' }).attachmentSupport).toBeUndefined();
    });
    it('keeps skipped and rejected tool outcomes distinct for the provider', () => {
        const messages = new LocalMessageInterface().transformForSend([toolMessage('skipped'), toolMessage('rejected')]);
        expect(messages[0].content).toContain('"status":"skipped"');
        expect(messages[1].content).toContain('"status":"rejected"');
    });

    it('wraps evidence as untrusted context data', () => {
        const message: MessageDTO = { id: 'user', role: 'user', status: 'done', createdAt: 1, blocks: [{ id: 'user', kind: 'text', role: 'user', content: 'question', status: 'done', evidence: [{ sourceId: 'file', label: 'File', items: [{ label: 'x', note: '', type: 'text' }] }] }] };
        const [mapped] = new LocalMessageInterface().transformForSend([message]);
        expect(mapped.content).toContain('<context_data>');
        expect(mapped.content).toContain('</context_data>');
    });

    it('sends an attachment-only user turn as a native file part', () => {
        const message: MessageDTO = { id: 'user', role: 'user', status: 'done', createdAt: 1, blocks: [{ id: 'user', kind: 'text', role: 'user', content: '', status: 'done', attachments: [{ name: 'report.pdf', mediaType: 'application/pdf', size: 3, data: 'YWJj' }] }] };
        const support = { mediaTypes: ['application/pdf'], maxFileBytes: 10, maxTotalBytes: 10 };
        const [mapped] = new LocalMessageInterface(support).transformForSend([message]);
        expect(mapped).toMatchObject({ role: 'user', content: [{ type: 'file', filename: 'report.pdf', mediaType: 'application/pdf', data: Buffer.from('abc') }] });
        const [unsupported] = new LocalMessageInterface().transformForSend([message]);
        expect(unsupported).toMatchObject({ role: 'user', content: [{ type: 'text', text: '[Attachment report.pdf is unavailable to the current provider.]' }] });
    });

    it('maps image attachments to native image parts', () => {
        const message: MessageDTO = { id: 'user', role: 'user', status: 'done', createdAt: 1, blocks: [{ id: 'user', kind: 'text', role: 'user', content: 'Look at this', status: 'done', attachments: [{ name: 'image.png', mediaType: 'image/png', size: 3, data: 'YWJj' }] }] };
        const support = { mediaTypes: ['image/png'], maxFileBytes: 10, maxTotalBytes: 10 };
        const [mapped] = new LocalMessageInterface(support).transformForSend([message]);
        expect(mapped).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'Look at this' }, { type: 'image', mediaType: 'image/png', image: Buffer.from('abc') }] });
    });
});
