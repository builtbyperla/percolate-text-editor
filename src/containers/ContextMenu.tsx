import { Accessor, Setter, For, Show, JSX, createSignal, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import styles from '../styles/ContextMenu.module.css';

export interface ContextMenuItem {
    getLabel: () => string;
    // Invoked on click; the menu closes itself immediately after.
    onSelect: () => void | Promise<void>;
    isDisabled?: () => boolean;
    isDanger?: () => boolean;
}

export class ContextMenu {
    private items: ContextMenuItem[];

    // Open position, or null when closed. Same createSignal idiom as the other
    // class-layer components (DualTextView's getEditModeOn etc.).
    private getPos: Accessor<{ x: number; y: number } | null>;
    private setPos: Setter<{ x: number; y: number } | null>;

    constructor(items: ContextMenuItem[]) {
        this.items = items;
        [this.getPos, this.setPos] = createSignal<{ x: number; y: number } | null>(null);
    }

    // Event-driven entry point: owners call this from onContextMenu with the
    // cursor's client coordinates.
    openAt(x: number, y: number): void {
        this.setPos({ x, y });
    }

    close(): void {
        this.setPos(null);
    }

    isOpen(): boolean {
        return this.getPos() !== null;
    }

    // Run an item and close. Awaits so an async onSelect (e.g. closeTab's
    // dirty-editor prompt) settles before the menu dismisses.
    private async invoke(item: ContextMenuItem): Promise<void> {
        if (item.isDisabled?.()) return;
        this.close();
        await item.onSelect();
    }

    getVisual(): () => JSX.Element {
        return () => {
            createEffect(() => {
                if (!this.getPos()) return;
                const onDown = (e: PointerEvent) => {
                    // A pointerdown inside the menu is handled by the row's onClick;
                    // anything else dismisses.
                    if (!(e.target as Element | null)?.closest?.(`.${styles.menu}`)) {
                        this.close();
                    }
                };
                const onKey = (e: KeyboardEvent) => {
                    if (e.key === 'Escape') this.close();
                };
                document.addEventListener('pointerdown', onDown, true);
                document.addEventListener('keydown', onKey, true);
                onCleanup(() => {
                    document.removeEventListener('pointerdown', onDown, true);
                    document.removeEventListener('keydown', onKey, true);
                });
            });

            return (
                <Show when={this.getPos()}>
                    {pos => (
                        // Portal to body so the menu escapes the tab strip's overflow.
                        <Portal>
                            <div
                                class={styles.menu}
                                style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
                            >
                                <For each={this.items}>
                                    {item => (
                                        <div
                                            classList={{
                                                [styles.item]: true,
                                                [styles.disabled]: !!item.isDisabled?.(),
                                                [styles.danger]: !!item.isDanger?.(),
                                            }}
                                            onClick={() => this.invoke(item)}
                                        >
                                            {item.getLabel()}
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Portal>
                    )}
                </Show>
            );
        };
    }
}
