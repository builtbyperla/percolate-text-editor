import { EditorView, keymap, BlockInfo, BlockType } from '@codemirror/view';
import { EditorState, SelectionRange, Compartment, Extension, ChangeSet, StateEffect } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { codeFolding, foldKeymap, forceParsing, indentUnit, indentOnInput } from '@codemirror/language';
import { EDITOR_THEMES, EditorThemeName } from './editorThemes';
import { TextDataModel } from '../textmodel/TextDataModel';
import { CmViewBinding } from './CmViewBinding';
import { idService } from '../IdService';
import { Accessor, Component, Setter, createSignal } from 'solid-js';
import { resolveLanguage } from './LanguageRouter';
import { detectIndentUnit } from './detectIndent';
import { ContextItem } from '../annotation/ContextItem';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import { userSettings } from '../UserSettings';
import { foldInfoForLine, FoldingController, setFoldInView, toggleFoldAtLine, unfoldLineInView, validateFoldsOnChange } from './folding';
import { coreTypingExtensions, coreTypingKeymap } from './editorInput';
import { transientEditorUIExtensions, transientEditorUIKeymap } from './editorTransientUI';

// Single source of truth for the editor font.
export const EDITOR_FONT = {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: 450,
} as const;

const fontTheme = EditorView.theme({
    '&': { height: 'auto' },
    '.cm-scroller': {
        fontFamily: EDITOR_FONT.fontFamily,
        fontSize: `${EDITOR_FONT.fontSize}px`,
        lineHeight: `${EDITOR_FONT.lineHeight}px`,
        fontWeight: `${EDITOR_FONT.fontWeight}`,
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        overflow: 'visible',
    },
    '.cm-content': {
        fontFamily: EDITOR_FONT.fontFamily,
        fontWeight: `${EDITOR_FONT.fontWeight}`,
    },
});

const listenerComp = new Compartment();
const diffComp = new Compartment();
// EditorState is handed to a newly-created frame during mode and tab transitions.
// These identities must therefore outlive any one CmEditorFrame instance.
const languageComp = new Compartment();
const indentationComp = new Compartment();
const themeComp = new Compartment();

export interface EditorRulerRow {
    line: number;
    top: number;
    foldable: boolean;
    folded: boolean;
}

/**
 * A block widget immediately before a line is returned by CM6 as a composite
 * line block whose outer top is the widget's top. The ruler belongs beside the
 * text child, not beside that preceding widget.
 */
export function rulerTextBlock(block: BlockInfo): BlockInfo | null {
    const type = block.type;
    if (type === BlockType.Text) return block;
    if (!Array.isArray(type)) return null;
    for (const child of type) {
        const text = rulerTextBlock(child);
        if (text) return text;
    }
    return null;
}

export class CmEditorFrame {
    private model: TextDataModel;
    private sourceKey: string;
    private theme: EditorThemeName;

    // Unique per editor view (not the source key): identifies this view in the
    // model's fan-out so it can be excluded as the originator of its own edits.
    private viewKey: string;

    private view: EditorView | null = null;
    private binding: CmViewBinding | null = null;
    private elementRef!: HTMLDivElement;

    // Scroll offset to restore once the view is created (mode-switch handoff).
    private pendingScroll = 0;

    // A 1-based line to reveal once the view is created, for a reveal that arrived before this frame existed (search-opening a file that wasn't already open).
    private pendingReveal: number | null = null;

    private getScroller: () => HTMLElement | null;

    // For cursor selections to reflect in ruler
    getSelectionRanges: Accessor<SelectionRange[]>;
    private setSelections_: Setter<SelectionRange[]>;

    private initialState: EditorState | null;

    private diffExtension: Extension | (() => Extension);

    private onRemap: () => void;

    private onSave: () => void;

    private onStateChange: (state: EditorState) => void;

    private foldingEnabled: boolean;
    private foldingController: FoldingController | null;

    readonly rulerRows: Accessor<EditorRulerRow[]>;
    private setRulerRows: Setter<EditorRulerRow[]>;
    readonly rulerContentHeight: Accessor<number>;
    private setRulerContentHeight: Setter<number>;

    constructor(model: TextDataModel,
        getScroller: () => HTMLElement | null = () => null,
        sourceKey: string = '',
        initialState: EditorState | null = null,
        diffExtension: Extension | (() => Extension) = [],
        onRemap: () => void = () => {},
        onSave: () => void = () => {},
        foldingEnabled: boolean = true,
        foldingController: FoldingController | null = null,
        onStateChange: (state: EditorState) => void = () => {})
    {
        this.model = model;
        this.sourceKey = sourceKey;
        this.theme = userSettings.editorTheme();
        this.viewKey = idService.requestId();
        this.getScroller = getScroller;
        this.initialState = initialState;
        this.diffExtension = diffExtension;
        this.onRemap = onRemap;
        this.onSave = onSave;
        this.foldingEnabled = foldingEnabled;
        this.foldingController = foldingController;
        this.onStateChange = onStateChange;
        [this.getSelectionRanges, this.setSelections_] = createSignal<SelectionRange[]>([]);
        [this.rulerRows, this.setRulerRows] = createSignal<EditorRulerRow[]>([]);
        [this.rulerContentHeight, this.setRulerContentHeight] = createSignal(0);
    }

