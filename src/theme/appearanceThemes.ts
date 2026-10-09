import type { EditorThemeName } from '../editor/editorThemes';

/** Stable identifiers persisted by the settings layer. */
export type AppearanceThemeId = EditorThemeName;

/**
 * Semantic UI colors exposed to CSS as `--ui-${token}`.
 * Components depend on these roles, never on a particular palette value.
 */
export interface UiThemeTokens {
    canvas: string;
    surface: string;
    /** Structurally distinct pane surface; defaults to `surface`. */
    secondarySurface: string;
    /** Optional third surface family; defaults to a subtle secondary-accent tint. */
    tertiarySurface: string;
    surfaceRaised: string;
    surfaceRaisedFrame: string;
    surfaceHover: string;
    /** Native-style window chrome, independently adjustable from other surfaces. */
    titleBarBackground: string;
    border: string;
    borderStrong: string;
    /** Resize divider between split panes; defaults to the neutral border. */
    paneDivider: string;
    text: string;
    textMuted: string;
    textSubtle: string;
    accent: string;
    /** Accent for secondary/annotation interactions, independent of surface hue. */
    secondaryAccent: string;
    accentHover: string;
    accentSoft: string;
    /** A subdued derivative of the primary accent, reserved for Settings controls. */
    settingsAccent: string;
    onAccent: string;
    info: string;
    infoSoft: string;
    selection: string;
    scrollbar: string;
    scrollbarHover: string;
    danger: string;
    warning: string;
    success: string;
    successSoft: string;
    dangerSoft: string;
    overlay: string;
    tooltip: string;
    tooltipText: string;
    shadow: string;
}

/** Code-oriented surfaces. Markdown intentionally does not consume these tokens. */
export interface ContentThemeTokens {
    chatBackground: string;
    /** Emphasis color inside chat flow; independent from the pane background. */
    chatAccent: string;
    chatAccentHover: string;
    chatAccentSoft: string;
    chatOnAccent: string;
    editorBackground: string;
    editorAccent: string;
    annotationBackground: string;
    annotationAccent: string;
    annotationAccentStrong: string;
    annotationAccentHover: string;
    editorRulerBackground: string;
    editorRulerAccent: string;
    editorRulerHoverBackground: string;
    editorRulerBorder: string;
    editorRulerHoverBorder: string;
    annotationRulerBackground: string;
    annotationRulerText: string;
    annotationRulerHoverBackground: string;
    annotationRulerHoverText: string;
    annotationRulerBorder: string;
    annotationRulerHoverBorder: string;
    annotationHighlight: string;
    nativeSelection: string;
    annotationDrag: string;
    annotationHover: string;
    tabBackground: string;
    tabBorder: string;
    /** Muted blend of tabBorder and the neutral border; themes may override it. */
    tabHeaderAreaBorder: string;
    tabText: string;
    annotationTabBackground: string;
    annotationTabHoverBackground: string;
    annotationTabBorder: string;
    annotationTabHeaderAreaBorder: string;
    evidenceSourceBackground: string;
    evidencePaneBackground: string;
    evidenceHeaderBackground: string;
    evidenceActionsBackground: string;
    evidenceHeaderBorder: string;
    evidenceSourceBorder: string;
    evidenceSourceText: string;
    evidenceAnnotationBackground: string;
    evidenceAnnotationBorder: string;
    evidenceAnnotationText: string;
    evidenceAnnotationToggle: string;
    noteSurface: string;
    noteBorder: string;
    noteText: string;
    noteDot: string;
    noteLine: string;
}

/** One selectable unit: UI palette and syntax highlighting cannot drift apart. */
export interface AppearanceTheme {
    id: AppearanceThemeId;
    label: string;
    editorTheme: EditorThemeName;
    colorScheme?: 'light' | 'dark';
    ui: Readonly<UiThemeTokens>;
    content: Readonly<ContentThemeTokens>;
}

