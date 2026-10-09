import { describe, it, expect } from 'vitest';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';

// Tier-1: the TextDataModel "kind + getData" escape hatch. A plain CmTextDataModel is
// the DEFAULT source kind — kind() is 'text' and getData() returns a tagged-union payload
// carrying its current text. This is the extension point future source kinds (diff, ...)
// override; asserting the default here pins that existing call sites see 'text'.

describe('CmTextDataModel kind()/getData()', () => {
    it('defaults kind() to "text"', () => {
        expect(new CmTextDataModel('hello').kind()).toBe('text');
    });

    it('getData() returns a tagged text payload with the current text', () => {
        const m = new CmTextDataModel('a\nb\n');
        expect(m.getData()).toEqual({ kind: 'text', text: 'a\nb\n' });
    });

    it('getData() reflects the latest text after an edit', () => {
        const m = new CmTextDataModel('a\nb\n');
        m.setValue('a\nB\nc\n');
        expect(m.getData()).toEqual({ kind: 'text', text: 'a\nB\nc\n' });
    });
});
