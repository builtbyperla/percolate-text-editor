import { Accessor, createMemo } from 'solid-js';
import { ContextItem, ContextView, type FullSourceOverride } from '../annotation/ContextItem';
import { contextRegistry } from './ContextRegistry';

export interface EvidenceGroup {
    key: string;
    label: string;
    parent: ContextItem | null;
    items: ContextItem[];
}

class VirtualizedContextItem extends ContextItem {
    constructor(origin: ContextView) {
        super(origin);
    }

    getFullSourceOverride(): FullSourceOverride | undefined {
        const data = this.view.additionalData?.() as { kind?: string } | undefined;
        if (data?.kind !== 'diff') return undefined;
        return { label: 'Full diff', additionalData: data };
    }
}

export class EvidenceTree {
    private virtualParents = new Map<string, VirtualizedContextItem>();

    group(items: readonly ContextItem[]): EvidenceGroup[] {
        type Bucket = { key: string; label: string; real: ContextItem | null; items: ContextItem[]; origin: ContextView };
        const groups = new Map<string, Bucket>();

        for (const item of items) {
            const key = item.groupKey();
            let group = groups.get(key);
            if (!group) {
                group = { key, label: item.groupLabel(), real: null, items: [], origin: item.view };
                groups.set(key, group);
            }
            if (item.getRange() == null) {
                group.real = item;
            } else {
                group.items.push(item);
            }
        }

        // Evict cached virtual parents whose group no longer exists (last slice gone).
        for (const key of [...this.virtualParents.keys()]) {
            if (!groups.has(key)) this.virtualParents.delete(key);
        }

        return [...groups.values()].map(g => ({
            key: g.key,
            label: g.label,
            parent: g.real ?? this.resolveVirtualParent(g.key, g.origin),
            items: g.items,
        }));
    }

    private resolveVirtualParent(key: string, origin: ContextView): VirtualizedContextItem {
        let parent = this.virtualParents.get(key);
        if (!parent) {
            parent = new VirtualizedContextItem(origin);
            this.virtualParents.set(key, parent);
        }
        return parent;
    }

    // Drop every cached stand-in. For tests and teardown — regrouping after this
    // mints fresh parents rather than reviving the old ones.
    clearVirtualParents(): void {
        this.virtualParents.clear();
    }
}

export function createEvidenceGroups(tree: EvidenceTree): Accessor<EvidenceGroup[]> {
    return createMemo(() => tree.group(contextRegistry.items()));
}

// Anything that can supply the current evidence grouping — in practice the
// evidence pane. Kept as an interface so this module doesn't depend on the pane.
export interface EvidenceGroupSource {
    groups: Accessor<EvidenceGroup[]>;
}

let evidenceSource: EvidenceGroupSource | null = null;

export function setEvidenceSource(source: EvidenceGroupSource): void {
    evidenceSource = source;
}

export function currentEvidenceGroups(): readonly EvidenceGroup[] {
    return evidenceSource?.groups() ?? [];
}