/** Content tokens derived by `theme` unless a theme explicitly overrides them. */
type DerivedContentThemeToken =
    | 'chatBackground'
    | 'chatAccent'
    | 'chatAccentHover'
    | 'chatAccentSoft'
    | 'chatOnAccent'
    | 'editorRulerBackground'
    | 'editorRulerAccent'
    | 'editorRulerHoverBackground'
    | 'editorRulerBorder'
    | 'editorRulerHoverBorder'
    | 'annotationRulerBackground'
    | 'annotationRulerText'
    | 'annotationRulerHoverBackground'
    | 'annotationRulerHoverText'
    | 'annotationRulerBorder'
    | 'annotationRulerHoverBorder'
    | 'annotationHighlight'
    | 'nativeSelection'
    | 'annotationDrag'
    | 'annotationHover'
    | 'tabBackground'
    | 'tabBorder'
    | 'tabHeaderAreaBorder'
    | 'tabText'
    | 'annotationTabBackground'
    | 'annotationTabHoverBackground'
    | 'annotationTabBorder'
    | 'annotationTabHeaderAreaBorder'
    | 'evidencePaneBackground'
    | 'evidenceHeaderBackground'
    | 'evidenceActionsBackground'
    | 'evidenceHeaderBorder'
    | 'evidenceSourceBackground'
    | 'evidenceSourceBorder'
    | 'evidenceSourceText'
    | 'evidenceAnnotationBackground'
    | 'evidenceAnnotationBorder'
    | 'evidenceAnnotationText'
    | 'evidenceAnnotationToggle'
    | 'noteSurface'
    | 'noteBorder'
    | 'noteText'
    | 'noteDot'
    | 'noteLine';

type ThemeContentInput = Omit<ContentThemeTokens, DerivedContentThemeToken>;

const base = {
    canvas: '#ffffff',
    surface: '#fafafa',
    secondarySurface: '#fafafa',
    tertiarySurface: '#fafafa',
    surfaceRaised: '#ffffff',
    surfaceRaisedFrame: 'color-mix(in srgb, var(--ui-accent) 5%, var(--ui-surface-raised))',
    surfaceHover: '#f3f4f6',
    titleBarBackground: 'var(--ui-surface)',
    border: '#e5e7eb',
    borderStrong: '#d1d5db',
    paneDivider: 'var(--ui-border)',
    text: '#374151',
    textMuted: '#6b7280',
    textSubtle: '#9ca3af',
    accent: '#4280e2',
    secondaryAccent: '#7d9787',
    accentHover: '#2768e2',
    accentSoft: '#d1e2fb',
    settingsAccent: 'color-mix(in oklch, var(--ui-accent) 72%, var(--ui-text-muted))',
    onAccent: '#ffffff',
    info: '#3c6e93',
    infoSoft: '#ecf4f9',
    selection: 'rgba(59, 130, 246, 0.18)',
    scrollbar: '#9198a3',
    scrollbarHover: '#4e545f',
    danger: '#dc2626',
    warning: '#d97706',
    success: '#3e811f',
    successSoft: '#eff9ee',
    dangerSoft: '#fdecec',
    overlay: 'rgba(15, 23, 42, 0.32)',
    tooltip: 'rgba(30, 30, 30, 0.88)',
    tooltipText: '#f0f0f0',
    shadow: 'rgba(0, 0, 0, 0.12)',
} satisfies UiThemeTokens;

