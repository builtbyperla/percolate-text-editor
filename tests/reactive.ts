import { createRoot } from 'solid-js';

// Run `fn` inside a Solid reactive root, then dispose it. The classes under test
// own eager signals (not effects), so accessor values are readable synchronously
// after a mutation inside the root — we just need an owner so createSignal has
// somewhere to live and gets cleaned up.
export function withRoot<T>(fn: () => T): T {
    let out!: T;
    let dispose!: () => void;
    createRoot(d => {
        dispose = d;
        out = fn();
    });
    dispose();
    return out;
}
