import { TabAction, TabDecoration, ViewBlock, Editor, SearchData } from '../containers/Tabs';
import { DecorationProducer } from '../containers/tabDecorations';
import { JSX } from 'solid-js/jsx-runtime';
import { textModelRegistry } from '../textmodel/TextModelRegistry';
import { CmTextDataModel, ModelChange, TextDataModel } from '../textmodel/TextDataModel';
import { saveModel } from '../textmodel/saveModel';
import type { FileSystemProvider } from '../fileexplorer/FileSystemProvider';
import { promptConfirm } from '../appcore/promptConfirm';
import { Accessor, Component, Setter, For, batch, createSignal, Show, createMemo, onCleanup } from 'solid-js';
import { ChevronDown, ChevronRight, CircleMinus, CirclePlus, ClipboardMinus, ClipboardPlus, Zap } from 'lucide-solid';
import appStyles from '../styles/App.module.css';
import { InnerText, makeFragment, Decoration } from '../annotation/TextViewCore';
import { RenderUnitVisual } from '../annotation/TextRenderVisuals';
import { RenderLayer, RenderUnit, BuildInput, BuildResult } from '../annotation/RenderLayer';
import { AnnotationTextView, HighlightAnchorSupplInfo } from '../annotation/AnnotationTextView';
import { ContextItem, ContextView, PREVIEW_CHARS } from '../annotation/ContextItem';
import { NoteCoordinator } from '../annotation/AnnotationVisualFrames';
import { SyntaxToken, clipSyntaxTokens, tokenize, syntaxPalette } from './SyntaxTokens';
import { THEME_FOREGROUNDS } from './editorThemes';
import { sourceContextRegistry } from '../interactions/SourceContextRegistry';
import { registrySources, SourceListener } from '../interactions/RegistrySources';
import { contextRegistry } from '../interactions/ContextRegistry';
import roStyles from '../styles/EditorAnnotation.module.css'
import { userSettings } from '../UserSettings';
import { CmEditorFrame, CmEditorFrameVisual, EDITOR_FONT, EditorRulerRow } from './CmEditorFrame';
import { EditorState, Extension } from '@codemirror/state';
import { RangesDataModel } from './RangesDataModel';
import { textSelectionManager } from '../interactions/TextSelectionManager';
import { idService } from '../IdService';
import { FoldLineProjection, FoldSnapshot, FoldingController, foldInfoForLine, setFoldInState, toggleFoldInState, unfoldLineInState } from './folding';
import { EditorViewStateHost } from './EditorViewStateHost';

class AnnotatorRenderLayer extends RenderLayer {
    private tokens: SyntaxToken[] = [];
    private tokenizedText: string | null = null;

    private getFolds: Accessor<FoldSnapshot[]> = () => [];
    private onToggleFold: (line: number) => void = () => {};

    constructor(private sourceId: string) {
        super();
    }

    configureFolding(getFolds: Accessor<FoldSnapshot[]>, onToggleFold: (line: number) => void): void {
        this.getFolds = getFolds;
        this.onToggleFold = onToggleFold;
    }

    private refreshTokens(text: string) {
        // Highlight changes rebuild sections without changing the text. Syntax
        // classes are stable across themes, so only source edits require a parse.
        if (text === this.tokenizedText) return;
        this.tokenizedText = text;
        try {
            this.tokens = tokenize(text, this.sourceId);
        } catch {
            this.tokens = [];
        }
    }

    private sliceDecorations(viewFrom: number, viewTo: number): Decoration[] {
        const clipped = clipSyntaxTokens(this.tokens, viewFrom, viewTo);
        const out: Decoration[] = [];
        for (const tok of clipped) {
            out.push({ from: tok.from, to: tok.to, className: tok.className });
        }
        return out;
    }

    // Split into lines, keeping the trailing "\n" on each (String.split drops them,
    // and we need the endings to rebuild text faithfully).
    protected splitLines(text: string): string[] {
        const lines: string[] = [];
        let left = 0;
        for (const m of text.matchAll(/\n/g)) {
            lines.push(text.slice(left, m.index + 1));
            left = m.index + 1;
        }
        if (left < text.length) {
            lines.push(text.slice(left));
        }
        return lines;
    }

    // The row class every unit this layer emits wears.
    protected lineClass(): string {
        return roStyles.line;
    }

    private annotationCount(fold: FoldSnapshot): number {
        let count = 0;
        for (const item of sourceContextRegistry.itemsFor(this.sourceId)) {
            const range = item.getRange();
            if (range && range.start < fold.to && fold.from < range.end) count++;
        }
        return count;
    }

    private foldPlaceholder(fold: FoldSnapshot, position: number, parent: AnnotationTextView) {
        const annotations = this.annotationCount(fold);
        const lineLabel = `${fold.hiddenLines} ${fold.hiddenLines === 1 ? 'line' : 'lines'}`;
        const annotationLabel = annotations > 0
            ? ` · ${annotations} ${annotations === 1 ? 'note' : 'notes'}`
            : '';
        return makeFragment({
            // The placeholder is a visual replacement, not document content. Its
            // empty source string keeps DOM selection from inventing offsets.
            text: '',
            position,
            parent,
            segStart: fold.from,
            renderer: {
                render: () => (
                    <button
                        type="button"
                        class={roStyles.foldPlaceholder}
                        data-fold-from={fold.from}
                        data-fold-to={fold.to}
                        aria-label={`Unfold ${lineLabel}${annotationLabel}`}
                        title={`Unfold ${lineLabel}${annotationLabel}`}
                        onpointerdown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onclick={(e) => { e.stopPropagation(); this.onToggleFold(fold.startLine); }}
                    >
                        <span aria-hidden="true">⋯</span>
                        <span class={roStyles.foldPlaceholderLabel}>{lineLabel}{annotationLabel}</span>
                    </button>
                ),
            },
        });
    }

    buildUnits(input: BuildInput, _from: number, _to: number): BuildResult {
        this.refreshTokens(input.dataSource.getValue());

        const units: RenderUnit[] = [];
        const sourceLines: number[] = [];
        let currentLine = input.dataSource.lineAtOffset(_from);
        let rowSourceLine = currentLine;
        let current = new RenderUnit([], this.lineClass());
        let segmentCount = 0;
        const folds = this.getFolds();

        const emitText = (text: string, segStart: number, isPlain: boolean,
                          ctx: ContextItem | null, note: NoteCoordinator | null) => {
            let pieceStart = segStart;
            const lines = this.splitLines(text);
            for (const line of lines) {
                const pieceEnd = pieceStart + line.length;
                const decorations = this.sliceDecorations(pieceStart, pieceEnd);
                current.addSegment(makeFragment({
                    text: line, position: segmentCount++, parent: input.parent,
                    segStart: pieceStart,
                    decorations,
                    context: isPlain ? undefined : (ctx ?? undefined),
                    noteable: note,
                }));
                pieceStart = pieceEnd;

                // A visible newline closes the current visual row. Newlines inside
                // a fold never reach this path, which joins the closing text onto
                // the same row exactly like CodeMirror's replacement decoration.
                if (line.endsWith("\n")) {
                    units.push(current);
                    sourceLines.push(rowSourceLine);
                    currentLine++;
                    rowSourceLine = currentLine;
                    current = new RenderUnit([], this.lineClass());
                }
            }
        };

        // A section boundary is ALWAYS a cut (§3.2), so cuts happen only within a
        // section and every fragment has exactly one unambiguous frame.
        for (const fullSeg of input.sections) {
            const text = fullSeg.getText();
            const segFrom = fullSeg.segStart;
            const segTo = segFrom + text.length;
            const isPlain = fullSeg.isPlainText();
            const ctx = fullSeg.getContextItem();
            const note = fullSeg.getNoteInterface();

            // Open this frame's span pass: emitLine mints fresh fragments that
            // register as they render, so clear the previous pass first.
            note?.resetRegistry();

            let cursor = segFrom;
            for (const fold of folds) {
                if (fold.to <= cursor) continue;
                if (fold.from >= segTo) break;

                const visibleTo = Math.min(fold.from, segTo);
                if (visibleTo > cursor) {
                    emitText(text.slice(cursor - segFrom, visibleTo - segFrom), cursor, isPlain, ctx, note);
                }

                // Emit the replacement once, from whichever source section owns
                // the fold's opening boundary. Following sections covered by the
                // same fold simply advance their cursor without rendering.
                if (fold.from >= segFrom && fold.from < segTo) {
                    current.addSegment(this.foldPlaceholder(fold, segmentCount++, input.parent));
                }
                // The folded text is still part of the source. Advance its
                // line count without making visible rows for hidden newlines.
                const hiddenFrom = Math.max(cursor, fold.from);
                const hiddenTo = Math.min(fold.to, segTo);
                for (let offset = hiddenFrom; offset < hiddenTo; offset++) {
                    if (text[offset - segFrom] === "\n") currentLine++;
                }
                cursor = Math.max(cursor, fold.to);
                if (cursor >= segTo) break;
            }

            if (cursor < segTo) {
                emitText(text.slice(cursor - segFrom), cursor, isPlain, ctx, note);
            }
        }

        // Tail row
        if (current.numSegments() > 0) {
            units.push(current);
            sourceLines.push(rowSourceLine);
        }
        return { units, sourceLines };
    }
}

