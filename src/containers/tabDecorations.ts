import { Accessor } from 'solid-js';
import type { Tab, TabDecoration } from './Tabs';

export interface DecorationProducer {
    getTabDecorations(): Accessor<TabDecoration[]>;
}

export interface ModeProducer {
    getTabMode(): Accessor<string | undefined>;
}

// Duck-check for opt-in. Prefer this over `instanceof` — the marker is
// structural (no shared base class), so any view that fits the shape counts.
export function isDecorationProducer(v: unknown): v is DecorationProducer {
    return typeof v === 'object' && v !== null
        && typeof (v as DecorationProducer).getTabDecorations === 'function';
}

export function isModeProducer(v: unknown): v is ModeProducer {
    return typeof v === 'object' && v !== null
        && typeof (v as ModeProducer).getTabMode === 'function';
}

export function wireTabDecorations(tab: Tab, view: unknown): void {
    if (isDecorationProducer(view)) {
        tab.setDecorationsAccessor(view.getTabDecorations());
    }
    if (isModeProducer(view)) {
        tab.setModeAccessor(view.getTabMode());
    }
}