function theme(
    id: AppearanceThemeId,
    label: string,
    overrides: Partial<UiThemeTokens>,
    content: ThemeContentInput,
    decorationOverrides: Partial<ContentThemeTokens> = {},
): AppearanceTheme {
    const surface = overrides.surface ?? base.surface;
    const secondaryAccent = overrides.secondaryAccent ?? content.annotationAccent;
    const ui: UiThemeTokens = {
        ...base,
        ...overrides,
        secondarySurface: overrides.secondarySurface ?? surface,
        tertiarySurface: overrides.tertiarySurface
            ?? `color-mix(in srgb, ${secondaryAccent} 8%, ${overrides.secondarySurface ?? surface})`,
        secondaryAccent,
    };
    const decorations: ContentThemeTokens = {
        ...content,
        chatBackground: ui.secondarySurface,
        chatAccent: ui.accent,
        chatAccentHover: ui.accentHover,
        chatAccentSoft: ui.accentSoft,
        chatOnAccent: ui.onAccent,
        editorRulerBackground: `color-mix(in srgb, ${content.editorAccent} 7%, ${content.editorBackground})`,
        editorRulerAccent: content.editorAccent,
        editorRulerHoverBackground: `color-mix(in srgb, ${content.editorAccent} 11%, ${content.editorBackground})`,
        editorRulerBorder: content.editorAccent,
        editorRulerHoverBorder: content.editorAccent,
        annotationRulerBackground: `color-mix(in srgb, ${content.annotationAccent} 12%, ${content.annotationBackground})`,
        annotationRulerText: content.annotationAccentStrong,
        annotationRulerHoverBackground: `color-mix(in srgb, ${content.annotationAccent} 18%, ${content.annotationBackground})`,
        annotationRulerHoverText: content.annotationAccentHover,
        annotationRulerBorder: content.annotationAccentStrong,
        annotationRulerHoverBorder: content.annotationAccentStrong,
        annotationHighlight: `color-mix(in srgb, ${content.annotationAccent} 20%, ${content.annotationBackground})`,
        nativeSelection: `color-mix(in srgb, ${content.annotationAccent} 40%, transparent)`,
        annotationDrag: `color-mix(in srgb, ${content.annotationAccent} 28%, transparent)`,
        annotationHover: `color-mix(in srgb, ${content.annotationAccent} 8%, transparent)`,
        tabBackground: `color-mix(in srgb, ${content.editorAccent} 5%, ${content.editorBackground})`,
        tabBorder: content.editorAccent,
        tabHeaderAreaBorder: 'color-mix(in srgb, var(--content-tab-border) 20%, var(--ui-border))',
        tabText: content.editorAccent,
        annotationTabBackground: `color-mix(in srgb, ${content.annotationAccent} 8%, ${content.annotationBackground})`,
        annotationTabHoverBackground: `color-mix(in srgb, ${content.annotationAccent} 14%, ${content.annotationBackground})`,
        annotationTabBorder: content.annotationAccentStrong,
        annotationTabHeaderAreaBorder: 'color-mix(in srgb, var(--content-annotation-tab-border) 20%, var(--ui-border))',
        evidencePaneBackground: ui.secondarySurface,
        evidenceHeaderBackground: ui.surfaceHover,
        evidenceActionsBackground: ui.surfaceHover,
        evidenceHeaderBorder: 'var(--ui-border-strong)',
        // File-level context uses the primary (editor) accent; selected spans use
        // the secondary (annotation) accent. Keep neutral elevated surfaces free
        // of either role so cards and response boxes do not read as highlights.
        evidenceSourceBackground: `color-mix(in srgb, ${content.editorAccent} 7%, ${content.editorBackground})`,
        evidenceSourceBorder: content.editorAccent,
        evidenceSourceText: content.editorAccent,
        evidenceAnnotationBackground: `color-mix(in srgb, ${content.annotationAccent} 12%, ${content.annotationBackground})`,
        evidenceAnnotationBorder: content.annotationAccent,
        evidenceAnnotationText: content.annotationAccent,
        evidenceAnnotationToggle: content.annotationAccentStrong,
        noteSurface: ui.tooltip,
        noteBorder: content.annotationAccent,
        noteText: ui.tooltipText,
        noteDot: content.annotationAccent,
        noteLine: `color-mix(in srgb, ${content.annotationAccent} 55%, transparent)`,
        ...decorationOverrides,
    };
    return { id, label, editorTheme: id, ui, content: decorations };
}