class AnnotatorInnerText extends InnerText<AnnotatorRenderLayer> {
    public getLineDragRange: Accessor<{ lo: number; hi: number } | null>;
    public getLineHoverLine: Accessor<number | null>;
    public visualTopForLine: (line: number) => number;
    public visualHeightForRange: (lo: number, hi: number) => number;

    constructor(parent: AnnotationTextView,
                getLineDragRange: Accessor<{ lo: number; hi: number } | null>,
                getLineHoverLine: Accessor<number | null>,
                visualTopForLine: (line: number) => number = line => (line - 1) * EDITOR_FONT.lineHeight,
                visualHeightForRange: (lo: number, hi: number) => number = (lo, hi) => (hi - lo + 1) * EDITOR_FONT.lineHeight,
                text?: string, layer?: AnnotatorRenderLayer) {
        super(parent, text, layer ?? new AnnotatorRenderLayer(parent.sourceId));
        this.getLineDragRange = getLineDragRange;
        this.getLineHoverLine = getLineHoverLine;
        this.visualTopForLine = visualTopForLine;
        this.visualHeightForRange = visualHeightForRange;
        // Phase 2 (§2.2): the layer is wired, so the first build is fully painted.
        this.extendedSetup();
    }

    configureFolding(getFolds: Accessor<FoldSnapshot[]>, onToggleFold: (line: number) => void): void {
        this.renderLayer.configureFolding(getFolds, onToggleFold);
        this.rebuildUnits();
    }

}

const AnnotatorInnerTextVisual: Component<{value: AnnotatorInnerText}> = props => {
    return (
        <div class={`${roStyles.textView} txt-inner`} data-linemode={userSettings.annotationSelectMode() === 'line'} ref={el => props.value.setFrameEl(el)}>

            <Show when={!props.value.getLineDragRange() && props.value.getLineHoverLine()}>
                {line => (
                    <div
                        class={roStyles.lineHoverOverlay}
                        style={{
                            top: `${props.value.visualTopForLine(line())}px`,
                            height: `${EDITOR_FONT.lineHeight}px`,
                        }}
                    />
                )}
            </Show>

            <Show when={props.value.getLineDragRange()}>
                {range => (
                    <div
                        class={roStyles.lineDragOverlay}
                        style={{
                            top: `${props.value.visualTopForLine(range().lo)}px`,
                            height: `${props.value.visualHeightForRange(range().lo, range().hi)}px`,
                        }}
                    />
                )}
            </Show>

            <For each={props.value.getUnits()}>
                {unit => <RenderUnitVisual value={unit} />}
            </For>
        </div>
    );
}

interface RulerProps {
    lineCount: Accessor<number>;
    // Visible line window {first (0-based), count} the ruler should render.
    window: Accessor<{ first: number; count: number }>;
    annotateCallback: () => void;
    editMode: boolean;
    selectedLines?: Accessor<Set<number>>;
    contextLines?: Accessor<Set<number>>;
    // Edit-mode only: clicking a selected line's marker icon quick-tags the
    // selection (separate from the ruler-body toggle).
    markerCallback?: () => void;
    ranges?: RangesDataModel;
    // Edit-mode rows come from CM6's measured visual blocks. Unlike source-line
    // arithmetic, these remain correct when folds or block widgets change height.
    editorRows?: Accessor<EditorRulerRow[]>;
    editorContentHeight?: Accessor<number>;
    foldCallback?: (line: number) => void;
}

type TextViewMode = 'edit' | 'annotate';

interface ModeOverride {
    mode: TextViewMode;
    reason: 'quick-edit';
    lockRevision: number;
}

interface ViewHandoff {
    scrollTop: number;
    revealLine: number | null;
}

interface ViewportMetrics {
    scrollTop: number;
    height: number;
}

class ViewportTracker {
    private getMetrics: Accessor<ViewportMetrics>;
    private setMetrics: Setter<ViewportMetrics>;
    private detach: (() => void) | null = null;

    constructor() {
        [this.getMetrics, this.setMetrics] = createSignal<ViewportMetrics>({
            scrollTop: 0,
            height: 0,
        });
    }

    attach(el: HTMLDivElement): void {
        this.dispose();

        const update = () => {
            this.setMetrics({ scrollTop: el.scrollTop, height: el.clientHeight });
        };
        update();

        el.addEventListener('scroll', update, { passive: true });
        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(update);
        resizeObserver?.observe(el);

        this.detach = () => {
            el.removeEventListener('scroll', update);
            resizeObserver?.disconnect();
        };
    }

    height(): number {
        return this.getMetrics().height;
    }

    visibleWindow(lineCount: number, ranges?: RangesDataModel): { first: number; count: number } {
        const row = EDITOR_FONT.lineHeight;
        const { scrollTop, height } = this.getMetrics();

        // Before layout, render the full ruler so the first paint is never empty.
        if (height <= 0) return { first: 0, count: lineCount };

        const viewportLines = Math.ceil(height / row);
        const overscan = viewportLines;
        const topLine = ranges
            ? ranges.lineAtPx(scrollTop) - 1
            : Math.floor(scrollTop / row);
        const first = Math.max(0, topLine - overscan);
        const visible = viewportLines + overscan * 2;
        const count = Math.max(0, Math.min(lineCount - first, visible));
        return { first, count };
    }

    dispose(): void {
        this.detach?.();
        this.detach = null;
    }
}

class RulerMetrics {
    private row = EDITOR_FONT.lineHeight;

    constructor(private props: RulerProps) {}

    visibleRows(): EditorRulerRow[] {
        const measured = this.props.editorRows?.() ?? [];
        if (measured.length > 0) return measured;
        const { first, count } = this.props.window();
        return Array.from({ length: count }, (_, i) => {
            const line = first + i + 1;
            return { line, top: this.fallbackLineTop(line), foldable: false, folded: false };
        });
    }

    windowLineNumbers(): number[] {
        return this.visibleRows().map(row => row.line);
    }

    // Absolute pixel Y of a 1-based line — the ruler's ONLY source of position.
    lineTop(line: number): number {
        const measured = this.props.editorRows?.() ?? [];
        const row = measured.find(candidate => candidate.line === line);
        if (row) return row.top;
        return this.fallbackLineTop(line);
    }

    private fallbackLineTop(line: number): number {
        const r = this.props.ranges;
        if (!r) return (line - 1) * this.row;
        return r.lineTop(line) + this.spacerAt(line);
    }

    // Spacer height stamped directly above a 1-based line (0 when none).
    private spacerAt(line: number): number {
        const r = this.props.ranges;
        if (!r) return 0;
        let total = 0;
        for (const x of r.ranges()) {
            if (x.beforeLine === line) total += x.heightPx;
        }
        return total;
    }

    columnHeight(): number {
        const measured = this.props.editorContentHeight?.() ?? 0;
        if (measured > 0) return measured;
        const r = this.props.ranges;
        return r ? r.columnHeight(this.props.lineCount()) : this.props.lineCount() * this.row;
    }

    lineDigits(): number {
        return Math.max(3, String(this.props.lineCount()).length);
    }

    hasContext(line: number): boolean {
        return this.props.contextLines?.().has(line) ?? false;
    }

    runOverlapsSelection(line: number): boolean {
        const ctx = this.props.contextLines?.();
        const sel = this.props.selectedLines?.();
        if (!ctx || !sel || !ctx.has(line)) return false;
        let lo = line;
        while (ctx.has(lo - 1)) lo--;
        let hi = line;
        while (ctx.has(hi + 1)) hi++;
        for (let l = lo; l <= hi; l++) if (sel.has(l)) return true;
        return false;
    }

