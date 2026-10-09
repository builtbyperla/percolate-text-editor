import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting, TagStyle } from '@codemirror/language';
import { Extension } from '@codemirror/state';

function createTheme(variant: 'light' | 'dark', settings: {
    background: string; foreground: string; caret: string;
    selection: string;
    gutterBackground: string; gutterForeground: string;
    lineHighlight: string;
}, styles: TagStyle[]): Extension {
    const theme = EditorView.theme({
        '&': {
            backgroundColor: 'transparent',
            color: settings.foreground,
            '--cm-active-line-overlay': `var(--content-editor-ruler-background, ${settings.lineHighlight})`,
        },
        // CM6's baseTheme puts a 1px dotted outline on the focused editor; drop it.
        // The pane already shows focus, and the dots ring the whole frame.
        '&.cm-focused': { outline: 'none' },
        '.cm-content': { caretColor: `var(--content-editor-accent, ${settings.caret})` },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: `var(--content-editor-accent, ${settings.caret})` },
        // Match CM6's focused-selection selector specificity so its default
        // lavender (#d7d4f0) cannot override the configured drawn selection.
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
            backgroundColor: 'var(--ui-selection, ' + settings.selection + ')',
        },
        // CM6 otherwise falls back to an opaque grey when the editor loses
        // focus. Keep the selection's hue, but soften it to show inactivity.
        '&:not(.cm-focused) > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
            backgroundColor: 'var(--ui-selection, ' + settings.selection + ')',
            opacity: 0.5,
        },
        '.cm-activeLine': { backgroundColor: `var(--content-editor-ruler-background, ${settings.lineHighlight})` },
        '.cm-gutters': { backgroundColor: `var(--content-editor-background, ${settings.gutterBackground})`, color: settings.gutterForeground },
        '.cm-activeLineGutter': { backgroundColor: `var(--content-editor-ruler-background, ${settings.lineHighlight})` },
        '.cm-panels': {
            backgroundColor: settings.background,
            color: settings.foreground,
            fontFamily: 'var(--font-sans)',
            fontSize: '14px',
        },
        // Top panels float over the code instead of becoming a new row in the
        // editor's flex layout. Keeping the zero-height wrapper sticky makes the
        // find widget follow the pane's scroll viewport without moving any text.
        '.cm-panels-top': {
            alignSelf: 'flex-end',
            backgroundColor: 'transparent',
            border: 'none',
            height: '0',
            left: 'auto',
            marginRight: '8px',
            overflow: 'visible',
            position: 'sticky',
            right: 'auto',
            top: '8px',
            width: 'min(680px, calc(100% - 16px))',
            zIndex: '400',
        },
        '.cm-panels-bottom': { borderTop: `1px solid ${settings.gutterForeground}` },
        '.cm-panel.cm-search': {
            backgroundColor: settings.background,
            border: `1px solid ${settings.gutterForeground}`,
            borderRadius: '6px',
            boxShadow: '0 7px 22px #00000020',
            boxSizing: 'border-box',
            padding: '5px 28px 5px 8px',
            width: '100%',
        },
        '.cm-panel.cm-search input.cm-textfield': {
            backgroundColor: settings.background,
            color: settings.foreground,
            border: `1px solid ${settings.gutterForeground}`,
            borderRadius: '4px',
            padding: '3px 6px',
            outline: 'none',
        },
        '.cm-panel.cm-search input.cm-textfield:focus': {
            borderColor: settings.caret,
        },
        '.cm-panel.cm-search button.cm-button': {
            backgroundImage: 'none',
            backgroundColor: settings.lineHighlight,
            color: settings.foreground,
            border: `1px solid ${settings.gutterForeground}`,
            borderRadius: '4px',
            padding: '3px 7px',
        },
        '.cm-panel.cm-search button.cm-button:hover': {
            backgroundColor: settings.selection,
        },
        '.cm-panel.cm-search [name=close]': {
            color: settings.gutterForeground,
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: '20px',
        },
        '.cm-searchMatch': {
            backgroundColor: settings.selection,
            outline: `1px solid ${settings.gutterForeground}`,
        },
        '.cm-searchMatch.cm-searchMatch-selected': {
            backgroundColor: settings.selection,
            outline: `1px solid ${settings.caret}`,
        },
        '.cm-selectionMatch': {
            backgroundColor: settings.selection,
            outline: `1px solid ${settings.gutterForeground}`,
        },
        '.cm-tooltip': {
            backgroundColor: settings.background,
            color: settings.foreground,
            border: `1px solid ${settings.gutterForeground}`,
            borderRadius: '5px',
            boxShadow: '0 5px 16px #00000018',
        },
        '.cm-tooltip.cm-tooltip-autocomplete > ul': {
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            padding: '3px',
        },
        '.cm-tooltip-autocomplete > ul > li': {
            borderRadius: '3px',
            padding: '2px 5px',
        },
        '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
            backgroundColor: settings.selection,
            color: settings.foreground,
        },
        '.cm-completionMatchedText': {
            color: settings.caret,
            textDecoration: 'none',
            fontWeight: '650',
        },
        '.cm-completionDetail': {
            color: settings.gutterForeground,
            fontStyle: 'normal',
        },
        '.cm-snippetField': {
            backgroundColor: settings.selection,
            outline: `1px solid ${settings.gutterForeground}`,
        },
    }, { dark: variant === 'dark' });
    return [theme, syntaxHighlighting(HighlightStyle.define(styles))];
}

