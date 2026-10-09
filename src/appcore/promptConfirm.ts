import { Accessor, createSignal, Setter } from 'solid-js';

export type PromptOption = 'Save' | 'Discard' | 'Cancel' | 'Reload' | 'Keep mine' | string;

export interface PromptSpec {
    title: string;
    message: string;
    options: PromptOption[];
}

// One entry in the prompt queue. The resolver fires exactly once when the user
// picks an option (or dismisses via Esc/backdrop, which returns the last option).
interface Pending {
    id: number;
    spec: PromptSpec;
    resolve: (option: PromptOption) => void;
}

const [getQueue, setQueue] = createSignal<Pending[]>([]);
let nextId = 0;

// Read-side for PromptHost — kept internal to this module (the host imports it
// via a named export below). Callers use promptConfirm.
export function _getPromptQueue(): Accessor<Pending[]> {
    return getQueue;
}

// Resolve the head of the queue with `option` and pop it. Called by PromptHost
// on button click, Enter, Esc, or backdrop dismiss.
export function _resolveHead(option: PromptOption): void {
    const q = getQueue();
    if (q.length === 0) return;
    const head = q[0];
    head.resolve(option);
    setQueue(q.slice(1));
}

export function promptConfirm(spec: PromptSpec): Promise<PromptOption> {
    if (spec.options.length === 0) {
        // A no-option prompt has nothing to resolve to — treat as immediate cancel.
        return Promise.resolve('' as PromptOption);
    }
    return new Promise<PromptOption>(resolve => {
        const id = ++nextId;
        setQueue([...getQueue(), { id, spec, resolve }]);
    });
}

export function _clearQueueForTest(): void {
    setQueue([]);
}
