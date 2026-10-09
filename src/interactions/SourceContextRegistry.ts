// TODO: stable id for persistence — view ids are fresh each run (idService), so
// cross-session reload needs a key derived from the data source, not the view id.
import type { ContextItem } from '../annotation/ContextItem';
import { registrySources, SourceListener } from './RegistrySources';

export class SourceContextRegistry {
    private map: Map<string, ContextItem[]> = new Map();

    // The view's items, or an empty list when the view has none registered yet.
    itemsFor(viewId: string): ContextItem[] {
        return this.map.get(viewId) ?? [];
    }

    // Fan this source's current items to its listeners. Called at the end of
    // every mutation, so listeners never see a partially-applied set.
    private informUpdated(viewId: string, origin?: SourceListener): void {
        registrySources.fanUpdate(viewId, this.itemsFor(viewId), origin);
    }

    // The item carries its own source key (groupKey), so callers don't pass one
    // and can't pass a mismatched one.
    add(item: ContextItem, origin?: SourceListener): void {
        const viewId = item.groupKey();
        const items = this.map.get(viewId);
        if (items == null) {
            this.map.set(viewId, [item]);
        } else if (!items.includes(item)) {
            items.push(item);
        } else {
            return; // already present: no change, no fan
        }
        item.register();
        this.informUpdated(viewId, origin);
    }

    remove(item: ContextItem, origin?: SourceListener): void {
        const viewId = item.groupKey();
        const items = this.map.get(viewId);
        if (items == null || !items.includes(item)) return;
        this.map.set(viewId, items.filter(i => i !== item));
        item.deregister();
        this.informUpdated(viewId, origin);
    }

    removeList(items: ContextItem[], origin?: SourceListener): void {
        if (items.length === 0) return;
        const viewId = items[0].groupKey();
        const bucket = this.map.get(viewId);
        if (bucket == null) return;

        const doomed = new Set(items.filter(i => i.groupKey() === viewId && bucket.includes(i)));
        if (doomed.size === 0) return; // nothing actually present: no change, no fan

        this.map.set(viewId, bucket.filter(i => !doomed.has(i)));
        for (const item of doomed) item.deregister();
        this.informUpdated(viewId, origin);
    }

    setItems(viewId: string, items: ContextItem[], origin?: SourceListener): void {
        const before = this.map.get(viewId) ?? [];

        const unchanged = before.length === items.length
            && before.every((it, i) => it === items[i]);
        if (unchanged) return;

        this.map.set(viewId, [...items]);

        for (const item of items) item.register();
        for (const item of before) {
            if (!items.includes(item)) item.deregister();
        }
        this.informUpdated(viewId, origin);
    }

    remapped(viewId: string, origin?: SourceListener): void {
        registrySources.fanPositions(viewId, this.itemsFor(viewId), origin);
    }

    // Stub: load couldn't place this item (bad range). Reports + leaves it
    // registered — hook for later reconciliation/eviction.
    reportInvalid(viewId: string, item: ContextItem, reason: string): void {
        // TODO: reconcile/evict the unplaceable item instead of only warning.
        console.warn(`[SourceContextRegistry] invalid item for view ${viewId}: ${reason}`, item);
    }
}

export const sourceContextRegistry = new SourceContextRegistry();
