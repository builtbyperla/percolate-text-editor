import { describe, it, expect, vi } from 'vitest';
import { ClickToDrag } from '../src/interactions/ClickToDrag';

// Drive ClickToDrag through real window pointer events and assert observable
// outcomes (callback fired? still listening?) rather than internal state.
const move = (x: number, y: number) =>
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
const up = (x = 0, y = 0) =>
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y }));

describe('ClickToDrag', () => {
    it('promotes to a drag once the pointer passes the threshold', () => {
        const onStart = vi.fn();
        new ClickToDrag(100, 100, 6, onStart);

        move(103, 103); // ~4.24px — under threshold
        expect(onStart).not.toHaveBeenCalled();

        move(110, 110); // ~14px — over threshold
        expect(onStart).toHaveBeenCalledOnce();
    });

    it('passes the crossing pointer event to the start callback', () => {
        const onStart = vi.fn();
        new ClickToDrag(0, 0, 5, onStart);
        move(20, 0);
        expect(onStart.mock.calls[0][0]).toMatchObject({ x: 20, y: 0 });
    });

    it('stops listening after promotion (a second move does nothing)', () => {
        const onStart = vi.fn();
        new ClickToDrag(0, 0, 5, onStart);
        move(20, 0);
        move(40, 0);
        expect(onStart).toHaveBeenCalledOnce();
    });

    it('treats a release before the threshold as a click (no drag)', () => {
        const onStart = vi.fn();
        new ClickToDrag(0, 0, 5, onStart);
        up();
        move(100, 100); // detached — must not promote after release
        expect(onStart).not.toHaveBeenCalled();
    });

    it('detach is idempotent and silences further events', () => {
        const onStart = vi.fn();
        const c = new ClickToDrag(0, 0, 5, onStart);
        c.detach();
        expect(() => c.detach()).not.toThrow();
        move(100, 100);
        expect(onStart).not.toHaveBeenCalled();
        expect(c.stale).toBe(true);
    });
});
