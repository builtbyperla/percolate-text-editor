import { JSX } from 'solid-js';

export abstract class ToolbarModule {
    // Stable key for active-module memory and button identity.
    abstract readonly id: string;
    abstract readonly icon: string | JSX.Element;
    abstract readonly label: string;

    abstract getPanel(): () => JSX.Element;

    // Optional controls rendered beside the module label in the panel header.
    // Keeping this on the module lets panel-specific actions live with the
    // feature that owns them without teaching ToolbarHost about module ids.
    getHeaderActions?(): JSX.Element;

    readonly isAction: boolean = false;

    // Called when a pure-action module's rail button is clicked. No-op for panel
    // modules. Overridden by action modules to run their toggle.
    onActivate(): void {}

    isActive?(): boolean;
}
