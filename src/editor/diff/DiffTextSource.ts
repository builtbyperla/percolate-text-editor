import { Accessor } from 'solid-js';
import { ChangeSet } from '@codemirror/state';
import {
    TextDataModel, TextEdit, TextSourceKind, TextSourceData, ModelChangeListener, AnnotationMapResult,
    TrackedMapListener,
} from '../../textmodel/TextDataModel';
import { AnchorRange } from '../../textmodel/AnnotationAnchors';
import { DiffScheduler } from './DiffScheduler';
import { DiffHunk, DiffSide } from './DiffModel';

export interface DiffSourceData extends TextSourceData {
    kind: 'diff';
    oldModel: TextDataModel;
    newModel: TextDataModel;
    hunks: DiffHunk[];
}

export class DiffTextSource implements TextDataModel {
    private sourceId: string;
    private oldModel: TextDataModel;
    private newModel: TextDataModel;
    private scheduler: DiffScheduler;

    constructor(sourceId: string, oldModel: TextDataModel, newModel: TextDataModel, scheduler: DiffScheduler) {
        this.sourceId = sourceId;
        this.oldModel = oldModel;
        this.newModel = newModel;
        this.scheduler = scheduler;
    }

    // ---- Diff identity / composite surface ------------------------------------------

    getSourceId(): string {
        return this.sourceId;
    }

    kind(): TextSourceKind {
        return 'diff';
    }

    getData(): TextSourceData {
        const data: DiffSourceData = {
            kind: 'diff',
            oldModel: this.oldModel,
            newModel: this.newModel,
            hunks: this.scheduler.current(),
        };
        return data;
    }

    // The real child model for a side — the seam side-bound callbacks close over, and the
    // way a consumer that needs the actual TextDataModel on a side reaches it.
    modelFor(side: DiffSide): TextDataModel {
        return side === 'old' ? this.oldModel : this.newModel;
    }

    // Current text of a side (convenience over modelFor(side).getValue()).
    valueFor(side: DiffSide): string {
        return this.modelFor(side).getValue();
    }

    boundEditor(side: DiffSide): (edit: TextEdit, originViewKey?: string) => void {
        const model = this.modelFor(side);
        return (edit, originViewKey) => model.applyEdit(edit, originViewKey);
    }

    applyHunk(hunk: DiffHunk, side: DiffSide, originViewKey?: string): void {
        const other: DiffSide = side === 'old' ? 'new' : 'old';
        const targetSpan = hunk.span(side);
        const sourceSpan = hunk.span(other);

        const targetText = this.valueFor(side);
        const otherText = this.valueFor(other);

        const { from, to } = lineSpanToCharRange(targetText, targetSpan.start, targetSpan.count);
        const insert = sliceLines(otherText, sourceSpan.start, sourceSpan.count);

        this.modelFor(side).applyEdit({ from, to, insert }, originViewKey);
    }

    get getValue(): Accessor<string> {
        return this.newModel.getValue;
    }

    // Same default-side delegation: a diff annotation counts offsets against the side's
    // own buffer, and the child model already collapses raw/display.
    get displayText(): Accessor<string> {
        return this.newModel.displayText;
    }

    getLineCount(): number {
        return this.newModel.getLineCount();
    }

    lineAtOffset(offset: number): number {
        return this.newModel.lineAtOffset(offset);
    }

    lineStartOffset(line: number): number {
        return this.newModel.lineStartOffset(line);
    }

    snapshot(): { read(): string } {
        return this.newModel.snapshot();
    }

    applyEdit(edit: TextEdit, originViewKey?: string): void {
        this.newModel.applyEdit(edit, originViewKey);
    }

    setValue(next: string, originViewKey?: string): void {
        this.newModel.setValue(next, originViewKey);
    }

    // Annotation anchor mapping delegates to the new-side model (the diff source's
    // annotations live over its new text), same as the other text ops above.
    applyChanges(changes: ChangeSet, originViewKey?: string): void {
        this.newModel.applyChanges(changes, originViewKey);
    }

    setAnnotationRanges(ranges: AnchorRange[]): void {
        this.newModel.setAnnotationRanges(ranges);
    }

    mapAnnotations(changes: ChangeSet): AnnotationMapResult {
        return this.newModel.mapAnnotations(changes);
    }

    trackRanges(key: string, ranges: AnchorRange[], onMapped: TrackedMapListener): () => void {
        return this.newModel.trackRanges(key, ranges, onMapped);
    }

    updateTrackedRanges(key: string, ranges: AnchorRange[]): void {
        this.newModel.updateTrackedRanges(key, ranges);
    }

    onChange(listener: ModelChangeListener): () => void {
        return this.newModel.onChange(listener);
    }

    dispose(): void {
        // The children are owned by DiffView (shared with the per-side views), so the
        // composite does not dispose them — it only drops its own references.
    }
}

// Char offset where each 1-based line begins: index i holds line (i+1)'s start.
function lineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') starts.push(i + 1);
    }
    return starts;
}

// The char range [from, to) covering `count` lines starting at 1-based `start`.
function lineSpanToCharRange(text: string, start: number, count: number): { from: number; to: number } {
    const starts = lineStarts(text);
    const from = starts[start - 1] ?? text.length;
    const to = starts[start - 1 + count] ?? text.length;
    return { from, to };
}

// The substring of `text` spanning `count` lines from 1-based `start` (including each line's trailing "\n").
function sliceLines(text: string, start: number, count: number): string {
    if (count === 0) return '';
    const { from, to } = lineSpanToCharRange(text, start, count);
    return text.slice(from, to);
}
