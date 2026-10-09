import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import type { Root } from 'mdast';

export const BULLET = '• ';
export const INDENT_UNIT = '  ';

export interface MarkdownRender {
    // The immutable source of record, for the future reverse-map / send path.
    raw: string;
    // The parse, for the render tree to walk.
    tree: Root;
}

export interface RenderMarkdownOptions {
    theme?: string;
}

// Parse raw markdown. GFM tables only — not full gfm, which would also pull in
// strikethrough/footnotes/task-lists/autolinks.
export function renderMarkdown(raw: string, _opts?: RenderMarkdownOptions): MarkdownRender {
    const tree: Root = fromMarkdown(raw, {
        extensions: [gfmTable()],
        mdastExtensions: [gfmTableFromMarkdown()],
    });
    return { raw, tree };
}
