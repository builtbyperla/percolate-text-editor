import { Accessor, createSignal, Setter } from 'solid-js';
import { EditorState, SelectionRange, ChangeSet, RangeSet, Text } from '@codemirror/state';
import { AnnotationAnchor, type AnchorRange, anchorsFrom } from './AnnotationAnchors';
import { codeFolding } from '@codemirror/language';
import { resolveLanguage } from '../editor/LanguageRouter';
import { validateFoldsOnChange } from '../editor/folding';

export interface AnnotationMapResult {
    survivors: AnchorRange[];
    dropped: string[];
}

export type TrackedMapListener = (result: AnnotationMapResult) => void;

interface TrackedAnchorSet {
    anchors: RangeSet<AnnotationAnchor>;
    onMapped: TrackedMapListener;
    subscribers: number;
}

export interface TextEdit {
    from: number;
    to: number;
    insert: string;
}

export type TextSourceKind = 'text' | 'diff';

export interface TextSourceData {
    kind: TextSourceKind;
    [extra: string]: unknown;
}

export interface ModelChange {
    originViewKey: string | undefined;
    changes: ChangeSet;
    /** True when callers intentionally replaced the document as a whole. */
    replacement: boolean;
}

export type ModelChangeListener = (change: ModelChange) => void;

export interface TextDataModel {
    /** Initial syntax/folding state; views own subsequent presentation changes. */
    foldingState?(): EditorState;
    // Reactive read of the full text. JSX / memos recompute when it changes.
    getValue: Accessor<string>;

    displayText: Accessor<string>;

    // Standard line-count convention (lines = \n count + 1; a trailing newline
    // counts its empty final line). Matches Monaco's getLineCount 1:1.
    getLineCount(): number;

    // 1-based line number containing char `offset`.
    lineAtOffset(offset: number): number;

    // Char offset of the first character of a 1-based line.
    lineStartOffset(line: number): number;

    // Immutable read of the current text — the edit↔annotate handoff reads this.
    snapshot(): { read(): string };

    applyEdit(edit: TextEdit, originViewKey?: string): void;

    // Replace the whole document (the setValue equivalent).
    setValue(next: string, originViewKey?: string): void;

    applyChanges(changes: ChangeSet, originViewKey?: string): void;

    setAnnotationRanges(ranges: AnchorRange[]): void;

    mapAnnotations(changes: ChangeSet): AnnotationMapResult;

    trackRanges(key: string, ranges: AnchorRange[], onMapped: TrackedMapListener): () => void;

    // Replace a tracked set's ranges in place (its listener is retained), for when the
    // subscriber's annotations change for a reason other than an edit — a new highlight.
    updateTrackedRanges(key: string, ranges: AnchorRange[]): void;

    // Subscribe to changes; returns an unsubscribe.
    onChange(listener: ModelChangeListener): () => void;

    kind(): TextSourceKind;
    getData(): TextSourceData;

    dispose(): void;
}

export class CmTextDataModel implements TextDataModel {
    getValue: Accessor<string>;

    // Raw == display for a plain buffer: nothing is stripped or glyphed between the
    // parser input and the string offsets are counted against.
    displayText: Accessor<string>;

    private setValue_: (next: string) => void;

    private state: EditorState;
    private listeners = new Set<ModelChangeListener>();

    private anchors: RangeSet<AnnotationAnchor> = RangeSet.empty;

    private trackedSets = new Map<string, TrackedAnchorSet>();

    private savedDoc: Text;
    private getDirty_: Accessor<boolean>;
    private setDirty_: Setter<boolean>;

    // Detached = watcher saw an unlink but the buffer is still open. A "dirty"
    // buffer whose backing file was deleted; save-from-detached recreates.
    private getDetached_: Accessor<boolean>;
    private setDetached_: Setter<boolean>;

    private getExternal_: Accessor<{ nextText: string } | null>;
    private setExternal_: Setter<{ nextText: string } | null>;

    static readonly DISK_ORIGIN = '__disk__';

