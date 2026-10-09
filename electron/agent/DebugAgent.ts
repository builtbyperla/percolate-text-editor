import { randomUUID } from 'node:crypto';
import type { MessageDTO, ToolBlockDTO } from '../../shared/agentProtocol';
import { agentStubResponse, agentStubTurn } from '../../shared/agentStubResponses';
import type { Agent, MessageInterface, ProviderEvent } from './Agent';
import { LocalMessageInterface } from './VercelAgent';

/** Offline provider used to exercise the same runtime contract as a remote API. */
export class DebugProviderAgent implements Agent {
    readonly name = 'debug';
    readonly messageInterface: MessageInterface = new LocalMessageInterface();

    constructor(private readonly hasFixtureOperation: boolean) {}

    async *call(messages: MessageDTO[], signal: AbortSignal): AsyncIterable<ProviderEvent> {
        const user = [...messages].reverse().find(message => message.role === 'user');
        const responseIndex = Math.max(0, messages.filter(message => message.role === 'user').length - 1);
        const turn = agentStubTurn(responseIndex);
        const fileEditFixture = this.hasFixtureOperation ? turn.tools.find(tool => tool.type === 'write_file') : undefined;
        const fileEdit = fileEditFixture ? settledToolAfter(messages, user, 'write_file') : undefined;
        const questionFixture = turn.tools.find(tool => tool.type === 'ask_question');
        const question = questionFixture ? settledToolAfter(messages, user, 'ask_question') : undefined;
        const operation = settledToolAfter(messages, user, 'update_stub_fixture');

        const text = question
            ? question.status === 'skipped'
                ? 'Question skipped. No preference was recorded.'
                : agentStubResponse(responseIndex)
            : fileEditFixture && fileEdit
                ? fileEditOutcome(fileEdit)
                : fileEditFixture
                    ? turn.response
                    : questionFixture
                        ? 'I need one preference before continuing.'
                        : operation
                            ? `${operationOutcome(operation)}\n\n${agentStubResponse(responseIndex)}`
                            : this.hasFixtureOperation
                                ? 'I’ll inspect the dedicated stub fixture first. Updating it is a mutation, so I’ll pause and ask for your approval before making the change.'
                                : agentStubResponse(responseIndex);

        for (const token of text.match(/\S+\s*/g) ?? []) {
            await wait(35, signal);
            yield { type: 'text-delta', delta: token };
        }

        if (fileEditFixture && !fileEdit) {
            yield { type: 'tool-call', id: randomUUID(), name: 'write_file', input: fileEditFixture.input };
        } else if (questionFixture && !question) {
            yield { type: 'tool-call', id: randomUUID(), name: 'ask_question', input: questionFixture.input };
        } else if (!operation && !questionFixture && this.hasFixtureOperation) {
            yield { type: 'tool-call', id: randomUUID(), name: 'read_file', input: { path: 'tests/fixtures/agent-stub-operation.json' } };
            yield { type: 'tool-call', id: randomUUID(), name: 'update_stub_fixture', input: { path: 'tests/fixtures/agent-stub-operation.json' } };
        }
    }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
        }, { once: true });
    });
}

function settledToolAfter(messages: MessageDTO[], user: MessageDTO | undefined, type: string): ToolBlockDTO | undefined {
    if (!user) return undefined;
    const index = messages.indexOf(user);
    for (let i = messages.length - 1; i > index; i--) {
        const block = messages[i].blocks.find(candidate => candidate.kind === 'tool' && candidate.type === type);
        if (block?.kind === 'tool' && block.status !== 'pending' && block.status !== 'running') return block;
    }
    return undefined;
}

function fileEditOutcome(block: ToolBlockDTO): string {
    if (block.status === 'done') return `File edit applied.${block.userModified ? ' You changed the proposed contents.' : ''}`;
    if (block.status === 'rejected') return 'File edit rejected. The workspace was left unchanged.';
    if (block.status === 'skipped') return 'File edit skipped. The workspace was left unchanged.';
    return `File edit ended with status: ${block.status}.`;
}

function operationOutcome(block: ToolBlockDTO): string {
    if (block.status === 'done') return `Approved operation completed. The dedicated fixture was updated successfully.\n\n${block.output ?? ''}`;
    if (block.status === 'rejected') return 'The fixture update was rejected. I recorded the rejection and left the file unchanged.';
    if (block.status === 'skipped') return 'The fixture update was skipped. This is stored as a distinct skipped outcome, and the file was left unchanged.';
    return `The simulated fixture operation ended with status: ${block.status}.`;
}