export const lightThemeStyles: TagStyle[] = [
    { tag: t.comment,                                    color: '#8f929999' },
    { tag: t.string,                                     color: '#7a9e52' },
    { tag: t.regexp,                                     color: '#5aab90' },
    { tag: [t.number, t.bool, t.null],                   color: '#b8924a' },
    { tag: t.variableName,                               color: '#5c6166' },
    { tag: [t.definitionKeyword, t.modifier],            color: '#c47d52' },
    { tag: [t.keyword, t.special(t.brace)],              color: '#c47d52' },
    { tag: t.operator,                                   color: '#c08870' },
    { tag: t.separator,                                  color: '#5c616699' },
    { tag: t.punctuation,                                color: '#5c6166' },
    { tag: [t.definition(t.propertyName),
            t.function(t.variableName)],                 color: '#b09a5e' },
    { tag: [t.className, t.definition(t.typeName)],      color: '#5491b8' },
    { tag: [t.tagName, t.typeName, t.self, t.labelName], color: '#6aa3b8' },
    { tag: t.angleBracket,                               color: '#6aa3b860' },
    { tag: t.attributeName,                              color: '#b09a5e' },
];
export const lightTheme: Extension = createTheme('light', {
    background: '#fcfcfc',
    foreground: '#5c6166',
    caret: '#b8924a',
    selection: '#036dd618',
    gutterBackground: '#fcfcfc',
    gutterForeground: '#8a919955',
    lineHighlight: '#8a919912',
}, lightThemeStyles);

// Warm greige — even quieter, almost monochrome with just enough hue to read.
export const warmThemeStyles: TagStyle[] = [
    { tag: t.comment,                                    color: '#9a948c88' },
    { tag: t.string,                                     color: '#7a9470' },
    { tag: t.regexp,                                     color: '#7aaa95' },
    { tag: [t.number, t.bool, t.null],                   color: '#a8916a' },
    { tag: t.variableName,                               color: '#5e5a55' },
    { tag: [t.definitionKeyword, t.modifier],            color: '#b07a56' },
    { tag: [t.keyword, t.special(t.brace)],              color: '#b07a56' },
    { tag: t.operator,                                   color: '#a87a60' },
    { tag: t.separator,                                  color: '#5e5a5588' },
    { tag: t.punctuation,                                color: '#5e5a55' },
    { tag: [t.definition(t.propertyName),
            t.function(t.variableName)],                 color: '#9e8c60' },
    { tag: [t.className, t.definition(t.typeName)],      color: '#5a8fa8' },
    { tag: [t.tagName, t.typeName, t.self, t.labelName], color: '#6a9eaa' },
    { tag: t.angleBracket,                               color: '#6a9eaa55' },
    { tag: t.attributeName,                              color: '#9e8c60' },
];
export const warmTheme: Extension = createTheme('light', {
    background: '#faf8f5',
    foreground: '#5e5a55',
    caret: '#a8916a',
    selection: '#a8916a18',
    gutterBackground: '#faf8f5',
    gutterForeground: '#9a948c55',
    lineHighlight: '#9a948c0e',
}, warmThemeStyles);

