
declare global {
    interface Window { __ANCHOR_DEBUG__?: boolean; }
}

export function anchorDebugOn(): boolean {
    if (typeof window === 'undefined') return false;
    // Only an explicit false opts out; unset means on.
    return window.__ANCHOR_DEBUG__ !== false;
}

// One log channel per concern, so the console can be filtered by tag.
export function alog(tag: string, ...args: unknown[]): void {
    if (!anchorDebugOn()) return;
    console.log(`[anchor:${tag}]`, ...args);
}

export function anchorNameLive(name: string): boolean {
    if (typeof document === 'undefined') return false;
    return [...document.querySelectorAll<HTMLElement>('[style]')].some(el =>
        el.style.getPropertyValue('anchor-name')
            .split(',')
            .map(candidate => candidate.trim())
            .includes(name));
}

export function elementForAnchorName(name: string | undefined): HTMLElement | undefined {
    if (typeof document === 'undefined' || name == null) return undefined;
    return [...document.querySelectorAll<HTMLElement>('[style]')].find(el =>
        el.style.getPropertyValue('anchor-name')
            .split(',')
            .map(candidate => candidate.trim())
            .includes(name));
}
