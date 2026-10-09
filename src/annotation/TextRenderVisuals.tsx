import { Component, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { PlainTextSegment, TextHighlight, TextRepr } from './TextViewCore';
import type { RenderUnit } from './RenderLayer';
import { NoteCoordinatorVisual } from './AnnotationVisualFrames';
import styles from '../styles/LiveComponent.module.css';

export const PlainTextSegmentVisual: Component<{ value: PlainTextSegment }> = props => (
    // data-pos-x is the POSITION AXIS the backward path reads: this fragment's
    // global start offset, so resolvePosition can recover a document offset.
    <span class="txt-block" data-pos={props.value.getPosition()} data-pos-x={props.value.segStart}>
        {props.value.renderer.render(
            props.value.getText(), props.value.segStart, props.value.decorations,
        )}
    </span>
);

export const TextHighlightVisual: Component<{ value: TextHighlight }> = props => {
    props.value.noteable.register(props.value);

    // A glyph-less splice paints no visible rect under white-space:pre. Preserve the
    // real line terminators for offset mapping and add an empty visual ornament only.
    const hasNoGlyphs = (text: string) => !/[^\r\n]/.test(text);

    return (
        <span
            class={`${styles.textSegment} txt-block`}
            data-kind="highlighted"
            data-pos={props.value.getPosition()}
            data-pos-x={props.value.segStart}
            ref={el => { props.value.refEl = el; }}
            style={{
                'anchor-name': props.value.noteable.spanAnchorName(props.value),
            }}
            // Activation is a click, not a release: pointerup must remain available
            // to an enclosing interaction (notably a tab dragged over this span).
            onClick={e => props.value.handleSegmentClick(e)}
        >
            <Show when={props.value.noteable.rendersFrom(props.value)}>
                <NoteCoordinatorVisual value={props.value.noteable} />
            </Show>
            {hasNoGlyphs(props.value.getText()) && <span class={styles.emptyOrnament} />}
            {(props.value.renderer.renderHighlighted ?? props.value.renderer.render).call(
                props.value.renderer,
                props.value.getText(),
                props.value.segStart,
                props.value.decorations,
            )}
        </span>
    );
};

export const TextReprVisual: Component<{ value: TextRepr }> = props => (
    <Show
        when={!props.value.isPlainText()}
        fallback={<PlainTextSegmentVisual value={props.value as PlainTextSegment} />}
    >
        <TextHighlightVisual value={props.value as TextHighlight} />
    </Show>
);

export const RenderUnitVisual: Component<{ value: RenderUnit }> = props => (
    <>
        {props.value.stamp?.spacerPx ? (
            <div style={{
                height: `${props.value.stamp.spacerPx}px`,
                'flex-shrink': 0,
                ...(props.value.stamp.spacerHatch
                    ? { background: props.value.stamp.spacerHatch }
                    : {}),
            }} />
        ) : null}
        {/* Dynamic because the row's element varies between block and inline views. */}
        <Dynamic
            component={props.value.rowTag}
            class={props.value.lineClass}
            ref={(el: HTMLElement) => { props.value.refEl = el; }}
            style={props.value.stamp?.bgColor ? { background: props.value.stamp.bgColor } : {}}
        >
            <For each={props.value.segments}>
                {segment => <TextReprVisual value={segment} />}
            </For>
        </Dynamic>
    </>
);
