import { JSX } from 'solid-js/jsx-runtime';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import mdStyles from '../styles/Markdown.module.css';
import { BULLET, INDENT_UNIT } from './MarkdownModel';

interface InlineSpan {
    text: string;
    style?: JSX.CSSProperties;
}

const STRONG_STYLE: JSX.CSSProperties = { 'font-weight': 700 };
const EMPHASIS_STYLE: JSX.CSSProperties = { 'font-style': 'italic' };
const CODE_STYLE: JSX.CSSProperties = {
    'font-family': 'var(--font-mono)',
    'background-color': 'color-mix(in srgb, var(--ui-text) 5%, transparent)',
    'border-radius': '3px',
    padding: '0 3px',
};

// A rendered visual line the scanner emits. `kind` picks the wrapper; `spans`
// are the inline pieces (empty for a code-fence line, which carries raw text).
type LineKind = 'paragraph' | 'heading' | 'bullet' | 'code';

class RenderedLine {
    constructor(
        readonly kind: LineKind,
        readonly spans: InlineSpan[],
        readonly depth = 0,     // heading level, or bullet indent
        readonly raw = '',      // code-fence line's literal text
    ) {}

    getVisual(isLast = false): () => JSX.Element {
        const join = isLast ? '' : '\n';
        return () => {
            switch (this.kind) {
                case 'heading': {
                    const tag = `h${Math.min(Math.max(this.depth, 1), 6)}`;
                    return <Dynamic component={tag}>{renderSpans(this.spans)}{join}</Dynamic>;
                }
                case 'bullet':
                    return (
                        <p>
                            {INDENT_UNIT.repeat(this.depth) + BULLET}
                            {renderSpans(this.spans)}{join}
                        </p>
                    );
                case 'code':
                    return <pre>{this.raw}</pre>;
                default:
                    return <p>{renderSpans(this.spans)}{join}</p>;
            }
        };
    }
}

function renderSpans(spans: InlineSpan[]): JSX.Element {
    return <For each={spans}>{s => (s.style ? <span style={s.style}>{s.text}</span> : s.text)}</For>;
}

function scanInline(text: string): InlineSpan[] {
    const spans: InlineSpan[] = [];
    let plain = '';
    const flush = () => { if (plain) { spans.push({ text: plain }); plain = ''; } };

    let i = 0;
    while (i < text.length) {
        const delim = matchDelimiter(text, i);
        if (delim == null) { plain += text[i]; i++; continue; }

        const closeAt = text.indexOf(delim.token, i + delim.token.length);
        if (closeAt === -1) {
            // Unclosed run: emit the opener + rest as literal (the "open run" the
            // design holds back — it styles once the closer streams in).
            plain += text.slice(i);
            break;
        }
        flush();
        spans.push({ text: text.slice(i + delim.token.length, closeAt), style: delim.style });
        i = closeAt + delim.token.length;
    }
    flush();
    return spans;
}

// The inline delimiter starting at `i`, if any. `code` first (literal inside),
// then the two-char `**`/`__`, then one-char `*`/`_`.
function matchDelimiter(text: string, i: number): { token: string; style: JSX.CSSProperties } | null {
    if (text[i] === '`') return { token: '`', style: CODE_STYLE };
    if (text.startsWith('**', i) || text.startsWith('__', i)) return { token: text.slice(i, i + 2), style: STRONG_STYLE };
    if (text[i] === '*' || text[i] === '_') return { token: text[i], style: EMPHASIS_STYLE };
    return null;
}

// Turn one source line (no trailing '\n') into a RenderedLine by its prefix.
// Block prefixes resolve as soon as they're complete at line start.
function scanBlockLine(line: string): RenderedLine {
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) return new RenderedLine('heading', scanInline(heading[2]), heading[1].length);

    const bullet = /^(\s*)[-*+] (.*)$/.exec(line);
    if (bullet) return new RenderedLine('bullet', scanInline(bullet[2]), Math.floor(bullet[1].length / 2));

    return new RenderedLine('paragraph', scanInline(line));
}

export function scanStreamingMarkdown(raw: string): RenderedLine[] {
    const lines = raw.split('\n');
    const out: RenderedLine[] = [];
    let fenceBody: string[] | null = null; // non-null while inside a fence

    for (const line of lines) {
        if (line.startsWith('```')) {
            if (fenceBody == null) {
                fenceBody = []; // open: start collecting
            } else {
                out.push(new RenderedLine('code', [], 0, fenceBody.join('\n')));
                fenceBody = null; // close: flush the whole block as one unit
            }
            continue; // the fence marker itself is not rendered
        }
        if (fenceBody != null) {
            fenceBody.push(line); // inside a fence, blank lines are real content
            continue;
        }
        if (line.trim() === '') continue;
        out.push(scanBlockLine(line));
    }

    // Unclosed fence (still streaming): render what we have as an open code block.
    if (fenceBody != null) out.push(new RenderedLine('code', [], 0, fenceBody.join('\n')));
    return out;
}

export function StreamingMarkdownBody(
    props: { content: () => string; theme?: string },
): JSX.Element {
    const lines = () => scanStreamingMarkdown(props.content());
    // The same theme classes the settled render wears, so one stylesheet covers both.
    return (
        <div class={`${props.theme ?? ''} ${mdStyles.markdown}`}>
            <For each={lines()}>
                {(line, i) => line.getVisual(i() === lines().length - 1)()}
            </For>
        </div>
    );
}
