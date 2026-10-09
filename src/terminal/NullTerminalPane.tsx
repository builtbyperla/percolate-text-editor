import { JSX } from 'solid-js';
import { ViewBlock } from '../containers/Tabs';
import type { PtyProvider } from './PtyProvider';

export class NullTerminalPane implements ViewBlock {
    ownsScroll: boolean = false;

    constructor(
        _provider: PtyProvider,
        _opts: { shell?: string; cwd?: string } = {},
    ) {}

    getVisual(): () => JSX.Element {
        return () => (
            <div style={{ padding: '12px', "font-size": '12px', color: 'var(--ui-text-muted)' }}>
                Terminal is unavailable in the web demo.
            </div>
        );
    }

    dispose(): void {}
}