/**
 * Compact palette descriptions for light and mid-tone themes. The scheme kind
 * controls which color family owns each semantic role; components continue to
 * consume the fully expanded UI/content tokens below.
 */
export type AppearanceColorScheme =
    | { kind: 'single-color'; color: string }
    | { kind: 'two-color'; base: string; primary: string }
    | { kind: 'three-color'; base: string; primary: string; secondary: string }
    | { kind: 'three-color-muted'; base: string; primary: string; secondary: string };

export interface AppearanceThemeFactoryOptions {
    /** Light foundation used when tinting the supplied color families. */
    foundation?: string;
    text?: string;
    ui?: Partial<UiThemeTokens>;
    content?: Partial<ContentThemeTokens>;
}

const tint = (color: string, amount: number, background: string): string =>
    `color-mix(in oklch, ${color} ${amount}%, ${background})`;

const shade = (color: string, amount: number): string =>
    `color-mix(in oklch, ${color} ${amount}%, #17202a)`;

/** Expand a few color families into the same depth hierarchy used by Floral. */
function generatedTheme(
    id: AppearanceThemeId,
    label: string,
    scheme: AppearanceColorScheme,
    options: AppearanceThemeFactoryOptions = {},
): AppearanceTheme {
    const foundation = options.foundation ?? (scheme.kind === 'two-color' ? scheme.base : '#ffffff');
    // In a two-color palette the base is the literal light foundation, so its
    // primary supplies subtle structural tints too. Three-color palettes use
    // their base hue for that structural family.
    const structure = scheme.kind === 'single-color'
        ? scheme.color
        : scheme.kind === 'two-color' ? scheme.primary : scheme.base;
    const primary = scheme.kind === 'single-color' ? scheme.color : scheme.primary;
    const annotation = scheme.kind === 'single-color' || scheme.kind === 'two-color'
        ? primary
        : scheme.secondary;
    // Muted three-color themes use the base family for chat emphasis, as Floral
    // does. Standard two/three-color themes carry their primary accent through.
    const chatAccent = scheme.kind === 'three-color-muted' ? scheme.base : primary;
    const text = options.text ?? shade(structure, 38);
    const surface = tint(structure, 4, foundation);
    const secondarySurface = tint(structure, 10, foundation);

    return theme(id, label, {
        canvas: tint(structure, 12, foundation),
        surface,
        secondarySurface,
        tertiarySurface: tint(annotation, 9, foundation),
        surfaceRaised: foundation,
        surfaceHover: tint(structure, 14, foundation),
        border: tint(structure, 27, foundation),
        borderStrong: tint(structure, 45, foundation),
        text,
        textMuted: tint(text, 72, foundation),
        textSubtle: tint(text, 52, foundation),
        accent: chatAccent,
        secondaryAccent: annotation,
        accentHover: shade(chatAccent, 84),
        accentSoft: tint(chatAccent, 18, foundation),
        onAccent: foundation,
        info: shade(structure, 68),
        infoSoft: tint(structure, 11, foundation),
        selection: `color-mix(in oklch, ${primary} 20%, transparent)`,
        scrollbar: tint(structure, 38, foundation),
        scrollbarHover: tint(structure, 58, foundation),
        overlay: 'rgba(15, 23, 42, 0.30)',
        shadow: 'rgba(15, 23, 42, 0.13)',
        ...options.ui,
    }, {
        editorBackground: surface,
        editorAccent: primary,
        annotationBackground: surface,
        annotationAccent: annotation,
        annotationAccentStrong: shade(annotation, 76),
        annotationAccentHover: shade(annotation, 84),
    }, options.content ?? {});
}

