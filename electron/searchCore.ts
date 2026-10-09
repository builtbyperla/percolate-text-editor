// Pure ripgrep glue — no Electron, no child_process, no fs. Split out from
// main.ts so the arg-building and JSON-line parsing are unit-testable in
// isolation (Tier-1). main.ts owns the actual spawn + streaming.

import type { SearchQueryDTO, SearchMatchDTO } from './ipcChannels';
import { ignoreGlobs } from './ignoreRules';

// Build the ripgrep argument vector for a query. `--json` gives us the
// structured stream we parse below; the ignore globs hide the same dirs the
// tree does, layered on top of rg's own .gitignore handling. Flags map:
//   caseSensitive → -s (else smart-case: rg's default is case-insensitive for
//                        all-lowercase patterns, which is the friendly default)
//   regex=false   → -F (fixed-strings: treat the query literally)
//   wholeWord     → -w
// The query itself is passed as the final positional arg (never interpolated
// into a shell — main spawns rg directly with this array, so a query containing
// shell metacharacters is inert).
export function buildRgArgs(q: SearchQueryDTO, searchRoot: string): string[] {
    const args = ['--json'];
    if (q.caseSensitive) args.push('-s');
    else args.push('-S'); // smart-case
    if (!q.regex) args.push('-F');
    if (q.wholeWord) args.push('-w');
    for (const glob of ignoreGlobs()) args.push('--glob', glob);
    // Pattern, THEN an explicit search path. The path is required: with no path
    // and a non-tty stdin (a spawned child always has one), ripgrep reads from
    // STDIN instead of the tree and blocks forever waiting for input that never
    // comes. Passing the ABSOLUTE workspace root (not '.') makes rg emit
    // absolute match paths, which the file opener can read/open directly — a
    // relative './foo' wouldn't resolve against the provider's absolute paths.
    args.push('--', q.query, searchRoot);
    return args;
}

// Parse one line of ripgrep's --json output into a match, or null for any line
// that isn't a `match` event (begin/end/summary/context, or a blank line). rg
// emits newline-delimited JSON objects, one per line; the caller splits the
// stream and feeds each line here.
//
// rg's `data` fields carry text as either { text } (utf-8) or { bytes }
// (base64, for invalid-utf-8 paths). We take `text` when present and fall back
// to a best-effort decode of `bytes`, so a match in a file with an odd path or
// line still surfaces rather than throwing.
export function parseRgLine(line: string): SearchMatchDTO | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let obj: RgJsonEvent;
    try {
        obj = JSON.parse(trimmed) as RgJsonEvent;
    } catch {
        // A partial/garbled line (e.g. a chunk boundary) — skip it; the caller
        // buffers whole lines, so this should only bite on truly malformed output.
        return null;
    }
    if (obj.type !== 'match' || !obj.data) return null;

    const d = obj.data;
    const path = decodeRgText(d.path);
    const preview = decodeRgText(d.lines).replace(/\r?\n$/, '');
    const line1 = d.line_number ?? 0;
    // rg reports zero or more submatches; take the first for the caret column.
    // submatch.start is a 0-based byte offset → present as 1-based column.
    const column = (d.submatches && d.submatches[0] ? d.submatches[0].start : 0) + 1;

    if (!path) return null;
    return { path, line: line1, column, preview };
}

// ---- rg --json shapes (only the fields we read) --------------------------

interface RgText {
    text?: string;
    bytes?: string; // base64 when the value isn't valid utf-8
}

interface RgSubmatch {
    start: number;
    end: number;
}

interface RgMatchData {
    path: RgText;
    lines: RgText;
    line_number?: number;
    submatches?: RgSubmatch[];
}

interface RgJsonEvent {
    type: 'begin' | 'match' | 'end' | 'summary' | 'context';
    data?: RgMatchData;
}

// Prefer utf-8 `text`; fall back to decoding base64 `bytes`. Empty string if
// neither is present (shouldn't happen for a real match, but keeps this total).
function decodeRgText(t: RgText | undefined): string {
    if (!t) return '';
    if (typeof t.text === 'string') return t.text;
    if (typeof t.bytes === 'string') {
        try {
            return Buffer.from(t.bytes, 'base64').toString('utf-8');
        } catch {
            return '';
        }
    }
    return '';
}
