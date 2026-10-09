
// Visual shown during tab drags, decoupled from component-specifc
// pointer interactions except for onUp callback
export class VisualGhost {
    // Position
    x: number = 0;
    y: number = 0;

    // Element
    el: HTMLElement;

    // Bound methods for listener
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;

    // Hover callback
    movecallback: (e: PointerEvent) => void = () => {};

    // Release callback
    endcallback: (e: PointerEvent) => void = () => {};

    // Flag in case already removed
    stale: boolean = false;

    constructor(visual: HTMLElement, x: number, y: number, 
        endcallback: (e: PointerEvent) => void,
        movecallback: (e: PointerEvent) => void) {
        // Create actual ghost element and add to doc
        const host = document.createElement('div');
        this.el = host;
        host.appendChild(visual);
        host.style.position = 'fixed';
        host.style.pointerEvents = 'none';
        host.style.zIndex = '9999';
        host.style.willChange = 'transform';
        document.body.appendChild(host);

        // Post-end callback
        this.endcallback = endcallback;
        this.movecallback = movecallback;

        // Set ghost position
        this.setPos(x, y);

        this.onMove = this.move.bind(this);
        this.onUp = this.release.bind(this);

        window.addEventListener('pointermove', this.onMove, {capture: true});
        window.addEventListener('pointerup', this.onUp);
    }

    setPos(x: number, y: number) {
        // Store position locally and apply style to object
        this.x = x;
        this.y = y;
        this.el.style.left = `${this.x}px`;
        this.el.style.top = `${this.y}px`;
    }

    move(e: PointerEvent) {
        // Update this.el element position to match pointer location
        if (this.stale) return;
        this.setPos(e.x, e.y);
        this.movecallback(e);
    }

    release(e: PointerEvent) {
        console.log("Released", this.stale);
        if (this.stale) return;
        this.detach();
        this.endcallback(e);
    }

    detach() {
        if (this.stale) return;
        // Remove event listeners and object from document
        window.removeEventListener('pointermove', this.onMove, {capture: true});
        window.removeEventListener('pointerup', this.onUp);
        this.el.remove();

        // Mark object as stale
        this.stale = true;
    }
}