export function createSingleColorAppearanceTheme(
    id: AppearanceThemeId,
    label: string,
    color: string,
    options: AppearanceThemeFactoryOptions = {},
): AppearanceTheme {
    return generatedTheme(id, label, { kind: 'single-color', color }, {
        ...options,
        content: {
            // A monochrome ruler reads as a soft tint only; its normal-mode
            // edge must not introduce a second, darker visual color band.
            editorRulerBorder: 'transparent',
            ...options.content,
        },
    });
}

export function createTwoColorAppearanceTheme(
    id: AppearanceThemeId,
    label: string,
    colors: { base: string; accent: string },
    options?: AppearanceThemeFactoryOptions,
): AppearanceTheme {
    return generatedTheme(id, label, {
        kind: 'two-color', base: colors.base, primary: colors.accent,
    }, options);
}

export function createThreeColorAppearanceTheme(
    id: AppearanceThemeId,
    label: string,
    colors: { base: string; primary: string; secondary: string },
    options?: AppearanceThemeFactoryOptions,
): AppearanceTheme {
    return generatedTheme(id, label, { kind: 'three-color', ...colors }, options);
}

export function createMutedThreeColorAppearanceTheme(
    id: AppearanceThemeId,
    label: string,
    colors: { base: string; primary: string; secondary: string },
    options?: AppearanceThemeFactoryOptions,
): AppearanceTheme {
    return generatedTheme(id, label, { kind: 'three-color-muted', ...colors }, options);
}

