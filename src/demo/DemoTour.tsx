import { Show, createSignal, createEffect, onCleanup, JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import styles from '../styles/DemoTour.module.css';

type TourStep = {
    selector: string;
    title: string;
    body: string;
    // Preferred side; flips automatically when it would leave the viewport.
    side: 'left' | 'right' | 'top' | 'bottom';
};

// The tour is data, so adding a pattern later is one entry rather than new UI.
// Ordered as a visitor would discover them: read, then annotate, then send.
const STEPS: TourStep[] = [
    {
        selector: '[data-tour="tabs"]',
        title: 'Tabs and panes',
        body:
            'Drag a tab to split the workspace, or create a duplicate via the right-click menu. ' +
            'Tab-specific buttons on the right.',
        side: 'bottom',
    },
    {
        selector: '[data-editmode="false"]',
        title: 'Select to annotate',
        body:
            'Drag across any text here to highlight it. Each highlight and its corresponding note becomes a piece ' +
            'of context you can send to the agent.',
        side: 'right',
    },
    {
        // The ruler is the mode toggle: clicking it flips this pane between
        // editing and annotating.
        selector: '[data-editmode="false"] [class*="ruler"]',
        title: 'Switch modes',
        body:
            'Click the ruler to flip a pane between Edit and Annotate.' +
            ' Use quick-select in the editor view by making a selection then clicking on the lightning icons.'
            ,
        side: 'right',
    },
    {
        selector: '[data-tour="evidence"]',
        title: 'Context pane',
        body:
            'Each selection has its own include ' +
            'toggle, so selecting something and shipping it are separate choices.\n' +
            ' Opt to attach full text sources, or toggle the displayed previews, via the buttons at the top',
        side: 'left',
    },
    {
        selector: '[data-tour="chat"]',
        title: 'Ask, then annotate the answer',
        body:
            'Included context ships with your message, and the selections clear. The ' +
            'agent\'s markdown replies are annotatable too. Tool responses still pending.',
        side: 'left',
    },
    {
        selector: '[data-tour="rail-interaction"]',
        title: 'Interaction settings',
        body:
            'Open the interaction panel from the rail. Options for locking all panes to annotate or edit modes, switch selection between character and ' +
            'whole-line granularity, and setting note visibility.',
        side: 'right',
    },
];

const BOX_W = 300;
const BOX_H = 190;
const GAP = 12;

type Placement = { left: number; top: number; sideUsed: TourStep['side'] };

export function placeCallout(
    rect: { left: number; top: number; right: number; bottom: number },
    side: TourStep['side'],
    viewport: { width: number; height: number },
): Placement {
    const fits = {
        left: rect.left - GAP - BOX_W >= 0,
        right: rect.right + GAP + BOX_W <= viewport.width,
        top: rect.top - GAP - BOX_H >= 0,
        bottom: rect.bottom + GAP + BOX_H <= viewport.height,
    };

    // Flip to the opposite side only if the preferred one doesn't fit and the
    // opposite one does; otherwise keep the preference and let the clamp handle it.
    const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
    const sideUsed = fits[side] ? side : (fits[opposite[side]] ? opposite[side] : side);

    let left: number;
    let top: number;
    switch (sideUsed) {
        case 'left':
            left = rect.left - GAP - BOX_W;
            top = rect.top;
            break;
        case 'right':
            left = rect.right + GAP;
            top = rect.top;
            break;
        case 'top':
            left = rect.left;
            top = rect.top - GAP - BOX_H;
            break;
        case 'bottom':
            left = rect.left;
            top = rect.bottom + GAP;
            break;
    }

    // Keep the box fully on screen regardless of which side won.
    left = Math.max(GAP, Math.min(left, viewport.width - BOX_W - GAP));
    top = Math.max(GAP, Math.min(top, viewport.height - BOX_H - GAP));
    return { left, top, sideUsed };
}

function findTarget(step: TourStep): HTMLElement | null {
    return document.querySelector<HTMLElement>(step.selector);
}

export function DemoTour(): JSX.Element {
    // intro -> steps -> done. One state machine rather than two components, so
    // there is a single place that decides whether anything is mounted at all.
    const [phase, setPhase] = createSignal<'intro' | 'steps' | 'done'>('intro');
    // `active` gates every listener below: once it's false the Shows unmount and
    // each createEffect's onCleanup detaches, leaving nothing running.
    const active = () => phase() !== 'done';
    const [index, setIndex] = createSignal(0);
    // Bumped to force a re-measure without changing the step (resize/scroll).
    const [revision, setRevision] = createSignal(0);

    const step = (): TourStep | undefined => STEPS[index()];

    const stop = () => setPhase('done');

    const advance = (delta: number) => {
        // Skip steps whose target isn't in the DOM, in either direction, and end
        // the tour if we walk off either edge.
        let next = index() + delta;
        while (next >= 0 && next < STEPS.length && !findTarget(STEPS[next])) {
            next += delta;
        }
        if (next < 0 || next >= STEPS.length) {
            stop();
            return;
        }
        setIndex(next);
    };

    createEffect(() => {
        if (!active()) return;
        const stepping = phase() === 'steps';
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                stop();
            } else if (!stepping) {
                // Enter starts the tour from the intro panel.
                if (e.key === 'Enter') {
                    e.preventDefault();
                    setPhase('steps');
                }
            } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
                e.preventDefault();
                advance(1);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                advance(-1);
            }
        };
        document.addEventListener('keydown', onKey, true);
        onCleanup(() => document.removeEventListener('keydown', onKey, true));
    });

    createEffect(() => {
        if (phase() !== 'steps') return;
        const remeasure = () => setRevision(r => r + 1);
        window.addEventListener('resize', remeasure, { passive: true });
        window.addEventListener('scroll', remeasure, { capture: true, passive: true });
        onCleanup(() => {
            window.removeEventListener('resize', remeasure);
            window.removeEventListener('scroll', remeasure, { capture: true });
        });
    });

    // If the current step's target is missing, skip forward before painting so
    // the tour never opens on a detached callout.
    createEffect(() => {
        if (phase() !== 'steps') return;
        const s = step();
        if (s && !findTarget(s)) advance(1);
    });

    // Target rect + computed placement. Depends on revision so resize/scroll
    // recompute, and on index so advancing re-measures.
    const geometry = () => {
        revision();
        const s = step();
        if (!s) return null;
        const el = findTarget(s);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const place = placeCallout(rect, s.side, {
            width: window.innerWidth,
            height: window.innerHeight,
        });
        return { rect, place };
    };

    return (
        <>
        {/* Intro: what this is, and an explicit choice to take the tour or not. */}
        <Show when={phase() === 'intro'}>
            <Portal>
                <div class={styles.backdrop} onClick={stop} />
                <div class={styles.introCard}>
                    <div class={styles.introTitle}>Annotation Text Editor</div>
                    <div class={styles.introBody}>
                        <p>
                        <strong>Demo only runs in Chrome browsers.</strong>
                        </p>
                        Toggle between edit and annotate modes to comment on specific code sections
                        and send them to the agent.

                    </div>
                    <div class={styles.introNote}>
                        Everything here runs in memory. Nothing is saved or sent.

                        Agent responses are stubbed.

                    </div>
                    <div class={styles.actions}>
                        <button class={styles.skip} onClick={stop}>
                            Skip
                        </button>
                        <div class={styles.spacer} />
                        <button class={styles.next} onClick={() => setPhase('steps')}>
                            Show me around
                        </button>
                    </div>
                </div>
            </Portal>
        </Show>

        <Show when={phase() === 'steps' && step() && geometry()}>
            {geo => (
                <Portal>

                    <div class={styles.backdrop} onClick={stop} />

                    {/* Ring around the region being described. Purely decorative,
                        so it never intercepts clicks. */}
                    <div
                        class={styles.ring}
                        style={{
                            left: `${geo().rect.left}px`,
                            top: `${geo().rect.top}px`,
                            width: `${geo().rect.width}px`,
                            height: `${geo().rect.height}px`,
                        }}
                    />

                    <div
                        class={styles.callout}
                        style={{ left: `${geo().place.left}px`, top: `${geo().place.top}px` }}
                    >
                        <div class={styles.step}>
                            {index() + 1} of {STEPS.length}
                        </div>
                        <div class={styles.title}>{step()!.title}</div>
                        <div class={styles.body}>{step()!.body}</div>
                        <div class={styles.actions}>
                            <button class={styles.skip} onClick={stop}>
                                Skip
                            </button>
                            <div class={styles.spacer} />
                            <Show when={index() > 0}>
                                <button class={styles.back} onClick={() => advance(-1)}>
                                    Back
                                </button>
                            </Show>
                            <button class={styles.next} onClick={() => advance(1)}>
                                {index() === STEPS.length - 1 ? 'Done' : 'Next'}
                            </button>
                        </div>
                    </div>
                </Portal>
            )}
        </Show>
        </>
    );
}
