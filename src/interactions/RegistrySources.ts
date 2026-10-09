export interface SourceListener {
    onSourceContextItemsChange(items: ContextItem[]): void;

    onSourceContextPositionsChange?(items: ContextItem[]): void;

}

import type { ContextItem } from '../annotation/ContextItem';

export class RegistrySources {
    private listeners: Map<string, WeakRef<SourceListener>[]> = new Map();

    register(sourceId: string, listener: SourceListener): void {
        const refs = this.listeners.get(sourceId);
        if (refs == null) {
            this.listeners.set(sourceId, [new WeakRef(listener)]);
            return;
        }
        if (!refs.some(r => r.deref() === listener)) {
            refs.push(new WeakRef(listener));
        }
    }

    deregister(sourceId: string, listener: SourceListener): void {
        const refs = this.listeners.get(sourceId);
        if (refs == null) return;
        this.listeners.set(sourceId, refs.filter(r => {
            const held = r.deref();
            // Drop the target and any already-collected ref while we're here.
            return held != null && held !== listener;
        }));
    }

    fanUpdate(sourceId: string, items: ContextItem[], origin?: SourceListener): void {
        this.fan(sourceId, items, origin, (l, i) => l.onSourceContextItemsChange(i));
    }

    fanPositions(sourceId: string, items: ContextItem[], origin?: SourceListener): void {
        this.fan(sourceId, items, origin, (l, i) => l.onSourceContextPositionsChange?.(i));
    }

    // Shared walk for both channels: deref live listeners (pruning collected refs),
    // skip the origin, deliver via `notify`.
    private fan(
        sourceId: string,
        items: ContextItem[],
        origin: SourceListener | undefined,
        notify: (listener: SourceListener, items: ContextItem[]) => void,
    ): void {
        const refs = this.listeners.get(sourceId);
        if (refs == null) return;

        const live: WeakRef<SourceListener>[] = [];
        for (const ref of refs) {
            const listener = ref.deref();
            if (listener == null) continue;
            live.push(ref);
            if (listener === origin) continue;
            notify(listener, items);
        }
        this.listeners.set(sourceId, live);
    }
}

export const registrySources = new RegistrySources();
