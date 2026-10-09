import { describe, it, expect } from 'vitest';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';
import { DiffScheduler } from '../src/editor/diff/DiffScheduler';
import { DiffTextSource } from '../src/editor/diff/DiffTextSource';
import { DiffContextCoordinator } from '../src/editor/diff/DiffContextCoordinator';
import { correspondingDiffLine } from '../src/editor/diff/DiffContextCoordinator';
import { EditorState } from '@codemirror/state';
import { codeFolding, ensureSyntaxTree } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { foldInfoForLine, foldSnapshots, setFoldInState } from '../src/editor/folding';

// Tier-1: the DiffContextCoordinator — the data-coordination seam between a diff
// annotation (ContextItem) and the DiffTextSource, for feeding the agent context.
//
// It supplies ONLY the diff concern (before/after + hunks, side, kind:'diff'
// derived/temporary) — the item attaches this alongside its OWN slice, which the item
// provides itself. The coordinator holds a DiffTextSource and reads its children/hunks;
// the source stays unaware (clean leaf).

function makeCoordinator(oldText: string, newText: string) {
    const oldModel = new CmTextDataModel(oldText);
    const newModel = new CmTextDataModel(newText);
    const scheduler = new DiffScheduler(() => ({
        oldText: oldModel.getValue(),
        newText: newModel.getValue(),
    }));
    scheduler.recomputeNow();
    const source = new DiffTextSource('diff::sample', oldModel, newModel, scheduler);
    return new DiffContextCoordinator(source);
}

function foldingState(text: string): EditorState {
    const state = EditorState.create({
        doc: text,
        extensions: [javascript(), codeFolding()],
    });
    expect(ensureSyntaxTree(state, state.doc.length, 100)).not.toBeNull();
    return state;
}

class FoldViewFake {
    constructor(public state: EditorState) {}
    failNextApply = false;
    currentFoldingState() { return this.state; }
    applyCoordinatedFold(line: number, folded: boolean) {
        if (this.failNextApply) {
            this.failNextApply = false;
            return false;
        }
        const next = setFoldInState(this.state, line, folded);
        const available = foldInfoForLine(this.state, line) != null;
        this.state = next;
        return available;
    }
    refreshCoordinatedFoldControls() {}
}

describe('DiffContextCoordinator diffPayload (side + diff + provenance, no slice)', () => {
    it('carries the side, both texts, hunks, and a diff kind tag', () => {
        const coord = makeCoordinator('a\nOLD\nc\n', 'a\nNEW\nc\n');
        const payload = coord.diffPayload('old');
        expect(payload.kind).toBe('diff');          // provenance: derived/temporary
        expect(payload.side).toBe('old');
        expect(payload.diff.oldText).toBe('a\nOLD\nc\n');
        expect(payload.diff.newText).toBe('a\nNEW\nc\n');
        expect(payload.diff.hunks).toHaveLength(1);
    });

    it('carries NO slice text — the item provides its own', () => {
        const coord = makeCoordinator('a\nOLD\nc\n', 'a\nNEW\nc\n');
        const payload = coord.diffPayload('new');
        expect((payload as unknown as Record<string, unknown>).text).toBeUndefined();
        expect(payload.side).toBe('new');
    });
});

describe('DiffContextCoordinator scroll synchronization', () => {
    const scroll = (el: HTMLElement, top: number) => {
        el.scrollTop = top;
        el.dispatchEvent(new Event('scroll'));
    };

    it('does not let a delayed follower echo pull the actively scrolling side backward', () => {
        const coord = makeCoordinator('old', 'new');
        const oldScroller = document.createElement('div');
        const newScroller = document.createElement('div');
        coord.registerScroller('old', oldScroller);
        coord.registerScroller('new', newScroller);

        scroll(oldScroller, 100);
        expect(newScroller.scrollTop).toBe(100);

        // The user advances the source before the asynchronous scroll event from
        // assigning newScroller.scrollTop = 100 has arrived.
        oldScroller.scrollTop = 120;
        newScroller.dispatchEvent(new Event('scroll'));

        expect(oldScroller.scrollTop).toBe(120);

        // The next real source event still propagates, and its follower echo is
        // consumed without disturbing either side.
        oldScroller.dispatchEvent(new Event('scroll'));
        expect(newScroller.scrollTop).toBe(120);
        newScroller.dispatchEvent(new Event('scroll'));
        expect(oldScroller.scrollTop).toBe(120);

        coord.dispose();
    });

    it('keeps only the newest expected position during rapid source events', () => {
        const coord = makeCoordinator('old', 'new');
        const oldScroller = document.createElement('div');
        const newScroller = document.createElement('div');
        coord.registerScroller('old', oldScroller);
        coord.registerScroller('new', newScroller);

        scroll(oldScroller, 100);
        scroll(oldScroller, 120);
        expect(newScroller.scrollTop).toBe(120);

        // Browsers may coalesce the two programmatic follower scrolls into one
        // event. It must acknowledge the latest write rather than echoing it.
        newScroller.dispatchEvent(new Event('scroll'));
        expect(oldScroller.scrollTop).toBe(120);

        coord.dispose();
    });
});

