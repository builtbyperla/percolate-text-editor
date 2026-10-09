import { describe, expect, it } from 'vitest';
import {
    APPEARANCE_THEME_CHANGE_EVENT,
    APPEARANCE_THEMES,
    DEFAULT_APPEARANCE_THEME,
    applyAppearanceTheme,
    getAppearanceTheme,
} from '../src/theme/appearanceThemes';

describe('appearance theme contract', () => {
    it('resolves every stable id to one combined UI and editor theme', () => {
        for (const [id, theme] of Object.entries(APPEARANCE_THEMES)) {
            expect(theme.id).toBe(id);
            expect(theme.editorTheme).toBe(id);
            expect(Object.keys(theme.ui).length).toBeGreaterThan(0);
            expect(Object.values(theme.ui).every(Boolean)).toBe(true);
            expect(Object.values(theme.content).every(Boolean)).toBe(true);
        }
        expect(getAppearanceTheme(DEFAULT_APPEARANCE_THEME)).toBeDefined();
        expect(DEFAULT_APPEARANCE_THEME).toBe('light-theme');
    });

    it('applies the complete palette at the document boundary', () => {
        const root = document.createElement('div');
        let themeAtNotification: string | undefined;
        root.addEventListener(APPEARANCE_THEME_CHANGE_EVENT, () => {
            themeAtNotification = root.style.getPropertyValue('--content-editor-background');
        });
        applyAppearanceTheme('violet-theme', root);

        expect(root.dataset.appearanceTheme).toBe('violet-theme');
        expect(root.style.getPropertyValue('--ui-accent')).toBe('#8a4ad8');
        expect(root.style.getPropertyValue('--ui-surface-raised')).toBe('#ffffff');
        expect(root.style.getPropertyValue('--content-editor-background')).toBe('#fafafc');
        expect(root.style.getPropertyValue('--content-editor-accent')).toBe('#8a4ad8');
        expect(root.style.getPropertyValue('--content-annotation-accent')).toBe('#8b75aa');
        expect(root.style.getPropertyValue('--content-annotation-accent-strong')).toBe('#7655a6');
        expect(root.style.getPropertyValue('--ui-settings-accent')).toContain('color-mix');
        expect(root.style.getPropertyValue('--content-annotation-highlight')).toContain('color-mix');
        expect(root.style.getPropertyValue('--content-native-selection')).toContain('color-mix');
        expect(themeAtNotification).toBe('#fafafc');
    });

    it('keeps native selection in the annotation palette', () => {
        const root = document.createElement('div');
        applyAppearanceTheme('light-theme', root);

        expect(root.style.getPropertyValue('--content-native-selection'))
            .toBe('rgba(157, 205, 165, 0.4)');
    });

    it('uses the demo neutrals for Quiet Light chrome', () => {
        const quietLight = getAppearanceTheme('light-theme');
        const violet = getAppearanceTheme('violet-theme');

        expect(quietLight.ui.surfaceHover).toBe('#eff1f4');
        expect(quietLight.ui.titleBarBackground).toBe('#eff1f4');
        expect(quietLight.ui.tertiarySurface).toBe('#f4f8fc');
        expect(quietLight.ui.borderStrong).toBe('#d6dce0');
        expect(quietLight.ui.paneDivider).toBe('#d1d8dd');
        expect(quietLight.content.evidencePaneBackground).toBe('#fafafa');
        expect(quietLight.content.evidencePaneBackground)
            .toBe(quietLight.content.chatBackground);
        expect(quietLight.content.evidenceHeaderBackground).toBe('#eff1f4');
        expect(quietLight.content.evidenceActionsBackground).toBe('#f3f4f6');
        expect(violet.ui.surfaceHover).toBe('#f0eff7');
        expect(violet.ui.titleBarBackground).toBe('var(--ui-surface)');
    });

    it('mutes the theme tab border by default and allows a separate override', () => {
        const root = document.createElement('div');
        const base = getAppearanceTheme('light-theme');
        const derived = 'color-mix(in srgb, var(--content-tab-border) 20%, var(--ui-border))';
        expect(base.content.tabBorder).toBe('#64a2d4');
        expect(base.content.tabHeaderAreaBorder).toBe(derived);
        expect(base.content.annotationTabBorder).toBe('#53902a');
        expect(base.content.annotationTabHeaderAreaBorder)
            .toBe('color-mix(in srgb, var(--content-annotation-tab-border) 20%, var(--ui-border))');

        applyAppearanceTheme(base, root);
        expect(root.style.getPropertyValue('--content-tab-header-area-border')).toBe(derived);

        applyAppearanceTheme({
            ...base,
            content: { ...base.content, tabHeaderAreaBorder: '#123456' },
        }, root);

        expect(root.style.getPropertyValue('--content-tab-header-area-border')).toBe('#123456');
        expect(root.style.getPropertyValue('--content-tab-border')).toBe('#64a2d4');
    });

    it('registers the floral UI and syntax palette together', () => {
        const floral = getAppearanceTheme('floral-theme');

        expect(floral.label).toBe('Floral');
        expect(floral.editorTheme).toBe('floral-theme');
        expect(floral.ui.accent).toBe('#8c264d');
        expect(floral.content.chatAccent).toBe('#8c264d');
        expect(floral.content.editorBackground).toBe('#fbf5f2');
        expect(floral.ui.secondarySurface).toBe('#f9e3ec');
        expect(floral.ui.tertiarySurface).toBe('#edf0e5');
        expect(floral.ui.secondaryAccent).toBe('#8c6077');
        expect(floral.content.annotationBackground).toBe('#fbf5f2');
        expect(floral.content.annotationAccent).toBe('#7e916e');
        expect(floral.content.annotationRulerText).toBe('#526348');
        expect(floral.content.annotationRulerBorder).toBe('#718267');
        expect(floral.content.annotationHighlight).toBe('#e8ede3');
        expect(floral.content.annotationTabBorder).toBe(floral.content.annotationRulerBorder);
        expect(floral.content.annotationTabBackground).toBe(floral.content.annotationHighlight);
        expect(floral.content.annotationTabHeaderAreaBorder).toBe('#b9c6ae');
        expect(floral.content.tabHeaderAreaBorder).toBe('#d9b5a5');
        expect(floral.content.evidenceSourceBorder).toBe(floral.content.editorAccent);
        expect(floral.content.evidenceAnnotationBackground).toBe(floral.content.annotationHighlight);
        expect(floral.content.evidenceAnnotationBorder).toBe('#79936b');
        expect(floral.content.noteSurface).toBe('#59494e');
        expect(floral.content.noteText).toBe('#fff7f3');
    });

    it('expands the two-color factory with light surfaces and one accent family', () => {
        const teal = getAppearanceTheme('deep-teal-theme');

        expect(teal.ui.accent).toBe('#176b6d');
        expect(teal.content.chatAccent).toBe('#176b6d');
        expect(teal.content.editorAccent).toBe('#176b6d');
        expect(teal.content.annotationAccent).toBe('#176b6d');
        expect(teal.content.annotationHighlight).toContain('#176b6d');
        expect(teal.content.annotationHighlight).toContain(teal.content.annotationBackground);
    });

    it('uses one family throughout a single-color theme without a normal ruler edge', () => {
        const mist = getAppearanceTheme('blue-mist-theme');

        expect(mist.ui.accent).toBe('#526f8a');
        expect(mist.content.chatAccent).toBe('#526f8a');
        expect(mist.content.editorAccent).toBe('#526f8a');
        expect(mist.content.annotationAccent).toBe('#526f8a');
        expect(mist.content.editorRulerBorder).toBe('transparent');
        expect(mist.content.editorRulerHoverBorder).toBe('#526f8a');
    });

    it('assigns primary and secondary families in the three-color factory', () => {
        const bloom = getAppearanceTheme('navy-bloom-theme');

        expect(bloom.ui.accent).toBe('#7453a6');
        expect(bloom.content.chatAccent).toBe('#7453a6');
        expect(bloom.content.editorAccent).toBe('#7453a6');
        expect(bloom.content.annotationAccent).toBe('#9b3f62');
        expect(bloom.ui.canvas).toContain('#283b67');
    });

    it('uses the base family for chat emphasis only in the muted three-color factory', () => {
        const floral = getAppearanceTheme('floral-theme');

        expect(floral.content.chatAccent).toBe('#8c264d');
        expect(floral.content.editorAccent).toBe('#c97b62');
        expect(floral.content.annotationAccent).toBe('#7e916e');
    });

    it('replaces values synchronously when hot swapped', () => {
        const root = document.createElement('div');
        applyAppearanceTheme('warm-theme', root);
        const warmAccent = root.style.getPropertyValue('--ui-accent');

        applyAppearanceTheme('slate-theme', root);

        expect(root.dataset.appearanceTheme).toBe('slate-theme');
        expect(root.style.getPropertyValue('--ui-accent')).not.toBe(warmAccent);
    });

    it('applies an in-memory theme object without registering it', () => {
        const root = document.createElement('div');
        const base = getAppearanceTheme('warm-theme');
        applyAppearanceTheme({
            ...base,
            ui: { ...base.ui, accent: '#123456' },
            content: { ...base.content, editorAccent: '#abcdef' },
        }, root);

        expect(root.dataset.appearanceTheme).toBe('warm-theme');
        expect(root.style.getPropertyValue('--ui-accent')).toBe('#123456');
        expect(root.style.getPropertyValue('--content-editor-accent')).toBe('#abcdef');
        expect(APPEARANCE_THEMES['warm-theme'].ui.accent).not.toBe('#123456');
    });
});
