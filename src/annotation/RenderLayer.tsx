import type { TextRepr, Decoration } from './TextViewCore';
import type { AnnotationTextView } from './AnnotationTextView';
import type { TextDataModel } from '../textmodel/TextDataModel';

export interface DocPosition {
    offset: number;
    x?: number;
    y?: number;
}

export interface LineStamp {
    bgColor?: string;
    spacerPx?: number;
    spacerHatch?: string;
}

export class RenderUnit {
    segments: TextRepr[];
    stamp?: LineStamp;
    refEl?: HTMLElement;

    lineClass?: string;

    rowTag: 'div' | 'span';

    constructor(segments: TextRepr[] = [], lineClass?: string, rowTag: 'div' | 'span' = 'div') {
        this.segments = segments;
        this.lineClass = lineClass;
        this.rowTag = rowTag;
    }

    addSegment(seg: TextRepr) {
        this.segments.push(seg);
    }

    numSegments(): number {
        return this.segments.length;
    }

}

export interface BuildInput {
    sections: readonly TextRepr[];
    dataSource: TextDataModel;
    parent: AnnotationTextView;
}

export interface BuildResult {
    units: RenderUnit[];
    // Build-only source mapping for projections such as diff stamping. Folded
    // rows can differ from their visible array index.
    sourceLines?: number[];
}

export function clipRanges(ranges: readonly Decoration[], from: number, to: number): Decoration[] {
    const out: Decoration[] = [];
    for (const d of ranges) {
        if (d.to <= from || d.from >= to) continue;
        out.push({ from: Math.max(d.from, from), to: Math.min(d.to, to), color: d.color, className: d.className, style: d.style });
    }
    return out;
}

export abstract class RenderLayer {
    // FORWARD (§3.1). The whole conversion: walk [from, to) and return self-contained
    // units, stamping each segment's position. Each subclass writes its own.
    abstract buildUnits(input: BuildInput, from: number, to: number): BuildResult;

    resolvePosition(node: Node, offsetInNode: number): DocPosition | null {
        const start = node instanceof HTMLElement ? node : node.parentElement;

        // The nearest STAMPED ancestor, if the endpoint sits inside a fragment.
        let el: HTMLElement | null = start;
        while (el != null && el.dataset.posX == null) {
            el = el.parentElement;
        }

        const base = el ?? (start?.closest('.txt-inner') as HTMLElement | null);
        if (base == null) return null;

        const range = document.createRange();
        range.setStart(base, 0);
        range.setEnd(node, offsetInNode);
        const within = range.toString().length;

        // Anchored at the fragment's own global start when one was found; from the
        // root the measurement IS the offset, so the origin is 0.
        const x = el != null ? Number(el.dataset.posX) : 0;
        const pos: DocPosition = { offset: x + within, x };
        if (el?.dataset.posY != null) pos.y = Number(el.dataset.posY);
        return pos;
    }

    // Post-passes (§3.5). Default no-op; diff overrides both.
    stampUnit(_unit: RenderUnit, _index: number, _sourceLine: number): void {}
    publish(_result: BuildResult): void {}
}

export class PlainRenderLayer extends RenderLayer {
    buildUnits(input: BuildInput, _from: number, _to: number): BuildResult {
        return { units: input.sections.map(section => new RenderUnit([section], undefined, 'span')) };
    }
}
