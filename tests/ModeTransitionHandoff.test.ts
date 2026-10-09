import { describe, it, expect } from 'vitest';

// The edit<->annotate mode transition, as a contract rather than as a DualTextView.
// Instantiating the real view needs jsdom + CM6 + the signal graph (Tier 3), so this
// models the four moving parts the transition actually depends on:
//
//   - the two setup methods, each guarded to one frame per mode entry
//   - the two teardowns, each capturing the outgoing view's scroll on the way out
//   - the ordering: teardown BEFORE setup, so the handoff field is current
//   - storeChoice: the direct toggle records the user's mode, the lock does not
//
// Two real bugs are pinned here, both of which shipped:
//
//   1. _setupEditor had no idempotence guard (only _setupAnnotator did). It runs from
//      getEditorVisual in the JSX body, so every re-render built a fresh frame over the
//      live one, discarding its scroll. Under an edit LOCK this read as "the lock
//      breaks scrolling", because the lock holds the view in a mode whose body keeps
//      re-running.
//   2. applyMode ran setup before teardown, so the incoming view read a handoff the
//      outgoing view had not written yet, restoring a stale position.

// A stand-in for CmEditorFrame / AnnotatorViewFrame: the transition only cares that a
// frame holds a scroll offset and can be told where to start.
class FakeFrame {
    scrollTop: number;
    readonly serial: number;
    disposed = false;

    constructor(serial: number, initialScroll: number) {
        this.serial = serial;
        this.scrollTop = initialScroll;
    }

    getScrollTop(): number { return this.scrollTop; }
    dispose(): void { this.disposed = true; }
}

// The transition logic lifted out of DualTextView, same shape and same order.
class ModeHost {
    editor: FakeFrame | null = null;
    annotator: FakeFrame | null = null;

    scrollHandoff = 0;
    editModeOn = true;
    private serial = 0;

    // Both setups are guarded: they run from the JSX body, which re-evaluates on any
    // reactive change, and a second frame over a live one leaks the first.
    setupEditor(): void {
        if (this.editor != null) return;
        this.editor = new FakeFrame(++this.serial, this.scrollHandoff);
    }

    setupAnnotator(): void {
        if (this.annotator != null) return;
        this.annotator = new FakeFrame(++this.serial, this.scrollHandoff);
    }

    teardownEditor(): void {
        if (this.editor) {
            this.scrollHandoff = this.editor.getScrollTop();
            this.editor.dispose();
        }
        this.editor = null;
    }

    teardownAnnotator(): void {
        if (this.annotator) {
            this.scrollHandoff = this.annotator.getScrollTop();
            this.annotator.dispose();
        }
        this.annotator = null;
    }

    applyMode(annotate: boolean, storeChoice: boolean): void {
        if (annotate) {
            this.teardownEditor();
            this.setupAnnotator();
        } else {
            this.teardownAnnotator();
            this.setupEditor();
        }
        if (storeChoice) this.editModeOn = !annotate;
    }

    // The rendered mode: the lock overrides, else the view's own stored choice.
    // Mirrors DualTextView.shouldShowEditorView (edit-positive polarity).
    shouldShowEditorView(lock: 'unlocked' | 'annotation' | 'edit'): boolean {
        if (lock === 'annotation') return false;
        if (lock === 'edit') return true;
        return this.editModeOn;
    }
}

describe('mode transition scroll handoff', () => {
    it('carries the outgoing scroll position into the incoming view', () => {
        const host = new ModeHost();
        host.setupEditor();
        host.editor!.scrollTop = 420;

        host.applyMode(true, true);

        expect(host.annotator).not.toBeNull();
        expect(host.annotator!.scrollTop).toBe(420);
    });

    it('teardown runs BEFORE setup, so the handoff is current when read', () => {
        // The ordering bug: setting up first meant the incoming frame read a
        // scrollHandoff still holding the position from the PREVIOUS transition.
        const host = new ModeHost();
        host.setupEditor();
        host.editor!.scrollTop = 100;

        host.applyMode(true, true);      // -> annotate, carries 100
        host.annotator!.scrollTop = 750; // user scrolls in annotate mode
        host.applyMode(false, true);     // -> edit, must carry 750 not 100

        expect(host.editor!.scrollTop).toBe(750);
    });

    it('round trips a position through both modes and back', () => {
        const host = new ModeHost();
        host.setupEditor();
        host.editor!.scrollTop = 55;

        host.applyMode(true, true);
        host.applyMode(false, true);

        expect(host.editor!.scrollTop).toBe(55);
    });
});

