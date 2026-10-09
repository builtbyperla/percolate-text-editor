import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { jsonc } from '@platformos/lang-jsonc';
import { LanguageSupport } from '@codemirror/language';

// Map common file extensions to a language support factory.
const EXT_MAP: Record<string, () => LanguageSupport> = {
    py:    () => python(),
    pyw:   () => python(),
    js:    () => javascript(),
    mjs:   () => javascript(),
    cjs:   () => javascript(),
    jsx:   () => javascript({ jsx: true }),
    ts:    () => javascript({ typescript: true }),
    mts:   () => javascript({ typescript: true }),
    cts:   () => javascript({ typescript: true }),
    tsx:   () => javascript({ jsx: true, typescript: true }),
    json:  () => json(),
    jsonc: () => jsonc(),
};

const JSONC_BASENAMES = new Set([
    'jsconfig.json',
    'tsconfig.json',
]);

function isJsoncSource(sourceKey: string): boolean {
    const normalized = sourceKey.replaceAll('\\', '/').toLowerCase();
    const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
    if (JSONC_BASENAMES.has(basename)) return true;
    return /^(?:js|ts)config\..+\.json$/.test(basename);
}

function detectFromContent(text: string): LanguageSupport | null {
    const trimmed = text.replace(/^\uFEFF/, '').trimStart();
    if (!trimmed) return null;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return json();
    // Unknown files that begin with comments but immediately contain an object or
    // array are much more likely to be JSONC than JavaScript.
    const withoutLeadingComments = trimmed
        .replace(/^(?:(?:\/\/[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/)|\s)*/, '')
        .trimStart();
    if (withoutLeadingComments.startsWith('{') || withoutLeadingComments.startsWith('[')) return jsonc();
    // JS/TS-specific patterns that don't appear in Python
    if (/^(?:#!.*\bnode\b|import .+ from |const |let |var |function |export |require\()/.test(trimmed)) return javascript();
    // Python-specific patterns: 'from x import', 'def ', 'async def', type hints '-> '
    if (/^(?:#!.*\bpython\b|from \S+ import |import \S+|def |async def |class \w+.*:|@\w+)/.test(trimmed)) return python();
    return null;
}

/** Return the best language for a source, or null when it should remain plain text. */
export function resolveLanguage(sourceKey: string, content: string): LanguageSupport | null {
    if (isJsoncSource(sourceKey)) return jsonc();
    const ext = sourceKey.split('.').pop()?.toLowerCase() ?? '';
    const factory = EXT_MAP[ext];
    if (factory) return factory();
    return detectFromContent(content);
}
