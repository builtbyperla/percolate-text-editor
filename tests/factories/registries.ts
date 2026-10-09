import { ComponentRegistry } from '../../src/ComponentRegistry';
import type { ContextItem } from '../../src/annotation/ContextItem';

// A tiny id-bearing object — all ComponentRegistry stores/relates is { id }.
export function node(id: string): { id: string } {
    return { id };
}

// Build a ComponentRegistry populated from a parent -> children spec. Every id
// mentioned is registered (type 'container'); edges are wired via setParent.
// Example: buildComponentRegistry({ root: ['a', 'b'], a: ['c'] }).
export function buildComponentRegistry(
    tree: Record<string, string[]>,
): ComponentRegistry {
    const reg = new ComponentRegistry();
    const ids = new Set<string>();
    for (const [parent, children] of Object.entries(tree)) {
        ids.add(parent);
        children.forEach(c => ids.add(c));
    }
    for (const id of ids) reg.register(node(id), 'container');
    for (const [parent, children] of Object.entries(tree)) {
        for (const c of children) reg.setParent(c, parent);
    }
    return reg;
}

// A labelled stub for identity, plus no-op register/deregister so it survives
// SourceContextRegistry.setItems (which reconciles the evidence-pane registry
// through these). Override the spies in a test to assert reconciliation.
// groupKey is the item's own source key — the registry derives its bucket from
// it rather than taking one from the caller.
export function fakeContextItem(label: string, source = 'v'): ContextItem {
    return {
        label,
        groupKey: () => source,
        register() {},
        deregister() {},
    } as unknown as ContextItem;
}
