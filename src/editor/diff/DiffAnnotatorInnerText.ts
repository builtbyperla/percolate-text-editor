import { AnnotatorInnerText, AnnotatorRenderLayer } from '../DualTextView';
import { BuildResult, RenderUnit } from '../../annotation/RenderLayer';
import { AnnotationTextView } from '../../annotation/AnnotationTextView';
import { TextDataModel } from '../../textmodel/TextDataModel';
import { diffLineInfo, diffLineInfoFromHunks, DiffSide, DiffLineInfo } from './diffDecorations';
import { RangesDataModel } from '../RangesDataModel';
import { userSettings } from '../../UserSettings';
import { THEME_DIFF_COLORS, THEME_FOREGROUNDS } from '../editorThemes';
import { DiffScheduler } from './DiffScheduler';
import type { Accessor } from 'solid-js';

export class DiffRenderLayer extends AnnotatorRenderLayer {
    constructor(
        sourceId: string,
        private side: DiffSide,
        private getOwnText: () => string,
        private getOtherModel: () => TextDataModel | null,
        private ranges: RangesDataModel,
        private scheduler: DiffScheduler | null = null,
    ) {
        super(sourceId);
    }

    // The per-walk diff snapshot, computed once in publish() and read by stampUnit.
    // Recomputing it per row would re-diff the document once per line.
    private info: DiffLineInfo | null = null;

    private currentInfo(): DiffLineInfo {
        return this.scheduler
            ? diffLineInfoFromHunks(this.scheduler.current(), this.side)
            : diffLineInfo(this.getOwnText(), this.getOtherModel()?.getValue() ?? '', this.side);
    }

    // Per emitted unit: the changed-line background and the spacer hanging above it.
    stampUnit(unit: RenderUnit, _index: number, lineNo: number): void {
        const info = this.info ?? (this.info = this.currentInfo());
        const theme = userSettings.editorTheme();
        const bg = this.side === 'old'
            ? THEME_DIFF_COLORS[theme].removedBg
            : THEME_DIFF_COLORS[theme].addedBg;
        const grey = THEME_FOREGROUNDS[theme];
        const hatch = `${grey}0e repeating-linear-gradient(45deg, ${grey}22 0, ${grey}22 1px, transparent 1px, transparent 7px)`;

        let spacerPx = 0;
        for (const s of info.spacers) {
            if (s.beforeLine === lineNo) spacerPx += s.heightPx;
        }

        unit.stamp = {
            bgColor: info.changedLines.has(lineNo) ? bg : undefined,
            spacerPx,
            spacerHatch: spacerPx > 0 ? hatch : undefined,
        };
    }

    publish(result: BuildResult): void {
        const info = this.info ?? this.currentInfo();
        const visibleLines = new Set(result.sourceLines ?? result.units.map((_, i) => i + 1));
        this.ranges.setRanges(info.spacers.filter(spacer => visibleLines.has(spacer.beforeLine)));
        this.info = null;
    }
}

export class DiffAnnotatorInnerText extends AnnotatorInnerText {
    constructor(
        parent: AnnotationTextView,
        text: string | undefined,
        side: DiffSide,
        getOtherModel: () => TextDataModel | null,
        ranges: RangesDataModel,
        scheduler: DiffScheduler | null,
        getLineDragRange: Accessor<{ lo: number; hi: number } | null>,
        getLineHoverLine: Accessor<number | null>,
        visualTopForLine: (line: number) => number,
        visualHeightForRange: (lo: number, hi: number) => number,
    ) {
        super(parent, getLineDragRange, getLineHoverLine, visualTopForLine, visualHeightForRange, text, new DiffRenderLayer(
            parent.sourceId, side, () => this.getText(), getOtherModel, ranges, scheduler,
        ));

        this.unsubscribe = scheduler?.subscribe(() => this.rebuildUnits()) ?? null;
    }

    private unsubscribe: (() => void) | null = null;

    dispose() {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }
}
