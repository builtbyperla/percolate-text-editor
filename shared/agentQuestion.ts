export interface QuestionOption {
    id: string;
    label: string;
    detail?: string;
}

export interface AskQuestionInput {
    question: string;
    detail?: string;
    options?: QuestionOption[];
}

export type QuestionAnswer =
    | { kind: 'option'; optionId: string }
    | { kind: 'text'; text: string };

const MAX_ANSWER_LENGTH = 4_000;

export function parseAskQuestionInput(value: unknown): AskQuestionInput {
    if (!isRecord(value) || typeof value.question !== 'string' || !value.question.trim() || value.question.length > 500) {
        throw new Error('Question must be between 1 and 500 characters.');
    }
    const detail = optionalText(value.detail, 1_000, 'Question detail');
    if (value.options != null && (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 6)) {
        throw new Error('Question options must contain 2 to 6 choices.');
    }
    const ids = new Set<string>();
    const options = (value.options as unknown[] | undefined)?.map(option => {
        if (!isRecord(option) || typeof option.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(option.id) || ids.has(option.id)) {
            throw new Error('Question option ids must be unique short identifiers.');
        }
        ids.add(option.id);
        const label = requiredText(option.label, 120, 'Option label');
        const optionDetail = optionalText(option.detail, 300, 'Option detail');
        return { id: option.id, label, ...(optionDetail ? { detail: optionDetail } : {}) };
    });
    return { question: value.question.trim(), ...(detail ? { detail } : {}), ...(options ? { options } : {}) };
}

export function validateQuestionAnswer(question: AskQuestionInput, answer: QuestionAnswer): QuestionAnswer {
    if (answer.kind === 'option') {
        if (!question.options?.some(option => option.id === answer.optionId)) throw new Error('Unknown question option.');
        return answer;
    }
    if (answer.kind === 'text') {
        return { kind: 'text', text: requiredText(answer.text, MAX_ANSWER_LENGTH, 'Answer') };
    }
    throw new Error('Invalid question answer.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, max: number, label: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must be between 1 and ${max} characters.`);
    return value.trim();
}

function optionalText(value: unknown, max: number, label: string): string | undefined {
    if (value == null) return undefined;
    return requiredText(value, max, label);
}
