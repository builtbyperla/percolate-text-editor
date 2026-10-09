
import { EditorView, Decoration, DecorationSet, GutterMarker, gutter, WidgetType, ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder, Extension, Text } from '@codemirror/state';
import { computeHunks, DiffHunk, DiffSide } from './DiffModel';
import { EditorThemeName, THEME_DIFF_COLORS, THEME_FOREGROUNDS, DiffColors } from '../editorThemes';
import { EDITOR_FONT } from '../CmEditorFrame';
import { RangesDataModel, StampedRange } from '../RangesDataModel';
import { DiffScheduler } from './DiffScheduler';

// Re-export DiffSide so external importers (DualTextView.tsx) need no change.
export type { DiffSide };

class DiffKind {
    static readonly Added = new DiffKind('cm-diff-added', 'cm-diff-gutter-added', '+', 'addedBg', 'addedGutter');
    static readonly Removed = new DiffKind('cm-diff-removed', 'cm-diff-gutter-removed', '-', 'removedBg', 'removedGutter');

    private constructor(
        public readonly lineClass: string,
        public readonly gutterClass: string,
        public readonly symbol: string,
        public readonly bgKey: keyof DiffColors,
        public readonly gutterColorKey: keyof DiffColors,
    ) {}
}

// Spacer gaps are kind-independent (a neutral grey fill either side), so one class.
const SPACER_CLASS = 'cm-diff-spacer';

// This side's own change kind — what its changed lines are (removed on 'old', added on
// 'new'). Spacers don't use a kind (they're grey).
const sideKind = (side: DiffSide): DiffKind => side === 'old' ? DiffKind.Removed : DiffKind.Added;

const redecorate = StateEffect.define<null>();

class SpacerWidget extends WidgetType {
    constructor(private height: number, private cls: string) { super(); }
    eq(other: SpacerWidget) { return other.height === this.height && other.cls === this.cls; }
    toDOM() {
        const el = document.createElement('div');
        el.className = this.cls;
        el.style.height = `${this.height}px`;
        el.setAttribute('aria-hidden', 'true');
        return el;
    }
    // Non-interactive: never intercept events meant for the editor.
    ignoreEvent() { return false; }
}

// The +/- gutter marker for a changed line on this side.
class DiffGutterMarker extends GutterMarker {
    constructor(private symbol: string, private cls: string) { super(); }
    eq(other: DiffGutterMarker) { return other.symbol === this.symbol; }
    toDOM() {
        const el = document.createElement('span');
        el.textContent = this.symbol;
        el.className = this.cls;
        return el;
    }
}

export function diffExtension(
    scheduler: DiffScheduler,
    side: DiffSide,
    theme: EditorThemeName,
    ranges?: RangesDataModel,
): Extension {
    // The last spacer list pushed to the ranges model, so we only re-push (and re-render the ruler) when the spacers actually change — a keystroke that doesn't cross a hunk boundary…
    let lastSpacers: StampedRange[] = [];
    const pushRangesIfChanged = (hunks: DiffHunk[]) => {
        if (!ranges) return;
        const next = spacersFor(hunks, side);
        if (sameSpacers(next, lastSpacers)) return;
        lastSpacers = next;
        ranges.setRanges(next);
    };

    const rebuild = (state: import('@codemirror/state').EditorState): DecorationSet => {
        const hunks = scheduler.current();
        pushRangesIfChanged(hunks);
        return decorationsFromHunks(state.doc, hunks, side);
    };

    const field = StateField.define<DecorationSet>({
        create(state) {
            return rebuild(state);
        },
        update(value, tr) {
            // Rebuild off the fresh snapshot when the scheduler signals a completed
            // recompute (redecorate effect).
            for (const e of tr.effects) if (e.is(redecorate)) return rebuild(tr.state);
            // On a plain edit, MAP the current set through the change rather than returning it raw: a line-anchored DecorationSet whose positions no longer match the doc is (partially)…
            if (tr.docChanged) return value.map(tr.changes);
            return value;
        },
        provide: (f) => EditorView.decorations.from(f),
    });

    // Drive + observe the shared diff: on this view's doc edits, schedule a recompute; on any completed recompute (either side), dispatch redecorate so the field rebuilds off the…
    const diffPlugin = ViewPlugin.define((view) => {
        const unsubscribe = scheduler.subscribe(() => {
            view.dispatch({ effects: redecorate.of(null) });
        });
        return {
            update(u) {
                if (u.docChanged) scheduler.request();
            },
            destroy: () => unsubscribe(),
        };
    });

    const kind = sideKind(side);

    const diffGutter = gutter({
        class: 'cm-diff-gutter',
        lineMarker(view, line) {
            const set = view.state.field(field, false);
            if (!set) return null;
            let marked = false;
            set.between(line.from, line.from, (_from, _to, value) => {
                if (value.spec?.class === kind.lineClass) { marked = true; return false; }
            });
            return marked ? new DiffGutterMarker(kind.symbol, kind.gutterClass) : null;
        },
    });

    // diffGutter is built but not installed: the +/- markers read as noise next to the
    // line backgrounds. Keep it here so it can be re-added without rebuilding the marker.
    void diffGutter;
    return [field, diffPlugin, diffTheme(theme)];
}