describe('DiffContextCoordinator coordinated folding', () => {
    it('maps real lines through top-padded asymmetric hunks', () => {
        const coord = makeCoordinator('a\nb\nc\n', 'a\nx\ny\nb\nc\n');
        const hunks = coord.diffPayload('old').diff.hunks;

        expect(correspondingDiffLine(hunks, 'old', 1)).toBe(1);
        expect(correspondingDiffLine(hunks, 'old', 2)).toBe(4);
        expect(correspondingDiffLine(hunks, 'new', 2)).toBeNull();
        expect(correspondingDiffLine(hunks, 'new', 3)).toBeNull();
        expect(correspondingDiffLine(hunks, 'new', 4)).toBe(2);
    });

    it('folds both sides when corresponding parser ranges span the same diff rows', () => {
        const oldText = 'function value() {\n  return 1;\n}';
        const newText = 'function value() {\n  const n = 1;\n  return n;\n}';
        const coord = makeCoordinator(oldText, newText);
        const oldView = new FoldViewFake(foldingState(oldText));
        const newView = new FoldViewFake(foldingState(newText));
        coord.registerFoldView('old', oldView);
        coord.registerFoldView('new', newView);

        expect(coord.coordinatedFoldInfo('old', oldView.state, 1)).not.toBeNull();
        expect(coord.toggleFold('old', 1)).toBe(true);
        expect(foldSnapshots(oldView.state)).toHaveLength(1);
        expect(foldSnapshots(newView.state)).toHaveLength(1);

        expect(coord.toggleFold('new', 1)).toBe(true);
        expect(foldSnapshots(oldView.state)).toHaveLength(0);
        expect(foldSnapshots(newView.state)).toHaveLength(0);
    });

    it('rejects a fold without a structurally matching range on the other side', () => {
        const oldText = 'function value() {\n  return 1;\n}';
        const newText = 'const value = 1;';
        const coord = makeCoordinator(oldText, newText);
        const oldView = new FoldViewFake(foldingState(oldText));
        const newView = new FoldViewFake(foldingState(newText));
        coord.registerFoldView('old', oldView);
        coord.registerFoldView('new', newView);

        expect(coord.coordinatedFoldInfo('old', oldView.state, 1)).toBeNull();
        expect(coord.toggleFold('old', 1)).toBe(false);
        expect(foldSnapshots(oldView.state)).toHaveLength(0);
        expect(foldSnapshots(newView.state)).toHaveLength(0);
    });

    it('rolls back the first side when the paired fold commit fails', () => {
        const text = 'function value() {\n  return 1;\n}';
        const coord = makeCoordinator(text, text);
        const oldView = new FoldViewFake(foldingState(text));
        const newView = new FoldViewFake(foldingState(text));
        coord.registerFoldView('old', oldView);
        coord.registerFoldView('new', newView);
        newView.failNextApply = true;

        expect(coord.toggleFold('old', 1)).toBe(false);
        expect(foldSnapshots(oldView.state)).toHaveLength(0);
        expect(foldSnapshots(newView.state)).toHaveLength(0);
    });

    it('mirrors a direct CodeMirror fold command onto the other side', () => {
        const text = 'function value() {\n  return 1;\n}';
        const coord = makeCoordinator(text, text);
        const oldView = new FoldViewFake(foldingState(text));
        const newView = new FoldViewFake(foldingState(text));
        coord.registerFoldView('old', oldView);
        coord.registerFoldView('new', newView);

        const before = oldView.state;
        oldView.state = setFoldInState(oldView.state, 1, true);
        coord.synchronizeFoldChange('old', before, oldView.state);

        expect(foldSnapshots(oldView.state)).toHaveLength(1);
        expect(foldSnapshots(newView.state)).toHaveLength(1);
    });

    it('removes an orphaned fold when a fresh diff snapshot is reconciled', () => {
        const text = 'function value() {\n  return 1;\n}';
        const coord = makeCoordinator(text, text);
        const oldView = new FoldViewFake(setFoldInState(foldingState(text), 1, true));
        const newView = new FoldViewFake(setFoldInState(foldingState(text), 1, true));
        coord.registerFoldView('old', oldView);
        coord.registerFoldView('new', newView);
        oldView.state = setFoldInState(oldView.state, 1, false);

        coord.reconcileFolds();

        expect(foldSnapshots(oldView.state)).toHaveLength(0);
        expect(foldSnapshots(newView.state)).toHaveLength(0);
    });
});
