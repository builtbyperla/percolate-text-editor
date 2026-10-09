import { describe, it, expect, vi } from 'vitest';
import { VisualGhost } from '../src/interactions/VisualGhost';

const move = (x: number, y: number) =>
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
const up = (x = 0, y = 0) =>
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y }));

const visual = () => {
    const el = document.createElement('span');
    el.textContent = 'tab';
    return el;
};

describe('VisualGhost', () => {
    it('mounts a host into the document at the start position', () => {
        const g = new VisualGhost(visual(), 30, 40, vi.fn(), vi.fn());
        expect(document.body.contains(g.el)).toBe(true);
        expect(g.el.style.left).toBe('30px');
        expect(g.el.style.top).toBe('40px');
        g.detach();
    });

    it('follows the pointer on move and fires the move callback', () => {
        const onMove = vi.fn();
        const g = new VisualGhost(visual(), 0, 0, vi.fn(), onMove);
        move(120, 80);
        expect(g.el.style.left).toBe('120px');
        expect(g.el.style.top).toBe('80px');
        expect(onMove).toHaveBeenCalledOnce();
        g.detach();
    });

    it('releases on pointerup: removes itself and fires the end callback', () => {
        const onEnd = vi.fn();
        const g = new VisualGhost(visual(), 0, 0, onEnd, vi.fn());
        up(10, 10);
        expect(document.body.contains(g.el)).toBe(false);
        expect(onEnd).toHaveBeenCalledOnce();
    });

    it('detach removes the element and is idempotent', () => {
        const onMove = vi.fn();
        const g = new VisualGhost(visual(), 0, 0, vi.fn(), onMove);
        g.detach();
        expect(document.body.contains(g.el)).toBe(false);
        expect(() => g.detach()).not.toThrow();
        // No longer listening — a move must not re-fire.
        move(50, 50);
        expect(onMove).not.toHaveBeenCalled();
        expect(g.stale).toBe(true);
    });

    it('does not fire callbacks again after release', () => {
        const onEnd = vi.fn();
        const onMove = vi.fn();
        const g = new VisualGhost(visual(), 0, 0, onEnd, onMove);
        up();
        move(99, 99);
        up();
        expect(onEnd).toHaveBeenCalledOnce();
        expect(onMove).not.toHaveBeenCalled();
    });
});
