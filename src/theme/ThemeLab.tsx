import { For, Show, createMemo, createSignal } from 'solid-js';
import { EDITOR_THEMES, EditorThemeName, THEME_STYLES } from '../editor/editorThemes';
import { userSettings } from '../UserSettings';
import {
    APPEARANCE_THEMES,
    AppearanceTheme,
    ContentThemeTokens,
    createMutedThreeColorAppearanceTheme,
    createSingleColorAppearanceTheme,
    createThreeColorAppearanceTheme,
    createTwoColorAppearanceTheme,
} from './appearanceThemes';
import styles from '../styles/Toolbar.module.css';

type TokenGroup = 'ui' | 'content';
type FactoryKind = 'single-color' | 'two-color' | 'three-color' | 'three-color-muted';

const baseInputs: ReadonlyArray<{ group: TokenGroup; token: string; label: string }> = [
    { group: 'ui', token: 'surface', label: 'Primary' },
    { group: 'ui', token: 'accent', label: 'Accent' },
    { group: 'ui', token: 'secondaryAccent', label: 'Secondary accent' },
    { group: 'ui', token: 'secondarySurface', label: 'Secondary surface' },
    { group: 'content', token: 'chatBackground', label: 'Chat background' },
    { group: 'content', token: 'chatAccent', label: 'Chat accent' },
    { group: 'ui', token: 'tertiarySurface', label: 'Third surface' },
];

const baseKeys = new Set(baseInputs.map(({ group, token }) => `${group}.${token}`));
const syntaxTokenNames = [
    'comment', 'string', 'regexp', 'constant', 'variable', 'definition', 'keyword',
    'operator', 'separator', 'punctuation', 'function', 'class', 'type', 'bracket',
    'attribute',
] as const;
const friendlyName = (token: string) => token
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, character => character.toUpperCase());
const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

