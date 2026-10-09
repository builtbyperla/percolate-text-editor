import { afterEach, describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import {
    APP_VIEWPORT_ANCHOR,
    NoteCoordinator,
    NoteCoordinatorVisual,
    appEditorLayer,
    containedMarkerNoteAnchorParams,
    editorAnchorParams,
    markerNoteAnchorParams,
} from '../src/annotation/AnnotationVisualFrames';
import type { AnnotatableComponent, ContextItem } from '../src/annotation/ContextItem';
import { windowrefregistry } from '../src/appcore/WindowRefRegistry';

describe('note layer context', () => {
    const mounted: HTMLElement[] = [];
    const originalAppRef = windowrefregistry.map.get(APP_VIEWPORT_ANCHOR);
    afterEach(() => {
        mounted.splice(0).forEach(el => el.remove());
        if (originalAppRef) windowrefregistry.map.set(APP_VIEWPORT_ANCHOR, originalAppRef);
        else windowrefregistry.map.delete(APP_VIEWPORT_ANCHOR);
    });

    it('follows each layer mount without waiting for an outer frame', () => {
        const host = document.createElement('div');
        const noteMountA = document.createElement('div');
        const noteMountB = document.createElement('div');
        const appRoot = document.createElement('div');
        for (const el of [host, noteMountA, noteMountB, appRoot]) {
            document.body.appendChild(el);
            mounted.push(el);
        }

        const [noteMount, setNoteMount] = createSignal(noteMountA);
        const [appEl, setAppEl] = createSignal<HTMLElement | undefined>();
        windowrefregistry.register(APP_VIEWPORT_ANCHOR, appEl);
        const [noteText, setNoteText] = createSignal('A note');
        const contextItem = { getNote: noteText, setNote: setNoteText } as ContextItem;
        const span = { id: 'span' } as AnnotatableComponent;
        const coordinator = new NoteCoordinator(span, {
            noteLayer: () => ({ portalMount: noteMount(), clampAnchor: '--note-viewport' }),
            editorLayer: () => appEditorLayer(),
        }, contextItem);
        const dispose = render(() => <NoteCoordinatorVisual value={coordinator} />, host);

        expect(noteMountA.textContent).toContain('A note');

        setNoteMount(noteMountB);
        expect(noteMountA.textContent).toBe('');
        expect(noteMountB.textContent).toContain('A note');

        coordinator.setActive();
        expect(noteMountB.textContent).toBe('');
        expect(document.body.querySelector('[data-widget="note-editor"]')).toBeNull();
        setAppEl(appRoot);
        expect(appRoot.querySelector('[data-widget="note-editor"]')).toBeNull();
        const editor = document.body.querySelector('[data-widget="note-editor"]');
        expect(editor).not.toBeNull();

        coordinator.setInactive();
        dispose();
    });

    it('keeps marker, surface, and app viewport clamps in the anchor strategies', () => {
        const marker = markerNoteAnchorParams('--wrapped-span', '--document-clamp');
        expect(marker.left).toContain('--wrapped-span-start');
        expect(marker.bottom).toContain('--wrapped-span-start');
        expect(marker.right).toContain('--document-clamp');
        expect(marker.style?.['position-try-fallbacks'])
            .toBe('--note-inline-right-top, --note-inline-right-bottom');
        expect(marker.style?.['position-visibility']).toBe('anchors-visible');

        const editor = editorAnchorParams('--wrapped-span', '--local-pane');
        expect(editor.left).toContain('--local-pane');
        expect(editor.top).toContain('--local-pane');
        expect(editor.left).toContain(APP_VIEWPORT_ANCHOR);
        expect(editor.top).toContain(APP_VIEWPORT_ANCHOR);
    });

    it('composes local sticky placement with app-wide visibility clamping', () => {
        const editor = editorAnchorParams('--wrapped-span', '--local-pane');

        expect(editor.left).toBe(
            'clamp(anchor(--app-viewport left), min(calc(anchor(--wrapped-span right) + 4px), anchor(--local-pane right)), calc(anchor(--app-viewport right) - 200px))',
        );
        expect(editor.top).toBe(
            'clamp(calc(anchor(--app-viewport top) + 55px), max(calc((anchor(--wrapped-span top) + anchor(--wrapped-span bottom)) / 2), calc(anchor(--local-pane top) + 59px)), calc(anchor(--app-viewport bottom) - 55px))',
        );
    });

    it('does not invent a clamp when an arm intentionally has none', () => {
        const marker = markerNoteAnchorParams('--wrapped-span');
        expect(marker.left).toBe('anchor(--wrapped-span-start left)');
        expect(marker.right).toBeUndefined();
    });

    it('uses local containing-block bounds when the portal is inside its clamp', () => {
        const marker = containedMarkerNoteAnchorParams('--wrapped-span', '--document-clamp');
        expect(marker.left).toBe('max(20px, min(anchor(--wrapped-span-start left), calc(100% - 72px)))');
        expect(marker.left).not.toContain('--document-clamp');
        expect(marker.right).toBe('20px');
    });

    it('threads independent inner content bounds into the bumper fallbacks', () => {
        const marker = markerNoteAnchorParams(
            '--wrapped-span', '--outer-right-edge', '--inner-content-bounds',
        );
        expect(marker.right).toContain('--outer-right-edge');
        expect(marker.style?.['--note-bumper-top']).toBe('anchor(--inner-content-bounds top)');
        expect(marker.style?.['--note-bumper-bottom']).toBe('anchor(--inner-content-bounds bottom)');
    });
});
