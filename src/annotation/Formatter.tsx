import { JSX } from 'solid-js';

type StyleObj = JSX.CSSProperties;

// Lightweight, sliceable render description (not HTML). For LineFormatter: the segment-relative offsets where each line begins.
export type RenderInfo = number[];

// A segment's data unit: raw text + optional render-info, flowed through slicing/merging instead of a bare string.
export interface TextReprData {
    text: string;
    renderInfo?: RenderInfo;
}

export interface Formatter {
    // Produce render-info for raw text at load time (undefined = a single run).
    analyze(rawText: string): RenderInfo | undefined;

    // Emit the visual units the segment wraps. Each text-bearing unit MUST stamp
    // data-offset (segment-relative start); ornaments stamp none + user-select:none.
    renderUnits(rawText: string, info: RenderInfo | undefined): JSX.Element;

    // Slice render-info to [start, end), rebased to the slice origin (no re-running analyze).
    sliceInfo(info: RenderInfo | undefined, start: number, end: number): RenderInfo | undefined;
}

// Default formatter: renders raw text as a single flat unit (one text node, data-offset="0").
export class PlainFormatter implements Formatter {
    analyze(_rawText: string): RenderInfo | undefined {
        return undefined;
    }

    renderUnits(rawText: string, _info: RenderInfo | undefined): JSX.Element {
        return <span data-offset={0}>{rawText}</span>;
    }

    sliceInfo(_info: RenderInfo | undefined, _start: number, _end: number): RenderInfo | undefined {
        return undefined;
    }

}

// Splits raw text into per-line rows, each stamped with its segment-relative start offset.
export class LineFormatter implements Formatter {
    // Start offset of every line after the first (just past each "\n"); line 0 is implicit.
    analyze(rawText: string): RenderInfo | undefined {
        const breaks: number[] = [];
        for (let i = 0; i < rawText.length; i++) {
            if (rawText[i] === '\n') {
                breaks.push(i + 1);
            }
        }
        return breaks;
    }

    renderUnits(rawText: string, info: RenderInfo | undefined): JSX.Element {
        const breaks = info ?? [];
        const starts = [0, ...breaks];
        const rows: { start: number; text: string }[] = [];
        for (let i = 0; i < starts.length; i++) {
            const start = starts[i];
            const end = i + 1 < starts.length ? starts[i + 1] : rawText.length;
            const text = rawText.slice(start, end).replace(/\n$/, '');
            rows.push({ start, text });
        }

        return (
            <>
                {rows.map(row => (
                    // data-offset = line start, so selection reads offset = start + range.startOffset.
                    <span data-offset={row.start} style={{ display: 'block' }}>
                        {row.text}
                    </span>
                ))}
            </>
        );
    }

    // Keep only the breaks inside (start, end) and rebase them to the slice origin.
    sliceInfo(info: RenderInfo | undefined, start: number, end: number): RenderInfo | undefined {
        if (info == null) return undefined;
        const sliced: number[] = [];
        for (const b of info) {
            if (b > start && b < end) {
                sliced.push(b - start);
            }
        }
        return sliced;
    }
}