    constructor(initialContent: string = '', sourceKey: string = '') {
        const languageKey = sourceKey.replace(/::(?:old|new)$/, '');
        this.state = EditorState.create({
            doc: initialContent,
            extensions: sourceKey
                ? [resolveLanguage(languageKey, initialContent) ?? [], codeFolding(), validateFoldsOnChange]
                : [],
        });
        const [get, set] = createSignal(initialContent);
        this.getValue = get;
        this.displayText = get;
        this.setValue_ = set;

        this.savedDoc = this.state.doc;
        [this.getDirty_, this.setDirty_] = createSignal(false);
        [this.getDetached_, this.setDetached_] = createSignal(false);
        [this.getExternal_, this.setExternal_] = createSignal<{ nextText: string } | null>(null);
    }

    foldingState(): EditorState {
        return this.state;
    }

    getLineCount(): number {
        return this.state.doc.lines;
    }

    lineAtOffset(offset: number): number {
        // Clamp: doc.lineAt throws out of [0, length]. CM6's line index is O(log n).
        const clamped = Math.max(0, Math.min(offset, this.state.doc.length));
        return this.state.doc.lineAt(clamped).number;
    }

    lineStartOffset(line: number): number {
        // Clamp to a valid 1-based line; doc.line throws out of [1, lines].
        const clamped = Math.max(1, Math.min(line, this.state.doc.lines));
        return this.state.doc.line(clamped).from;
    }

    snapshot(): { read(): string } {
        const text = this.state.doc.toString();
        return { read: () => text };
    }

    applyEdit(edit: TextEdit, originViewKey?: string): void {
        const tr = this.state.update({
            changes: { from: edit.from, to: edit.to, insert: edit.insert },
        });
        this.state = tr.state;
        this.setValue_(this.state.doc.toString());
        this.recomputeDirty();
        this.mapTrackedSets(tr.changes);
        this.notify({ originViewKey, changes: tr.changes, replacement: false });
    }

    setValue(next: string, originViewKey?: string): void {
        const tr = this.state.update({
            changes: { from: 0, to: this.state.doc.length, insert: next },
        });
        this.state = tr.state;
        this.setValue_(this.state.doc.toString());
        this.recomputeDirty();
        this.mapTrackedSets(tr.changes);
        this.notify({ originViewKey, changes: tr.changes, replacement: true });
    }

    applyChanges(changes: ChangeSet, originViewKey?: string): void {
        const tr = this.state.update({ changes });
        this.state = tr.state;
        this.setValue_(this.state.doc.toString());
        this.recomputeDirty();
        this.mapTrackedSets(changes);
        this.notify({ originViewKey, changes, replacement: false });
    }

    setAnnotationRanges(ranges: AnchorRange[]): void {
        this.anchors = anchorsFrom(ranges);
    }