function resolveToHex(value: string): string | null {
    const probe = document.createElement('span');
    probe.style.color = value;
    probe.style.display = 'none';
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const channels = resolved.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (!channels || channels.length !== 3) return null;
    return `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function cloneTheme(theme: AppearanceTheme): AppearanceTheme {
    return { ...theme, ui: { ...theme.ui }, content: { ...theme.content } };
}

function derivedContent(content: ContentThemeTokens, changedToken: string, colorScheme?: 'light' | 'dark'): Partial<ContentThemeTokens> {
    const editor = content.editorAccent;
    const editorBg = content.editorBackground;
    const annotation = content.annotationAccent;
    const annotationBg = content.annotationBackground;
    const contrast = colorScheme === 'dark' ? 'white' : 'black';
    if (changedToken === 'editorAccent' || changedToken === 'editorBackground') return {
        editorRulerBackground: `color-mix(in srgb, ${editor} 7%, ${editorBg})`,
        editorRulerAccent: editor,
        editorRulerHoverBackground: `color-mix(in srgb, ${editor} 11%, ${editorBg})`,
        editorRulerBorder: editor,
        editorRulerHoverBorder: editor,
        tabBackground: `color-mix(in srgb, ${editor} 5%, ${editorBg})`,
        tabBorder: editor,
        tabText: editor,
        evidenceSourceBackground: `color-mix(in srgb, ${editor} 7%, ${editorBg})`,
        evidenceSourceBorder: editor,
        evidenceSourceText: editor,
    };
    if (changedToken === 'annotationAccent' || changedToken === 'annotationBackground') return {
        annotationAccentStrong: `color-mix(in srgb, ${annotation} 78%, ${contrast})`,
        annotationAccentHover: `color-mix(in srgb, ${annotation} 84%, ${contrast})`,
        annotationRulerBackground: `color-mix(in srgb, ${annotation} 12%, ${annotationBg})`,
        annotationRulerText: `color-mix(in srgb, ${annotation} 78%, ${contrast})`,
        annotationRulerHoverBackground: `color-mix(in srgb, ${annotation} 18%, ${annotationBg})`,
        annotationRulerHoverText: `color-mix(in srgb, ${annotation} 84%, ${contrast})`,
        annotationHighlight: `color-mix(in srgb, ${annotation} 20%, ${annotationBg})`,
        nativeSelection: `color-mix(in srgb, ${annotation} 40%, transparent)`,
        annotationDrag: `color-mix(in srgb, ${annotation} 28%, transparent)`,
        annotationHover: `color-mix(in srgb, ${annotation} 8%, transparent)`,
        annotationTabBackground: `color-mix(in srgb, ${annotation} 8%, ${annotationBg})`,
        annotationTabHoverBackground: `color-mix(in srgb, ${annotation} 14%, ${annotationBg})`,
        annotationRulerBorder: `color-mix(in srgb, ${annotation} 78%, ${contrast})`,
        annotationRulerHoverBorder: `color-mix(in srgb, ${annotation} 78%, ${contrast})`,
        annotationTabBorder: `color-mix(in srgb, ${annotation} 70%, ${contrast})`,
        evidenceAnnotationBackground: `color-mix(in srgb, ${annotation} 12%, ${annotationBg})`,
        evidenceAnnotationBorder: annotation,
        evidenceAnnotationText: annotation,
        evidenceAnnotationToggle: `color-mix(in srgb, ${annotation} 78%, ${contrast})`,
        noteBorder: annotation,
        noteDot: annotation,
        noteLine: `color-mix(in srgb, ${annotation} 55%, transparent)`,
    };
    return {};
}

function contentDerivedFromUi(theme: AppearanceTheme, changedToken: string): Partial<ContentThemeTokens> {
    const contrast = theme.colorScheme === 'dark' ? 'white' : 'black';
    const shade = theme.colorScheme === 'dark' ? 'white' : 'black';
    if (changedToken === 'surface') return {
        chatBackground: theme.ui.secondarySurface,
        evidencePaneBackground: theme.ui.secondarySurface,
    };
    if (changedToken === 'secondarySurface') return {
        chatBackground: theme.ui.secondarySurface,
        evidencePaneBackground: theme.ui.secondarySurface,
    };
    if (changedToken === 'tertiarySurface') return {
        annotationBackground: theme.ui.tertiarySurface,
        annotationRulerBackground: `color-mix(in srgb, ${theme.ui.tertiarySurface} 92%, ${shade})`,
        annotationRulerText: `color-mix(in srgb, ${theme.ui.tertiarySurface} 58%, ${contrast})`,
        annotationRulerHoverBackground: `color-mix(in srgb, ${theme.ui.tertiarySurface} 84%, ${shade})`,
        annotationRulerHoverText: `color-mix(in srgb, ${theme.ui.tertiarySurface} 48%, ${contrast})`,
        annotationRulerBorder: `color-mix(in srgb, ${theme.ui.tertiarySurface} 68%, ${contrast})`,
        annotationRulerHoverBorder: `color-mix(in srgb, ${theme.ui.tertiarySurface} 58%, ${contrast})`,
    };
    if (changedToken === 'surfaceHover') return {
        evidenceHeaderBackground: theme.ui.surfaceHover,
        evidenceActionsBackground: theme.ui.surfaceHover,
    };
    if (changedToken === 'tooltip') return {
        noteSurface: theme.ui.tooltip,
    };
    if (changedToken === 'tooltipText') return {
        noteText: theme.ui.tooltipText,
    };
    return {};
}

function setUnlessOverridden(
    target: Record<string, string>,
    values: Record<string, string>,
    group: TokenGroup,
    explicit: ReadonlySet<string>,
) {
    for (const [token, value] of Object.entries(values)) {
        if (!explicit.has(`${group}.${token}`)) target[token] = value;
    }
}

function deriveUiPalette(theme: AppearanceTheme, changedToken: string, explicit: ReadonlySet<string>) {
    const ui = theme.ui as Record<string, string>;
    const surface = theme.ui.surface;
    const canvas = theme.ui.canvas;
    const text = theme.ui.text;
    const accent = theme.ui.accent;
    const dark = theme.colorScheme === 'dark';

    if (changedToken === 'surface' || changedToken === 'canvas' || changedToken === 'text') {
        setUnlessOverridden(ui, {
            secondarySurface: surface,
            tertiarySurface: `color-mix(in srgb, ${theme.ui.secondaryAccent} 8%, ${surface})`,
            surfaceRaised: dark
                ? `color-mix(in srgb, ${surface} 92%, white)`
                : `color-mix(in srgb, ${surface} 32%, white)`,
            surfaceRaisedFrame: dark
                ? `color-mix(in srgb, ${surface} 86%, white)`
                : `color-mix(in srgb, ${surface} 22%, white)`,
            surfaceHover: `color-mix(in srgb, ${surface} 94%, ${text})`,
            border: `color-mix(in srgb, ${surface} 84%, ${text})`,
            borderStrong: `color-mix(in srgb, ${surface} 72%, ${text})`,
            textMuted: `color-mix(in srgb, ${text} 70%, ${surface})`,
            textSubtle: `color-mix(in srgb, ${text} 48%, ${surface})`,
            scrollbar: `color-mix(in srgb, ${surface} 76%, ${text})`,
            scrollbarHover: `color-mix(in srgb, ${surface} 58%, ${text})`,
            overlay: `color-mix(in srgb, ${text} 32%, transparent)`,
            tooltip: `color-mix(in srgb, ${text} 92%, ${surface})`,
            tooltipText: `color-mix(in srgb, ${surface} 92%, ${text})`,
            shadow: `color-mix(in srgb, ${text} 12%, transparent)`,
        }, 'ui', explicit);
    }
    if (changedToken === 'accent' || changedToken === 'surface' || changedToken === 'text') {
        setUnlessOverridden(ui, {
            accentHover: `color-mix(in srgb, ${accent} 82%, ${text})`,
            accentSoft: `color-mix(in srgb, ${accent} 14%, ${surface})`,
            settingsAccent: `color-mix(in oklch, ${accent} 72%, ${theme.ui.textMuted})`,
            selection: `color-mix(in srgb, ${accent} 18%, transparent)`,
        }, 'ui', explicit);
    }
    if (changedToken === 'secondaryAccent') {
        setUnlessOverridden(ui, {
            tertiarySurface: `color-mix(in srgb, ${theme.ui.secondaryAccent} 8%, ${theme.ui.secondarySurface})`,
        }, 'ui', explicit);
    }
}

export function ThemeLab() {
    const [open, setOpen] = createSignal(false);
    const [copyStatus, setCopyStatus] = createSignal('');
    const [explicitOverrides, setExplicitOverrides] = createSignal<Set<string>>(new Set());
    const [factoryKind, setFactoryKind] = createSignal<FactoryKind>('three-color');
    const [factoryBase, setFactoryBase] = createSignal('#ffffff');
    const [factoryPrimary, setFactoryPrimary] = createSignal('#526f8a');
    const [factorySecondary, setFactorySecondary] = createSignal('#9b3f62');
    const selectedBase = () => APPEARANCE_THEMES[userSettings.appearance.theme()];
    const draft = () => userSettings.appearance.customTheme() ?? selectedBase();
    const overrideKeys = createMemo(() => {
        const current = draft();
        const base = selectedBase();
        const keys = new Set<string>();
        for (const group of ['ui', 'content'] as const) {
            for (const token of Object.keys(current[group])) {
                if (current[group][token as keyof typeof current[typeof group]] !== base[group][token as keyof typeof base[typeof group]]) {
                    keys.add(`${group}.${token}`);
                }
            }
        }
        return keys;
    });

    const applyFactory = () => {
        const base = selectedBase();
        const kind = factoryKind();
        const generated = kind === 'single-color'
            ? createSingleColorAppearanceTheme(base.id, `${base.label} custom`, factoryPrimary())
            : kind === 'two-color'
                ? createTwoColorAppearanceTheme(base.id, `${base.label} custom`, {
                    base: factoryBase(), accent: factoryPrimary(),
                })
                : kind === 'three-color-muted'
                    ? createMutedThreeColorAppearanceTheme(base.id, `${base.label} custom`, {
                        base: factoryBase(), primary: factoryPrimary(), secondary: factorySecondary(),
                    })
                    : createThreeColorAppearanceTheme(base.id, `${base.label} custom`, {
                        base: factoryBase(), primary: factoryPrimary(), secondary: factorySecondary(),
                    });
        userSettings.appearance.setCustomTheme(generated);
        setExplicitOverrides(new Set());
        setCopyStatus('Factory applied');
    };

    const setToken = (group: TokenGroup, token: string, value: string, derive = false) => {
        const next = cloneTheme(draft());
        if (group === 'ui') {
            (next.ui as Record<string, string>)[token] = value;
            if (derive) {
                if (token === 'surface') {
                    const dark = next.colorScheme === 'dark';
                    setUnlessOverridden(next.ui as Record<string, string>, {
                        canvas: dark ? `color-mix(in srgb, ${value} 84%, black)` : `color-mix(in srgb, ${value} 55%, white)`,
                        text: dark ? `color-mix(in srgb, ${value} 18%, white)` : `color-mix(in srgb, ${value} 20%, black)`,
                    }, 'ui', explicitOverrides());
                    setUnlessOverridden(next.content as Record<string, string>, {
                        editorBackground: dark ? `color-mix(in srgb, ${value} 88%, black)` : `color-mix(in srgb, ${value} 28%, white)`,
                    }, 'content', explicitOverrides());
                }
                if (token === 'accent') {
                    setUnlessOverridden(next.content as Record<string, string>, {
                        editorAccent: value,
                    }, 'content', explicitOverrides());
                }
                if (token === 'secondaryAccent') {
                    setUnlessOverridden(next.content as Record<string, string>, {
                        annotationAccent: value,
                    }, 'content', explicitOverrides());
                }
                if (token === 'secondarySurface') {
                    setUnlessOverridden(next.content as Record<string, string>, {
                        evidencePaneBackground: value,
                    }, 'content', explicitOverrides());
                }
                if (token === 'tertiarySurface') {
                    setUnlessOverridden(next.content as Record<string, string>, {
                        annotationBackground: value,
                    }, 'content', explicitOverrides());
                }
                deriveUiPalette(next, token, explicitOverrides());
                for (const derivedToken of ['surface', 'secondarySurface', 'tertiarySurface', 'surfaceHover', 'border', 'tooltip', 'tooltipText']) {
                    setUnlessOverridden(
                        next.content as Record<string, string>,
                        contentDerivedFromUi(next, derivedToken) as Record<string, string>,
                        'content',
                        explicitOverrides(),
                    );
                }
                if (token === 'surface') {
                    setUnlessOverridden(
                        next.content as Record<string, string>,
                        derivedContent(next.content, 'editorBackground', next.colorScheme) as Record<string, string>,
                        'content', explicitOverrides(),
                    );
                    setUnlessOverridden(
                        next.content as Record<string, string>,
                        derivedContent(next.content, 'annotationBackground', next.colorScheme) as Record<string, string>,
                        'content', explicitOverrides(),
                    );
                }
                if (token === 'accent') {
                    setUnlessOverridden(
                        next.content as Record<string, string>,
                        derivedContent(next.content, 'editorAccent', next.colorScheme) as Record<string, string>,
                        'content', explicitOverrides(),
                    );
                }
                if (token === 'secondaryAccent') {
                    setUnlessOverridden(
                        next.content as Record<string, string>,
                        derivedContent(next.content, 'annotationAccent', next.colorScheme) as Record<string, string>,
                        'content', explicitOverrides(),
                    );
                }
                if (token === 'tertiarySurface') {
                    setUnlessOverridden(
                        next.content as Record<string, string>,
                        derivedContent(next.content, 'annotationBackground', next.colorScheme) as Record<string, string>,
                        'content', explicitOverrides(),
                    );
                }
            }
        } else {
            (next.content as Record<string, string>)[token] = value;
            if (derive) setUnlessOverridden(
                next.content as Record<string, string>,
                derivedContent(next.content, token, next.colorScheme) as Record<string, string>,
                'content',
                explicitOverrides(),
            );
        }
        if (!derive) {
            setExplicitOverrides(previous => new Set(previous).add(`${group}.${token}`));
        }
        userSettings.appearance.setCustomTheme(next);
    };

    const resetToken = (group: TokenGroup, token: string) => {
        setExplicitOverrides(previous => {
            const next = new Set(previous);
            next.delete(`${group}.${token}`);
            return next;
        });
        const next = cloneTheme(draft());
        (next[group] as unknown as Record<string, string>)[token] =
            (selectedBase()[group] as unknown as Record<string, string>)[token];
        userSettings.appearance.setCustomTheme(next);
    };

    const resetDraft = () => {
        userSettings.appearance.setCustomTheme(null);
        userSettings.appearance.setSyntaxTheme(userSettings.appearance.theme());
        setExplicitOverrides(new Set());
        setCopyStatus('');
    };

    const makeOverride = (group: TokenGroup, token: string, value: string) => {
        const resolved = resolveToHex(value);
        if (resolved) setToken(group, token, resolved);
    };

    const copyTheme = async () => {
        const syntaxTheme = userSettings.appearance.syntaxTheme();
        const value = {
            version: 1,
            label: `${selectedBase().label} custom`,
            basedOn: selectedBase().id,
            colorScheme: draft().colorScheme ?? 'light',
            syntax: {
                basedOn: syntaxTheme,
                tokens: Object.fromEntries(THEME_STYLES[syntaxTheme].map((style, index) => [
                    syntaxTokenNames[index] ?? `token${index + 1}`,
                    style.color,
                ])),
            },
            ui: draft().ui,
            content: draft().content,
        };
        try {
            await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
            setCopyStatus('Copied');
        } catch {
            setCopyStatus('Clipboard unavailable');
        }
    };

    const TokenInput = (props: { group: TokenGroup; token: string; label?: string; derive?: boolean }) => {
        const value = () => (draft()[props.group] as unknown as Record<string, string>)[props.token];
        const overridden = () => overrideKeys().has(`${props.group}.${props.token}`);
        return (
            <label class={styles.themeTokenRow}>
                <span class={styles.themeTokenLabel}>{props.label ?? friendlyName(props.token)}</span>
                <span class={styles.themeTokenControls}>
                    <Show when={isHexColor(value())}>
                        <input
                            class={styles.themeColorInput}
                            type="color"
                            value={value()}
                            onInput={event => setToken(props.group, props.token, event.currentTarget.value, props.derive)}
                        />
                    </Show>
                    <Show when={!isHexColor(value())}>
                        <button
                            class={styles.themeOverrideChip}
                            title="Turn this computed color into an editable override"
                            onClick={() => makeOverride(props.group, props.token, value())}
                        >Override</button>
                    </Show>
                    <input
                        class={styles.themeValueInput}
                        value={value()}
                        spellcheck={false}
                        onChange={event => setToken(props.group, props.token, event.currentTarget.value, props.derive)}
                    />
                    <button
                        class={styles.themeResetButton}
                        disabled={!overridden()}
                        title={`Reset ${props.label ?? friendlyName(props.token)}`}
                        onClick={() => resetToken(props.group, props.token)}
                    >↺</button>
                </span>
            </label>
        );
    };

    return (
        <section class={styles.themeLab}>
            <button class={styles.themeLabToggle} onClick={() => setOpen(value => !value)}>
                {open() ? 'Close Theme Lab' : 'Open Theme Lab'}
            </button>
            <Show when={open()}>
                <div class={styles.themeLabBody}>
                    <p class={styles.themeLabIntro}>Changes preview immediately and remain in memory until reload.</p>
                    <div class={styles.themeFactory}>
                        <label class={styles.themeTokenRow}>
                            <span class={styles.themeTokenLabel}>Theme factory</span>
                            <select
                                class={styles.themeSelect}
                                value={factoryKind()}
                                onChange={event => setFactoryKind(event.currentTarget.value as FactoryKind)}
                            >
                                <option value="single-color">Single color</option>
                                <option value="two-color">Two color</option>
                                <option value="three-color">Three color</option>
                                <option value="three-color-muted">Three color — muted</option>
                            </select>
                        </label>
                        <div class={styles.themeFactoryColors}>
                            <Show when={factoryKind() !== 'single-color'}>
                                <label>
                                    <span>Base</span>
                                    <input type="color" value={factoryBase()} onInput={event => setFactoryBase(event.currentTarget.value)} />
                                </label>
                            </Show>
                            <label>
                                <span>{factoryKind() === 'single-color' ? 'Color' : 'Primary'}</span>
                                <input type="color" value={factoryPrimary()} onInput={event => setFactoryPrimary(event.currentTarget.value)} />
                            </label>
                            <Show when={factoryKind() === 'three-color' || factoryKind() === 'three-color-muted'}>
                                <label>
                                    <span>Secondary</span>
                                    <input type="color" value={factorySecondary()} onInput={event => setFactorySecondary(event.currentTarget.value)} />
                                </label>
                            </Show>
                        </div>
                        <button class={styles.themeFactoryApply} onClick={applyFactory}>Apply factory</button>
                    </div>
                    <h4 class={styles.themeLabHeading}>Base colors</h4>
                    <For each={baseInputs}>{input => (
                        <TokenInput {...input} derive />
                    )}</For>
                    <label class={styles.themeTokenRow}>
                        <span class={styles.themeTokenLabel}>Syntax highlighting</span>
                        <select
                            class={styles.themeSelect}
                            value={userSettings.appearance.syntaxTheme()}
                            onChange={event => userSettings.appearance.setSyntaxTheme(event.currentTarget.value as EditorThemeName)}
                        >
                            <For each={Object.keys(EDITOR_THEMES) as EditorThemeName[]}>{id => (
                                <option value={id}>{APPEARANCE_THEMES[id].label}</option>
                            )}</For>
                        </select>
                    </label>
                    <details class={styles.themeAdvanced}>
                        <summary>Advanced overrides</summary>
                        <h4 class={styles.themeLabHeading}>UI tokens</h4>
                        <For each={Object.keys(draft().ui).filter(token => !baseKeys.has(`ui.${token}`))}>
                            {token => <TokenInput group="ui" token={token} />}
                        </For>
                        <h4 class={styles.themeLabHeading}>Content tokens</h4>
                        <For each={Object.keys(draft().content).filter(token => !baseKeys.has(`content.${token}`))}>
                            {token => <TokenInput group="content" token={token} />}
                        </For>
                    </details>
                    <div class={styles.themeLabActions}>
                        <button onClick={resetDraft}>Reset all</button>
                        <button onClick={copyTheme}>Copy theme JSON</button>
                        <span role="status">{copyStatus()}</span>
                    </div>
                </div>
            </Show>
        </section>
    );
}
