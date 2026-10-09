import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '../src/ComponentRegistry';
import { buildComponentRegistry, node } from './factories/registries';

// Only the live half of the registry is covered (register / deregister /
// setParent / getChildren). The traversal half (getAncestors, isSiblings,
// getFirstAncestorOfType, getParent, get) has no call sites in the app.
describe('ComponentRegistry', () => {
    it('registers and lists children under a parent', () => {
        const reg = buildComponentRegistry({ root: ['a', 'b'] });
        const childIds = reg.getChildren('root').map(e => e.id);
        expect(childIds).toEqual(['a', 'b']);
    });

    it('getChildren returns [] for an unknown or childless id', () => {
        const reg = new ComponentRegistry();
        reg.register(node('lonely'), 'text');
        expect(reg.getChildren('lonely')).toEqual([]);
        expect(reg.getChildren('missing')).toEqual([]);
    });

    it('setParent re-parents: child leaves the old parent and joins the new', () => {
        const reg = buildComponentRegistry({ p1: ['c'], p2: [] });
        reg.setParent('c', 'p2');
        expect(reg.getChildren('p1').map(e => e.id)).toEqual([]);
        expect(reg.getChildren('p2').map(e => e.id)).toEqual(['c']);
    });

    it('setParent is idempotent — re-adding the same child does not duplicate it', () => {
        const reg = buildComponentRegistry({ p: ['c'] });
        reg.setParent('c', 'p');
        expect(reg.getChildren('p').map(e => e.id)).toEqual(['c']);
    });

    it('deregister removes the entry so getChildren skips the dangling id', () => {
        const reg = buildComponentRegistry({ root: ['a', 'b'] });
        reg.deregister('a');
        // The id is filtered out of the parent's child entries (entry gone).
        expect(reg.getChildren('root').map(e => e.id)).toEqual(['b']);
    });

    it('deregister cleans up the node as a parent too', () => {
        const reg = buildComponentRegistry({ root: ['a'], a: ['grandchild'] });
        reg.deregister('a');
        // 'a' removed as child of root...
        expect(reg.getChildren('root')).toEqual([]);
        // ...and its own children map is gone (no lingering 'a' -> [grandchild]).
        expect(reg.getChildren('a')).toEqual([]);
    });

    it('isolation: a fresh instance shares no state with another', () => {
        const a = buildComponentRegistry({ root: ['x'] });
        const b = new ComponentRegistry();
        expect(a.getChildren('root').map(e => e.id)).toEqual(['x']);
        expect(b.getChildren('root')).toEqual([]);
    });
});
