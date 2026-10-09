import { describe, it, expect, vi } from 'vitest';
import { RegistrySources, SourceListener } from '../src/interactions/RegistrySources';
import type { ContextItem } from '../src/annotation/ContextItem';

// A listener that records every set it's handed.
function recorder(): SourceListener & { seen: ContextItem[][] } {
    const seen: ContextItem[][] = [];
    return { seen, onSourceContextItemsChange(items) { seen.push(items); } };
}

const item = (label: string) => ({ label }) as unknown as ContextItem;

describe('RegistrySources', () => {
    it('fans an update to every listener on the source', () => {
        const sources = new RegistrySources();
        const a = recorder();
        const b = recorder();
        sources.register('src', a);
        sources.register('src', b);

        const items = [item('x')];
        sources.fanUpdate('src', items);
        expect(a.seen).toEqual([items]);
        expect(b.seen).toEqual([items]);
    });

    it('does not fan across sources', () => {
        const sources = new RegistrySources();
        const other = recorder();
        sources.register('src-1', other);
        sources.fanUpdate('src-2', [item('x')]);
        expect(other.seen).toEqual([]);
    });

    it('skips the origin of the change', () => {
        const sources = new RegistrySources();
        const writer = recorder();
        const peer = recorder();
        sources.register('src', writer);
        sources.register('src', peer);

        sources.fanUpdate('src', [item('x')], writer);
        expect(writer.seen).toEqual([]);
        expect(peer.seen).toHaveLength(1);
    });

    // Documents a REAL limit of the origin skip: it stops a writer hearing its
    // own change, but it does NOT stop a two-party echo. Each hop legitimately
    // skips only itself, so A->B->A->B recurses without bound. Nothing here can
    // fix that — a pure fan-out has no state, so it cannot tell an echo from a
    // genuine change. Termination comes from SourceContextRegistry's unchanged
    // guard (see its 'a write-back of the same set does not re-fan' test), which
    // is why every fan must originate from a registry mutation and listeners
    // must not call fanUpdate directly.
    it('the origin skip alone does not stop a two-party echo', () => {
        const sources = new RegistrySources();
        let hops = 0;

        const makeEchoer = (): SourceListener => {
            const self: SourceListener = {
                onSourceContextItemsChange() {
                    hops++;
                    if (hops < 20) sources.fanUpdate('src', [], self);
                },
            };
            return self;
        };

        sources.register('src', makeEchoer());
        sources.register('src', makeEchoer());
        sources.fanUpdate('src', [item('x')], undefined);
        expect(hops).toBeGreaterThanOrEqual(20); // runs to the cap: no natural termination here
    });

    it('deregister stops delivery', () => {
        const sources = new RegistrySources();
        const a = recorder();
        sources.register('src', a);
        sources.deregister('src', a);
        sources.fanUpdate('src', [item('x')]);
        expect(a.seen).toEqual([]);
    });

    it('register is idempotent for the same listener', () => {
        const sources = new RegistrySources();
        const a = recorder();
        sources.register('src', a);
        sources.register('src', a);
        sources.fanUpdate('src', [item('x')]);
        expect(a.seen).toHaveLength(1);
    });

    it('isolation: listeners are per-instance', () => {
        const one = new RegistrySources();
        const two = new RegistrySources();
        const a = recorder();
        one.register('src', a);
        two.fanUpdate('src', [item('x')]);
        expect(a.seen).toEqual([]);
    });
});
