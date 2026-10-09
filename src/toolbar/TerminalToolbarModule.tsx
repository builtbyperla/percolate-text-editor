import { JSX } from 'solid-js';
import { ToolbarModule } from './ToolbarModule';

export class TerminalToolbarModule extends ToolbarModule {
    readonly id = 'terminal';
    readonly icon = '▤';
    readonly label = 'Terminal';
    readonly isAction = true;

    constructor(
        private toggle: () => void,
        private visible: () => boolean,
    ) {
        super();
    }

    // Never shown (isAction), but the base contract requires a body.
    getPanel(): () => JSX.Element {
        return () => <></>;
    }

    onActivate(): void {
        this.toggle();
    }

    isActive(): boolean {
        return this.visible();
    }
}