    trackRanges(key: string, ranges: AnchorRange[], onMapped: TrackedMapListener): () => void {
        const existing = this.trackedSets.get(key);
        if (existing) {
            existing.subscribers++;
        } else {
            this.trackedSets.set(key, { anchors: anchorsFrom(ranges), onMapped, subscribers: 1 });
        }

        // Idempotent: a caller that untracks twice must not decrement twice and evict a
        // set its peers still need.
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const tracked = this.trackedSets.get(key);
            if (!tracked) return;
            tracked.subscribers--;
            if (tracked.subscribers <= 0) this.trackedSets.delete(key);
        };
    }

    updateTrackedRanges(key: string, ranges: AnchorRange[]): void {
        const tracked = this.trackedSets.get(key);
        if (tracked) tracked.anchors = anchorsFrom(ranges);
    }

    private mapTrackedSets(changes: ChangeSet): void {
        for (const tracked of this.trackedSets.values()) {
            const trackedIds = new Set<string>();
            const before = tracked.anchors.iter();
            while (before.value) { trackedIds.add(before.value.id); before.next(); }

            const mapped = tracked.anchors.map(changes);

            const survivors: AnchorRange[] = [];
            const after = mapped.iter();
            while (after.value) {
                if (after.to > after.from) survivors.push({ id: after.value.id, from: after.from, to: after.to });
                after.next();
            }

            const survivingIds = new Set(survivors.map(s => s.id));
            const dropped = [...trackedIds].filter(id => !survivingIds.has(id));

            // Keep only live-width anchors, so a collapsed one isn't re-reported next edit.
            tracked.anchors = anchorsFrom(survivors);
            tracked.onMapped({ survivors, dropped });
        }
    }

    mapAnnotations(changes: ChangeSet): AnnotationMapResult {
        const trackedIds = new Set<string>();
        {
            const it = this.anchors.iter();
            while (it.value) { trackedIds.add(it.value.id); it.next(); }
        }

        this.anchors = this.anchors.map(changes);

        // Survivors: still present with width. Their new offsets go back to the items.
        const survivors: AnchorRange[] = [];
        const survivingIds = new Set<string>();
        {
            const it = this.anchors.iter();
            while (it.value) {
                survivingIds.add(it.value.id);
                if (it.to > it.from) survivors.push({ id: it.value.id, from: it.from, to: it.to });
                it.next();
            }
        }

        // Dropped: tracked before, gone (dropped by the map) or collapsed to zero width
        // after. Pure id-set check over our OWN set — the sound deletion signal.
        const dropped: string[] = [];
        for (const id of trackedIds) {
            const survivor = survivors.find(s => s.id === id);
            if (!survivor) dropped.push(id); // absent, or present but zero-width
        }

        // Keep only live-width anchors so a collapsed one isn't re-reported next edit.
        this.anchors = anchorsFrom(survivors);

        return { survivors, dropped };
    }

    onChange(listener: ModelChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // Default source kind: a plain text buffer. The diff composite overrides these.
    kind(): TextSourceKind {
        return 'text';
    }

    getData(): TextSourceData {
        return { kind: 'text', text: this.getValue() };
    }

    // Dirty state accessor — flips on any mutation that moves state.doc away from
    // savedDoc, and back to clean when the user undoes to the checkpoint.
    isDirty(): Accessor<boolean> {
        return this.getDirty_;
    }

    // Detached = the backing file was deleted while the buffer is open. UI paints
    // this differently from ordinary dirty (save recreates the file).
    isDetached(): Accessor<boolean> {
        return this.getDetached_;
    }

    markSaved(): void {
        this.savedDoc = this.state.doc;
        this.setDirty_(false);
        this.setExternal_(null);
        this.setDetached_(false);
    }

    // Watcher-driven: the file on disk changed. Clean buffer → silently reload.
    // Dirty buffer → surface for UI reconciliation; user picks accept/dismiss.
    onDiskChanged(nextText: string): void {
        if (!this.getDirty_()) {
            this.setValue(nextText, CmTextDataModel.DISK_ORIGIN);
            this.savedDoc = this.state.doc;
            this.setDirty_(false);
            return;
        }
        this.setExternal_({ nextText });
    }

    // Watcher-driven: the backing file was deleted. The buffer stays in memory
    // and is marked detached; save-from-detached recreates the file on disk.
    onDiskDeleted(): void {
        this.setDetached_(true);
        if (!this.getDirty_()) this.setDirty_(true);
    }

    // Pending external-change accessor for the reconciliation UI. Null when no
    // external change is waiting.
    getExternalChange(): Accessor<{ nextText: string } | null> {
        return this.getExternal_;
    }

    acceptExternalChange(): void {
        const ext = this.getExternal_();
        if (!ext) return;
        this.setValue(ext.nextText, CmTextDataModel.DISK_ORIGIN);
        this.markSaved();
    }

    // User dismissed the external change: keep the in-memory buffer as-is,
    // clear the pending flag. The buffer remains dirty vs disk.
    dismissExternalChange(): void {
        this.setExternal_(null);
    }

    private recomputeDirty(): void {
        this.setDirty_(!this.state.doc.eq(this.savedDoc));
    }

    private notify(change: ModelChange): void {
        // Each listener decides whether to apply the exact ChangeSet or skip its
        // own edit. Keeping it intact lets peer EditorStates map presentation.
        for (const l of this.listeners) l(change);
    }

    dispose(): void {
        this.listeners.clear();
    }
}