    getEditorState(): EditorState | null {
        return this.view?.state ?? null;
    }

    setup(el: HTMLDivElement) {
        this.elementRef = el;
        if (this.binding) return;

        const cached = this.initialState;
        this.initialState = null; // one-shot: never reused past this mount
        const reuse = cached != null && cached.doc.toString() === this.model.getValue();
        const unit = detectIndentUnit(this.model.getValue());
        const tabSize = unit === '\t' ? 4 : unit.length;
        const indentation = [indentUnit.of(unit), EditorState.tabSize.of(tabSize)];
        const language = resolveLanguage(this.sourceKey, this.model.getValue()) ?? [];

        // Keep the full editor configuration separate from state creation: a
        // reader-first state already has the document, parser, and fold field,
        // but still needs the editor's input, UI, and listener extensions.
        const fullExtensions: Extension = [
            history(),
            keymap.of([
                ...transientEditorUIKeymap,
                ...coreTypingKeymap,
                { key: 'Mod-s', run: () => { this.onSave(); return true; } },
                ...(this.foldingEnabled ? foldKeymap : []),
                ...defaultKeymap,
                ...historyKeymap,
            ]),
            indentationComp.of(indentation),
            indentOnInput(),
            coreTypingExtensions,
            transientEditorUIExtensions,
            ...(this.foldingEnabled ? [codeFolding(), validateFoldsOnChange] : []),
            languageComp.of(language),
            themeComp.of(EDITOR_THEMES[this.theme]),
            fontTheme,
            listenerComp.of(this.buildListener()),
            diffComp.of(this.currentDiffExtension()),
        ];

        // Reconfigure a reader-first state in place to retain its folds. A state
        // handed off from a previous editor mount already has these extensions.
        const state = reuse
            ? listenerComp.get(cached!) === undefined
                ? cached!.update({ effects: StateEffect.reconfigure.of(fullExtensions) }).state
                : cached!
            : EditorState.create({ doc: this.model.getValue(), extensions: fullExtensions });
        const reveal = this.pendingReveal;
        this.pendingReveal = null;

        const targetLine = Math.min(
            reveal ?? Math.floor(this.pendingScroll / EDITOR_FONT.lineHeight) + 1,
            state.doc.lines,
        );
        const scrollPos = state.doc.line(targetLine).from;
        this.view = new EditorView({
            state,
            parent: this.elementRef,
            scrollTo: EditorView.scrollIntoView(scrollPos, { y: reveal != null ? 'center' : 'start' }),
        });
        this.binding = new CmViewBinding(this.view, this.model, this.viewKey);

        // A reused EditorState already carries its selection. Seed the ruler-facing
        // signal immediately instead of waiting for a later selection transaction.
        this.setSelections_([...state.selection.ranges]);

        if (reveal != null) {
            this.view.dispatch({ selection: { anchor: scrollPos } });
        }

        if (reuse) {
            this.view.dispatch({ effects: [
                listenerComp.reconfigure(this.buildListener()),
                diffComp.reconfigure(this.currentDiffExtension()),
                languageComp.reconfigure(language),
                indentationComp.reconfigure(indentation),
                themeComp.reconfigure(EDITOR_THEMES[this.theme]),
            ] });
        } else {
            forceParsing(this.view, this.view.viewport.to, 50);
        }
        this.scheduleRulerMeasure();
        if (reveal == null) {
            // Capture this frame's mounted scroller. A rapid mode/tab transition can
            // replace the host's active-scroller pointer before the callback runs.
            const mountedScroller = this.getScroller();
            requestAnimationFrame(() => {
                if (mountedScroller) mountedScroller.scrollTop = this.pendingScroll;
            });
        }
        this.onStateChange(this.view.state);

    }

    private currentDiffExtension(): Extension {
        return typeof this.diffExtension === 'function'
            ? this.diffExtension()
            : this.diffExtension;
    }

    /** Reconfigure theme-bearing extensions without replacing the view or its state. */
    setTheme(theme: EditorThemeName): void {
        if (theme === this.theme) return;
        this.theme = theme;
        this.view?.dispatch({ effects: [
            themeComp.reconfigure(EDITOR_THEMES[theme]),
            diffComp.reconfigure(this.currentDiffExtension()),
        ] });
    }

    // The doc/selection updateListener, bound to this frame's viewKey and binding.
    // Rebuilt (not shared) so a reused state can swap in one bound to the live frame.
    private buildListener() {
        return EditorView.updateListener.of((u) => {
            if (u.docChanged && !this.binding?.isApplyingRemote()) {
                this.reconcileAnnotations(u.changes);
            }
            if (u.selectionSet) {
                this.setSelections_([...u.state.selection.ranges]);
            }
            if (this.foldingEnabled && (u.docChanged || u.viewportChanged || u.geometryChanged)) {
                this.scheduleRulerMeasure();
            }
            // Publish before coordination. A coordinator may synchronously dispatch
            // a corrective transaction, whose nested update must remain the newest.
            this.onStateChange(u.state);
            if (this.foldingEnabled && this.foldingController?.onChange) {
                this.foldingController.onChange(u.startState, u.state);
            }
        });
    }

