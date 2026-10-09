import { JSX, ParentComponent, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import styles from '../styles/LiveComponent.module.css';
import type { Selectable } from '../interactions/SelectionManager';

interface LiveBase {
    id?: string;
    selectable?: Selectable;
    [key: string]: any;
}

export const LiveContainer: ParentComponent<LiveBase> = (props) => {
    const [local, rest] = splitProps(props, ['id', 'selectable', 'children']);
    return (
        <div
            class={styles.liveContainer}
            data-component-id={local.id}
            data-selected={local.selectable?.getSelected()}
            {...rest}
        >
            {local.children}
        </div>
    );
};

export function LiveTextBox(props: LiveBase & { value: any }): JSX.Element {
    const [local, rest] = splitProps(props, ['id', 'selectable', 'value']);
    return (
        <div
            class={styles.liveTextBox}
            data-component-id={local.id}
            data-selected={local.selectable?.getSelected()}
            // The clamp anchor-name is stamped onto this div by the view's
            // setClampEl (forwarded via ref in rest), so it's not declared here.
            {...rest}
        >
            <pre>
                <Dynamic component={local.value} />
            </pre>
        </div>
    );
}
