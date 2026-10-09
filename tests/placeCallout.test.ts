import { describe, it, expect } from 'vitest';
import { placeCallout } from '../src/demo/DemoTour';

// Tier 1: pure placement math, no DOM. Box is 300x190 with a 12px gap (mirrored
// from DemoTour's constants), so a viewport is sized here to force each case.
const VIEWPORT = { width: 1400, height: 900 };

function rect(left: number, top: number, width: number, height: number) {
    return { left, top, right: left + width, bottom: top + height };
}

describe('placeCallout', () => {
    it('places on the preferred side when it fits', () => {
        const r = rect(600, 300, 200, 100);
        const p = placeCallout(r, 'right', VIEWPORT);
        expect(p.sideUsed).toBe('right');
        expect(p.left).toBe(r.right + 12);
        expect(p.top).toBe(r.top);
    });

    it('flips to the opposite side when the preferred one overflows', () => {
        // Target hard against the right edge: no room for a 300px box to its right.
        const r = rect(1300, 300, 90, 100);
        const p = placeCallout(r, 'right', VIEWPORT);
        expect(p.sideUsed).toBe('left');
        expect(p.left).toBe(r.left - 12 - 300);
    });

    it('keeps the preferred side when neither side fits, then clamps', () => {
        // Narrow viewport: 300px box fits on neither side, so preference stands
        // and the clamp is what keeps it visible.
        const narrow = { width: 500, height: 900 };
        const r = rect(150, 300, 200, 100);
        const p = placeCallout(r, 'right', narrow);
        expect(p.sideUsed).toBe('right');
        expect(p.left).toBeLessThanOrEqual(narrow.width - 300 - 12);
        expect(p.left).toBeGreaterThanOrEqual(12);
    });

    it('clamps a bottom placement back into the viewport', () => {
        // Target near the bottom: 'bottom' does not fit, 'top' does, so it flips.
        const r = rect(600, 800, 200, 60);
        const p = placeCallout(r, 'bottom', VIEWPORT);
        expect(p.sideUsed).toBe('top');
        expect(p.top).toBeGreaterThanOrEqual(12);
        expect(p.top + 190).toBeLessThanOrEqual(VIEWPORT.height);
    });

    it('never positions outside the viewport on any side', () => {
        const corners = [
            rect(0, 0, 50, 50),
            rect(1350, 0, 50, 50),
            rect(0, 850, 50, 50),
            rect(1350, 850, 50, 50),
        ];
        for (const r of corners) {
            for (const side of ['left', 'right', 'top', 'bottom'] as const) {
                const p = placeCallout(r, side, VIEWPORT);
                expect(p.left).toBeGreaterThanOrEqual(12);
                expect(p.top).toBeGreaterThanOrEqual(12);
                expect(p.left + 300).toBeLessThanOrEqual(VIEWPORT.width - 12);
                expect(p.top + 190).toBeLessThanOrEqual(VIEWPORT.height - 12);
            }
        }
    });
});
