import { describe, it, expect } from 'vitest';
import { detectIndentUnit } from '../src/editor/detectIndent';

describe('detectIndentUnit', () => {
    it('returns a tab when any line is tab-indented', () => {
        const text = 'def f():\n\treturn 1\n';
        expect(detectIndentUnit(text)).toBe('\t');
    });

    it('prefers a tab over spaces when both appear', () => {
        const text = '    spaced()\n\ttabbed()\n';
        expect(detectIndentUnit(text)).toBe('\t');
    });

    it('detects a 2-space unit', () => {
        const text = 'const o = {\n  a: 1,\n  b: 2,\n};\n';
        expect(detectIndentUnit(text)).toBe('  ');
    });

    it('detects a 4-space unit', () => {
        const text = 'def f():\n    return 1\n';
        expect(detectIndentUnit(text)).toBe('    ');
    });

    it('takes the smallest positive indent as the unit', () => {
        // A nested 8-space line should not raise the unit above the 4-space step.
        const text = 'def f():\n    if x:\n        return 1\n';
        expect(detectIndentUnit(text)).toBe('    ');
    });

    it('clamps a suspiciously large lone indent to the max', () => {
        const text = 'x = (\n          continued\n)\n';
        expect(detectIndentUnit(text)).toBe(' '.repeat(8));
    });

    it('falls back when nothing is indented', () => {
        expect(detectIndentUnit('a\nb\nc\n')).toBe('    ');
    });

    it('honors a custom fallback', () => {
        expect(detectIndentUnit('no indent', '\t')).toBe('\t');
    });

    it('ignores blank / whitespace-only lines', () => {
        const text = 'a\n   \n  real: 1\n';
        expect(detectIndentUnit(text)).toBe('  ');
    });
});
