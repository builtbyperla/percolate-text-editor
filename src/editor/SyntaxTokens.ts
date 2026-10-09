import { highlightTree } from '@lezer/highlight';
import { HighlightStyle, TagStyle } from '@codemirror/language';
import { EditorThemeName, THEME_STYLES, lightThemeStyles } from './editorThemes';
import type { JSX } from 'solid-js';
import { resolveLanguage } from './LanguageRouter';

export interface SyntaxToken {
    from: number;
    to: number;
    className: string;
}

// highlightTree emits ordered, non-overlapping ranges. Find the first range
// that can touch this fragment, then visit only ranges inside it.
export function clipSyntaxTokens(tokens: readonly SyntaxToken[], from: number, to: number): SyntaxToken[] {
    let lo = 0;
    let hi = tokens.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (tokens[mid].to <= from) lo = mid + 1;
        else hi = mid;
    }

    const clipped: SyntaxToken[] = [];
    for (let i = lo; i < tokens.length && tokens[i].from < to; i++) {
        const token = tokens[i];
        clipped.push({
            from: Math.max(token.from, from),
            to: Math.min(token.to, to),
            className: token.className,
        });
    }
    return clipped;
}

// All palettes use the same ordered tag specs. Stable classes let a theme change
// update only the container's CSS variables, without parsing or replacing spans.
const syntaxStyle = HighlightStyle.define(lightThemeStyles.map((spec, i): TagStyle => ({
    tag: spec.tag,
    class: `annotator-syntax-${i}`,
})));

export function syntaxPalette(theme: EditorThemeName): JSX.CSSProperties {
    const vars: Record<string, string> = {};
    THEME_STYLES[theme].forEach((spec, i) => {
        if (typeof spec.color === 'string') vars[`--annotator-syntax-${i}`] = spec.color;
    });
    return vars;
}

export function tokenize(text: string, sourceKey: string): SyntaxToken[] {
    const lang = resolveLanguage(sourceKey, text);
    if (!lang) return [];
    const tree = lang.language.parser.parse(text);
    const tokens: SyntaxToken[] = [];
    highlightTree(tree, syntaxStyle, (from, to, className) => {
        if (className) tokens.push({ from, to, className });
    });
    return tokens;
}
