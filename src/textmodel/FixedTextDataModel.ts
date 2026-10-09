import { Accessor, createSignal } from 'solid-js';
import { ChangeSet, Text } from '@codemirror/state';
import { AnnotationMapResult, ModelChange, TrackedMapListener } from './TextDataModel';
import type { TextDataModel, TextEdit, TextSourceData, TextSourceKind, ModelChangeListener } from './TextDataModel';
import { AnchorRange } from './AnnotationAnchors';

export class FixedTextDataModel implements TextDataModel {
    getValue: Accessor<string>;

    displayText: Accessor<string>;

    private setValue_: (next: string) => void;
    private text: string;
    private listeners = new Set<ModelChangeListener>();

    constructor(initial: string = '') {
        this.text = initial;
        const [get, set] = createSignal(initial);
        this.getValue = get;
        this.displayText = get;
        this.setValue_ = set;
    }

    // Lines = \n count + 1 (a trailing newline counts its empty final line), matching
    // the CM6-backed model's convention so line math is uniform across the seam.
    getLineCount(): number {
        let lines = 1;
        for (const ch of this.text) if (ch === '\n') lines++;
        return lines;
    }

    lineAtOffset(offset: number): number {
        const clamped = Math.max(0, Math.min(offset, this.text.length));
        let line = 1;
        for (let i = 0; i < clamped; i++) if (this.text[i] === '\n') line++;
        return line;
    }

    lineStartOffset(line: number): number {
        const clamped = Math.max(1, Math.min(line, this.getLineCount()));
        if (clamped === 1) return 0;
        let seen = 1;
        for (let i = 0; i < this.text.length; i++) {
            if (this.text[i] === '\n') {
                seen++;
                if (seen === clamped) return i + 1;
            }
        }
        return this.text.length;
    }

    snapshot(): { read(): string } {
        const text = this.text;
        return { read: () => text };
    }

    applyEdit(edit: TextEdit, originViewKey?: string): void {
        const changes = ChangeSet.of(edit, this.text.length);
        this.text = changes.apply(Text.of(this.text.split('\n'))).toString();
        this.setValue_(this.text);
        this.notify({ originViewKey, changes, replacement: false });
    }

    setValue(next: string, originViewKey?: string): void {
        const changes = ChangeSet.of({ from: 0, to: this.text.length, insert: next }, this.text.length);
        this.text = next;
        this.setValue_(this.text);
        this.notify({ originViewKey, changes, replacement: true });
    }

    // No CM6 buffer to advance — collapse a ChangeSet to its resulting doc string.
    applyChanges(changes: ChangeSet, originViewKey?: string): void {
        this.text = changes.apply(Text.of(this.text.split('\n'))).toString();
        this.setValue_(this.text);
        this.notify({ originViewKey, changes, replacement: false });
    }

    // Fixed model tracks no anchors, so annotation mapping is a no-op: nothing to
    // seed, nothing survives or drops through an edit.
    setAnnotationRanges(_ranges: AnchorRange[]): void {}

    mapAnnotations(_changes: ChangeSet): AnnotationMapResult {
        return { survivors: [], dropped: [] };
    }

    trackRanges(_key: string, _ranges: AnchorRange[], _onMapped: TrackedMapListener): () => void {
        return () => {};
    }

    updateTrackedRanges(_key: string, _ranges: AnchorRange[]): void {}

    onChange(listener: ModelChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    kind(): TextSourceKind {
        return 'text';
    }

    getData(): TextSourceData {
        return { kind: 'text', text: this.text };
    }

    private notify(change: ModelChange): void {
        for (const l of this.listeners) l(change);
    }

    dispose(): void {
        this.listeners.clear();
    }
}
