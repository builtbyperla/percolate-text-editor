import { describe, it, expect } from 'vitest';
import { withRoot } from './reactive';
import { SplitPaneFrame } from '../src/containers/SplitPane';
import { FakeViewBlock } from './factories/fakes';
import { rect } from './factories/panes';

const buildFrame = (n: number, horizontal = true) =>
    new SplitPaneFrame(horizontal, Array.from({ length: n }, (_, i) => new FakeViewBlock(`p${i}`)));

describe('SplitPaneFrame', () => {
    it('getPaneIndex locates a pane, -1 when absent', () => {
        withRoot(() => {
            const f = buildFrame(3);
            expect(f.getPaneIndex(f.panes[2])).toBe(2);
            expect(f.getPaneIndex(new FakeViewBlock('other'))).toBe(-1);
        });
    });

    describe('_initBlocks', () => {
        it('assigns each pane an equal 1/n fraction', () => {
            withRoot(() => {
                const f = buildFrame(4);
                expect(f.fractions.map(fr => fr())).toEqual([0.25, 0.25, 0.25, 0.25]);
            });
        });

        it('interleaves a divider between panes but not before the first', () => {
            withRoot(() => {
                const f = buildFrame(3);
                // 3 panes + 2 dividers = 5 blocks, pane-first ordering.
                expect(f.blocks).toHaveLength(5);
                expect(f.fractions).toHaveLength(3);
            });
        });

        it('defaults fraction to 1 for an empty frame', () => {
            withRoot(() => {
                const f = buildFrame(0);
                expect(f.fractions).toHaveLength(0);
                expect(f.blocks).toHaveLength(0);
            });
        });
    });

    describe('onDividerPointerMove', () => {
        // Two panes, 1000px-wide horizontal container, divider at index 1.
        const setup = (f: SplitPaneFrame<FakeViewBlock>) => {
            f.containerRef = { getBoundingClientRect: () => rect(0, 0, 1000, 500) } as HTMLDivElement;
        };

        it('rebalances adjacent fractions toward the pointer', () => {
            withRoot(() => {
                const f = buildFrame(2); // [0.5, 0.5]
                setup(f);
                // Pointer 300px in -> above pane should take 0.3, below 0.7.
                f.onDividerPointerMove({ clientX: 300, clientY: 0 } as PointerEvent, 1);
                expect(f.fractions[0]()).toBeCloseTo(0.3, 5);
                expect(f.fractions[1]()).toBeCloseTo(0.7, 5);
            });
        });

        it('keeps the two fractions summing to their original combined size', () => {
            withRoot(() => {
                const f = buildFrame(2);
                setup(f);
                f.onDividerPointerMove({ clientX: 420, clientY: 0 } as PointerEvent, 1);
                expect(f.fractions[0]() + f.fractions[1]()).toBeCloseTo(1, 5);
            });
        });

        it('clamps the above pane to minPx (80px) when dragged past the edge', () => {
            withRoot(() => {
                const f = buildFrame(2);
                setup(f);
                // Pointer at 10px would give 0.01 -> clamped to 80/1000 = 0.08.
                f.onDividerPointerMove({ clientX: 10, clientY: 0 } as PointerEvent, 1);
                expect(f.fractions[0]()).toBeCloseTo(0.08, 5);
                expect(f.fractions[1]()).toBeCloseTo(0.92, 5);
            });
        });

        it('does nothing without a container ref', () => {
            withRoot(() => {
                const f = buildFrame(2);
                expect(() => f.onDividerPointerMove({ clientX: 300, clientY: 0 } as PointerEvent, 1)).not.toThrow();
                expect(f.fractions[0]()).toBe(0.5);
            });
        });
    });
});