// Cool slate — blue-grey base, slightly cooler than ayu.
export const slateThemeStyles: TagStyle[] = [
    { tag: t.comment,                                    color: '#8a929e88' },
    { tag: t.string,                                     color: '#5e9e7a' },
    { tag: t.regexp,                                     color: '#5aaa9a' },
    { tag: [t.number, t.bool, t.null],                   color: '#8a7eb0' },
    { tag: t.variableName,                               color: '#555e6e' },
    { tag: [t.definitionKeyword, t.modifier],            color: '#7a6eb0' },
    { tag: [t.keyword, t.special(t.brace)],              color: '#7a6eb0' },
    { tag: t.operator,                                   color: '#8a80aa' },
    { tag: t.separator,                                  color: '#555e6e88' },
    { tag: t.punctuation,                                color: '#555e6e' },
    { tag: [t.definition(t.propertyName),
            t.function(t.variableName)],                 color: '#4e8ea8' },
    { tag: [t.className, t.definition(t.typeName)],      color: '#4a84b0' },
    { tag: [t.tagName, t.typeName, t.self, t.labelName], color: '#5a90a8' },
    { tag: t.angleBracket,                               color: '#5a90a855' },
    { tag: t.attributeName,                              color: '#4e8ea8' },
];
export const slateTheme: Extension = createTheme('light', {
    background: '#f8f9fb',
    foreground: '#555e6e',
    caret: '#7090b0',
    selection: '#7090b018',
    gutterBackground: '#f8f9fb',
    gutterForeground: '#8a929e55',
    lineHighlight: '#8a929e0e',
}, slateThemeStyles);

export const violetThemeStyles: TagStyle[] = [
    { tag: t.comment,                                    color: '#9a9baa99' },
    { tag: t.string,                                     color: '#5e9e42' },
    { tag: t.regexp,                                     color: '#4aab90' },
    { tag: [t.number, t.bool, t.null],                   color: '#c48a3a' },
    { tag: t.variableName,                               color: '#4a4c58' },
    { tag: [t.definitionKeyword, t.modifier],            color: '#8a4ad8' },
    { tag: [t.keyword, t.special(t.brace)],              color: '#8a4ad8' },
    { tag: t.operator,                                   color: '#6a78d8' },
    { tag: t.separator,                                  color: '#4a4c5899' },
    { tag: t.punctuation,                                color: '#4a4c58' },
    { tag: [t.definition(t.propertyName),
            t.function(t.variableName)],                 color: '#4a72d8' },
    { tag: [t.className, t.definition(t.typeName)],      color: '#c48a3a' },
    { tag: [t.tagName, t.typeName, t.self, t.labelName], color: '#c4544a' },
    { tag: t.angleBracket,                               color: '#c4544a60' },
    { tag: t.attributeName,                              color: '#4a72d8' },
];
export const violetTheme: Extension = createTheme('light', {
    background: '#fafafc',
    foreground: '#4a4c58',
    caret: '#8a4ad8',
    selection: '#4a72d818',
    gutterBackground: '#fafafc',
    gutterForeground: '#9a9baa55',
    lineHighlight: '#9a9baa12',
}, violetThemeStyles);

// Floral — dusty rose chrome, warm paper, and botanical sage accents.
export const floralThemeStyles: TagStyle[] = [
    { tag: t.comment,                                    color: '#9b7a7399' },
    { tag: t.string,                                     color: '#c43f70' },
    { tag: t.regexp,                                     color: '#668879' },
    { tag: [t.number, t.bool, t.null],                   color: '#9b7851' },
    { tag: t.variableName,                               color: '#584b50' },
    { tag: [t.definitionKeyword, t.modifier],            color: '#bd684a' },
    { tag: [t.keyword, t.special(t.brace)],              color: '#bd684a' },
    { tag: t.operator,                                   color: '#a85d4f' },
    { tag: t.separator,                                  color: '#584b5099' },
    { tag: t.punctuation,                                color: '#584b50' },
    { tag: [t.definition(t.propertyName),
            t.function(t.variableName)],                 color: '#8f6c52' },
    { tag: [t.className, t.definition(t.typeName)],      color: '#6f668f' },
    { tag: [t.tagName, t.typeName, t.self, t.labelName], color: '#628477' },
    { tag: t.angleBracket,                               color: '#62847760' },
    { tag: t.attributeName,                              color: '#8f6c52' },
];
export const floralTheme: Extension = createTheme('light', {
    background: '#fbf5f2',
    foreground: '#584b50',
    caret: '#b73769',
    selection: '#b7376924',
    gutterBackground: '#f6ebe7',
    gutterForeground: '#9b716655',
    lineHighlight: '#71856b15',
}, floralThemeStyles);

