// The one way an annotation reveal scrolls to a DOM element.
export function revealElement(el: Element | null | undefined): void {
    el?.scrollIntoView({ block: 'center' });
}