    selectionRuns(): { lines: number[]; top: number; height: number }[] {
        const selected = this.props.selectedLines?.() ?? new Set<number>();
        const runs: { lines: number[]; top: number; height: number }[] = [];
        let current: { lines: number[]; top: number; bottom: number } | null = null;

        for (const row of this.visibleRows()) {
            if (selected.has(row.line)) {
                if (current && Math.abs(row.top - current.bottom) < 0.5) {
                    current.lines.push(row.line);
                    current.bottom = row.top + this.row;
                } else {
                    if (current) runs.push({ lines: current.lines, top: current.top, height: current.bottom - current.top });
                    current = { lines: [row.line], top: row.top, bottom: row.top + this.row };
                }
                continue;
            }
            if (current) {
                runs.push({ lines: current.lines, top: current.top, height: current.bottom - current.top });
                current = null;
            }
        }
        if (current) runs.push({ lines: current.lines, top: current.top, height: current.bottom - current.top });
        return runs;
    }
}

// Direct Solid ruler. Its inputs are memoized coarsely: a selection/context change
// rebuilds the affected arrays and sets, without introducing per-marker stores.
const Ruler: Component<RulerProps> = props => {
    const emptyLines = new Set<number>();
    const selectedLines = createMemo(() => props.selectedLines?.() ?? emptyLines);
    const contextLines = createMemo(() => props.contextLines?.() ?? emptyLines);
    const metrics = new RulerMetrics({
        ...props,
        selectedLines,
        contextLines,
    });

    const windowLineNumbers = createMemo(() => metrics.windowLineNumbers());
    const selectionRuns = createMemo(() => metrics.selectionRuns());
    const contextMarkerLines = createMemo(() => windowLineNumbers()
        .filter(line => contextLines().has(line) && !selectedLines().has(line)));

    const marker = (line: number, runTop: number, selected: boolean) => (
        <div
            class={roStyles.selectionMarker}
            style={{ top: `${metrics.lineTop(line) - runTop}px` }}
        >
            <Show when={selected}>
                <Zap size={12} />
            </Show>
            <Show when={metrics.hasContext(line) && !selected}>
                <div
                    class={roStyles.contextBar}
                    data-active={metrics.runOverlapsSelection(line)}
                />
            </Show>
        </div>
    );

    return (
        <div class={roStyles.ruler} data-editmode={props.editMode} onclick={props.annotateCallback}>
            <div class={roStyles.gutter}>
                <div class={roStyles.selectionColumn} style={{ height: `${metrics.columnHeight()}px` }}>
                    <For each={contextMarkerLines()}>
                        {line => marker(line, 0, false)}
                    </For>
                    <For each={selectionRuns()}>
                        {run => (
                            <div
                                class={roStyles.selectionRun}
                                style={{ top: `${run.top}px`, height: `${run.height}px` }}
                                onclick={(e) => { e.stopPropagation(); props.markerCallback?.(); }}
                            >
                                <For each={run.lines}>
                                    {line => marker(line, run.top, true)}
                                </For>
                            </div>
                        )}
                    </For>
                </div>

                <div
                    class={roStyles.lineColumn}
                    style={{
                        height: `${metrics.columnHeight()}px`,
                        width: `${metrics.lineDigits()}ch`,
                        "flex-grow": 0,
                    }}
                >
                    <For each={windowLineNumbers()}>
                        {line => (
                            <div data-stripe={line % 2 === 0} style={{ top: `${metrics.lineTop(line)}px` }}>
                                {line.toString().padStart(metrics.lineDigits())}
                            </div>
                        )}
                    </For>
                </div>
            </div>
            <div class={roStyles.foldColumn} style={{ height: `${metrics.columnHeight()}px` }}>
                <For each={metrics.visibleRows().filter(row => row.foldable)}>
                    {row => (
                        <button
                            type="button"
                            class={roStyles.foldToggle}
                            data-folded={row.folded}
                            style={{ top: `${row.top}px` }}
                            aria-label={`${row.folded ? 'Unfold' : 'Fold'} line ${row.line}`}
                            title={row.folded ? 'Unfold region' : 'Fold region'}
                            onpointerdown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onclick={(e) => { e.stopPropagation(); props.foldCallback?.(row.line); }}
                        >
                            <Show when={row.folded} fallback={<ChevronDown size={13} />}>
                                <ChevronRight size={13} />
                            </Show>
                        </button>
                    )}
                </For>
            </div>
        </div>
    );
};

interface AnnotatorHost {
    getLineCount: Accessor<number>;
    getLineDragRange: Accessor<{ lo: number; hi: number } | null>;
    getLineHoverLine: Accessor<number | null>;
    setLineDragRange: Setter<{ lo: number; hi: number } | null>;
    setLineHoverLine: Setter<number | null>;
    rangeForLines(lo: number, hi: number): [number, number];
    sourceLineAtPixel(y: number): number;
    visualTopForSourceLine(line: number): number;
    visualHeightForSourceRange(lo: number, hi: number): number;
    scrollToItem(item: ContextItem): void;
}

class AnnotatorViewFrame extends AnnotationTextView {
    declare innerTextObject: AnnotatorInnerText;
    readonly contextPresentation = 'code' as const;

    private pendingScroll = 0;
    protected parent: AnnotatorHost;

    private getClampBox: () => HTMLElement | null;

    // sourceId is required for editors: the edit<->annotate toggle rebuilds this
    // view, so the registry must key off a stable source, not the fresh view id.
    constructor(parent: AnnotatorHost, sourceId: string,
            getClampBox: () => HTMLElement | null, text?: string, 
            textdatamodel?: TextDataModel | null, meta?: unknown,
            anchorInfo?: HighlightAnchorSupplInfo
        ) {
        super(text, textdatamodel, sourceId, meta, anchorInfo);
        this.parent = parent;
        this.getClampBox = getClampBox;
    }

    private isBareTextTarget(target: EventTarget | null): boolean {
        const el = target as Element | null;
        if (!el || !el.closest('.txt-inner')) return false;
        if (el.closest('[data-kind="highlighted"]')) return false;
        return true;
    }

    // The line the drag anchored on (pointerdown), held across moves so the range is
    // recomputed as [min, max] each move — reverse and backtrack fall out for free.
    private dragAnchorLine: number | null = null;

    // 1-based line under a screen Y, by geometry against the .readFrame scroller (the actual overflow container — the content div has no scroll of its own).
    private lineFromY(clientY: number): number | null {
        const scroller = this.getClampBox();
        if (!scroller) return null;
        const top = scroller.getBoundingClientRect().top;
        const y = clientY - top + scroller.scrollTop;
        return this.parent.sourceLineAtPixel(y);
    }

    onMouseDown(e: PointerEvent) {
        // Let the browser handle secondary presses (notably its context menu)
        // before line mode can preventDefault or capture the pointer.
        if (e.button !== 0) return;
        // Char mode, or alt/meta-click (reserved for removing an existing highlight):
        // fall through to the normal text-selection path untouched.
        if (userSettings.annotationSelectMode() !== 'line' || e.altKey || e.metaKey) {
            super.onMouseDown(e);
            return;
        }

        if (!this.isBareTextTarget(e.target)) {
            super.onMouseDown(e);
            return;
        }

        const pe = e as PointerEvent;
        const line = this.lineFromY(pe.clientY);
        if (line == null) {
            super.onMouseDown(e);
            return;
        }

        e.preventDefault();
        this.dragAnchorLine = line;
        this.parent.setLineHoverLine(null); // the drag range subsumes the hover preview
        this.parent.setLineDragRange({ lo: line, hi: line });
        (e.currentTarget as HTMLElement)?.setPointerCapture?.(pe.pointerId);

        super.onMouseDown(e);
    }

    private onLineMove(e: PointerEvent) {
        if (this.dragAnchorLine != null) {
            const cur = this.lineFromY(e.clientY);
            if (cur == null) return;
            this.parent.setLineDragRange({
                lo: Math.min(this.dragAnchorLine, cur),
                hi: Math.max(this.dragAnchorLine, cur),
            });
            return;
        }
        // No active drag: hover-preview the line under the cursor in line mode.
        if (userSettings.annotationSelectMode() !== 'line') {
            this.parent.setLineHoverLine(null);
            return;
        }
        if (!this.isBareTextTarget(e.target)) {
            this.parent.setLineHoverLine(null);
            return;
        }
        this.parent.setLineHoverLine(this.lineFromY(e.clientY));
    }

