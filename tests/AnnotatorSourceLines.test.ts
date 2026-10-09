import { expect, it } from 'vitest';
import { AnnotatorRenderLayer } from '../src/editor/DualTextView';
import { PlainTextSegment } from '../src/annotation/TextViewCore';
import { FixedTextDataModel } from '../src/textmodel/FixedTextDataModel';
import type { AnnotationTextView } from '../src/annotation/AnnotationTextView';

it('passes source lines through folded text and section boundaries', () => {
    const text = 'start {\n  hidden A\n  hidden B\n}\nafter\n';
    const split = text.indexOf('hidden B');
    const input = {
        sections: [
            new PlainTextSegment(text.slice(0, split), 0, 0),
            new PlainTextSegment(text.slice(split), 1, split),
        ],
        dataSource: new FixedTextDataModel(text),
        parent: {} as AnnotationTextView,
    };
    const layer = new AnnotatorRenderLayer('sample.ts');

    expect(layer.buildUnits(input, 0, text.length).sourceLines).toEqual([1, 2, 3, 4, 5]);

    layer.configureFolding(() => [{
        from: text.indexOf('{') + 1,
        to: text.indexOf('}'),
        startLine: 1,
        endLine: 4,
        hiddenLines: 3,
    }], () => {});
    const folded = layer.buildUnits(input, 0, text.length);
    expect(folded.sourceLines).toEqual([1, 5]);
    expect(folded.units).toHaveLength(2);
    expect(folded.units.every(unit => !('sourceLine' in unit))).toBe(true);
});
