import { For, Show } from 'solid-js';
import { JSX } from 'solid-js/jsx-runtime';
import { ClipboardCheck, ClipboardMinus, FileText, MessageCircleMore, Quote, StickyNoteOff, StickyNotePlus, TextInitial, Trash2 } from 'lucide-solid';
import { ViewBlock } from '../containers/Tabs';
import { contextRegistry } from '../interactions/ContextRegistry';
import { EvidenceTree, createEvidenceGroups, setEvidenceSource } from '../interactions/EvidenceTree';
import { ContextItem } from '../annotation/ContextItem';
import { userSettings } from '../UserSettings';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import styles from '../styles/EvidenceStrip.module.css';

function truncate(s: string, max = 40): string {
    return s.length > max ? s.slice(0, max) + '…' : s;
}

function EvidenceRow(props: {
    included: boolean;
    type: string;
    label: string;
    title: string;
    icon?: boolean;
    count?: number;
    badge?: string;
    onLabelClick: () => void;
    onToggle: () => void;
}) {
    return (
        <div class={styles.chip} data-included={props.included} data-type={props.type} title={props.title}>
            <Show when={props.icon}>
                <FileText class={styles.sourceIcon} size={13} />
            </Show>
            <button class={styles.chipLabel} onClick={props.onLabelClick}>
                {truncate(props.label)}
            </button>
            <Show when={props.count != null}>
                <span class={styles.sourceCount}>{props.count}</span>
            </Show>
            {/* Marker when the item carries a richer payload for the agent (e.g. a
                diff's before/after). */}
            <Show when={props.badge}>
                <span class={styles.chipBadge} title="Carries diff context for the agent">{props.badge}</span>
            </Show>
            <button
                class={styles.chipToggle}
                onClick={props.onToggle}
                title={props.included ? 'Exclude from next message' : 'Include in next message'}
            />
        </div>
    );
}

export class EvidencePane implements ViewBlock {
    ownsScroll = false;

    private tree = new EvidenceTree();

    // The live grouping. Exposed because the send path needs the same groups the
    // pane renders — a virtual parent the user toggled here is the one that ships.
    readonly groups = createEvidenceGroups(this.tree);

    constructor() {
        setEvidenceSource(this);
    }

    allContextItems(): ContextItem[] {
        return this.groups().flatMap(g => [
            ...(g.parent && this.isRealParent(g.parent) ? [g.parent] : []),
            ...g.items,
        ]);
    }

    // A source's real (user-selected) whole-file parent lives in the registry; a
    // derived/virtual stand-in does not.
    isRealParent(item: ContextItem): boolean {
        return contextRegistry.items().includes(item);
    }

    toggleAll() {
        const all = this.allContextItems();
        const including = !all.every(i => i.getIncluded());
        for (const i of all) i.setIncluded(including);
    }

    deleteSelected() {
        for (const item of this.allContextItems()) {
            if (!item.getIncluded()) continue;
            if (sourceContextRegistry.itemsFor(item.groupKey()).includes(item)) {
                sourceContextRegistry.remove(item);
            } else {
                // Whole-source selections can register directly with the pane.
                // Their owner clears its own selection and note state.
                const owner = item.view as typeof item.view & { clear?: () => void };
                if (typeof owner.clear === 'function') owner.clear();
                else item.deregister();
            }
        }
    }

    getVisual(): () => JSX.Element {
        return () => (
            <div class={styles.strip} data-tour="evidence">
                <div class={styles.chipList}>
                    <Show
                        when={this.allContextItems().length > 0}
                        fallback={<span class={styles.empty}>No annotations yet</span>}
                    >
                        <For each={this.allContextItems()}>
                            {item => (
                                <EvidenceRow
                                    included={item.getIncluded()}
                                    type={item.getSourceType()}
                                    icon={item.isWholeSource()}
                                    label={item.displayText}
                                    title={item.displayText}
                                    badge={item.additionalData() != null ? ((item.additionalData() as { kind?: string })?.kind ?? 'data') : undefined}
                                    onLabelClick={() => item.scrollIntoView()}
                                    onToggle={() => item.setIncluded(!item.getIncluded())}
                                />
                            )}
                        </For>
                    </Show>
                </div>
                <div class={styles.settingsBar} aria-label="Context settings">
                    <button
                        class={styles.deleteSelected}
                        type="button"
                        onClick={() => this.deleteSelected()}
                        disabled={!this.allContextItems().some(item => item.getIncluded())}
                        aria-label="Delete selected context items"
                        title="Delete selected context items"
                    >
                        <Trash2 size={16} />
                    </button>
                    <div class={styles.headerActions}>
                        <button
                            class={styles.displayToggle}
                            onClick={() => contextRegistry.toggleDisplay()}
                            title={contextRegistry.shouldShowNote() ? 'Showing note text' : 'Showing selection text'}
                        >
                            {contextRegistry.shouldShowNote()
                                ? <Quote size={16} />
                                : <TextInitial size={16} />}
                        </button>
                        {/* Pure data flag: flips what send() emits, never an item's state. */}
                        <button
                            class={styles.displayToggle}
                            onClick={() => userSettings.evidence.setIncludeFullSource(v => !v)}
                            title="Include full source for sliced ranges"
                        >
                            {userSettings.evidence.includeFullSource()
                                ? <ClipboardCheck class={styles.positiveToggleIcon} size={16} />
                                : <ClipboardMinus size={16} />}
                        </button>
                        <Show when={this.allContextItems().length > 0}>
                            <button class={styles.toggleAll} onClick={() => this.toggleAll()}>
                                {this.allContextItems().every(i => i.getIncluded()) ? 'Exclude all' : 'Include all'}
                            </button>
                        </Show>
                    </div>
                </div>
            </div>
        );
    }
}