    // Cursor left the box: drop the hover preview (a live drag is unaffected — it's
    // pointer-captured and ends on pointerup).
    private onLineLeave() {
        this.parent.setLineHoverLine(null);
    }

    onSelectionEnd(e: PointerEvent) {
        // Commit an in-progress line-drag before the base resolves the gesture.
        if (this.dragAnchorLine != null) {
            const range = this.parent.getLineDragRange();
            this.dragAnchorLine = null;
            this.parent.setLineDragRange(null);
            if (range) {
                const [start, end] = this.parent.rangeForLines(range.lo, range.hi);
                // Same funnel as the char path: persist, rebuild, open the note.
                if (end > start) this.commitHighlight(start, end);
            }
            return;
        }
        super.onSelectionEnd(e);
    }

    // Current vertical scroll, captured at teardown for the mode-switch handoff.
    getScrollTop(): number {
        return this.getClampBox()?.scrollTop ?? 0;
    }

    // Stash a scroll offset to apply once .readFrame mounts (see getVisual ref).
    applyInitialScroll(top: number) {
        this.pendingScroll = top;
    }

    setScrollTop(top: number) {
        const scroller = this.getClampBox();
        if (scroller) scroller.scrollTop = top;
        this.pendingScroll = top;
    }

    scrollToLineTop(top: number) {
        this.getClampBox()?.scrollTo({ top });
    }

    createInnerText(text?: string, _meta?: unknown): InnerText {
        return new AnnotatorInnerText(
            this,
            () => this.parent?.getLineDragRange() ?? null,
            () => this.parent?.getLineHoverLine() ?? null,
            line => this.parent?.visualTopForSourceLine(line) ?? (line - 1) * EDITOR_FONT.lineHeight,
            (lo, hi) => this.parent?.visualHeightForSourceRange(lo, hi) ?? (hi - lo + 1) * EDITOR_FONT.lineHeight,
            text,
        );
    }

    configureFolding(getFolds: Accessor<FoldSnapshot[]>, onToggleFold: (line: number) => void): void {
        this.innerTextObject.configureFolding(getFolds, onToggleFold);
    }

    refreshFolding(): void {
        this.innerTextObject.rebuildUnits();
    }

    scrollToItem(item: ContextItem): void {
        this.parent.scrollToItem(item);
    }

    // Visual-component seams. Keep the lazy clamp lookup and pending scroll private;
    // the extracted value-only component asks the frame to perform the operations.
    mountVisualFrame(el: HTMLDivElement): void {
        this.setFrameEl(el);
        const clampBox = this.getClampBox();
        if (clampBox) this.setClampEl(clampBox);
    }

    restoreVisualScroll(): void {
        // Capture this frame's own scroller. The parent can mount the other mode
        // before this callback runs, changing its active-scroller pointer.
        const scroller = this.getClampBox();
        requestAnimationFrame(() => {
            if (scroller) scroller.scrollTop = this.pendingScroll;
        });
    }

    updateLineHover(e: PointerEvent): void {
        this.onLineMove(e);
    }

    clearLineHover(): void {
        this.onLineLeave();
    }

    // Pointer capture, hover, and line-drag progress belong to the current DOM host
    // and cannot survive its replacement.
    cancelPointerInteraction(): void {
        this.dragAnchorLine = null;
        this.parent.setLineDragRange(null);
        this.parent.setLineHoverLine(null);
    }

    getVisual(): () => JSX.Element {
        return () => <AnnotatorViewFrameVisual value={this} />;
    }

    quickEditHighlight(start: number, end: number): NoteCoordinator | null {
        if (end < start) [start, end] = [end, start];
        if (end <= start) return null;

        this.commitHighlight(start, end);
        // Containment, not equality: addHighlight may have snapped/merged the bounds.
        return this.innerTextObject.noteableAt(start);
    }

    refreshContent(text: string) {
        const context = sourceContextRegistry.itemsFor(this.sourceId);
        this.innerTextObject.updateData(text, context);
    }

    onDirectClick(): void {
        return;
    }

}

const AnnotatorViewFrameVisual: Component<{ value: AnnotatorViewFrame }> = props => (
    <div
        class="innerframe"
        ref={(el: HTMLDivElement) => props.value.mountVisualFrame(el)}
        style={{
            height: "100%",
            width: "100%",
            "background-color": "transparent",
            color: THEME_FOREGROUNDS[userSettings.editorTheme()],
            ...syntaxPalette(userSettings.editorTheme()),
        }}
        data-component-id={props.value.id}
        onpointerdown={(e: PointerEvent) => props.value.onMouseDown(e)}
        onpointermove={(e: PointerEvent) => props.value.updateLineHover(e)}
        onpointerleave={() => props.value.clearLineHover()}
    >
        <div
            ref={el => {
                props.value.setBumperEl(el);
                props.value.restoreVisualScroll();
            }}
            style={{
                position: "relative",
                "min-height": "100%",
                "font-family": EDITOR_FONT.fontFamily,
                "font-size": `${EDITOR_FONT.fontSize}px`,
                "line-height": `${EDITOR_FONT.lineHeight}px`,
                "font-weight": `${EDITOR_FONT.fontWeight}`,
                "-webkit-font-smoothing": "antialiased",
                "-moz-osx-font-smoothing": "grayscale",
            }}
        >
            <AnnotatorInnerTextVisual value={props.value.innerTextObject} />
        </div>
    </div>
);

class DualTextView implements ViewBlock, Editor, SourceListener, ContextView, DecorationProducer {
    readonly contextPresentation = 'code' as const;
    // ViewBlock contract: CM6 owns its own scroll, so the pane must not wrap it in
    // an overflow scroller (avoids scrollbar fighting on resize).
    ownsScroll: boolean = true;

    // Data model
    private dataKey: string;
    private textModel: TextDataModel | null = null;

    private saveBinding: { provider: FileSystemProvider; path: string } | null = null;

    private disposeWatcher: (() => void) | null = null;
    private requestClose: (() => void) | null = null;
    private disposeModelWatch: (() => void) | null = null;

    getTextModel(): TextDataModel | null {
        return this.textModel;
    }

    // Seed text for a freshly-created model (e.g. an opened file). Ignored when
    // the model already exists; empty editors leave it undefined.
    private initialContent?: string;

    // Used to keep track of whether text data model has been properly
    // initialized via setupEditor()
    private _initialized: boolean = false;

    // Editor and read view instances
    private _editor: CmEditorFrame | null = null;
    private _annotator: AnnotatorViewFrame | null = null;

    private getContextItems: Accessor<ContextItem[]>;
    private setContextItems: Setter<ContextItem[]>;

    contextItem: ContextItem;

    // Settings
    getEditModeOn: Accessor<boolean>;
    setEditModeOn: Setter<boolean>;
    private getModeOverride: Accessor<ModeOverride | null>;
    private setModeOverride: Setter<ModeOverride | null>;

    // Text signals
    getLineCount: Accessor<number>;
    setLineCount: Setter<number>;

    // Live whole-line selection range during a line-mode drag in the annotate view (1-based inclusive), or null when no drag is active.
    getLineDragRange: Accessor<{ lo: number; hi: number } | null>;
    setLineDragRange: Setter<{ lo: number; hi: number } | null>;

    // The single line under the cursor in line mode when NOT dragging (1-based), or null.
    getLineHoverLine: Accessor<number | null>;
    setLineHoverLine: Setter<number | null>;

    // Frame for portaling and anchored note
    getViewportEl: Accessor<HTMLElement | undefined>;
    setViewportEl: Setter<HTMLElement | undefined>;
    viewportAnchorName: string;

    private viewport = new ViewportTracker();
    private activeScroller: HTMLDivElement | undefined;

    private handoff: ViewHandoff = {
        scrollTop: 0,
        revealLine: null,
    };

    private editorStateHost: EditorViewStateHost;
    private getFoldProjection: Accessor<FoldLineProjection>;

    // Moving a tab can mount its destination before its source unmounts. The newest
    // visual owns the frame; cleanup from an older visual must not tear it down.
    private nextVisualMountId = 0;
    private currentVisualMountId: number | null = null;