export type EditorThemeName = 'light-theme' | 'warm-theme' | 'slate-theme' | 'violet-theme' | 'blue-mist-theme' | 'deep-teal-theme' | 'navy-bloom-theme' | 'floral-theme';

export const EDITOR_THEMES: Record<EditorThemeName, Extension> = {
    'light-theme': lightTheme,
    'warm-theme': warmTheme,
    'slate-theme': slateTheme,
    'violet-theme': violetTheme,
    'blue-mist-theme': slateTheme,
    'deep-teal-theme': lightTheme,
    'navy-bloom-theme': violetTheme,
    'floral-theme': floralTheme,
};

export const THEME_BACKGROUNDS: Record<EditorThemeName, string> = {
    'light-theme': '#fcfcfc',
    'warm-theme': '#faf8f5',
    'slate-theme': '#f8f9fb',
    'violet-theme': '#fafafa',
    'blue-mist-theme': '#f8fafc',
    'deep-teal-theme': '#f5fafa',
    'navy-bloom-theme': '#f5f6fa',
    'floral-theme': '#fbf5f2',
};
export const THEME_FOREGROUNDS: Record<EditorThemeName, string> = {
    'light-theme': '#5c6166',
    'warm-theme': '#5e5a55',
    'slate-theme': '#555e6e',
    'violet-theme': '#50525c',
    'blue-mist-theme': '#344452',
    'deep-teal-theme': '#243f40',
    'navy-bloom-theme': '#29324a',
    'floral-theme': '#584b50',
};

// Raw token styles per theme, exposed so the annotator can build a class-keyed
// HighlightStyle from the same color source the editor uses (see SyntaxTokens.ts).
export const THEME_STYLES: Record<EditorThemeName, TagStyle[]> = {
    'light-theme': lightThemeStyles,
    'warm-theme': warmThemeStyles,
    'slate-theme': slateThemeStyles,
    'violet-theme': violetThemeStyles,
    'blue-mist-theme': slateThemeStyles,
    'deep-teal-theme': lightThemeStyles,
    'navy-bloom-theme': violetThemeStyles,
    'floral-theme': floralThemeStyles,
};

export interface DiffColors { addedBg: string; removedBg: string; addedGutter: string; removedGutter: string; }
export const THEME_DIFF_COLORS: Record<EditorThemeName, DiffColors> = {
    'light-theme': { addedBg: '#7a9e5220', removedBg: '#c4525220', addedGutter: '#5a7e42', removedGutter: '#a44242' },
    'warm-theme':  { addedBg: '#7a947020', removedBg: '#b0705620', addedGutter: '#5e7450', removedGutter: '#96543e' },
    'slate-theme': { addedBg: '#5e9e7a20', removedBg: '#8a7eb020', addedGutter: '#4a7e60', removedGutter: '#6a5e90' },
    'violet-theme': { addedBg: '#6a9e6620', removedBg: '#c47a7220', addedGutter: '#5a8656', removedGutter: '#a4645c' },
    'blue-mist-theme': { addedBg: '#526f8a20', removedBg: '#8a526220', addedGutter: '#526f8a', removedGutter: '#7a4555' },
    'deep-teal-theme': { addedBg: '#176b6d20', removedBg: '#a34f5f20', addedGutter: '#176b6d', removedGutter: '#8e3f50' },
    'navy-bloom-theme': { addedBg: '#52796720', removedBg: '#9b3f6220', addedGutter: '#456957', removedGutter: '#873450' },
    'floral-theme': { addedBg: '#71856b24', removedBg: '#b7376920', addedGutter: '#61775c', removedGutter: '#a72f5d' },
};
