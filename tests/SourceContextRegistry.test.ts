import { describe, it, expect, vi } from 'vitest';
import { SourceContextRegistry } from '../src/interactions/SourceContextRegistry';
import { registrySources } from '../src/interactions/RegistrySources';
import { fakeContextItem } from './factories/registries';

// Live methods: itemsFor / add / remove / removeList / setItems / reportInvalid.
describe('SourceContextRegistry', () => {
    it('itemsFor returns an empty list for an unknown view', () => {
        const reg = new SourceContextRegistry();
        expect(reg.itemsFor('view-x')).toEqual([]);
    });

    it('add accumulates items per view', () => {
        const reg = new SourceContextRegistry();
        const a = fakeContextItem('a');
        const b = fakeContextItem('b');
        reg.add(a);
        reg.add(b);
        expect(reg.itemsFor('v')).toEqual([a, b]);
    });

    it('add is idempotent on the same item reference', () => {
        const reg = new SourceContextRegistry();
        const a = fakeContextItem('a');
        reg.add(a);
        reg.add(a);
        expect(reg.itemsFor('v')).toEqual([a]);
    });

    it('add routes each item to its own source bucket', () => {
        const reg = new SourceContextRegistry();
        const a = fakeContextItem('a', 'src-1');
        const b = fakeContextItem('b', 'src-2');
        reg.add(a);
        reg.add(b);
        expect(reg.itemsFor('src-1')).toEqual([a]);
        expect(reg.itemsFor('src-2')).toEqual([b]);
    });

    it('remove drops the item from its bucket and deregisters it', () => {
        const reg = new SourceContextRegistry();
        const a = fakeContextItem('a');
        const b = fakeContextItem('b');
        a.deregister = vi.fn();
        reg.add(a);
        reg.add(b);
        reg.remove(a);
        expect(reg.itemsFor('v')).toEqual([b]);
        expect(a.deregister).toHaveBeenCalledOnce();
    });

    // removeList is the batched deletion channel: an edit that collapses N
    // highlights must cost ONE rebuild per listener, not N (same principle as
    // remapped()). These pin both the bucket result and the single fan.
    it('removeList drops every listed item and deregisters each', () => {
        const reg = new SourceContextRegistry();
        const a = fakeContextItem('a');
        const b = fakeContextItem('b');
        const c = fakeContextItem('c');
        [a, b, c].forEach(it => { it.deregister = vi.fn(); });
        [a, b, c].forEach(it => reg.add(it));

        reg.removeList([a, c]);
        expect(reg.itemsFor('v')).toEqual([b]);
        expect(a.deregister).toHaveBeenCalledOnce();
        expect(c.deregister).toHaveBeenCalledOnce();
        expect(b.deregister).not.toHaveBeenCalled();
    });

    it('removeList fans exactly once for a multi-item removal', () => {
        const reg = new SourceContextRegistry();
        const items = [fakeContextItem('a'), fakeContextItem('b'), fakeContextItem('c')];
        items.forEach(it => reg.add(it));

        const listener = { onSourceContextItemsChange: vi.fn() };
        registrySources.register('v', listener);
        reg.removeList(items);
        expect(listener.onSourceContextItemsChange).toHaveBeenCalledOnce();
        registrySources.deregister('v', listener);
    });

    it('removeList is a no-op (no fan) when nothing listed is present', () => {
        const reg = new SourceContextRegistry();
        const a = fakeContextItem('a');
        reg.add(a);

        const listener = { onSourceContextItemsChange: vi.fn() };
        registrySources.register('v', listener);
        reg.removeList([fakeContextItem('absent')]);
        expect(listener.onSourceContextItemsChange).not.toHaveBeenCalled();
        expect(reg.itemsFor('v')).toEqual([a]);
        registrySources.deregister('v', listener);
    });

    it('removeList on an empty list does nothing', () => {
        const reg = new SourceContextRegistry();
        const a = fakeContextItem('a');
        reg.add(a);
        reg.removeList([]);
        expect(reg.itemsFor('v')).toEqual([a]);
    });

    it('setItems replaces a view bucket and copies the array', () => {
        const reg = new SourceContextRegistry();
        const items = [fakeContextItem('a'), fakeContextItem('b')];
        reg.setItems('v', items);
        // Mutating the source array afterward must not leak into the stored bucket.
        items.push(fakeContextItem('c'));
        expect(reg.itemsFor('v')).toHaveLength(2);
    });

    it('setItems registers every item in the new set and deregisters dropped ones', () => {
        const reg = new SourceContextRegistry();
        const a = fakeContextItem('a');
        const b = fakeContextItem('b');
        const c = fakeContextItem('c');
        [a, b, c].forEach(it => {
            it.register = vi.fn();
            it.deregister = vi.fn();
        });

        reg.setItems('v', [a, b]);
        expect(a.register).toHaveBeenCalledOnce();
        expect(b.register).toHaveBeenCalledOnce();

        // b dropped (merged away), c added: c registers, b deregisters, a stays.
        reg.setItems('v', [a, c]);
        expect(c.register).toHaveBeenCalledOnce();
        expect(b.deregister).toHaveBeenCalledOnce();
        expect(a.deregister).not.toHaveBeenCalled();
    });

    it('reportInvalid warns and leaves the item registered', () => {
        const reg = new SourceContextRegistry();
        const item = fakeContextItem('bad');
        reg.add(item);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        reg.reportInvalid('v', item, 'out of range');
        expect(warn).toHaveBeenCalledOnce();
        expect(reg.itemsFor('v')).toContain(item);
        warn.mockRestore();
    });

    // The termination property the whole design rests on. RegistrySources cannot
    // stop a two-party echo (it holds no state — see its own test); the registry
    // can, because re-setting an identical set is a no-op that never fans. This
    // is what keeps A-writes -> B-informed -> B-writes-back from ping-ponging.
    it('a write-back of the same set does not re-fan', () => {
        const reg = new SourceContextRegistry();
        const a = fakeContextItem('a');
        const b = fakeContextItem('b');
        reg.setItems('v', [a, b]);

        let fans = 0;
        // Held in a local: RegistrySources keeps only a WeakRef, so an inline
        // object with no other owner could be collected before the fan.
        const listener = { onSourceContextItemsChange() { fans++; } };
        registrySources.register('v', listener);

        // A genuine change fans once...
        reg.setItems('v', [a]);
        expect(fans).toBe(1);
        // ...and the echo of that same set is dropped.
        reg.setItems('v', [a]);
        expect(fans).toBe(1);
    });

    it('isolation: buckets are per-instance', () => {
        const a = new SourceContextRegistry();
        const b = new SourceContextRegistry();
        a.add(fakeContextItem('only-a'));
        expect(b.itemsFor('v')).toEqual([]);
    });
});