    constructor(key: string, initialContent?: string) {
        this.dataKey = key;
        this.initialContent = initialContent;
        this.textModel = textModelRegistry.fetchExisting(key);

        // Stored preference used whenever the global lock is unlocked.
        [this.getEditModeOn, this.setEditModeOn] = createSignal(true);
        [this.getModeOverride, this.setModeOverride] = createSignal<ModeOverride | null>(null);

        // Listen globally — the editor consumes keystrokes before they bubble to
        // our div.
        document.addEventListener('keydown', this.onKeyDown);

        // Set up line count accessor
        let count = 0;
        if (this.textModel) {
            count = this.textModel.getLineCount();
        }
        [this.getLineCount, this.setLineCount] = createSignal(count);

        [this.getLineDragRange, this.setLineDragRange] = createSignal<{ lo: number; hi: number } | null>(null);
        [this.getLineHoverLine, this.setLineHoverLine] = createSignal<number | null>(null);
        this.editorStateHost = new EditorViewStateHost();
        this.getFoldProjection = createMemo(() =>
            new FoldLineProjection(this.getLineCount(), this.editorStateHost.folds()));
        [this.getViewportEl, this.setViewportEl] = createSignal<HTMLElement | undefined>(undefined);
        this.viewportAnchorName = `--editor-viewport-${idService.requestId()}`;

        [this.getContextItems, this.setContextItems] =
            createSignal(sourceContextRegistry.itemsFor(this.dataKey));
        registrySources.register(this.dataKey, this);

        this.contextItem = new ContextItem(this);
    }

    makePeer(): DualTextView {
        const peer = new DualTextView(this.dataKey);
        if (this.saveBinding) peer.attachSaveBinding(this.saveBinding.provider, this.saveBinding.path);
        return peer;
    }

    // SourceListener: store this source's new item set for the ruler.
    onSourceContextItemsChange(items: ContextItem[]): void {
        this.refreshContextItems(items);
    }

    refreshContextItems(items: ContextItem[] = sourceContextRegistry.itemsFor(this.dataKey)): void {
        this.setContextItems([...items]);
    }

    mountScroller(el: HTMLDivElement): void {
        this.activeScroller = el;
        this.viewport.attach(el);
        // Let a subclass observe the live scroller (the diff view mirrors it to the
        // other pane via its coordinator). Base has nothing to do here.
        this.onScrollerMounted(el);
    }

    protected onScrollerMounted(_el: HTMLDivElement): void {}

    // The visible line window [first, first+count) in 1-based lines, derived from the scroller geometry.
    visibleWindow(): { first: number; count: number } {
        return this.viewport.visibleWindow(this.getLineCount(), this.rulerRanges());
    }

    rulerRanges(): RangesDataModel | undefined {
        return undefined;
    }

    private foldProjection(): FoldLineProjection {
        return this.getFoldProjection();
    }

    sourceLineAtVisualRow(row: number): number {
        return this.foldProjection().sourceLineAtVisualRow(row);
    }

