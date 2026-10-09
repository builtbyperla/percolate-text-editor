import { cleanup, render } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree, indentUnit, language } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DualTextView } from '../src/editor/DualTextView';
import { foldSnapshots } from '../src/editor/folding';
import { DiffDualTextView } from '../src/editor/diff/DiffDualTextView';
import { RangesDataModel } from '../src/editor/RangesDataModel';
import { DiffView } from '../src/editor/diff/DiffView';
import { FileEditBuffer } from '../src/chat/FileEditBuffer';
import type { AgentClient } from '../src/agent/AgentClient';
import { SearchQuery, getSearchQuery, openSearchPanel, searchPanelOpen, setSearchQuery } from '@codemirror/search';
import { userSettings } from '../src/UserSettings';
import { ContextItem } from '../src/annotation/ContextItem';

afterEach(cleanup);

const originalRangeGetClientRects = Range.prototype.getClientRects;
const originalRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect;

beforeAll(() => {
    // CM6 measures text during animation frames. jsdom exposes Range without these
    // geometry methods, so provide the empty geometry appropriate to this lifecycle
    // suite (none of the assertions depend on layout).
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

afterAll(() => {
    if (originalRangeGetClientRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', {
            configurable: true,
            value: originalRangeGetClientRects,
        });
    } else {
        delete (Range.prototype as Partial<Range>).getClientRects;
    }
    if (originalRangeGetBoundingClientRect) {
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: originalRangeGetBoundingClientRect,
        });
    } else {
        delete (Range.prototype as Partial<Range>).getBoundingClientRect;
    }
});

const afterAnimationFrame = () => new Promise<void>(resolve => {
    requestAnimationFrame(() => resolve());
});

