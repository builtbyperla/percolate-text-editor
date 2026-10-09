import { Accessor, Setter, createSignal } from "solid-js";
import type { EditorThemeName } from "./editor/editorThemes";
import { AppearanceTheme, AppearanceThemeId, DEFAULT_APPEARANCE_THEME } from "./theme/appearanceThemes";

export type AnnotateLock = 'unlocked' | 'annotation' | 'edit';

export type AnnotationSelectMode = 'char' | 'line';
export type NativeSelectionMode = 'automatic' | 'always-action';

// Evidence-pane user settings, grouped as a sub-interface so pane-scoped
// preferences live together rather than flat on the top-level manager.
class EvidenceSettings {
    includeFullSource: Accessor<boolean>;
    setIncludeFullSource: Setter<boolean>;

    constructor() {
        [this.includeFullSource, this.setIncludeFullSource] = createSignal(false);
    }
}

/** Appearance preferences are grouped so persistence can serialize one namespace. */
class AppearanceSettings {
    theme: Accessor<AppearanceThemeId>;
    setTheme: Setter<AppearanceThemeId>;
    customTheme: Accessor<AppearanceTheme | null>;
    setCustomTheme: Setter<AppearanceTheme | null>;
    syntaxTheme: Accessor<EditorThemeName>;
    setSyntaxTheme: Setter<EditorThemeName>;

    constructor() {
        [this.theme, this.setTheme] = createSignal<AppearanceThemeId>(DEFAULT_APPEARANCE_THEME);
        [this.customTheme, this.setCustomTheme] = createSignal<AppearanceTheme | null>(null);
        [this.syntaxTheme, this.setSyntaxTheme] = createSignal<EditorThemeName>(DEFAULT_APPEARANCE_THEME);
    }
}

class UserSettingsManager {
    private _autoHideNotes: Accessor<boolean>;
    private _setAutoHideNotes: Setter<boolean>;

    annotateLock: Accessor<AnnotateLock>;
    setAnnotateLock: Setter<AnnotateLock>;
    private annotateLockRevision = 0;

    // A temporary pane override is valid only for the lock setting under which
    // it began. The revision also detects a lock changed away and back while a
    // pane was unmounted.
    getAnnotateLockRevision(): number { return this.annotateLockRevision; }

    // Char-precise vs. whole-line selection in the annotate view. Read reactively by
    // the annotator's drag controller and the mode toggle's tab action.
    annotationSelectMode: Accessor<AnnotationSelectMode>;
    setAnnotationSelectMode: Setter<AnnotationSelectMode>;

    // Native character-precise selections can annotate immediately or offer an
    // action in every supported surface.
    nativeSelectionMode: Accessor<NativeSelectionMode>;
    setNativeSelectionMode: Setter<NativeSelectionMode>;

    readonly appearance = new AppearanceSettings();

    // Compatibility aliases for editor clients. New consumers use appearance.theme.
    readonly editorTheme: Accessor<EditorThemeName> = () => this.appearance.syntaxTheme();
    readonly setEditorTheme: Setter<EditorThemeName> = value => this.appearance.setSyntaxTheme(value);

    // Grouped pane-scoped settings.
    readonly evidence = new EvidenceSettings();

    constructor() {
        const [get, set] = createSignal(false);
        this._autoHideNotes = get;
        this._setAutoHideNotes = set;

        const [annotateLock, setAnnotateLock] = createSignal<AnnotateLock>('unlocked');
        this.annotateLock = annotateLock;
        this.setAnnotateLock = value => {
            const next = typeof value === 'function' ? value(annotateLock()) : value;
            if (next !== annotateLock()) {
                this.annotateLockRevision++;
                setAnnotateLock(() => next);
            }
            return next;
        };
        [this.annotationSelectMode, this.setAnnotationSelectMode] = createSignal<AnnotationSelectMode>('line');
        [this.nativeSelectionMode, this.setNativeSelectionMode] = createSignal<NativeSelectionMode>('always-action');
    }

    get autoHideNotes(): boolean { return this._autoHideNotes(); }

    get showPreviews(): Accessor<boolean> { return () => !this._autoHideNotes(); }

    toggleNotesVisibility() {
        this._setAutoHideNotes(v => !v);
    }
}

export const userSettings = new UserSettingsManager();
