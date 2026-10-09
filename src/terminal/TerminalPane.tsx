import { JSX } from 'solid-js';
import { Terminal as XTerminal, ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ViewBlock } from '../containers/Tabs';
import { EDITOR_FONT } from '../editor/CmEditorFrame';
import { APPEARANCE_THEME_CHANGE_EVENT } from '../theme/appearanceThemes';
import type { Dispose, PtyProvider, PtySession } from './PtyProvider';

// Resolve through an element's computed color so theme values that use var()
// or color-mix() become concrete colors xterm can consume.
function themeColor(property: string): string {
    const probe = document.createElement('span');
    probe.style.color = `var(${property})`;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
}

// xterm uses the value in canvas font declarations, where a CSS var() expression
// is not resolved. Hand it the custom property's concrete font stack instead.
function terminalFontFamily(): string {
    const family = getComputedStyle(document.documentElement)
        .getPropertyValue('--font-mono')
        .trim();
    return family || 'ui-monospace, monospace';
}

function terminalTheme(): ITheme {
    const background = themeColor('--content-editor-background');
    const foreground = themeColor('--ui-text');
    const accent = themeColor('--ui-accent');
    const selection = themeColor('--content-native-selection');

    return {
        background,
        foreground,
        cursor: accent,
        cursorAccent: background,
        selectionBackground: selection,
        black: '#5c6166',
        red: '#c47d52',
        green: '#7a9e52',
        yellow: '#b8924a',
        blue: '#5491b8',
        magenta: '#8a7eb0',
        cyan: '#6aa3b8',
        white: '#8a9199',
        brightBlack: '#8a919999',
        brightRed: '#c47d52',
        brightGreen: '#7a9e52',
        brightYellow: '#b8924a',
        brightBlue: '#5491b8',
        brightMagenta: '#8a7eb0',
        brightCyan: '#6aa3b8',
        brightWhite: foreground,
    };
}

export class TerminalPane implements ViewBlock {
    ownsScroll: boolean = false;

    private term: XTerminal | null = null;
    private fit: FitAddon | null = null;
    private session: PtySession | null = null;
    private disposers: Dispose[] = [];
    private ro: ResizeObserver | null = null;

    // The private element xterm is opened into. Persistent across mounts — it is
    // moved between host divs, never recreated, so xterm's DOM survives.
    private mountEl: HTMLDivElement | null = null;

    private spawning = false;
    private disposed = false;

    private onAppearanceThemeChange = (): void => {
        if (this.term) this.term.options.theme = terminalTheme();
    };

    constructor(
        private provider: PtyProvider,
        private opts: { shell?: string; cwd?: string } = {},
    ) {}

    // Build the xterm instance + its persistent mount element once. Idempotent.
    private ensureTerm(): XTerminal {
        if (this.term) return this.term;

        this.mountEl = document.createElement('div');
        this.mountEl.style.width = '100%';
        this.mountEl.style.height = '100%';

        this.term = new XTerminal({
            fontFamily: terminalFontFamily(),
            fontSize: EDITOR_FONT.fontSize,
            fontWeight: EDITOR_FONT.fontWeight,
            cursorBlink: true,
            scrollback: 1000,
            theme: terminalTheme(),
        });
        document.documentElement.addEventListener(
            APPEARANCE_THEME_CHANGE_EVENT,
            this.onAppearanceThemeChange,
        );
        this.fit = new FitAddon();
        this.term.loadAddon(this.fit);
        // Open into the persistent element, NOT the framework-owned host.
        this.term.open(this.mountEl);
        return this.term;
    }

    private async attach(host: HTMLElement): Promise<void> {
        if (this.disposed) return;
        const term = this.ensureTerm();

        if (this.mountEl && this.mountEl.parentElement !== host) {
            host.appendChild(this.mountEl);
        }

        queueMicrotask(() => {
            if (this.disposed) return;
            this.fit?.fit();
            if (this.session && this.term) {
                this.session.resize(this.term.cols, this.term.rows);
            }
        });

        this.ro?.disconnect();
        this.ro = new ResizeObserver(() => {
            this.fit?.fit();
            if (this.session && this.term) {
                this.session.resize(this.term.cols, this.term.rows);
            }
        });
        this.ro.observe(host);

        if (this.session || this.spawning) return;
        this.spawning = true;
        try {
            const session = await this.provider.spawn({
                cols: term.cols,
                rows: term.rows,
                ...this.opts,
            });
            if (this.disposed) {
                // Tab closed during the spawn round-trip — don't leak the shell.
                session.dispose();
                return;
            }
            this.session = session;
            this.disposers.push(session.onData(d => this.term?.write(d)));
            this.disposers.push(
                session.onExit(() => this.term?.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n')),
            );
            const inputSub = term.onData(d => this.session?.write(d));
            this.disposers.push(() => inputSub.dispose());
        } catch (err) {
            // NullPtyProvider (browser dev) rejects here; surface it in the pane
            // rather than failing silently.
            const msg = err instanceof Error ? err.message : String(err);
            term.write(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
        } finally {
            this.spawning = false;
        }
    }

    getVisual(): () => JSX.Element {
        return () => (
            <div
                style={{ height: '100%', width: '100%', overflow: 'hidden' }}
                ref={(el: HTMLDivElement) => {
                    queueMicrotask(() => this.attach(el));
                }}
            />
        );
    }

    dispose(): void {
        this.disposed = true;
        document.documentElement.removeEventListener(
            APPEARANCE_THEME_CHANGE_EVENT,
            this.onAppearanceThemeChange,
        );
        this.ro?.disconnect();
        this.ro = null;
        for (const d of this.disposers) d();
        this.disposers = [];
        this.session?.dispose();
        this.session = null;
        this.term?.dispose();
        this.term = null;
        this.mountEl = null;
    }
}
