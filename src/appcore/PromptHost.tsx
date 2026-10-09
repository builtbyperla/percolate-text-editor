import { Show, For, onCleanup, createEffect, JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { _getPromptQueue, _resolveHead } from './promptConfirm';
import styles from '../styles/App.module.css';

export function PromptHost(): JSX.Element {
    const queue = _getPromptQueue();

    createEffect(() => {
        const head = queue()[0];
        if (!head) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                _resolveHead(head.spec.options[0]);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                _resolveHead(head.spec.options[head.spec.options.length - 1]);
            }
        };
        document.addEventListener('keydown', onKey, true);
        onCleanup(() => document.removeEventListener('keydown', onKey, true));
    });

    return (
        <Show when={queue()[0]}>
            {head => (
                <Portal>
                    <div
                        class={styles.promptBackdrop}
                        onClick={() => _resolveHead(head().spec.options[head().spec.options.length - 1])}
                    >
                        <div
                            class={styles.promptModal}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="prompt-title"
                            onClick={e => e.stopPropagation()}
                        >
                            <div class={styles.promptTitle} id="prompt-title">
                                {head().spec.title}
                            </div>
                            <div class={styles.promptMessage}>
                                {head().spec.message}
                            </div>
                            <div class={styles.promptButtons}>
                                <For each={head().spec.options}>
                                    {(opt, i) => (
                                        <button
                                            classList={{
                                                [styles.promptButton]: true,
                                                [styles.promptButtonDefault]: i() === 0,
                                            }}
                                            autofocus={i() === 0}
                                            onClick={() => _resolveHead(opt)}
                                        >
                                            {opt}
                                        </button>
                                    )}
                                </For>
                            </div>
                        </div>
                    </div>
                </Portal>
            )}
        </Show>
    );
}