describe('setup idempotence', () => {
    it('setupEditor does not build a second frame over a live one', () => {
        // Bug 1: the missing guard. A re-render calls setup again; without the guard
        // the replacement frame starts from the already-consumed handoff, which is
        // what "the edit lock breaks scroll" actually was.
        const host = new ModeHost();
        host.setupEditor();
        const first = host.editor!;
        first.scrollTop = 300;

        host.setupEditor();
        host.setupEditor();

        expect(host.editor).toBe(first);
        expect(host.editor!.scrollTop).toBe(300);
        expect(first.disposed).toBe(false);
    });

    it('setupAnnotator does not build a second frame over a live one', () => {
        const host = new ModeHost();
        host.applyMode(true, true);
        const first = host.annotator!;
        first.scrollTop = 210;

        host.setupAnnotator();

        expect(host.annotator).toBe(first);
        expect(host.annotator!.scrollTop).toBe(210);
    });

    it('repeated setup calls in one mode never leak a frame', () => {
        // The leak signature: each un-guarded call minted a new serial and dropped the
        // previous frame without disposing it.
        const host = new ModeHost();
        host.setupEditor();
        const serial = host.editor!.serial;

        for (let i = 0; i < 10; i++) host.setupEditor();

        expect(host.editor!.serial).toBe(serial);
    });
});

describe('stored vs displayed mode', () => {
    it('the direct toggle records the user choice', () => {
        const host = new ModeHost();
        host.applyMode(true, true);
        expect(host.editModeOn).toBe(false);

        host.applyMode(false, true);
        expect(host.editModeOn).toBe(true);
    });

    it('a lock override does NOT overwrite the stored choice', () => {
        // The whole reason the lock cannot just call setEditModeOn: the stored mode is
        // what the view falls back to when the lock releases.
        const host = new ModeHost();
        host.applyMode(true, true);        // user chooses annotate
        expect(host.editModeOn).toBe(false);

        host.applyMode(false, false);      // edit lock engages
        expect(host.editModeOn).toBe(false); // still remembers annotate
    });

    it('releasing a lock returns the view to the user stored mode', () => {
        const host = new ModeHost();
        host.applyMode(true, true);
        expect(host.shouldShowEditorView('unlocked')).toBe(false);

        expect(host.shouldShowEditorView('edit')).toBe(true);    // overridden while locked
        expect(host.shouldShowEditorView('unlocked')).toBe(false); // restored on release
    });

    it('a lock still transitions the views, it only skips the store', () => {
        const host = new ModeHost();
        host.applyMode(true, true);
        host.annotator!.scrollTop = 88;

        host.applyMode(false, false);

        expect(host.annotator).toBeNull();
        expect(host.editor).not.toBeNull();
        expect(host.editor!.scrollTop).toBe(88);
    });

    it('an edit lock held across re-renders keeps one frame and its scroll', () => {
        // The reported bug end to end: lock to edit, then let the JSX body re-run
        // several times as it does on any reactive change.
        const host = new ModeHost();
        host.applyMode(true, true);
        host.annotator!.scrollTop = 640;

        host.applyMode(false, false);   // edit lock engages, carries 640
        const locked = host.editor!;
        for (let i = 0; i < 5; i++) host.setupEditor(); // re-renders under the lock

        expect(host.editor).toBe(locked);
        expect(host.editor!.scrollTop).toBe(640);
    });
});