    sourceLineAtPixel(y: number): number {
        const projection = this.foldProjection();
        let lo = 0;
        let hi = projection.visibleLineCount - 1;
        // Search the same fold- and spacer-aware line tops used to place the ruler.
        // Pixels in a spacer belong to the preceding visible line.
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (this.visualTopForSourceLine(projection.sourceLineAtVisualRow(mid)) <= y) lo = mid;
            else hi = mid - 1;
        }
        return projection.sourceLineAtVisualRow(lo);
    }

    visualTopForSourceLine(line: number): number {
        let top = this.foldProjection().visualRowForSourceLine(line) * EDITOR_FONT.lineHeight;
        for (const range of this.rulerRanges()?.ranges() ?? []) {
            if (range.beforeLine <= line) top += range.heightPx;
        }
        return top;
    }

    visualHeightForSourceRange(lo: number, hi: number): number {
        return this.visualTopForSourceLine(hi) + EDITOR_FONT.lineHeight
            - this.visualTopForSourceLine(lo);
    }

    annotatorRulerRows(): EditorRulerRow[] {
        const state = this.editorStateHost.state();
        const projection = this.foldProjection();
        const { first, count } = this.viewport.visibleWindow(projection.visibleLineCount);
        return projection.visibleSourceLines(first, count).map((line, index) => {
            const fold = state == null ? null : this.foldingInfo(state, line);
            return {
                line,
                top: this.visualTopForSourceLine(line),
                foldable: fold != null,
                folded: fold?.folded ?? false,
            };
        });
    }

    annotatorContentHeight(): number {
        const spacerHeight = (this.rulerRanges()?.ranges() ?? [])
            .reduce((height, range) => height + range.heightPx, 0);
        return this.foldProjection().visibleLineCount * EDITOR_FONT.lineHeight + spacerHeight;
    }

    annotatorContextLines(): Set<number> {
        const projected = new Set(this.contextLines());
        for (const fold of this.editorStateHost.folds()) {
            for (const line of projected) {
                if (fold.startLine < line && line <= fold.endLine) {
                    projected.add(fold.startLine);
                    break;
                }
            }
        }
        return projected;
    }

    toggleAnnotatorFold(line: number): void {
        const state = this.editorStateHost.state();
        if (!state) return;
        const next = this.editorStateHost.update(current => toggleFoldInState(current, line));
        if (!next) return;
        if (next === state) return;
        this._annotator?.refreshFolding();
    }

    toggleEditorFold(line: number): void {
        this._editor?.toggleFold(line);
    }

    /** The mounted or handed-off CM6 state used by coordinated diff folding. */
    currentFoldingState(): EditorState | null {
        return this.editorStateHost.state();
    }

    /** Apply one side of an already-coordinated fold without toggling it again. */
    applyCoordinatedFold(line: number, folded: boolean): boolean {
        if (this._editor) return this._editor.setFold(line, folded);
        const state = this.editorStateHost.state();
        if (!state) return false;
        const next = this.editorStateHost.update(current => setFoldInState(current, line, folded));
        if (!next) return false;
        if (next === state) return foldInfoForLine(state, line) != null;
        this._annotator?.refreshFolding();
        return true;
    }

    protected unfoldAnnotatorLine(line: number): void {
        const state = this.editorStateHost.state();
        if (!state) return;
        const next = this.editorStateHost.update(current => unfoldLineInState(current, line));
        if (!next) return;
        if (next === state) return;
        this._annotator?.refreshFolding();
    }

    // 1-based line numbers spanned by [from, to).
    private linesForRange(from: number, to: number): number[] {
        const lines: number[] = [];
        if (!this.textModel) return lines;
        const first = this.textModel.lineAtOffset(from);
        let last = this.textModel.lineAtOffset(to);
        // Half-open [from, to): when `to` sits exactly at the start of `last`'s row (the offset just past the previous line's newline), the selection ends at that boundary and doesn't…
        if (to > from && last > first && this.textModel.lineStartOffset(last) === to) last--;
        for (let l = first; l <= last; l++) lines.push(l);
        return lines;
    }

    // Whole-line char range [start, end) spanning 1-based inclusive lines [lo, hi].
    rangeForLines(lo: number, hi: number): [number, number] {
        if (!this.textModel) return [0, 0];
        const start = this.textModel.lineStartOffset(lo);
        const lineCount = this.textModel.getLineCount();
        const end = hi < lineCount
            ? this.textModel.lineStartOffset(hi + 1)
            : this.textModel.getValue().length;
        return [start, end];
    }

    contextLines(): Set<number> {
        // Reactive read so the marker set recomputes on edits; the line mapping
        // itself goes through the model's O(log n) line index (linesForRange).
        this.textModel?.getValue();
        const lineCount = this.textModel?.getLineCount() ?? 0;
        const covered = new Set<number>();
        for (const item of this.getContextItems()) {
            const range = item.getRange();
            if (range == null) {
                for (let l = 1; l <= lineCount; l++) covered.add(l);
                continue;
            }
            for (const l of this.linesForRange(range.start, range.end)) covered.add(l);
        }
        return covered;
    }

    _onTextContentChanged(change: ModelChange) {
        if (this.textModel && this.textModel.getLineCount() != this.getLineCount()) {
            this.setLineCount(this.textModel.getLineCount());
        }
        if (this.textModel) {
            const text = this.textModel.getValue();
            if (change.replacement) {
                const invalidated = this.editorStateHost.invalidateIfDocumentChanged(text);
                if (invalidated && this._annotator && this.editorFoldingEnabled()) {
                    this.editorStateHost.publish(this.textModel.foldingState?.() ?? null);
                }
            } else if (!this.editorStateHost.applyChanges(change.changes)) {
                // A missing or out-of-sequence base document cannot safely map
                // positional presentation. Rebuild on the next editor mount.
                this.editorStateHost.invalidateIfDocumentChanged(text);
            }
            this._annotator?.refreshContent(text);
        }
    }

    _initTextModel() {
        // Record current instance to keep track of number of open views on this text data model.
        if (!this._initialized) {
            this.textModel = textModelRegistry.create(this.dataKey, this.initialContent);
            textModelRegistry.register(this.dataKey);
            this.setLineCount(this.textModel.getLineCount());
            this.disposeModelWatch = this.textModel.onChange(change => this._onTextContentChanged(change));
            this._initialized = true;

        }
    }

    private createEditorFrame(): void {
        if (this._editor) return;

        // Initialize text model if not set
        this._initTextModel();

        this._editor = new CmEditorFrame(this.textModel!, () => this.activeScroller ?? null, this.dataKey, this.editorStateHost.state(), () => this.editorExtension(),
            () => sourceContextRegistry.remapped(this.dataKey, this),
            () => { void this.save(); },
            this.editorFoldingEnabled(),
            this.editorFoldingController(),
            state => this.editorStateHost.publish(state));
        this._editor.applyInitialScroll(this.handoff.scrollTop);
        // A reveal raised before this frame existed overrides that restore at mount.
        // Consumed here (not left standing) so it fires once, on this build only.
        this._editor.applyInitialReveal(this.handoff.revealLine);
        this.handoff.revealLine = null;
    }

    // Overridable CM6 extension baked into the editor frame at construction. The
    // base editor has none; the diff view overrides to supply its decoration layer.
    protected editorExtension(): Extension {
        return [];
    }

    protected editorFoldingEnabled(): boolean {
        return true;
    }

    protected editorFoldingController(): FoldingController | null {
        return null;
    }

    protected foldingInfo(state: EditorState, line: number) {
        const controller = this.editorFoldingController();
        return controller ? controller.info(state, line) : foldInfoForLine(state, line);
    }

    private createAnnotatorFrame(): void {
        // Initialize text model if not set
        this._initTextModel();

        if (this._annotator != null) return;

        let text: string = "";

        if (this.textModel != null) {
            const snapshot = this.textModel.snapshot();
            const data = snapshot.read();
            if (data != null) {
                text = data;
            }
        }

        // Create view frame. dataKey (the tab name) is the stable sourceId for now,
        // so highlights survive the edit<->annotate toggle's view rebuild.
        this._annotator = this.newAnnotatorFrame(this.dataKey, () => this.activeScroller ?? null, text, this.textModel);
        if (this.editorFoldingEnabled()) {
            if (!this.editorStateHost.state()) {
                this.editorStateHost.publish(this.textModel?.foldingState?.() ?? null);
            }
            this._annotator.configureFolding(
                this.editorStateHost.folds,
                line => this.toggleAnnotatorFold(line),
            );
        }

        const top = this.handoff.revealLine != null
            ? this.visualTopForSourceLine(this.handoff.revealLine)
            : this.handoff.scrollTop;
        this.handoff.revealLine = null;
        this._annotator.applyInitialScroll(top);
    }

    protected newAnnotatorFrame(sourceId: string, getClampBox: () => HTMLElement | null, text: string, model: TextDataModel | null): AnnotatorViewFrame {
        return new AnnotatorViewFrame(this, sourceId, getClampBox, text, model,
            undefined, {viewportEl: this.getViewportEl, viewportAnchorName: this.viewportAnchorName}
        );
    }

    getScrollOffset(): number {
        return this.captureMountedScroll();
    }

    setScrollOffset(top: number) {
        this.handoff.scrollTop = top;
        (this._annotator ?? this._editor)?.setScrollTop(top);
    }

    // Groups under the same key the ruler and the annotator already use, so the
    // evidence pane files this item with the rest of this source's annotations.
    get sourceId(): string {
        return this.dataKey;
    }

    // ContextView: the source key doubles as the group's display name.
    get label(): string {
        return this.dataKey;
    }

    // _initTextModel assigns this.textModel as a side effect rather than returning
    // it, so call-then-read. Non-null after init: the registry always yields a model.
    getDataSource(): TextDataModel {
        if (!this.textModel) this._initTextModel();
        return this.textModel!;
    }

    getPreviewText(): string {
        return this.getDataSource().displayText().slice(0, PREVIEW_CHARS);
    }

    scrollToItem(item: ContextItem): void {
        const range = item.getRange();
        if (range == null) this.revealLine(1);
        else this.revealOffset(range.start);
    }

    revealSearch(data: SearchData): void {
        this.revealLine(data.line);
    }

    // Source offsets are 0-based positions in the current text, not visual positions.
    revealOffset(offset: number): void {
        if (!Number.isInteger(offset)) throw new RangeError('Reveal offset must be an integer');
        this.revealLine(this.getDataSource().lineAtOffset(offset));
    }

    // Source lines are 1-based. Both visual modes use the same model position.
    revealLine(line: number): void {
        if (!Number.isInteger(line)) throw new RangeError('Reveal line must be an integer');
        line = Math.max(1, Math.min(line, this.getDataSource().getLineCount()));
        const live = this._annotator ?? this._editor;
        const viewport = this.viewport.height();

        if (this._annotator && live === this._annotator) this.unfoldAnnotatorLine(line);

        if (this._editor && live === this._editor) this._editor.revealLine(line);

        if (!live || viewport === 0) {
            // A reveal queued for a later annotate mount must not remain hidden by
            // a cached fold when that mount happens.
            if (!live) this.unfoldAnnotatorLine(line);
            this.handoff.revealLine = line;
            if (this._editor && live === this._editor) live.applyInitialReveal(line);
            if (this._annotator && live === this._annotator) {
                const top = this.visualTopForSourceLine(line);
                this.handoff.scrollTop = top;
                live.applyInitialScroll(top);
            }
            return;
        }

        this.handoff.revealLine = null;

        const row = EDITOR_FONT.lineHeight;
        const target = live === this._annotator
            ? this.visualTopForSourceLine(line)
            : (line - 1) * row;
        const current = live.getScrollTop();

        // Already comfortably in view (one row of margin): don't move.
        if (viewport > 0 && target >= current + row && target <= current + viewport - row * 2) {
            return;
        }

        // Center the line when the doc is tall enough; the scroller clamps the ends.
        const top = Math.max(0, target - Math.max(0, (viewport - row) / 2));
        live.scrollToLineTop(top);
    }

    getSubViews(): ContextView[] {
        return this._annotator ? [this._annotator] : [];
    }

    isWholeSourceIncluded(): boolean {
        return contextRegistry.items().some(
            item => item.isWholeSource() && item.groupKey() === this.dataKey,
        );
    }

    // Selection teardown: drop the whole-source item from the evidence pane.
    clear(): void {
        this.contextItem.deregister();
    }

    toggleWholeSourceContext(): void {
        if (this.isWholeSourceIncluded()) {
            this.contextItem.deregister();
        } else {
            this.contextItem.register();
        }
    }

    buildTabActions(): TabAction[] {
        const actions: TabAction[] = [
            new TabAction(
                'toggle-source-context',
                () => (
                    <Show when={this.isWholeSourceIncluded()} fallback={<CirclePlus size={16} />}>
                        <CircleMinus size={16} />
                    </Show>
                ),
                () => this.isWholeSourceIncluded()
                    ? 'Remove whole source from context'
                    : 'Add whole source as a context item',
                () => this.toggleWholeSourceContext(),
            ),
        ];
        // Save button hidden for now — the binding and Mod-s keymap stay live.
        return actions;
    }

    attachSaveBinding(provider: FileSystemProvider, path: string) {
        this.saveBinding = { provider, path };
    }

    // Read accessor so a peer (MarkdownDualView wraps a raw child) can carry the save
    // binding forward in makePeer without exposing the field.
    getSaveBinding(): { provider: FileSystemProvider; path: string } | null {
        return this.saveBinding;
    }

    attachFileBinding(disposeWatcher: () => void, requestClose: () => void) {
        this.disposeWatcher = disposeWatcher;
        this.requestClose = requestClose;
    }

    private reloadFromDisk() {
        const model = this.textModel;
        if (!(model instanceof CmTextDataModel)) return;
        model.acceptExternalChange();
    }

    // User rejected the external change: keep the in-memory buffer as-is; the
    // dirty dot stays lit because the buffer still diverges from disk.
    private dismissExternalChange() {
        const model = this.textModel;
        if (!(model instanceof CmTextDataModel)) return;
        model.dismissExternalChange();
    }

    private discardDetached() {
        const model = this.textModel;
        if (model instanceof CmTextDataModel) model.markSaved();
        this.requestClose?.();
    }

    async save(): Promise<void> {
        if (!this.saveBinding) return;
        const model = this.textModel;
        if (!(model instanceof CmTextDataModel)) return;
        await saveModel(model, this.saveBinding.provider, this.saveBinding.path);
    }

    // DecorationProducer: the dirty dot.
    getTabDecorations(): Accessor<TabDecoration[]> {
        return createMemo(() => {
            const model = this.textModel;
            if (!(model instanceof CmTextDataModel)) return [];
            if (!model.isDirty()()) return [];
            const detached = model.isDetached()();
            return [new TabDecoration(
                'dirty',
                () => (
                    <span classList={{
                        [appStyles.dirtyDot]: true,
                        [appStyles.dirtyDotDetached]: detached,
                    }} />
                ),
                () => detached ? 'Unsaved (file deleted on disk)' : 'Unsaved changes',
            )];
        });
    }

    getTabMode(): Accessor<string | undefined> {
        return () => this.resolveViewModeToDisplay();
    }

    async confirmClose(): Promise<boolean> {
        const model = this.textModel;
        if (!(model instanceof CmTextDataModel)) return true;
        if (!model.isDirty()()) return true;
        const options: string[] = this.saveBinding
            ? ['Save', 'Discard', 'Cancel']
            : ['Discard', 'Cancel'];
        const choice = await promptConfirm({
            title: 'Unsaved changes',
            message: `${this.dataKey} has unsaved changes.`,
            options,
        });
        if (choice === 'Save') {
            try { await this.save(); }
            catch { return false; } // save failed → keep the tab open so the user can retry
            return true;
        }
        if (choice === 'Discard') return true;
        return false; // Cancel (or Esc / backdrop dismiss)
    }

    private resolveViewModeToDisplay(): TextViewMode {
        const lockMode = userSettings.annotateLock();
        const override = this.getModeOverride();
        if (override && override.lockRevision === userSettings.getAnnotateLockRevision()) {
            return override.mode;
        }
        if (lockMode === 'edit') return 'edit';
        if (lockMode === 'annotation') return 'annotate';
        return this.getEditModeOn() ? 'edit' : 'annotate';
    }

    private hasFrameFor(mode: TextViewMode): boolean {
        return mode === 'edit' ? this._editor != null : this._annotator != null;
    }

    // The single ordering boundary for edit/annotate replacement:
    // capture outgoing state -> dispose it -> create the incoming frame -> publish mode.
    synchronizeMountedFrame(): TextViewMode {
        const viewModeToDisplay = this.resolveViewModeToDisplay();
        if (this.hasFrameFor(viewModeToDisplay)) {
            return viewModeToDisplay;
        }

        this.teardownMountedFrame();
        if (viewModeToDisplay === 'edit') {
            this.createEditorFrame();
        } else {
            this.createAnnotatorFrame();
        }
        return viewModeToDisplay;
    }

    private captureMountedScroll(): number {
        if (this.activeScroller) {
            const mountedFrame = this._annotator ?? this._editor;
            if (mountedFrame) this.handoff.scrollTop = mountedFrame.getScrollTop();
        }
        return this.handoff.scrollTop;
    }

    private disposeMountedFrame(): void {
        if (this._editor) {
            this.editorStateHost.publish(this._editor.getEditorState());
            this._editor.dispose();
            this._editor = null;
        }
        if (this._annotator) {
            this._annotator.dispose();
            this._annotator = null;
        }
    }

    private teardownMountedFrame(): void {
        // Mode changes own this local handoff. A tab move first writes its authoritative
        // offset through get/setScrollOffset, then replaces the visual host without
        // recapturing from either overlapping DOM tree.
        this.captureMountedScroll();
        this._annotator?.cancelPointerInteraction();
        this.disposeMountedFrame();
        this.detachMountedScroller();
    }

    private detachMountedScroller(): void {
        this.viewport.dispose();
        this.activeScroller = undefined;
    }

    // A new DOM host always needs a newly-bound CM6 frame. The Solid annotator can
    // retain its frame (including active note state) while the two tab hosts overlap.
    beginVisualMount(): number {
        const visualMountId = ++this.nextVisualMountId;
        this.currentVisualMountId = visualMountId;
        this.setViewportEl(undefined);
        this._annotator?.cancelPointerInteraction();

        if (this._editor) {
            // CM6 is bound to its old DOM host, so preserve EditorState and rebuild it.
            // Scroll was already stashed by the tab boundary; do not overwrite it.
            this.disposeMountedFrame();
        }
        // An existing annotator is ordinary Solid rendering, so it retains its
        // frame/state while destination and source briefly overlap during a tab move.
        this.detachMountedScroller();
        return visualMountId;
    }

    // A tab move may clean up its source after the destination has mounted. Only the
    // latest visual is allowed to release the frame it owns.
    releaseVisualMount(visualMountId: number): void {
        if (visualMountId !== this.currentVisualMountId) return;

        this.currentVisualMountId = null;
        this.captureMountedScroll();
        this._annotator?.cancelPointerInteraction();
        if (this._editor) {
            // CM6 owns DOM and must be destroyed when that DOM leaves the document.
            this.disposeMountedFrame();
        } else {
            // Retain the Solid annotator object across an inactive tab. Its pending
            // scroll is updated so remounts outside TabContainer also restore it.
            this._annotator?.applyInitialScroll(this.handoff.scrollTop);
        }
        this.detachMountedScroller();
        this.setViewportEl(undefined);
    }

    private setPreferredViewMode(mode: TextViewMode): void {
        batch(() => {
            this.setModeOverride(null);
            this.setEditModeOn(mode === 'edit');
        });
        // Mode requests are synchronous by contract: callers such as quickEditTag
        // may use the newly-created annotator immediately after this returns.
        // An unmounted/background tab stores only the preference; its visual creates
        // the frame on the next mount.
        if (this.currentVisualMountId != null) this.synchronizeMountedFrame();
    }

    private beginModeOverride(mode: TextViewMode, reason: 'quick-edit'): () => void {
        const override: ModeOverride = {
            mode, reason, lockRevision: userSettings.getAnnotateLockRevision(),
        };
        this.setModeOverride(override);
        if (this.currentVisualMountId != null) this.synchronizeMountedFrame();
        return () => {
            if (this.getModeOverride() !== override) return;
            this.setModeOverride(null);
            if (this.currentVisualMountId != null) this.synchronizeMountedFrame();
        };
    }

    setAnnotateMode(): void {
        this.setPreferredViewMode('annotate');
    }

    setEditMode(): void {
        this.setPreferredViewMode('edit');
    }

    toggleAnnotate() {
        // The ruler can always exit a quick edit that temporarily crossed the
        // edit lock. Other locked panes still obey the global mode.
        if (userSettings.annotateLock() !== 'unlocked') {
            const override = this.getModeOverride();
            if (override?.reason === 'quick-edit'
                && override.lockRevision === userSettings.getAnnotateLockRevision()) {
                this.setEditMode();
            }
            return;
        }

        if (this.resolveViewModeToDisplay() === 'edit') {
            this.setAnnotateMode();
        } else {
            this.setEditMode();
        }
    }

    quickEditTag() {
        // Read the live selection before teardown — setAnnotateMode disposes the editor.
        const ranges = (this._editor?.getSelectionRanges() ?? [])
            .filter(r => r.to > r.from);
        if (ranges.length === 0) return;

        const preferredEditMode = this.getEditModeOn();
        const lockedToEdit = userSettings.annotateLock() === 'edit';
        // The preference remembers reader mode after Send, Delete, or Close. Only
        // the edit lock needs a temporary exception to display the annotator.
        let releaseOverride: (() => void) | null = null;
        if (lockedToEdit) {
            batch(() => {
                this.setEditModeOn(false);
                releaseOverride = this.beginModeOverride('annotate', 'quick-edit');
            });
        } else {
            this.setAnnotateMode();
        }

        // Tag each range as its own highlight; arm the commit only on the first.
        let first: NoteCoordinator | null = null;
        for (const r of ranges) {
            const noteable = this._annotator?.quickEditHighlight(r.from, r.to);
            if (noteable && first == null) first = noteable;
        }
        if (first) {
            first.onCommit(() => {
                // Update the preference before releasing the override so the
                // display moves directly to edit in one transition.
                if (releaseOverride) {
                    this.setEditModeOn(true);
                    releaseOverride();
                } else {
                    this.setEditMode();
                }
            });
            first.setActive();
        } else {
            // No note could be opened; leave the pane exactly as it was.
            batch(() => {
                this.setEditModeOn(preferredEditMode);
                this.setModeOverride(null);
            });
            if (this.currentVisualMountId != null) this.synchronizeMountedFrame();
        }
    }

    onKeyDown = (e: KeyboardEvent) => {
        if (e.altKey && e.code === 'KeyN') {
            // Every view owns a document listener so CM6 cannot swallow the shortcut;
            // only the currently mounted tab is allowed to react.
            if (!this.getViewportEl()?.isConnected) return;
            if (userSettings.annotateLock() !== 'unlocked') {
                const override = this.getModeOverride();
                if (override?.reason === 'quick-edit'
                    && override.lockRevision === userSettings.getAnnotateLockRevision()) {
                    this.setEditMode();
                }
                return;
            }
            if (this.resolveViewModeToDisplay() === 'edit') {
                this.setAnnotateMode();
            } else {
                this.setEditMode();
            }
        }
    }

    getEditorFrame(): CmEditorFrame | null {
        return this._editor;
    }

    getAnnotatorFrame(): AnnotatorViewFrame | null {
        return this._annotator;
    }

    selectedEditorLines(): Set<number> {
        const selected = new Set<number>();
        for (const range of this._editor?.getSelectionRanges() ?? []) {
            for (const line of this.linesForRange(range.from, range.to)) selected.add(line);
        }
        return selected;
    }

    externalChangeBar(): JSX.Element {
        const model = this.textModel;
        if (!(model instanceof CmTextDataModel)) return null;
        if (model.isDetached()()) {
            return (
                <div class={roStyles.externalBar} data-variant="detached">
                    <span class={roStyles.externalBarMessage}>
                        The file was deleted on disk. Save to recreate it, or
                        discard the buffer.
                    </span>
                    <button
                        class={roStyles.externalBarPrimary}
                        onClick={() => { void this.save(); }}
                    >
                        Recreate on save
                    </button>
                    <button
                        class={roStyles.externalBarSecondary}
                        onClick={() => this.discardDetached()}
                    >
                        Discard
                    </button>
                </div>
            );
        }
        const ext = model.getExternalChange()();
        if (ext) {
            return (
                <div class={roStyles.externalBar} data-variant="external">
                    <span class={roStyles.externalBarMessage}>
                        This file changed on disk while you had unsaved edits.
                    </span>
                    <button
                        class={roStyles.externalBarPrimary}
                        onClick={() => this.reloadFromDisk()}
                    >
                        Reload
                    </button>
                    <button
                        class={roStyles.externalBarSecondary}
                        onClick={() => this.dismissExternalChange()}
                    >
                        Keep mine
                    </button>
                </div>
            );
        }
        return null;
    }

    mountViewportRoot(el: HTMLDivElement): void {
        this.setViewportEl(el);
    }

    getVisual(): () => JSX.Element {
        return () => <DualTextViewVisual value={this} />;
    }

    dispose() {
        document.removeEventListener('keydown', this.onKeyDown);
        // Balances the register() in the ctor. The annotator has its own separate
        // registration on sourceId, dropped by its own dispose() below.
        registrySources.deregister(this.dataKey, this);
        this.currentVisualMountId = null;
        this.captureMountedScroll();
        this._annotator?.cancelPointerInteraction();
        this.disposeMountedFrame();
        this.detachMountedScroller();
        this.setViewportEl(undefined);
        // Watcher subscription (Step 4). Fire before releasing the model so a
        // late chokidar event racing dispose can't reach a disposed registry.
        this.disposeWatcher?.();
        this.disposeWatcher = null;
        this.disposeModelWatch?.();
        this.disposeModelWatch = null;
        // Refcount release balances the register() in _initTextModel. When the
        // last view for this key closes, the registry disposes the model — so a
        // Discard-then-reopen cold-reads the file instead of finding the still-
        // dirty buffer we left behind. A peer view keeps the count above zero
        // and the model (and its edits) survive, which is the point of the
        // registry (Monaco/VS Code do the same: shared ITextModel is refcounted
        // by open editors, disposed when the last one closes).
        if (this._initialized) textModelRegistry.release(this.dataKey);
    }
}