// Structural equality for two spacer lists (order-stable: both come from spacersFor over
// hunks sorted in document order). Lets the ranges push skip no-op updates.
function sameSpacers(a: StampedRange[], b: StampedRange[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].beforeLine !== b[i].beforeLine || a[i].heightPx !== b[i].heightPx) return false;
    }
    return true;
}

export function diffLineClass(side: DiffSide): string {
    return sideKind(side).lineClass;
}

// Per-line diff projection for the ANNOTATE view (the read-only twin of the CM6 decoration layer).
export interface DiffLineInfo {
    changedLines: Set<number>;     // 1-based lines on this side that are added/removed
    spacers: StampedRange[];       // spacer ranges (fed to the ranges model + ruler)
}
export function diffLineInfo(thisText: string, otherText: string, side: DiffSide): DiffLineInfo {
    const hunks = side === 'old'
        ? computeHunks(thisText, otherText)
        : computeHunks(otherText, thisText);
    return diffLineInfoFromHunks(hunks, side);
}

export function diffLineInfoFromHunks(hunks: DiffHunk[], side: DiffSide): DiffLineInfo {
    const changedLines = new Set<number>();
    for (const h of hunks) {
        const span = h.span(side);
        for (let n = span.start; n < span.start + span.count; n++) changedLines.add(n);
    }
    return { changedLines, spacers: spacersFor(hunks, side) };
}

function spacersFor(hunks: DiffHunk[], side: DiffSide): StampedRange[] {
    const out: StampedRange[] = [];
    for (const h of hunks) {
        const span = h.span(side);
        const pad = span.pad();
        if (pad > 0) {
            out.push({ beforeLine: Math.max(span.start, 1), heightPx: pad * EDITOR_FONT.lineHeight, stamp: 'spacer' });
        }
    }
    return out;
}

function decorationsFromHunks(doc: Text, hunks: DiffHunk[], side: DiffSide): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const lineHeight = EDITOR_FONT.lineHeight;
    const lineDeco = Decoration.line({ class: sideKind(side).lineClass });

    for (const h of hunks) {
        const span = h.span(side);
        const pad = span.pad();
        if (pad > 0) {
            const anchorLine = Math.min(Math.max(span.start, 1), doc.lines);
            const at = doc.line(anchorLine).from;
            builder.add(at, at, Decoration.widget({
                widget: new SpacerWidget(pad * lineHeight, SPACER_CLASS),
                block: true,
                side: -1,
            }));
        }
        for (let n = span.start; n < span.start + span.count; n++) {
            if (n < 1 || n > doc.lines) continue;
            const from = doc.line(n).from;
            builder.add(from, from, lineDeco);
        }
    }
    return builder.finish();
}

function diffTheme(theme: EditorThemeName): Extension {
    const c = THEME_DIFF_COLORS[theme];
    const grey = THEME_FOREGROUNDS[theme];
    const rules: Record<string, Record<string, string>> = {
        '.cm-diff-gutter': { minWidth: '1ch', textAlign: 'center' },
        [`.${SPACER_CLASS}`]: {
            backgroundColor: `${grey}0e`,
            backgroundImage: `repeating-linear-gradient(45deg, ${grey}22 0, ${grey}22 1px, transparent 1px, transparent 7px)`,
        },
    };
    for (const k of [DiffKind.Added, DiffKind.Removed]) {
        rules[`.${k.lineClass}`] = { backgroundColor: c[k.bgKey] };
        // Active-line and diff decorations share the cm-line element. Preserve
        // the diff fill as the base and layer the active tint above it, matching
        // the way CM6's separate selection layer blends with diff backgrounds.
        rules[`.${k.lineClass}.cm-activeLine`] = {
            backgroundColor: c[k.bgKey],
            backgroundImage: 'linear-gradient(var(--cm-active-line-overlay), var(--cm-active-line-overlay))',
        };
        rules[`.${k.gutterClass}`] = { color: c[k.gutterColorKey] };
    }
    return EditorView.theme(rules);
}
