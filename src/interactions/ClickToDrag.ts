
export class ClickToDrag {
    // Press origin
    startX: number;
    startY: number;

    // Distance in px the pointer must move to become a drag
    threshold: number;

    // Bound methods for listener
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;

    // Threshold-crossed callback
    startcallback: (e: PointerEvent) => void = () => {};

    // Flag in case already removed
    stale: boolean = false;

    constructor(x: number, y: number, threshold: number, startcallback: (e: PointerEvent) => void) {
        // Store press origin
        this.startX = x;
        this.startY = y;
        this.threshold = threshold;

        // Threshold-crossed callback
        this.startcallback = startcallback;

        this.onMove = this.move.bind(this);
        this.onUp = this.release.bind(this);

        window.addEventListener('pointermove', this.onMove);
        window.addEventListener('pointerup', this.onUp);
    }

    move(e: PointerEvent) {
        // Promote to a drag once past the threshold, then hand off to the ghost
        if (this.stale) return;
        const distance = Math.hypot(e.x - this.startX, e.y - this.startY);
        if (distance > this.threshold) {
            this.detach();
            this.startcallback(e);
        }
    }

    release(_e: PointerEvent) {
        // Released before crossing the threshold — it was a click, not a drag
        if (this.stale) return;
        this.detach();
    }

    detach() {
        if (this.stale) return;
        // Remove event listeners
        window.removeEventListener('pointermove', this.onMove);
        window.removeEventListener('pointerup', this.onUp);

        // Mark object as stale
        this.stale = true;
    }
}
