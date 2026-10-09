import { RangeValue, RangeSet } from '@codemirror/state';

export class AnnotationAnchor extends RangeValue {
    constructor(readonly id: string) {
        super();
    }
    eq(other: RangeValue): boolean {
        return other instanceof AnnotationAnchor && other.id === this.id;
    }
}

// A minimal id + span record — the shape crossing the TextDataModel seam so callers
// reconcile without touching a CM6 RangeSet.
export interface AnchorRange {
    id: string;
    from: number;
    to: number;
}

// Build a RangeSet from id/span records. Sorts by `from` (RangeSet.of requires
// sorted input); callers pass unsorted freely.
export function anchorsFrom(ranges: AnchorRange[]): RangeSet<AnnotationAnchor> {
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    return RangeSet.of(sorted.map(r => new AnnotationAnchor(r.id).range(r.from, r.to)));
}

export function rangesFrom(set: RangeSet<AnnotationAnchor>): AnchorRange[] {
    const out: AnchorRange[] = [];
    const iter = set.iter();
    while (iter.value) {
        out.push({ id: iter.value.id, from: iter.from, to: iter.to });
        iter.next();
    }
    return out;
}
