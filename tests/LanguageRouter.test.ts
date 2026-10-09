import { describe, expect, it } from 'vitest';
import { resolveLanguage } from '../src/editor/LanguageRouter';

function languageName(sourceKey: string, content = ''): string | null {
    return resolveLanguage(sourceKey, content)?.language.name ?? null;
}

function errorNodes(sourceKey: string, content: string): number {
    const support = resolveLanguage(sourceKey, content);
    if (!support) return 0;
    const cursor = support.language.parser.parse(content).cursor();
    let errors = 0;
    do {
        if (cursor.type.isError) errors++;
    } while (cursor.next());
    return errors;
}

describe('editor language routing', () => {
    it.each([
        ['file.js', 'javascript'],
        ['file.mjs', 'javascript'],
        ['file.cjs', 'javascript'],
        ['file.jsx', 'javascript'],
        ['file.ts', 'typescript'],
        ['file.mts', 'typescript'],
        ['file.cts', 'typescript'],
        ['file.tsx', 'typescript'],
        ['file.py', 'python'],
        ['file.pyw', 'python'],
        ['file.json', 'json'],
        ['file.jsonc', 'jsonc'],
    ])('routes %s to %s', (sourceKey, expected) => {
        expect(languageName(sourceKey)).toBe(expected);
    });

    it('enables JSX and TSX parser dialects for their respective extensions', () => {
        expect(errorNodes('component.jsx', 'const view = <Panel enabled />;')).toBe(0);
        expect(errorNodes(
            'component.tsx',
            'const view: JSX.Element = <Panel enabled={true} />;',
        )).toBe(0);
    });

    it.each([
        ['tsconfig.json'],
        ['tsconfig.app.json'],
        ['jsconfig.json'],
    ])('recognizes JSONC configuration filename %s', sourceKey => {
        expect(languageName(sourceKey)).toBe('jsonc');
    });

    it('does not assign workspace-tool formats their own language routes', () => {
        expect(languageName('generated.map')).toBeNull();
        expect(languageName('project.code-workspace')).toBeNull();
        expect(languageName('/project/.vscode/settings.json')).toBe('json');
    });

    it('parses JSONC comments and trailing commas without error nodes', () => {
        const source = [
            '{',
            '  // line comment',
            '  "enabled": true,',
            '  /* block comment */',
            '}',
        ].join('\n');

        expect(errorNodes('settings.jsonc', source)).toBe(0);
        expect(errorNodes('settings.json', source)).toBeGreaterThan(0);
    });

    it.each([
        ['untitled', 'def calculate(value):\n    return value', 'python'],
        ['untitled', 'const value = calculate();', 'javascript'],
        ['untitled', 'import value from "./value.js";', 'javascript'],
        ['untitled', '{"enabled": true}', 'json'],
        ['untitled', '// preferences\n{"enabled": true,}', 'jsonc'],
    ])('detects unlabelled content as %s', (_sourceKey, content, expected) => {
        expect(languageName('untitled', content)).toBe(expected);
    });

    it.each([
        ['', ''],
        ['README', 'This is ordinary prose, not Python.'],
        ['notes.txt', 'class is a word that can occur in prose.'],
    ])('keeps %s as plain text when no language is evident', (sourceKey, content) => {
        expect(resolveLanguage(sourceKey, content)).toBeNull();
    });
});
