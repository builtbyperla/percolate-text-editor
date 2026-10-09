import { describe, expect, it } from 'vitest';
import { BlockInfo, BlockType } from '@codemirror/view';
import { rulerTextBlock } from '../src/editor/CmEditorFrame';

const block = (type: BlockInfo['type'], top: number): BlockInfo => ({
    from: 0,
    length: 0,
    top,
    height: 20,
    type,
    to: 0,
    bottom: top + 20,
    widget: null,
    widgetLineBreaks: 0,
} as BlockInfo);

describe('CodeMirror ruler block positioning', () => {
    it('uses the text row rather than a preceding spacer composite top', () => {
        const spacer = block(BlockType.WidgetBefore, 20);
        const text = block(BlockType.Text, 60);
        const composite = block([spacer, text], 20);

        expect(rulerTextBlock(composite)).toBe(text);
        expect(rulerTextBlock(composite)?.top).toBe(60);
    });

    it('keeps an ordinary text block unchanged', () => {
        const text = block(BlockType.Text, 40);
        expect(rulerTextBlock(text)).toBe(text);
    });
});