const paneStyle = () => ({
    "--editor-bg": 'var(--content-editor-background)',
    "--line-height": `${EDITOR_FONT.lineHeight}px`,
});

const EditorPane: Component<{ value: DualTextView }> = props => {
    const frame = props.value.getEditorFrame();
    if (!frame) return null;

    const selectedLines = createMemo(() => props.value.selectedEditorLines());
    const contextLines = createMemo(() => props.value.contextLines());

    return (
        <div
            class={roStyles.readFrame}
            data-editmode={true}
            style={paneStyle()}
            ref={el => props.value.mountScroller(el)}
        >
            <Ruler
                lineCount={props.value.getLineCount}
                window={() => props.value.visibleWindow()}
                annotateCallback={() => props.value.toggleAnnotate()}
                markerCallback={() => props.value.quickEditTag()}
                selectedLines={selectedLines}
                contextLines={contextLines}
                editMode={true}
                ranges={props.value.rulerRanges()}
                editorRows={frame.rulerRows}
                editorContentHeight={frame.rulerContentHeight}
                foldCallback={(line) => props.value.toggleEditorFold(line)}
            />
            <CmEditorFrameVisual value={frame} />
        </div>
    );
};

const AnnotatorPane: Component<{ value: DualTextView }> = props => {
    const frame = props.value.getAnnotatorFrame();
    if (!frame) return null;

    const contextLines = createMemo(() => props.value.annotatorContextLines());

    return (
        <div
            class={roStyles.readFrame}
            data-editmode={false}
            style={paneStyle()}
            ref={el => props.value.mountScroller(el)}
        >
            <Ruler
                lineCount={props.value.getLineCount}
                window={() => props.value.visibleWindow()}
                annotateCallback={() => props.value.toggleAnnotate()}
                contextLines={contextLines}
                editMode={false}
                ranges={props.value.rulerRanges()}
                editorRows={() => props.value.annotatorRulerRows()}
                editorContentHeight={() => props.value.annotatorContentHeight()}
                foldCallback={(line) => props.value.toggleAnnotatorFold(line)}
            />

            <div
                class={roStyles.annotatorWrapper}
                onpointerdown={(e: PointerEvent) => textSelectionManager.claim(frame, e)}
            >
                <AnnotatorViewFrameVisual value={frame} />
            </div>
        </div>
    );
};

