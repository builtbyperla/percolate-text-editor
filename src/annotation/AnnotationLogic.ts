import { Annotation } from "@codemirror/state";
import { ContextItem, ContextView } from "./ContextItem";
import { TextRepr } from "./TextViewCore";

interface TextRange {
    start: number;
    end: number;
    origin: ContextView;
}

enum ContentType {
    PlainText,
    Highlight,
}

export class AnnotationLogic {

    public static mergeNotes(items: ContextItem[]): string {
        let strs: string[] = [];
        for (let item of items) {
            if (item.getNote().trim().length > 0) {
                strs.push(item.getNote());
            }
        }
        return strs.join('\n');
    }

    public static addHighlight(selection: TextRange, existing: ContextItem[]): ContextItem[] {
        let startInHighlight: number | null = null;
        let endInHighlight = null;
        let index = 0;
        let overlaps: Set<number> = new Set([]);
        for (let item of existing) {
            // Skip non-ranged context items
            if (!item.metadata?.range) {
                index += 1;
                continue;
            }

            const itemStart = item.metadata.range.start;
            const itemEnd = item.metadata.range.end;

            // Ranges are half-open [start, end), so a shared endpoint means the two regions ABUT, not overlap.

            // If selection starts in a highlight
            if (itemStart <= selection.start && selection.start < itemEnd) {
                startInHighlight = index;
            }

            // If selection ends in a highlight
            if (itemStart < selection.end && selection.end <= itemEnd) {
                endInHighlight = index;
            }

            if (itemStart < selection.end && itemEnd > selection.start) {
                overlaps.add(index);
            }

            index += 1;
        }

        // Skip highlights that start and end within single highlight block
        if (startInHighlight != null && startInHighlight == endInHighlight) {
            return existing;
        }

        // Skip very small plain text highlights TODO: actually do this in selection layer if (startInHighlight == null && endInHighlight == null )

        // Create new highlight, merging overlapping highlights if needed
        let left: number = selection.start;
        let right: number = selection.end;
        let refContextItem: ContextItem = new ContextItem(
            selection.origin, selection.origin.additionalData?.bind(selection.origin));
        if (startInHighlight != null) {
            // Snap selection to start of overlapping starting highlight
            const rng = existing[startInHighlight].getRange();
            if (rng) {
                left = rng.start;
                refContextItem = existing[startInHighlight];
            }
        }
        if (endInHighlight != null) {
            // Snap selection to end of overlapping ending highlight
            const rng = existing[endInHighlight].getRange();
            if (rng) {
                right = rng.end;
            }
        }

        // Merge notes and replace overlapped highlights with the merged one.
        refContextItem.setRange(left, right);
        let mergedItems: ContextItem[] = [...existing];

        if (overlaps.size > 0) {
            const group: ContextItem[] = existing.filter((e, i) => overlaps.has(i));
            const notes = AnnotationLogic.mergeNotes(group);
            refContextItem.setNote(notes);
            const groupStart = Math.min(...overlaps);
            mergedItems.splice(groupStart, overlaps.size, refContextItem);
        } else {
            // No overlap: sorted insert at the first item starting after the
            // selection (ranged items only — null-range items have no position).
            let insertIndex: number = mergedItems.findIndex((e) => {
                const rng = e.getRange();
                return rng != null && rng.start > selection.start;
            });
            if (insertIndex < 0) {
                insertIndex = mergedItems.length;
            }
            mergedItems.splice(insertIndex, 0, refContextItem);
        }

        return mergedItems;
    }
}