describe('DualTextView mounted-frame lifecycle', () => {
    it('shows fold controls on the first reader mount and retains folds in edit mode', () => {
        const source = 'function initial() {\n  return true;\n}';
        const view = new DualTextView(`initial-reader-${crypto.randomUUID()}.ts`, source);
        view.setAnnotateMode();
        const mounted = render(() => view.getVisual()());
        try {
            const toggle = mounted.container.querySelector<HTMLButtonElement>('[aria-label="Fold line 1"]');
            expect(toggle).not.toBeNull();
            toggle!.click();
            expect(mounted.container.querySelector('[data-fold-from]')).not.toBeNull();
            view.setEditMode();
            expect(foldSnapshots(view.getEditorFrame()!.getEditorState()!)).toHaveLength(1);
        } finally {
            mounted.unmount();
            view.dispose();
        }
    });

    it('keeps a reader-first peer synchronized with an editing peer', () => {
        const source = 'function shared() {\n  return true;\n}';
        const reader = new DualTextView(`initial-peer-${crypto.randomUUID()}.ts`, source);
        reader.setAnnotateMode();
        const editor = reader.makePeer();
        const readerMount = render(() => reader.getVisual()());
        const editorMount = render(() => editor.getVisual()());
        try {
            readerMount.container.querySelector<HTMLButtonElement>('[aria-label="Fold line 1"]')!.click();
            const cm = EditorView.findFromDOM(editorMount.container.querySelector<HTMLElement>('.cm-editor')!)!;
            cm.dispatch({ changes: { from: cm.state.doc.line(2).from, insert: '  const added = 1;\n' } });
            expect(reader.currentFoldingState()!.doc.toString()).toContain('added');
            expect(foldSnapshots(reader.currentFoldingState()!)).toEqual([
                expect.objectContaining({ startLine: 1, endLine: 4 }),
            ]);
        } finally {
            readerMount.unmount();
            editorMount.unmount();
            reader.dispose();
            editor.dispose();
        }
    });

    it('drops a reader-first fold when a peer removes its opening brace', () => {
        const source = 'function shared() {\n  return true;\n}';
        const reader = new DualTextView(`initial-peer-invalid-${crypto.randomUUID()}.ts`, source);
        reader.setAnnotateMode();
        const editor = reader.makePeer();
        const readerMount = render(() => reader.getVisual()());
        const editorMount = render(() => editor.getVisual()());
        try {
            readerMount.container.querySelector<HTMLButtonElement>('[aria-label="Fold line 1"]')!.click();
            const cm = EditorView.findFromDOM(editorMount.container.querySelector<HTMLElement>('.cm-editor')!)!;
            const brace = cm.state.doc.line(1).to - 1;
            cm.dispatch({ changes: { from: brace, to: brace + 1 } });
            expect(foldSnapshots(reader.currentFoldingState()!)).toHaveLength(0);
        } finally {
            readerMount.unmount();
            editorMount.unmount();
            reader.dispose();
            editor.dispose();
        }
    });

    it('reveals source offsets through their line, including before the editor mounts', () => {
        const [view, disposeRoot] = createRoot(dispose => [
            new DualTextView(`offset-reveal-${crypto.randomUUID()}`, 'alpha\nbeta\ngamma'), dispose,
        ] as const);
        view.revealOffset(8);
        const mounted = render(() => view.getVisual()());
        try {
            expect(view.getEditorFrame()!.getEditorState()!.selection.main.head).toBe(6);

            const item = new ContextItem(view);
            item.setRange(12, 14);
            view.scrollToItem(item);
            expect(view.getEditorFrame()!.getEditorState()!.selection.main.head).toBe(11);
        } finally {
            mounted.unmount();
            view.dispose();
            disposeRoot();
        }
    });

    it('reveals an annotator context by source line without a rendered span target', () => {
        const source = 'function target() {\n  const value = 1;\n  return value;\n}';
        const view = new DualTextView(`annotator-reveal-${crypto.randomUUID()}.ts`, source);
        const mounted = render(() => view.getVisual()());
        try {
            const editor = view.getEditorFrame()!;
            expect(ensureSyntaxTree(editor.getEditorState()!, source.length, 100)).not.toBeNull();
            expect(editor.toggleFold(1)).toBe(true);
            view.setAnnotateMode();
            expect(mounted.container.querySelector('[data-fold-from]')).not.toBeNull();

            const frame = view.getAnnotatorFrame()!;
            const item = new ContextItem(frame);
            item.setRange(source.indexOf('return'), source.indexOf('return') + 6);
            frame.scrollToItem(item);

            expect(mounted.container.querySelector('[data-fold-from]')).toBeNull();
        } finally {
            mounted.unmount();
            view.dispose();
        }
    });

    it('leaves secondary presses to the browser in line-selection mode', () => {
        const previousMode = userSettings.annotationSelectMode();
        const previousLock = userSettings.annotateLock();
        userSettings.setAnnotationSelectMode('line');
        userSettings.setAnnotateLock('unlocked');
        const view = new DualTextView(`line-menu-${crypto.randomUUID()}`, 'alpha beta\n');
        const mounted = render(() => view.getVisual()());
        try {
            view.setAnnotateMode();
            const target = mounted.container.querySelector<HTMLElement>('.txt-inner')!;
            const rightPress = new PointerEvent('pointerdown', {
                button: 2, buttons: 2, bubbles: true, cancelable: true,
            });
            target.dispatchEvent(rightPress);
            document.dispatchEvent(new PointerEvent('pointerup', { button: 2, bubbles: true }));

            expect(rightPress.defaultPrevented).toBe(false);
            expect(view.getAnnotatorFrame()!.innerTextObject.noteableAt(0)).toBeNull();
        } finally {
            mounted.unmount();
            view.dispose();
            userSettings.setAnnotationSelectMode(previousMode);
            userSettings.setAnnotateLock(previousLock);
        }
    });

    it('quick-tags a CodeMirror selection under the edit lock and returns on commit', () => {
        const previousLock = userSettings.annotateLock();
        userSettings.setAnnotateLock('edit');
        const view = new DualTextView(`quick-lock-${crypto.randomUUID()}`, 'alpha beta\n');
        const mounted = render(() => view.getVisual()());
        try {
            const editor = EditorView.findFromDOM(mounted.container.querySelector<HTMLElement>('.cm-editor')!)!;
            editor.dispatch({ selection: { anchor: 0, head: 5 } });

            view.quickEditTag();

            expect(view.getAnnotatorFrame()).not.toBeNull();
            expect(mounted.container.querySelector('[data-editmode="false"]')).not.toBeNull();
            expect(userSettings.annotateLock()).toBe('edit');
            const note = view.getAnnotatorFrame()!.innerTextObject.noteableAt(0)!;
            expect(note.contextItem.getPreviewText()).toBe('alpha');

            note.commit();

            expect(view.getEditorFrame()).not.toBeNull();
            expect(mounted.container.querySelector('[data-editmode="true"]')).not.toBeNull();
            expect(userSettings.annotateLock()).toBe('edit');
        } finally {
            mounted.unmount();
            view.dispose();
            userSettings.setAnnotateLock(previousLock);
        }
    });

    it('keeps reader mode after dismissing a locked quick edit, but retires it when the lock changes', () => {
        const previousLock = userSettings.annotateLock();
        userSettings.setAnnotateLock('edit');
        const view = new DualTextView(`quick-dismiss-${crypto.randomUUID()}`, 'alpha beta\n');
        const mounted = render(() => view.getVisual()());
        try {
            const editor = EditorView.findFromDOM(mounted.container.querySelector<HTMLElement>('.cm-editor')!)!;
            editor.dispatch({ selection: { anchor: 0, head: 5 } });
            view.quickEditTag();
            const note = view.getAnnotatorFrame()!.innerTextObject.noteableAt(0)!;

            note.setInactive(); // Close and successful Send use this path.
            expect(mounted.container.querySelector('[data-editmode="false"]')).not.toBeNull();

            view.toggleAnnotate();
            expect(mounted.container.querySelector('[data-editmode="true"]')).not.toBeNull();

            const reopened = EditorView.findFromDOM(mounted.container.querySelector<HTMLElement>('.cm-editor')!)!;
            reopened.dispatch({ selection: { anchor: 0, head: 5 } });
            view.quickEditTag();
            view.getAnnotatorFrame()!.innerTextObject.noteableAt(0)!.deleteAnnotation();
            expect(mounted.container.querySelector('[data-editmode="false"]')).not.toBeNull();

            userSettings.setAnnotateLock('unlocked');
            expect(mounted.container.querySelector('[data-editmode="false"]')).not.toBeNull();

            userSettings.setAnnotateLock('edit');
            expect(mounted.container.querySelector('[data-editmode="true"]')).not.toBeNull();
        } finally {
            mounted.unmount();
            view.dispose();
            userSettings.setAnnotateLock(previousLock);
        }
    });

    it('does not enter reader mode when a quick selection cannot open a note', () => {
        const previousLock = userSettings.annotateLock();
        userSettings.setAnnotateLock('edit');
        const view = new DualTextView(`quick-empty-${crypto.randomUUID()}`, 'alpha beta\n');
        const mounted = render(() => view.getVisual()());
        try {
            const editor = EditorView.findFromDOM(mounted.container.querySelector<HTMLElement>('.cm-editor')!)!;
            editor.dispatch({ selection: { anchor: 0, head: 1 } });
            view.quickEditTag();
            expect(mounted.container.querySelector('[data-editmode="true"]')).not.toBeNull();
            expect(view.getAnnotatorFrame()).toBeNull();
        } finally {
            mounted.unmount();
            view.dispose();
            userSettings.setAnnotateLock(previousLock);
        }
    });

    it('synchronously replaces the mounted frame when the preferred mode changes', () => {
        const view = new DualTextView(`mode-${crypto.randomUUID()}`, 'one\ntwo\n');
        const visual = view.getVisual();
        const mounted = render(() => visual());

        expect(mounted.container.querySelector('[data-editmode="true"]')).not.toBeNull();

        view.setAnnotateMode();
        expect(mounted.container.querySelector('[data-editmode="false"]')).not.toBeNull();
        expect(view.getAnnotatorFrame()).not.toBeNull();

        view.setEditMode();
        expect(mounted.container.querySelector('[data-editmode="true"]')).not.toBeNull();
        expect(view.getEditorFrame()).not.toBeNull();

        mounted.unmount();
        view.dispose();
    });

    it('reconstructs the selected frame when the same view is remounted', () => {
        const view = new DualTextView(`remount-${crypto.randomUUID()}`, 'alpha\nbeta\n');
        const visual = view.getVisual();
        const firstMount = render(() => visual());

        expect(firstMount.container.querySelector('.cm-editor')).not.toBeNull();
        firstMount.unmount();
        expect(view.getEditorFrame()).toBeNull();

        const secondMount = render(() => view.getVisual()());
        expect(secondMount.container.querySelector('.cm-editor')).not.toBeNull();

        secondMount.unmount();
        view.dispose();
    });

    it('transfers frame ownership when the destination mounts before the source unmounts', () => {
        const view = new DualTextView(`move-${crypto.randomUUID()}`, 'source\ndestination\n');
        const sourceMount = render(() => view.getVisual()());
        expect(sourceMount.container.querySelector('.cm-editor')).not.toBeNull();

        // Tab moves can add the destination pane before removing the source pane.
        // The same ViewBlock is therefore briefly rendered in both places.
        const destinationMount = render(() => view.getVisual()());
        expect(destinationMount.container.querySelector('.cm-editor')).not.toBeNull();

        // Late cleanup from the source must not dispose the destination's frame.
        sourceMount.unmount();
        expect(destinationMount.container.querySelector('.cm-editor')).not.toBeNull();
        expect(view.getEditorFrame()).not.toBeNull();

        destinationMount.unmount();
        view.dispose();
    });

    it('keeps the tab-boundary scroll offset authoritative across overlapping hosts', async () => {
        const view = new DualTextView(`scroll-move-${crypto.randomUUID()}`, 'one\ntwo\nthree\n');
        const sourceMount = render(() => view.getVisual()());
        const sourceScroller = sourceMount.container.querySelector<HTMLElement>('[data-editmode="true"]')!;

        // This is the TabContainer boundary: read the outgoing live offset once,
        // before any destination DOM exists.
        sourceScroller.scrollTop = 275;
        expect(view.getScrollOffset()).toBe(275);

        // More than one structural render may occur while a dragged tab is being
        // inserted. Neither fresh host (which starts at zero) may replace the stash.
        const firstDestination = render(() => view.getVisual()());
        const finalDestination = render(() => view.getVisual()());
        sourceMount.unmount();
        firstDestination.unmount();

        await afterAnimationFrame();

        const finalScroller = finalDestination.container.querySelector<HTMLElement>('[data-editmode="true"]')!;
        expect(finalScroller.scrollTop).toBe(275);

        finalDestination.unmount();
        view.dispose();
    });

    it('preserves CM6 selection state and republishes it to the ruler after a tab move', () => {
        const view = new DualTextView(`selection-move-${crypto.randomUUID()}`, 'alpha\nbeta\ngamma\n');
        const sourceMount = render(() => view.getVisual()());
        const sourceFrame = view.getEditorFrame()!;
        const sourceEditorElement = sourceMount.container.querySelector<HTMLElement>('.cm-editor')!;
        const sourceEditorView = EditorView.findFromDOM(sourceEditorElement)!;

        sourceEditorView.dispatch({ selection: { anchor: 8 } });
        expect(sourceFrame.getSelectionRanges()[0]?.head).toBe(8);

        const destinationMount = render(() => view.getVisual()());
        const destinationFrame = view.getEditorFrame()!;
        expect(destinationFrame).not.toBe(sourceFrame);
        expect(destinationFrame.getEditorState()?.selection.main.head).toBe(8);
        expect(destinationFrame.getSelectionRanges()[0]?.head).toBe(8);

        sourceMount.unmount();
        destinationMount.unmount();
        view.dispose();
    });

    it('retains language and detected indentation configuration across a frame handoff', () => {
        const source = 'function configured() {\n  return true;\n}\n';
        const view = new DualTextView(`configured-${crypto.randomUUID()}.mts`, source);
        const sourceMount = render(() => view.getVisual()());
        const sourceState = view.getEditorFrame()!.getEditorState()!;
        expect(sourceState.facet(language)?.name).toBe('typescript');
        expect(sourceState.facet(indentUnit)).toBe('  ');
        expect(sourceState.facet(EditorState.tabSize)).toBe(2);

        const destinationMount = render(() => view.getVisual()());
        const rebound = view.getEditorFrame()!.getEditorState()!;
        expect(rebound.facet(language)?.name).toBe('typescript');
        expect(rebound.facet(indentUnit)).toBe('  ');
        expect(rebound.facet(EditorState.tabSize)).toBe(2);

        sourceMount.unmount();
        destinationMount.unmount();
        view.dispose();
    });

    it('preserves an open search panel, query, and scroll across an annotate-mode round trip', async () => {
        const source = Array.from({ length: 100 }, (_, line) => `const value_${line} = ${line};`).join('\n');
        const view = new DualTextView(`search-mode-${crypto.randomUUID()}.ts`, source);
        const mounted = render(() => view.getVisual()());
        const scroller = mounted.container.querySelector<HTMLElement>('[data-editmode="true"]')!;
        const editor = EditorView.findFromDOM(
            mounted.container.querySelector<HTMLElement>('.cm-editor')!,
        )!;
        scroller.scrollTop = 360;
        openSearchPanel(editor);
        editor.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: 'value_90' })),
        });

        expect(searchPanelOpen(editor.state)).toBe(true);
        view.setAnnotateMode();
        expect(mounted.container.querySelector('.cm-search')).toBeNull();
        await afterAnimationFrame();

        view.setEditMode();
        await afterAnimationFrame();
        const rebound = EditorView.findFromDOM(
            mounted.container.querySelector<HTMLElement>('.cm-editor')!,
        )!;

        expect(searchPanelOpen(rebound.state)).toBe(true);
        expect(getSearchQuery(rebound.state).search).toBe('value_90');
        expect(mounted.container.querySelector<HTMLInputElement>('[main-field]')?.value).toBe('value_90');
        expect(mounted.container.querySelector<HTMLElement>('[data-editmode="true"]')!.scrollTop).toBe(360);

        mounted.unmount();
        view.dispose();
    });

    it('reconfigures the live theme without replacing the editor or transient state', () => {
        const originalTheme = userSettings.editorTheme();
        userSettings.setEditorTheme('light-theme');
        const source = [
            'function themed() {',
            '  const needle = true;',
            '  return needle;',
            '}',
        ].join('\n');
        const view = new DualTextView(`live-theme-${crypto.randomUUID()}.ts`, source);
        const mounted = render(() => view.getVisual()());
        const editorElement = mounted.container.querySelector<HTMLElement>('.cm-editor')!;
        const editor = EditorView.findFromDOM(editorElement)!;
        const frameHost = mounted.container.querySelector<HTMLElement>('[data-editor-theme]')!;
        expect(frameHost.dataset.editorTheme).toBe('light-theme');
        expect(ensureSyntaxTree(editor.state, editor.state.doc.length, 100)).not.toBeNull();
        expect(view.getEditorFrame()!.toggleFold(1)).toBe(true);
        openSearchPanel(editor);
        editor.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: 'needle' })),
            selection: { anchor: 0 },
        });
        const stateBeforeTheme = editor.state;
        const classesBeforeTheme = editor.dom.className;

        try {
            userSettings.setEditorTheme('slate-theme');

            const rebound = EditorView.findFromDOM(editorElement)!;
            expect(rebound).toBe(editor);
            expect(rebound.state).not.toBe(stateBeforeTheme);
            expect(rebound.dom.className).not.toBe(classesBeforeTheme);
            expect(frameHost.dataset.editorTheme).toBe('slate-theme');
            expect(rebound.state.doc.toString()).toBe(source);
            expect(rebound.state.selection.main.head).toBe(0);
            expect(rebound.state.facet(language)?.name).toBe('typescript');
            expect(foldSnapshots(rebound.state)).toHaveLength(1);
            expect(searchPanelOpen(rebound.state)).toBe(true);
            expect(getSearchQuery(rebound.state).search).toBe('needle');
        } finally {
            userSettings.setEditorTheme(originalTheme);
            mounted.unmount();
            view.dispose();
        }
    });

    it('retains the annotator frame but clears host-bound gesture state during a tab move', () => {
        const view = new DualTextView(`annotator-move-${crypto.randomUUID()}`, 'alpha\nbeta\n');
        const sourceMount = render(() => view.getVisual()());
        view.setAnnotateMode();
        const sourceFrame = view.getAnnotatorFrame()!;

        view.setLineDragRange({ lo: 1, hi: 2 });
        view.setLineHoverLine(2);
        const destinationMount = render(() => view.getVisual()());

        expect(view.getAnnotatorFrame()).toBe(sourceFrame);
        expect(view.getLineDragRange()).toBeNull();
        expect(view.getLineHoverLine()).toBeNull();

        sourceMount.unmount();
        expect(view.getAnnotatorFrame()).toBe(sourceFrame);
        expect(destinationMount.container.querySelector('[data-editmode="false"]')).not.toBeNull();

        view.setScrollOffset(180);
        destinationMount.unmount();
        expect(view.getAnnotatorFrame()).toBe(sourceFrame);
        expect(view.getScrollOffset()).toBe(180);

        const remount = render(() => view.getVisual()());
        expect(view.getAnnotatorFrame()).toBe(sourceFrame);
        expect(remount.container.querySelector('[data-editmode="false"]')).not.toBeNull();

        remount.unmount();
        view.setEditMode();
        expect(view.getAnnotatorFrame()).toBe(sourceFrame);
        expect(view.getEditorFrame()).toBeNull();

        const editRemount = render(() => view.getVisual()());
        expect(view.getAnnotatorFrame()).toBeNull();
        expect(editRemount.container.querySelector('.cm-editor')).not.toBeNull();

        editRemount.unmount();
        view.dispose();
    });

    it('mirrors cached CodeMirror folds into the annotator and toggles them there', () => {
        const source = [
            'function folded() {',
            '  const first = 1;',
            '  const second = 2;',
            '  return first + second;',
            '}',
        ].join('\n');
        const view = new DualTextView(`fold-mirror-${crypto.randomUUID()}.ts`, source);
        const mounted = render(() => view.getVisual()());
        const editor = view.getEditorFrame()!;
        const state = editor.getEditorState()!;
        expect(ensureSyntaxTree(state, state.doc.length, 100)).not.toBeNull();
        expect(editor.toggleFold(1)).toBe(true);

        view.setAnnotateMode();

        const placeholder = mounted.container.querySelector<HTMLButtonElement>('[data-fold-from]');
        expect(placeholder).not.toBeNull();
        expect(placeholder).toHaveTextContent('4 lines');
        expect(mounted.container.querySelectorAll('[data-stripe]')).toHaveLength(1);

        // The placeholder updates the cached EditorState, so expanding in the
        // annotator also changes what the next edit-mode mount receives.
        placeholder!.click();
        expect(mounted.container.querySelector('[data-fold-from]')).toBeNull();

        const refold = mounted.container.querySelector<HTMLButtonElement>('[aria-label="Fold line 1"]');
        expect(refold).not.toBeNull();
        refold!.click();
        expect(mounted.container.querySelector('[data-fold-from]')).not.toBeNull();

        view.setEditMode();
        expect(view.getEditorFrame()!.getEditorState()!.doc.toString()).toBe(source);
        expect(foldSnapshots(view.getEditorFrame()!.getEditorState()!)).toHaveLength(1);

        mounted.unmount();
        view.dispose();
    });

    it('unfolds an annotator fold before revealing a hidden search result', () => {
        const source = [
            'function searchable() {',
            '  const first = 1;',
            '  const match = first + 1;',
            '  return match;',
            '}',
        ].join('\n');
        const view = new DualTextView(`fold-reveal-${crypto.randomUUID()}.ts`, source);
        const mounted = render(() => view.getVisual()());
        const editor = view.getEditorFrame()!;
        const state = editor.getEditorState()!;
        expect(ensureSyntaxTree(state, state.doc.length, 100)).not.toBeNull();
        expect(editor.toggleFold(1)).toBe(true);

        view.setAnnotateMode();
        expect(mounted.container.querySelector('[data-fold-from]')).not.toBeNull();

        view.revealSearch({ line: 3, column: 9, matchLength: 5 });

        expect(mounted.container.querySelector('[data-fold-from]')).toBeNull();
        view.setEditMode();
        expect(foldSnapshots(view.getEditorFrame()!.getEditorState()!)).toHaveLength(0);

        mounted.unmount();
        view.dispose();
    });

    it('preserves folded state when the edit view is rebound to a new host', () => {
        const source = [
            'function rebound() {',
            '  return 42;',
            '}',
        ].join('\n');
        const view = new DualTextView(`fold-remount-${crypto.randomUUID()}.ts`, source);
        const sourceMount = render(() => view.getVisual()());
        const editor = view.getEditorFrame()!;
        const state = editor.getEditorState()!;
        expect(ensureSyntaxTree(state, state.doc.length, 100)).not.toBeNull();
        expect(editor.toggleFold(1)).toBe(true);

        const destinationMount = render(() => view.getVisual()());

        expect(foldSnapshots(view.getEditorFrame()!.getEditorState()!)).toEqual([
            expect.objectContaining({ startLine: 1, endLine: 3 }),
        ]);
        expect(destinationMount.container.querySelector('.cm-foldPlaceholder')).not.toBeNull();

        sourceMount.unmount();
        destinationMount.unmount();
        view.dispose();
    });

    it('keeps folding disabled in a one-sided diff editor', () => {
        const source = [
            'function unchanged() {',
            '  return true;',
            '}',
        ].join('\n');
        const view = new DiffDualTextView(
            `diff-fold-${crypto.randomUUID()}.ts`,
            source,
            'old',
            () => null,
            new RangesDataModel(),
        );
        const mounted = render(() => view.getVisual()());

        expect(view.getEditorFrame()!.toggleFold(1)).toBe(false);
        expect(mounted.container.querySelector('[aria-label="Fold line 1"]')).toBeNull();

        mounted.unmount();
        view.dispose();
    });

    it('does not retain a stale fold after a peer invalidates its syntax', () => {
        const source = [
            'function shared() {',
            '  return true;',
            '}',
        ].join('\n');
        const sourceView = new DualTextView(`fold-peer-${crypto.randomUUID()}.ts`, source);
        const peerView = sourceView.makePeer();
        const sourceMount = render(() => sourceView.getVisual()());
        const peerMount = render(() => peerView.getVisual()());
        const peerFrame = peerView.getEditorFrame()!;
        const peerState = peerFrame.getEditorState()!;
        expect(ensureSyntaxTree(peerState, peerState.doc.length, 100)).not.toBeNull();
        expect(peerFrame.toggleFold(1)).toBe(true);

        const sourceEditor = EditorView.findFromDOM(
            sourceMount.container.querySelector<HTMLElement>('.cm-editor')!,
        )!;
        const brace = sourceEditor.state.doc.line(1).to;
        sourceEditor.dispatch({ changes: { from: brace - 1, to: brace } });

        expect(peerFrame.getEditorState()!.doc.toString()).not.toContain('{');
        expect(foldSnapshots(peerFrame.getEditorState()!)).toHaveLength(0);

        sourceMount.unmount();
        peerMount.unmount();
        sourceView.dispose();
        peerView.dispose();
    });

    it('invalidates native folds when a peer changes the handed-off document', () => {
        const source = [
            'function shared() {',
            '  return true;',
            '}',
        ].join('\n');
        const sourceView = new DualTextView(`native-fold-peer-${crypto.randomUUID()}.ts`, source);
        const peerView = sourceView.makePeer();
        const sourceMount = render(() => sourceView.getVisual()());
        const peerMount = render(() => peerView.getVisual()());

        const sourceFrame = sourceView.getEditorFrame()!;
        const sourceState = sourceFrame.getEditorState()!;
        expect(ensureSyntaxTree(sourceState, sourceState.doc.length, 100)).not.toBeNull();
        expect(sourceFrame.toggleFold(1)).toBe(true);

        sourceView.setAnnotateMode();
        expect(sourceMount.container.querySelector('[data-fold-from]')).not.toBeNull();

        const peerEditor = EditorView.findFromDOM(
            peerMount.container.querySelector<HTMLElement>('.cm-editor')!,
        )!;
        const openingBrace = peerEditor.state.doc.line(1).to - 1;
        peerEditor.dispatch({ changes: { from: openingBrace, to: openingBrace + 1 } });

        // A whole-document mismatch invalidates the handed-off EditorState. The
        // native renderer must immediately stop projecting folds from that state.
        expect(sourceMount.container.querySelector('[data-fold-from]')).toBeNull();

        sourceView.setEditMode();
        const rebound = sourceView.getEditorFrame()!.getEditorState()!;
        expect(rebound.doc.toString()).not.toContain('{');
        expect(foldSnapshots(rebound)).toHaveLength(0);

        sourceMount.unmount();
        peerMount.unmount();
        sourceView.dispose();
        peerView.dispose();
    });

    it('invalidates a folded handoff when its tab is unmounted during a peer change', () => {
        const source = [
            'function shared() {',
            '  return true;',
            '}',
        ].join('\n');
        const sourceView = new DualTextView(`unmounted-fold-peer-${crypto.randomUUID()}.ts`, source);
        const peerView = sourceView.makePeer();
        const sourceMount = render(() => sourceView.getVisual()());
        const peerMount = render(() => peerView.getVisual()());

        const sourceFrame = sourceView.getEditorFrame()!;
        const sourceState = sourceFrame.getEditorState()!;
        expect(ensureSyntaxTree(sourceState, sourceState.doc.length, 100)).not.toBeNull();
        expect(sourceFrame.toggleFold(1)).toBe(true);

        // Unmounting captures the folded EditorState. Select annotate mode while
        // there is no renderer, matching a background/inactive tab transition.
        sourceMount.unmount();
        sourceView.setAnnotateMode();

        const peerEditor = EditorView.findFromDOM(
            peerMount.container.querySelector<HTMLElement>('.cm-editor')!,
        )!;
        const openingBrace = peerEditor.state.doc.line(1).to - 1;
        peerEditor.dispatch({ changes: { from: openingBrace, to: openingBrace + 1 } });

        const remounted = render(() => sourceView.getVisual()());
        expect(remounted.container.querySelector('[data-fold-from]')).toBeNull();
        expect(sourceView.currentFoldingState()?.doc.toString()).not.toContain('{');
        expect(foldSnapshots(sourceView.currentFoldingState()!)).toHaveLength(0);

        remounted.unmount();
        peerMount.unmount();
        sourceView.dispose();
        peerView.dispose();
    });

    it('preserves native folds and ruler controls through a valid peer edit inside the fold', () => {
        const source = [
            'function shared() {',
            '  return true;',
            '}',
        ].join('\n');
        const sourceView = new DualTextView(`mapped-native-fold-${crypto.randomUUID()}.ts`, source);
        const peerView = sourceView.makePeer();
        const sourceMount = render(() => sourceView.getVisual()());
        const peerMount = render(() => peerView.getVisual()());

        const sourceFrame = sourceView.getEditorFrame()!;
        const sourceState = sourceFrame.getEditorState()!;
        expect(ensureSyntaxTree(sourceState, sourceState.doc.length, 100)).not.toBeNull();
        expect(sourceFrame.toggleFold(1)).toBe(true);
        sourceView.setAnnotateMode();

        expect(sourceMount.container.querySelector('[data-fold-from]')).not.toBeNull();
        expect(sourceMount.container.querySelector('[aria-label="Unfold line 1"]')).not.toBeNull();

        const peerEditor = EditorView.findFromDOM(
            peerMount.container.querySelector<HTMLElement>('.cm-editor')!,
        )!;
        peerEditor.dispatch({
            changes: {
                from: peerEditor.state.doc.line(2).from,
                insert: '  const stillValid = true;\n',
            },
        });

        expect(sourceMount.container.querySelector('[data-fold-from]')).not.toBeNull();
        expect(sourceMount.container.querySelector('[aria-label="Unfold line 1"]')).not.toBeNull();
        expect(foldSnapshots(sourceView.currentFoldingState()!)).toEqual([
            expect.objectContaining({ startLine: 1, endLine: 4 }),
        ]);

        sourceView.setEditMode();
        expect(sourceView.getEditorFrame()!.getEditorState()!.doc.toString()).toContain('stillValid');
        expect(foldSnapshots(sourceView.getEditorFrame()!.getEditorState()!)).toHaveLength(1);

        sourceMount.unmount();
        peerMount.unmount();
        sourceView.dispose();
        peerView.dispose();
    });

    it('opens both diff sides in reader mode and toggles them together from either side', () => {
        const diff = new DiffView(`paired-mode-${crypto.randomUUID()}.txt`, 'before', 'after');
        const sides = diff as unknown as { oldView: DiffDualTextView; newView: DiffDualTextView };
        expect(sides.oldView.getTabMode()()).toBe('annotate');
        expect(sides.newView.getTabMode()()).toBe('annotate');

        sides.oldView.toggleAnnotate();
        expect(sides.oldView.getTabMode()()).toBe('edit');
        expect(sides.newView.getTabMode()()).toBe('edit');

        sides.newView.toggleAnnotate();
        expect(sides.oldView.getTabMode()()).toBe('annotate');
        expect(sides.newView.getTabMode()()).toBe('annotate');
        diff.dispose();
    });

    it('maps diff spacer pixels to the adjacent source line and exposes line selection overlays', () => {
        const diff = new DiffView(`line-diff-${crypto.randomUUID()}.txt`, 'one\ntwo\nthree', 'one\nadded\ntwo\nthree');
        const mounted = render(() => diff.getVisual()());
        try {
            const { oldView } = diff as unknown as { oldView: DiffDualTextView };
            const lineTwoTop = oldView.visualTopForSourceLine(2);
            expect(lineTwoTop).toBeGreaterThan(20);
            expect(oldView.sourceLineAtPixel(lineTwoTop - 1)).toBe(1);
            expect(oldView.sourceLineAtPixel(lineTwoTop)).toBe(2);

            const inner = oldView.getAnnotatorFrame()!.innerTextObject as {
                getLineHoverLine: () => number | null;
                getLineDragRange: () => { lo: number; hi: number } | null;
                visualHeightForRange: (lo: number, hi: number) => number;
            };
            oldView.setLineHoverLine(2);
            oldView.setLineDragRange({ lo: 1, hi: 2 });
            expect(inner.getLineHoverLine()).toBe(2);
            expect(inner.getLineDragRange()).toEqual({ lo: 1, hi: 2 });
            expect(inner.visualHeightForRange(1, 2)).toBe(lineTwoTop + 20);
        } finally {
            mounted.unmount();
            diff.dispose();
        }
    });

    it('shows coordinated fold controls on the first diff reader mount', () => {
        const oldText = 'function value() {\n  return 1;\n}';
        const newText = 'function value() {\n  return 2;\n}';
        const diff = new DiffView(`initial-diff-${crypto.randomUUID()}.ts`, oldText, newText);
        const mounted = render(() => diff.getVisual()());
        try {
            const toggles = mounted.container.querySelectorAll<HTMLButtonElement>('[aria-label="Fold line 1"]');
            expect(toggles).toHaveLength(2);
            toggles[0].click();
            const sides = diff as unknown as { oldView: DiffDualTextView; newView: DiffDualTextView };
            expect(foldSnapshots(sides.oldView.currentFoldingState()!)).toHaveLength(1);
            expect(foldSnapshots(sides.newView.currentFoldingState()!)).toHaveLength(1);
        } finally {
            mounted.unmount();
            diff.dispose();
        }
    });

    it('coordinates diff folds across edit and annotate projections', () => {
        const oldText = [
            'function value() {',
            '  return 1;',
            '}',
        ].join('\n');
        const newText = [
            'function value() {',
            '  const n = 1;',
            '  return n;',
            '}',
        ].join('\n');
        const diff = new DiffView(`coordinated-fold-${crypto.randomUUID()}.ts`, oldText, newText);
        const foldSides = diff as unknown as { oldView: DiffDualTextView; newView: DiffDualTextView };
        foldSides.oldView.setEditMode();
        foldSides.newView.setEditMode();
        const mounted = render(() => diff.getVisual()());
        const sides = diff as unknown as {
            oldView: DiffDualTextView;
            newView: DiffDualTextView;
        };
        const oldFrame = sides.oldView.getEditorFrame()!;
        const newFrame = sides.newView.getEditorFrame()!;
        expect(ensureSyntaxTree(oldFrame.getEditorState()!, oldFrame.getEditorState()!.doc.length, 100)).not.toBeNull();
        expect(ensureSyntaxTree(newFrame.getEditorState()!, newFrame.getEditorState()!.doc.length, 100)).not.toBeNull();

        expect(oldFrame.toggleFold(1)).toBe(true);
        expect(foldSnapshots(oldFrame.getEditorState()!)).toHaveLength(1);
        expect(foldSnapshots(newFrame.getEditorState()!)).toHaveLength(1);

        sides.oldView.setAnnotateMode();
        const placeholder = mounted.container.querySelector<HTMLButtonElement>('[data-fold-from]');
        expect(placeholder).not.toBeNull();
        expect(sides.oldView.rulerRanges().ranges()).toHaveLength(0);
        placeholder!.click();

        expect(foldSnapshots(sides.oldView.currentFoldingState()!)).toHaveLength(0);
        expect(foldSnapshots(newFrame.getEditorState()!)).toHaveLength(0);
        expect(sides.oldView.rulerRanges().ranges()).toHaveLength(1);

        expect(newFrame.toggleFold(1)).toBe(true);
        sides.oldView.revealSearch({ line: 2 });
        expect(foldSnapshots(sides.oldView.currentFoldingState()!)).toHaveLength(0);
        expect(foldSnapshots(newFrame.getEditorState()!)).toHaveLength(0);

        mounted.unmount();
        diff.dispose();
    });

    it('rejects a direct one-sided fold in an incompatible diff region', () => {
        const oldText = 'function value() {\n  return 1;\n}';
        const newText = 'const value = 1;';
        const diff = new DiffView(`incompatible-fold-${crypto.randomUUID()}.ts`, oldText, newText);
        (diff as unknown as { oldView: DiffDualTextView; newView: DiffDualTextView }).oldView.setEditMode();
        (diff as unknown as { oldView: DiffDualTextView; newView: DiffDualTextView }).newView.setEditMode();
        const mounted = render(() => diff.getVisual()());
        const sides = diff as unknown as {
            oldView: DiffDualTextView;
            newView: DiffDualTextView;
        };
        const oldFrame = sides.oldView.getEditorFrame()!;
        const oldState = oldFrame.getEditorState()!;
        expect(ensureSyntaxTree(oldState, oldState.doc.length, 100)).not.toBeNull();

        expect(oldFrame.toggleFold(1)).toBe(false);
        // setFold bypasses the coordinated ruler callback in the same way CM6's
        // built-in keyboard command and inline placeholder do. The listener must
        // reject the unmatched fold before it can break pane alignment.
        expect(oldFrame.setFold(1, true)).toBe(true);
        expect(foldSnapshots(oldFrame.getEditorState()!)).toHaveLength(0);

        mounted.unmount();
        diff.dispose();
    });

    it('keeps a proposed edit and cursor stable while persisting the candidate', async () => {
        const before = 'Alpha\nBeta\nGamma\n';
        const initial = 'Alpha\nBeta (agent proposal)\nGamma\n';
        let persisted = initial;
        let revision = 0;
        const client = {
            readFileEdit: async () => ({ before, after: persisted, revision, settled: false }),
            updateFileEdit: async (_session: string, _artifact: string, expected: number, next: string) => {
                expect(expected).toBe(revision);
                persisted = next;
                revision++;
                return { artifactId: 'edit', path: 'sample.txt', baseSha256: null, revision };
            },
        } as unknown as AgentClient;
        const buffer = new FileEditBuffer('session', { artifactId: 'edit', path: 'sample.txt', baseSha256: null, revision }, client);
        await buffer.load();
        const [diff, disposeRoot] = createRoot(dispose => [
            new DiffView(`proposal-${crypto.randomUUID()}.txt`, before, initial, {
                buffer, status: () => 'pending', onAction: () => {},
            }),
            dispose,
        ] as const);
        const proposalSides = diff as unknown as { oldView: DiffDualTextView; newView: DiffDualTextView };
        proposalSides.oldView.setEditMode();
        proposalSides.newView.setEditMode();
        const mounted = render(() => diff.getVisual()());
        try {
            const [leftEl, rightEl] = mounted.container.querySelectorAll<HTMLElement>('.cm-editor');
            const left = EditorView.findFromDOM(leftEl)!;
            const right = EditorView.findFromDOM(rightEl)!;
            const candidate = (diff as unknown as { newView: DiffDualTextView }).newView.getTextModel()!;
            const replacements: boolean[] = [];
            candidate.onChange(change => replacements.push(change.replacement));

            expect(left.state.facet(EditorState.readOnly)).toBe(true);
            expect(right.state.facet(EditorState.readOnly)).toBe(false);
            const at = right.state.doc.line(2).to;
            right.dispatch({ selection: { anchor: at } });
            right.dispatch({ changes: { from: at, insert: ' revised' }, selection: { anchor: at + ' revised'.length } });
            await buffer.flush();

            expect(candidate.getValue()).toBe('Alpha\nBeta (agent proposal) revised\nGamma\n');
            expect(persisted).toBe(candidate.getValue());
            expect(right.state.selection.main.head).toBe(at + ' revised'.length);
            expect(replacements).toEqual([false]);
            expect(left.state.doc.toString()).toBe(before);
        } finally {
            mounted.unmount();
            diff.dispose();
            disposeRoot();
        }
    });
});
