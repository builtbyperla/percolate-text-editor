import { CompletionContext, type Completion, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { codeFolding, ensureSyntaxTree, foldEffect } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
    SearchQuery,
    closeSearchPanel,
    findNext,
    openSearchPanel,
    replaceNext,
    searchPanelOpen,
    setSearchQuery,
} from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
    transientEditorUIExtensions,
    transientEditorUIKeymap,
} from '../src/editor/editorTransientUI';
import { foldInfoForLine, foldSnapshots } from '../src/editor/folding';
import { isSelectionMatchCandidate } from '../src/editor/selectionMatches';
import { lightTheme } from '../src/editor/editorThemes';
import { editorAcceptanceFixture } from './fixtures/editorAcceptance';

const mountedViews: EditorView[] = [];

beforeAll(() => {
    // CodeMirror measures DOM ranges after mount. These tests assert state and
    // transient UI behavior, not browser layout, so empty jsdom geometry is apt.
    if (!Range.prototype.getClientRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', {
            configurable: true,
            value: () => [],
        });
    }
    if (!Range.prototype.getBoundingClientRect) {
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => new DOMRect(),
        });
    }
});

afterEach(() => {
    while (mountedViews.length > 0) mountedViews.pop()!.destroy();
    document.body.replaceChildren();
});

function mountState(state: EditorState): EditorView {
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new EditorView({ state, parent });
    mountedViews.push(view);
    return view;
}

async function languageCompletions(state: EditorState, pos: number): Promise<{
    results: CompletionResult[];
    options: readonly Completion[];
}> {
    const context = new CompletionContext(state, pos, true);
    const sources = state.languageDataAt<CompletionSource | readonly Completion[]>('autocomplete', pos);
    const results: CompletionResult[] = [];

    for (const source of sources) {
        const resolved = Array.isArray(source)
            ? { from: pos, options: source }
            : await (source as CompletionSource)(context);
        if (resolved) results.push(resolved);
    }
    return { results, options: results.flatMap(result => result.options) };
}