export const APPEARANCE_THEMES: Readonly<Record<AppearanceThemeId, AppearanceTheme>> = {
    'light-theme': theme('light-theme', 'Quiet Light', {
        canvas: '#ffffff',
        surface: '#fafafa',
        secondarySurface: '#fafafa',
        tertiarySurface: '#f4f8fc',
        surfaceRaised: '#ffffff',
        surfaceRaisedFrame: '#f1f2f6',
        surfaceHover: '#eff1f4',
        titleBarBackground: '#eff1f4',
        border: '#dbdde1',
        borderStrong: '#d6dce0',
        paneDivider: '#d1d8dd',
        text: '#374151',
        textMuted: '#6b7280',
        textSubtle: '#9ca3af',
        scrollbar: '#b9c2c9',
        scrollbarHover: '#7b818b',
    }, {
        editorBackground: '#fcfcfc', editorAccent: '#3c6e93', annotationBackground: '#fcfcfc',
        annotationAccent: '#7d9787', annotationAccentStrong: '#3e811f', annotationAccentHover: '#4a5a50',
    }, {
        editorRulerBackground: '#f4f8fd',
        editorRulerAccent: '#407bba',
        editorRulerHoverBackground: '#eef2f9',
        editorRulerBorder: '#5e81a9',
        annotationRulerBackground: '#eff9ee',
        annotationRulerText: '#3e811f',
        annotationRulerHoverBackground: '#e5f2eb',
        annotationRulerBorder: '#599233',
        annotationHighlight: '#dff1ea',
        nativeSelection: 'rgba(157, 205, 165, 0.4)',
        annotationDrag: 'rgba(115, 184, 142, 0.22)',
        annotationHover: 'rgba(142, 158, 148, 0.075)',
        tabBackground: 'rgb(247, 251, 255)',
        tabBorder: '#64a2d4',
        tabText: '#3c6e93',
        annotationTabBackground: '#f6fdf5',
        annotationTabHoverBackground: '#f4fcf3',
        annotationTabBorder: '#53902a',
        evidencePaneBackground: '#fafafa',
        evidenceHeaderBackground: '#eff1f4',
        evidenceActionsBackground: '#f3f4f6',
        evidenceSourceBackground: '#ecf4f9',
        evidenceSourceBorder: 'rgb(88, 153, 238)',
        evidenceSourceText: '#445878',
        evidenceAnnotationBackground: '#eff9ee',
        evidenceAnnotationBorder: '#6ba63c',
        evidenceAnnotationText: '#3c6130',
        evidenceAnnotationToggle: '#4e9626',
        noteSurface: 'rgb(67, 79, 75)',
        noteBorder: '#8fd6a8',
        noteText: '#e3eae4',
        noteDot: '#8aa896',
        noteLine: 'rgba(138, 168, 150, 0.55)',
    }),
    'warm-theme': theme('warm-theme', 'Warm', {
        canvas: '#fcfaf7', surface: '#faf8f5', surfaceHover: '#f2ede7',
        border: '#e7e0d8', borderStrong: '#d5cbc0', text: '#5e5a55',
        textMuted: '#7d756d', textSubtle: '#9a948c', accent: '#a06f50',
        accentHover: '#875b40', accentSoft: '#f1e5dc', selection: '#a8916a30',
    }, {
        editorBackground: '#faf8f5', editorAccent: '#a8916a', annotationBackground: '#faf8f5',
        annotationAccent: '#948a70', annotationAccentStrong: '#72703c', annotationAccentHover: '#665f4b',
    }),
    'slate-theme': theme('slate-theme', 'Slate', {
        canvas: '#fbfcfe', surface: '#f8f9fb', surfaceHover: '#eef1f5',
        border: '#dfe4eb', borderStrong: '#c8d0da', text: '#555e6e',
        textMuted: '#707b8d', textSubtle: '#8a929e', accent: '#587fa8',
        accentHover: '#436b94', accentSoft: '#e4edf7', selection: '#7090b030',
    }, {
        editorBackground: '#f8f9fb', editorAccent: '#7090b0', annotationBackground: '#f8f9fb',
        annotationAccent: '#668f8b', annotationAccentStrong: '#397f7a', annotationAccentHover: '#416d69',
    }),
    'violet-theme': theme('violet-theme', 'Violet', {
        surface: '#fafafc', surfaceHover: '#f0eff7', border: '#e3e1ec',
        borderStrong: '#ccc8dc', text: '#4a4c58', textMuted: '#6e6d7d',
        textSubtle: '#9a9baa', accent: '#8a4ad8', accentHover: '#7134bc',
        accentSoft: '#eee4fa', selection: '#8a4ad82b',
    }, {
        editorBackground: '#fafafc', editorAccent: '#8a4ad8', annotationBackground: '#fafafc',
        annotationAccent: '#8b75aa', annotationAccentStrong: '#7655a6', annotationAccentHover: '#665080',
    }),
    'blue-mist-theme': createSingleColorAppearanceTheme(
        'blue-mist-theme',
        'Blue Mist',
        '#526f8a',
        { text: '#344452' },
    ),
    'deep-teal-theme': createTwoColorAppearanceTheme('deep-teal-theme', 'Deep Teal', {
        base: '#ffffff',
        accent: '#176b6d',
    }, {
        text: '#243f40',
    }),
    'navy-bloom-theme': createThreeColorAppearanceTheme('navy-bloom-theme', 'Navy Bloom', {
        base: '#283b67',
        primary: '#7453a6',
        secondary: '#9b3f62',
    }, {
        foundation: '#fbfbfe',
        text: '#29324a',
    }),
    'floral-theme': createMutedThreeColorAppearanceTheme('floral-theme', 'Floral', {
        base: '#8c264d',
        primary: '#c97b62',
        secondary: '#7e916e',
    }, {
        foundation: '#fffaf8',
        text: '#58404b',
        ui: {
        canvas: '#eee1e5', surface: '#fbf5f2', secondarySurface: '#f9e3ec',
        tertiarySurface: '#edf0e5', surfaceRaised: '#fffaf8',
        surfaceHover: '#ead7df', border: '#d9bdc7', borderStrong: '#c799aa',
        text: '#58404b', textMuted: '#795364', textSubtle: '#a48692',
        accent: '#8c264d', secondaryAccent: '#8c6077', accentHover: '#98274f', accentSoft: '#e1b7cf',
        settingsAccent: '#98546f', onAccent: '#fff8fa', info: '#786485',
        infoSoft: '#eee5f0', selection: '#b7376926', scrollbar: '#b98aa0',
        scrollbarHover: '#9d657e', danger: '#a82f54', warning: '#ad7045',
        success: '#61775c', successSoft: '#e5ecdf', dangerSoft: '#f4dce4',
        overlay: 'rgba(68, 42, 53, 0.30)', tooltip: '#584b50',
        tooltipText: '#fff8fa', shadow: 'rgba(92, 51, 68, 0.14)',
        },
        content: {
        editorBackground: '#fbf5f2', editorAccent: '#c97b62', annotationBackground: '#fbf5f2',
        annotationAccent: '#7e916e', annotationAccentStrong: '#526348', annotationAccentHover: '#43543a',
        editorRulerAccent: '#bd6c51',
        editorRulerBorder: '#c37541',
        editorRulerHoverBorder: '#974a17',
        tabBorder: '#c37541',
        tabHeaderAreaBorder: '#d9b5a5',
        tabText: '#ab5217',
        annotationRulerBackground: '#e4e9dc',
        annotationRulerText: '#526348',
        annotationRulerHoverBackground: '#dce4d2',
        annotationRulerHoverText: '#43543a',
        annotationRulerBorder: '#718267',
        annotationRulerHoverBorder: '#5d7053',
        annotationHighlight: '#e8ede3',
        annotationTabBackground: '#e8ede3',
        annotationTabHoverBackground: '#e4e9dc',
        annotationTabBorder: '#718267',
        annotationTabHeaderAreaBorder: '#b9c6ae',
        nativeSelection: 'rgba(126, 145, 110, 0.24)',
        annotationDrag: 'rgba(126, 145, 110, 0.25)',
        annotationHover: 'rgba(126, 145, 110, 0.10)',
        evidencePaneBackground: '#faecf2',
        evidenceHeaderBackground: 'rgb(234, 215, 223)',
        evidenceActionsBackground: '#f4e2e9',
        chatBackground: '#faecf2',
        evidenceHeaderBorder: 'var(--ui-border)',
        evidenceAnnotationBackground: '#e8ede3',
        evidenceAnnotationBorder: '#79936b',
        evidenceAnnotationText: '#526348',
        evidenceAnnotationToggle: '#63874e',
        noteSurface: '#59494e',
        noteBorder: '#765561',
        noteText: '#fff7f3',
        noteDot: '#765561',
        noteLine: 'rgba(89, 73, 78, 0.62)',
        },
    }),
};

export const DEFAULT_APPEARANCE_THEME: AppearanceThemeId = 'light-theme';
export const APPEARANCE_THEME_CHANGE_EVENT = 'percolate:appearance-theme-change';

export function getAppearanceTheme(id: AppearanceThemeId): AppearanceTheme {
    return APPEARANCE_THEMES[id];
}

/** Apply atomically at the document boundary; existing DOM updates immediately. */
export function applyAppearanceTheme(themeOrId: AppearanceThemeId | AppearanceTheme, root: HTMLElement = document.documentElement): void {
    const selected = typeof themeOrId === 'string' ? getAppearanceTheme(themeOrId) : themeOrId;
    root.dataset.appearanceTheme = selected.id;
    root.style.colorScheme = selected.colorScheme ?? 'light';
    root.dataset.colorScheme = selected.colorScheme ?? 'light';
    for (const [token, value] of Object.entries(selected.ui)) {
        root.style.setProperty(`--ui-${token.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, value);
    }
    for (const [token, value] of Object.entries(selected.content)) {
        root.style.setProperty(`--content-${token.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, value);
    }
    root.dispatchEvent(new CustomEvent(APPEARANCE_THEME_CHANGE_EVENT, {
        detail: { themeId: selected.id },
    }));
}
