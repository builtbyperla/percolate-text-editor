import { SplitPaneFrame } from './SplitPane';
import { ViewBlock } from './Tabs';

export interface AdvancedSplitPaneView extends ViewBlock {
    minimumPaneSize?: number;
    onPaneResize?(size: number): void;
}

// Opt-in split behavior for panes that need programmatic pixel sizing or resize
// feedback. The ordinary SplitPaneFrame intentionally remains fraction-only.
export class AdvancedSplitPaneFrame<T extends AdvancedSplitPaneView> extends SplitPaneFrame<T> {
    private readonly preferredFractions = new Map<T, number>();

    shrinkPane(pane: T, pixels: number): void {
        const index = this.getPaneIndex(pane);
        if (index < 0 || !this.containerRef || this.panes.length < 2) return;

        const rect = this.containerRef.getBoundingClientRect();
        const totalSize = this.getIsHorizontal() ? rect.width : rect.height;
        if (totalSize <= 0) return;

        if (!this.preferredFractions.has(pane)) {
            this.preferredFractions.set(pane, this.fractions[index]());
        }

        const minimum = pane.minimumPaneSize ?? 80;
        const target = Math.min(Math.max(pixels, minimum), totalSize - 80);
        this.resizePaneToFraction(index, target / totalSize, totalSize);
    }

    unshrinkPane(pane: T): void {
        const index = this.getPaneIndex(pane);
        const preferred = this.preferredFractions.get(pane);
        if (index < 0 || preferred === undefined || !this.containerRef) return;

        const rect = this.containerRef.getBoundingClientRect();
        const totalSize = this.getIsHorizontal() ? rect.width : rect.height;
        if (totalSize <= 0) return;

        this.preferredFractions.delete(pane);
        this.resizePaneToFraction(index, preferred, totalSize);
    }

    private resizePaneToFraction(index: number, targetFraction: number, totalSize: number): void {
        const oldOtherTotal = this.fractions.reduce(
            (sum, fraction, i) => sum + (i === index ? 0 : fraction()),
            0,
        );

        this.fractionSetters[index](targetFraction);
        for (let i = 0; i < this.panes.length; i++) {
            if (i === index) continue;
            const share = oldOtherTotal > 0
                ? this.fractions[i]() / oldOtherTotal
                : 1 / (this.panes.length - 1);
            this.fractionSetters[i]((1 - targetFraction) * share);
        }
        this.notifyPaneSizes(totalSize);
    }

    override onDividerPointerMove(ev: PointerEvent, index: number): void {
        super.onDividerPointerMove(ev, index);
        // A manual drag establishes a new preferred size for both panes.
        this.preferredFractions.delete(this.panes[index - 1]);
        this.preferredFractions.delete(this.panes[index]);
        if (!this.containerRef) return;
        const rect = this.containerRef.getBoundingClientRect();
        this.notifyPaneSizes(this.getIsHorizontal() ? rect.width : rect.height);
    }

    private notifyPaneSizes(totalSize: number): void {
        for (let i = 0; i < this.panes.length; i++) {
            this.panes[i].onPaneResize?.(this.fractions[i]() * totalSize);
        }
    }
}