describe('transient editor UI', () => {
    it.each([
        ['', false],
        [' ', false],
        ['\t\n', false],
        ['a', false],
        ['7', false],
        ['.', false],
        ['<', false],
        ['🙂', false],
        ['()', true],
        ['same', true],
        ['same value', true],
        ['(', false],
        [')', false],
        ['[', false],
        [']', false],
        ['{', false],
        ['}', false],
    ])('classifies selection-match candidate %j as %s', (selection, expected) => {
        expect(isSelectionMatchCandidate(selection)).toBe(expected);
    });

    it('owns the standard search commands without replacing the browser keymap piecemeal', () => {
        expect(transientEditorUIKeymap).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'Mod-f' }),
            expect.objectContaining({ key: 'F3' }),
            expect.objectContaining({ key: 'Escape' }),
        ]));
    });

    it('searches the full document and unfolds a match selected inside a fold', () => {
        const source = [
            'function searchable() {',
            '  const hiddenNeedle = 1;',
            '  return hiddenNeedle;',
            '}',
        ].join('\n');
        const state = EditorState.create({
            doc: source,
            extensions: [javascript(), codeFolding(), transientEditorUIExtensions],
        });
        expect(ensureSyntaxTree(state, state.doc.length, 100)).not.toBeNull();

        const fold = foldInfoForLine(state, 1)!.range;
        const view = mountState(state);
        view.dispatch({ effects: foldEffect.of(fold) });
        expect(foldSnapshots(view.state)).toHaveLength(1);

        view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: 'hiddenNeedle' })),
        });
        expect(findNext(view)).toBe(true);

        expect(view.state.sliceDoc(
            view.state.selection.main.from,
            view.state.selection.main.to,
        )).toBe('hiddenNeedle');
        expect(foldSnapshots(view.state)).toHaveLength(0);
    });

    it('uses ordinary document transactions for replacement near annotation ranges', () => {
        const source = editorAcceptanceFixture.typescript;
        const annotation = editorAcceptanceFixture.annotations.insideFold;
        const userEvents: string[] = [];
        const state = EditorState.create({
            doc: source,
            extensions: [
                javascript({ typescript: true }),
                transientEditorUIExtensions,
                EditorView.updateListener.of(update => {
                    for (const transaction of update.transactions) {
                        if (transaction.docChanged && transaction.isUserEvent('input.replace')) {
                            userEvents.push('input.replace');
                        }
                    }
                }),
            ],
        });
        const view = mountState(state);
        view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({
                search: 'private value',
                replace: 'private currentValue',
            })),
        });

        // First invocation selects the next occurrence; the second replaces it.
        expect(replaceNext(view)).toBe(true);
        expect(replaceNext(view)).toBe(true);

        expect(view.state.doc.toString()).toContain('private currentValue = 0;');
        expect(view.state.sliceDoc(annotation.from + 7, annotation.to + 7)).toBe('this.value += step;');
        expect(userEvents).toEqual(['input.replace']);
    });

    it('offers nested local names and language snippets in TypeScript', async () => {
        const source = [
            'function outer() {',
            '  const nestedValue = 1;',
            '  function inner() {',
            '    nestedV',
            '  }',
            '}',
        ].join('\n');
        const pos = source.indexOf('nestedV', source.indexOf('function inner')) + 'nestedV'.length;
        const state = EditorState.create({
            doc: source,
            selection: { anchor: pos },
            extensions: [javascript({ typescript: true }), transientEditorUIExtensions],
        });
        expect(ensureSyntaxTree(state, state.doc.length, 100)).not.toBeNull();

        const { options } = await languageCompletions(state, pos);

        expect(options).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'nestedValue' }),
            expect.objectContaining({ label: 'function', detail: 'definition' }),
            expect.objectContaining({ label: 'interface', detail: 'definition' }),
        ]));
        expect(options.find(option => option.label === 'function' && option.detail === 'definition')?.apply)
            .toEqual(expect.any(Function));
    });

    it('opens with focused find input and returns focus to the editor on close', () => {
        const state = EditorState.create({
            doc: 'one two one',
            extensions: [transientEditorUIExtensions, lightTheme],
        });
        const view = mountState(state);
        view.focus();

        expect(openSearchPanel(view)).toBe(true);
        // jsdom's HTMLInputElement.select() does not focus like a browser does.
        // A second invocation uses CodeMirror's explicit already-open focus path.
        expect(openSearchPanel(view)).toBe(true);
        const input = view.dom.querySelector<HTMLInputElement>('[main-field]');
        expect(searchPanelOpen(view.state)).toBe(true);
        expect(input).not.toBeNull();
        expect(document.activeElement).toBe(input);
        const panelHost = view.dom.querySelector<HTMLElement>('.cm-panels-top');
        expect(panelHost).not.toBeNull();
        expect(getComputedStyle(panelHost!).position).toBe('sticky');
        expect(getComputedStyle(panelHost!).height).toBe('0px');

        expect(closeSearchPanel(view)).toBe(true);
        expect(searchPanelOpen(view.state)).toBe(false);
        expect(view.hasFocus).toBe(true);
    });

    it('highlights other visible occurrences of a selection', () => {
        const state = EditorState.create({
            doc: 'same other same',
            selection: { anchor: 0, head: 4 },
            extensions: [transientEditorUIExtensions],
        });
        const view = mountState(state);

        expect(view.dom.querySelectorAll('.cm-selectionMatch').length).toBeGreaterThan(0);
    });

    it.each([
        ['ordinary character', 'a other a', 0, 1],
        ['space', 'a b c', 1, 2],
        ['whitespace run', 'a  b  c', 1, 3],
        ['single Unicode character', '🙂 other 🙂', 0, 2],
    ])('does not highlight other occurrences of a selected %s', (_label, doc, anchor, head) => {
        const state = EditorState.create({
            doc,
            selection: { anchor, head },
            extensions: [transientEditorUIExtensions],
        });
        const view = mountState(state);

        expect(view.dom.querySelectorAll('.cm-selectionMatch')).toHaveLength(0);
    });

    it.each(['(', ')', '[', ']', '{', '}'])(
        'does not highlight other occurrences of the single delimiter %s',
        delimiter => {
            const state = EditorState.create({
                doc: `${delimiter} value ${delimiter}`,
                selection: { anchor: 0, head: 1 },
                extensions: [transientEditorUIExtensions],
            });
            const view = mountState(state);

            expect(view.dom.querySelectorAll('.cm-selectionMatch')).toHaveLength(0);
        },
    );
});
