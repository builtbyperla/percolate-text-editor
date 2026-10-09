import { AnnotatorViewFrame, AnnotatorInnerText } from '../DualTextView';
import { InnerText } from '../../annotation/TextViewCore';
import { DiffAnnotatorInnerText } from './DiffAnnotatorInnerText';
import { DiffSide } from './diffDecorations';
import { TextDataModel } from '../../textmodel/TextDataModel';
import { RangesDataModel } from '../RangesDataModel';
import { DiffScheduler } from './DiffScheduler';
import { AdditionalDataFn } from '../../annotation/ContextItem';
import { DualTextView } from '../DualTextView';

export interface DiffMeta {
    side: DiffSide;
    getOtherModel: () => TextDataModel | null;
    ranges: RangesDataModel;
    scheduler: DiffScheduler | null;
}

export class DiffAnnotatorViewFrame extends AnnotatorViewFrame {
    // WHY a separate constructor parameter instead of just reading this off `meta`: The obvious approach — put the payload callback in `meta` and read it in an override — fails…
    constructor(
        parent: DualTextView,
        sourceId: string,
        getClampBox: () => HTMLElement | null,
        text: string | undefined,
        model: TextDataModel | null,
        meta: DiffMeta,
        private getAdditionalData: AdditionalDataFn = () => undefined,
    ) {
        super(parent, sourceId, getClampBox, text, model, meta);
    }

    createInnerText(text?: string, meta?: unknown): InnerText {
        const m = meta as DiffMeta | undefined;
        if (!m) return new AnnotatorInnerText(this,
            () => this.parent?.getLineDragRange() ?? null,
            () => this.parent?.getLineHoverLine() ?? null,
            line => this.parent?.visualTopForSourceLine(line) ?? 0,
            (lo, hi) => this.parent?.visualHeightForSourceRange(lo, hi) ?? 0,
            text);
        return new DiffAnnotatorInnerText(this, text, m.side, m.getOtherModel, m.ranges, m.scheduler,
            () => this.parent?.getLineDragRange() ?? null,
            () => this.parent?.getLineHoverLine() ?? null,
            line => this.parent?.visualTopForSourceLine(line) ?? 0,
            (lo, hi) => this.parent?.visualHeightForSourceRange(lo, hi) ?? 0);
    }

    additionalData(): unknown {
        return this.getAdditionalData();
    }

    // The base annotator dispose is a no-op, but the diff inner-text holds a scheduler subscription that must be dropped on the edit↔annotate toggle rebuild (else one stale closure…
    dispose(): void {
        (this.innerTextObject as DiffAnnotatorInnerText).dispose?.();
        super.dispose();
    }
}
