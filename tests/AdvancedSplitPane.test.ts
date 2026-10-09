import { describe, expect, it, vi } from 'vitest';
import { JSX } from 'solid-js';
import { AdvancedSplitPaneFrame, AdvancedSplitPaneView } from '../src/containers/AdvancedSplitPane';

class Pane implements AdvancedSplitPaneView {
    ownsScroll = true;
    minimumPaneSize?: number;
    onPaneResize = vi.fn();

    constructor(minimumPaneSize?: number) {
        this.minimumPaneSize = minimumPaneSize;
    }

    getVisual(): () => JSX.Element {
        return () => null;
    }
}

describe('AdvancedSplitPaneFrame', () => {
    it('shrinks to a numbered pixel size and restores the preferred fraction', () => {
        const tools = new Pane(30);
        const chat = new Pane();
        const split = new AdvancedSplitPaneFrame(false, [tools, chat]);
        split.fractionSetters[0](0.33);
        split.fractionSetters[1](0.67);
        split.containerRef = {
            getBoundingClientRect: () => ({ width: 400, height: 1000 }),
        } as HTMLDivElement;

        split.shrinkPane(tools, 30);
        expect(split.fractions[0]()).toBeCloseTo(0.03);
        expect(split.fractions[1]()).toBeCloseTo(0.97);

        split.unshrinkPane(tools);
        expect(split.fractions[0]()).toBeCloseTo(0.33);
        expect(split.fractions[1]()).toBeCloseTo(0.67);
    });

    it('does not overwrite the preferred size when shrink is called twice', () => {
        const tools = new Pane(30);
        const chat = new Pane();
        const split = new AdvancedSplitPaneFrame(false, [tools, chat]);
        split.fractionSetters[0](0.4);
        split.fractionSetters[1](0.6);
        split.containerRef = {
            getBoundingClientRect: () => ({ width: 400, height: 1000 }),
        } as HTMLDivElement;

        split.shrinkPane(tools, 50);
        split.shrinkPane(tools, 30);
        split.unshrinkPane(tools);

        expect(split.fractions[0]()).toBeCloseTo(0.4);
    });
});