const DualTextViewVisual: Component<{ value: DualTextView }> = props => {
    const visualMountId = props.value.beginVisualMount();
    const viewModeToDisplay = () => props.value.synchronizeMountedFrame();
    onCleanup(() => props.value.releaseVisualMount(visualMountId));

    return (
        <div
            ref={el => props.value.mountViewportRoot(el)}
            style={{
                "anchor-name": props.value.viewportAnchorName,
                height: "100%",
                width: "100%",
                display: "flex",
                "flex-direction": "column",
                "font-family": EDITOR_FONT.fontFamily,
                "font-size": `${EDITOR_FONT.fontSize}px`,
                "line-height": `${EDITOR_FONT.lineHeight}px`,
                "font-weight": `${EDITOR_FONT.fontWeight}`,
                "-webkit-font-smoothing": "antialiased",
                "-moz-osx-font-smoothing": "grayscale",
            }}
        >
            {props.value.externalChangeBar()}
            <div style={{ flex: 1, display: "flex", "flex-direction": "row", "min-height": 0 }}>
                <Show
                    when={viewModeToDisplay() === 'edit'}
                    fallback={<AnnotatorPane value={props.value} />}
                >
                    <EditorPane value={props.value} />
                </Show>
            </div>
        </div>
    );
};

export { DualTextView, AnnotatorViewFrame, AnnotatorInnerText, AnnotatorRenderLayer };