    private scheduleRulerMeasure(): void {
        const view = this.view;
        if (!view || !this.foldingEnabled) return;

        view.requestMeasure({
            read: (measuredView) => {
                const rows: EditorRulerRow[] = [];
                let lastLine = -1;

                for (const block of measuredView.viewportLineBlocks) {
                    const textBlock = rulerTextBlock(block);
                    if (!textBlock) continue;
                    const line = measuredView.state.doc.lineAt(textBlock.from).number;
                    if (line === lastLine) continue;
                    lastLine = line;

                    const fold = this.foldingController
                        ? this.foldingController.info(measuredView.state, line)
                        : foldInfoForLine(measuredView.state, line);
                    rows.push({
                        line,
                        top: textBlock.top,
                        foldable: fold != null,
                        folded: fold?.folded ?? false,
                    });
                }

                const padding = measuredView.documentPadding;
                return {
                    rows,
                    contentHeight: Math.max(0, measuredView.contentHeight - padding.top - padding.bottom),
                };
            },
            write: ({ rows, contentHeight }) => {
                this.setRulerRows(rows);
                this.setRulerContentHeight(contentHeight);
            },
        });
    }

    toggleFold(line: number): boolean {
        if (!this.view || !this.foldingEnabled) return false;
        return this.foldingController?.toggle(this.view, line)
            ?? toggleFoldAtLine(this.view, line);
    }

    setFold(line: number, folded: boolean): boolean {
        if (!this.view || !this.foldingEnabled) return false;
        return setFoldInView(this.view, line, folded);
    }

    refreshRuler(): void {
        this.scheduleRulerMeasure();
    }

    private reconcileAnnotations(changes: ChangeSet): void {
        const items = sourceContextRegistry.itemsFor(this.sourceKey);
        const byId = new Map<string, ContextItem>();

        const seed: { id: string; from: number; to: number }[] = [];
        for (const item of items) {
            const r = item.getRange();
            if (r == null) continue; // whole-file: no anchor to map
            byId.set(item.metadata.id, item);
            seed.push({ id: item.metadata.id, from: r.start, to: r.end });
        }
        this.model.setAnnotationRanges(seed);

        const { survivors, dropped } = this.model.mapAnnotations(changes);

        for (const s of survivors) {
            const item = byId.get(s.id);
            if (item) item.setRange(s.from, s.to);
        }

        // Remove the ids the map itself dropped/collapsed (real deletions from this
        // edit) in ONE batch: N deletions cost one rebuild per listener, not N.
        const doomed = dropped.map(id => byId.get(id)).filter((i): i is ContextItem => i != null);
        if (doomed.length > 0) {
            sourceContextRegistry.removeList(doomed);
        }

        this.model.applyChanges(changes, this.viewKey);

        this.onRemap();
    }

    getModel(): TextDataModel {
        return this.model;
    }

    // Current vertical scroll, captured at teardown for the mode-switch handoff.
    // The wrapper is the scroller now, so read it (not view.scrollDOM).
    getScrollTop(): number {
        return this.getScroller()?.scrollTop ?? 0;
    }

    // Stash a scroll offset to apply once the view is created (see setup).
    applyInitialScroll(top: number) {
        this.pendingScroll = top;
    }

    // Stash a 1-based line to reveal once the view is created (see setup), for a reveal raised before this frame existed.
    applyInitialReveal(line: number | null) {
        this.pendingReveal = line;
    }

    setScrollTop(top: number) {
        const scroller = this.getScroller();
        if (scroller) scroller.scrollTop = top;
        this.pendingScroll = top;
    }

    scrollToLineTop(top: number) {
        this.getScroller()?.scrollTo({ top });
    }

    // Put the caret on a 1-based line so the active-line band marks it — the reveal's only highlight, and the editor half's alone (the annotator has no caret to place).
    revealLine(line: number): void {
        if (!this.view) return;

        unfoldLineInView(this.view, line);
        const doc = this.view.state.doc;
        const pos = doc.line(Math.min(Math.max(line, 1), doc.lines)).from;
        this.view.dispatch({ selection: { anchor: pos } });
    }

    dispose() {
        this.binding?.dispose();
        this.binding = null;
        this.view?.destroy();
        this.view = null;
    }

}

export const CmEditorFrameVisual: Component<{ value: CmEditorFrame }> = props => {
    const synchronizeTheme = () => {
        const theme = userSettings.editorTheme();
        props.value.setTheme(theme);
        return theme;
    };
    return (
        <div
            ref={el => props.value.setup(el)}
            data-editor-theme={synchronizeTheme()}
            style={{
                'min-width': '0',
                height: 'auto',
                width: '100%',
                'padding-bottom': '60vh',
            }}
        />
    );
};
