import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@solidjs/testing-library';
import { selectText } from './factories/dom';
import '../src/annotation/TextViewCore'; // Establish the existing AnnotationTextView/TextViewCore cycle.
import { MarkdownView } from '../src/markdown/MarkdownView';
import { sourceContextRegistry } from '../src/interactions/SourceContextRegistry';
import { PreselectAction, placePreselectButton, preselectManager } from '../src/interactions/PreselectManager';
import { userSettings } from '../src/UserSettings';

afterEach(() => {
    preselectManager.dismiss();
    window.getSelection()?.removeAllRanges();
    userSettings.setNativeSelectionMode('automatic');
    cleanup();
});

function renderReader() {
    const sourceId = `preselect-${crypto.randomUUID()}`;
    const view = new MarkdownView(sourceId, 'The quick brown fox.\n');
    const mounted = render(() => <>{view.getVisual()()}<PreselectAction /></>);
    const root = mounted.container.querySelector<HTMLElement>('.txt-inner')!;
    return { view, sourceId, root, mounted };
}

function select(root: HTMLElement, needle: string): void {
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(selectText(root, needle));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
}

describe('native selection confirmation', () => {
    it('keeps a markdown selection native until the action is clicked', () => {
        userSettings.setNativeSelectionMode('always-action');
        const { view, sourceId, root, mounted } = renderReader();
        try {
            select(root, 'quick');
            expect(sourceContextRegistry.itemsFor(sourceId)).toHaveLength(0);
            const action = document.body.querySelector<HTMLButtonElement>('[data-preselect-action]');
            expect(action).not.toBeNull();

            action!.click();
            expect(sourceContextRegistry.itemsFor(sourceId)).toHaveLength(1);
            expect(sourceContextRegistry.itemsFor(sourceId)[0].getPreviewText()).toBe('quick');
            expect(window.getSelection()?.isCollapsed).toBe(true);
        } finally {
            mounted.unmount();
            view.dispose();
        }
    });

    it('discards the action when the browser selection changes', () => {
        userSettings.setNativeSelectionMode('always-action');
        const { view, sourceId, root, mounted } = renderReader();
        try {
            select(root, 'quick');
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(selectText(root, 'brown'));
            document.dispatchEvent(new Event('selectionchange'));

            expect(document.body.querySelector('[data-preselect-action]')).toBeNull();
            expect(sourceContextRegistry.itemsFor(sourceId)).toHaveLength(0);
        } finally {
            mounted.unmount();
            view.dispose();
        }
    });

    it('annotates immediately by default', () => {
        const { view, sourceId, root, mounted } = renderReader();
        try {
            select(root, 'quick');
            expect(sourceContextRegistry.itemsFor(sourceId)).toHaveLength(1);
            expect(document.body.querySelector('[data-preselect-action]')).toBeNull();
        } finally {
            mounted.unmount();
            view.dispose();
        }
    });

    it('leaves a right-clicked native selection for the browser menu', () => {
        const { view, sourceId, root, mounted } = renderReader();
        try {
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(selectText(root, 'quick'));

            root.dispatchEvent(new PointerEvent('pointerdown', { button: 2, buttons: 2, bubbles: true }));
            document.dispatchEvent(new PointerEvent('pointerup', { button: 2, bubbles: true }));
            const menu = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
            root.dispatchEvent(menu);

            expect(menu.defaultPrevented).toBe(false);
            expect(selection.toString()).toBe('quick');
            expect(sourceContextRegistry.itemsFor(sourceId)).toHaveLength(0);
            expect(document.body.querySelector('[data-preselect-action]')).toBeNull();
        } finally {
            mounted.unmount();
            view.dispose();
        }
    });

    it('does not suppress the context menu on the floating action', () => {
        userSettings.setNativeSelectionMode('always-action');
        const { view, root, mounted } = renderReader();
        try {
            select(root, 'quick');
            const action = document.body.querySelector<HTMLButtonElement>('[data-preselect-action]')!;
            const rightPress = new PointerEvent('pointerdown', {
                button: 2, buttons: 2, bubbles: true, cancelable: true,
            });
            action.dispatchEvent(rightPress);
            const menu = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
            action.dispatchEvent(menu);

            expect(rightPress.defaultPrevented).toBe(false);
            expect(menu.defaultPrevented).toBe(false);
            expect(document.body.querySelector('[data-preselect-action]')).toBe(action);
        } finally {
            mounted.unmount();
            view.dispose();
        }
    });

    it('commits immediately while annotation mode is globally locked', () => {
        userSettings.setNativeSelectionMode('always-action');
        const previousLock = userSettings.annotateLock();
        userSettings.setAnnotateLock('annotation');
        const { view, sourceId, root, mounted } = renderReader();
        try {
            select(root, 'quick');
            expect(sourceContextRegistry.itemsFor(sourceId)).toHaveLength(1);
            expect(document.body.querySelector('[data-preselect-action]')).toBeNull();
        } finally {
            mounted.unmount();
            view.dispose();
            userSettings.setAnnotateLock(previousLock);
        }
    });

    it('offers an action for a claimed native selection in always-action mode', () => {
        userSettings.setNativeSelectionMode('always-action');
        const { view, root, mounted } = renderReader();
        try {
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            const range = selectText(root, 'quick');
            selection.addRange(range);
            expect(preselectManager.guardSelection(view, range, new PointerEvent('pointerup'),
                () => {})).toBe(true);
            expect(document.body.querySelector('[data-preselect-action]')).not.toBeNull();
        } finally {
            mounted.unmount();
            view.dispose();
        }
    });

    it('places the action to the right of the selection start and clamps it in view', () => {
        expect(placePreselectButton(
            { left: 290, right: 300, top: 170, bottom: 190 },
            { width: 300, height: 200 },
        )).toEqual({ left: 264, top: 134 });
        expect(placePreselectButton(
            { left: 30, right: 30, top: 4, bottom: 20 },
            { width: 300, height: 200 },
        )).toEqual({ left: 38, top: 28 });
    });

    it('keeps the action portaled and repositions it on a nested scroll', () => {
        userSettings.setNativeSelectionMode('always-action');
        let top = 90;
        const originalRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ left: 40, right: 40, top, bottom: top + 16, width: 0, height: 16 }),
        });
        const { view, root, mounted } = renderReader();
        try {
            select(root, 'quick');
            const action = document.body.querySelector<HTMLButtonElement>('[data-preselect-action]')!;
            expect(action.style.left).toBe('48px');
            expect(action.style.top).toBe('54px');

            top = 60;
            root.dispatchEvent(new Event('scroll'));
            expect(document.body.querySelector('[data-preselect-action]')).toBe(action);
            expect(action.style.top).toBe('24px');
        } finally {
            mounted.unmount();
            view.dispose();
            if (originalRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRect);
            else delete (Range.prototype as Range & { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;
        }
    });

    it('hides the action while its selection start is clipped by a nested scroller', () => {
        userSettings.setNativeSelectionMode('always-action');
        let top = 60;
        const originalRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ left: 40, right: 40, top, bottom: top + 16, width: 0, height: 16 }),
        });
        const { view, root, mounted } = renderReader();
        root.style.overflowY = 'auto';
        Object.defineProperty(root, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ left: 0, right: 200, top: 20, bottom: 100, width: 200, height: 80 }),
        });
        try {
            select(root, 'quick');
            const action = document.body.querySelector<HTMLButtonElement>('[data-preselect-action]')!;
            expect(action.style.display).not.toBe('none');

            top = 120;
            root.dispatchEvent(new Event('scroll'));
            expect(action.style.display).toBe('none');

            top = 60;
            root.dispatchEvent(new Event('scroll'));
            expect(action.style.display).not.toBe('none');
        } finally {
            mounted.unmount();
            view.dispose();
            if (originalRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRect);
            else delete (Range.prototype as Range & { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;
        }
    });
});
