import { Accessor, JSX, ParentComponent } from 'solid-js';
import { Portal } from 'solid-js/web';
import { alog, anchorNameLive, elementForAnchorName } from '../utility/AnchorDebug';

export type AnchorParams = {
    left: string;
    top?: string;
    bottom?: string;
    right?: string;
    positionAnchor?: string;
    // Pixel nudge after positioning, applied via margin so the inset math stays clean.
    offsetX?: number;
    offsetY?: number;
    // Extra styles merged onto the wrapper (e.g. transform for centering on an axis).
    style?: JSX.CSSProperties;
    interactive?: boolean;
};

type AnchoredPortalProps = {
    // The position to place the portal at. A single accessor — the caller computes
    // the anchor expressions (see anchorParamsFor in AnnotationVisualFrames).
    params: Accessor<AnchorParams>;
    // Portal mount target. Defaults to document.body (top level) like a bare <Portal>.
    mount?: Node;
    debug?: Accessor<Record<string, unknown>>;
};

function elementSummary(node: Node | undefined): string {
    if (!(node instanceof HTMLElement)) return node?.nodeName ?? '<unresolved>';
    const id = node.id ? `#${node.id}` : '';
    const classes = [...node.classList].map(name => `.${name}`).join('');
    return `${node.tagName.toLowerCase()}${id}${classes}${node.isConnected ? '' : ' (detached)'}`;
}

function geometry(el: HTMLElement | undefined): Record<string, unknown> | undefined {
    if (!el) return undefined;
    const rect = el.getBoundingClientRect();
    const computed = getComputedStyle(el);
    return {
        element: elementSummary(el),
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
        client: { width: el.clientWidth, height: el.clientHeight },
        scroll: { width: el.scrollWidth, height: el.scrollHeight },
        computed: { position: computed.position, left: computed.left, right: computed.right, width: computed.width },
    };
}

export const AnchoredPortal: ParentComponent<AnchoredPortalProps> = (props) => {
    const positionStyle = (): JSX.CSSProperties => {
        const p = props.params();
        return {
            position: 'absolute',
            left: p.left,
            ...(p.top ? { top: p.top } : {}),
            ...(p.bottom ? { bottom: p.bottom } : {}),
            ...(p.right ? { right: p.right } : {}),
            ...(p.positionAnchor ? { 'position-anchor': p.positionAnchor } : {}),
            'margin-left': `${p.offsetX ?? 0}px`,
            'margin-top': `${p.offsetY ?? 0}px`,
            ...p.style,
            'pointer-events': p.interactive ? 'auto' : 'none',
        };
    };

    return (
        <Portal mount={props.mount}>
            <div
                ref={el => {
                    const debug = props.debug?.() ?? {};
                    const spanAnchor = debug.spanAnchor as string | undefined;
                    const markerAnchor = debug.markerAnchor as string | undefined;
                    const clampAnchor = debug.clampAnchor as string | undefined;
                    const bumperAnchor = debug.bumperAnchor as string | undefined;
                    alog('runtime', {
                        ...debug,
                        portalEl: elementSummary(props.mount),
                        portalElNode: props.mount,
                        anchorNameLive: spanAnchor ? anchorNameLive(spanAnchor) : false,
                        markerAnchorLive: markerAnchor ? anchorNameLive(markerAnchor) : false,
                        clampAnchorLive: clampAnchor ? anchorNameLive(clampAnchor) : false,
                        bumperAnchorLive: bumperAnchor ? anchorNameLive(bumperAnchor) : false,
                        activeParams: { ...props.params() },
                        positionedEl: el,
                    });
                    requestAnimationFrame(() => {
                        const clampEl = elementForAnchorName(clampAnchor);
                        const bumperEl = elementForAnchorName(bumperAnchor);
                        alog('geometry', {
                            ...debug,
                            portalMount: geometry(props.mount instanceof HTMLElement ? props.mount : undefined),
                            portalContainer: geometry(el.parentElement ?? undefined),
                            offsetParent: geometry(el.offsetParent as HTMLElement | undefined),
                            clamp: geometry(clampEl),
                            bumper: geometry(bumperEl),
                            wrapper: geometry(el),
                            note: geometry(el.querySelector<HTMLElement>('[class*="floatingnote"]') ?? undefined),
                        });
                    });
                }}
                style={positionStyle()}
            >
                {props.children}
            </div>
        </Portal>
    );
};
