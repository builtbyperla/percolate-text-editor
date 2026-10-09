import { Accessor, Setter, For, Show, createSignal, JSX } from 'solid-js';
import { ViewBlock } from '../containers/Tabs';
import { ToolbarModule } from './ToolbarModule';
import styles from '../styles/Toolbar.module.css';

class ToolbarPanelView implements ViewBlock {
    // Panel manages its own scroll host (formerly a SelfManagedScrollPane wrap).
    ownsScroll: boolean = true;

    constructor(private host: ToolbarHost) {}

    getVisual(): () => JSX.Element {
        return () => (
            <Show when={this.host.activeModule()}>
                {mod => (
                    <div class={styles.panel}>
                        <div class={styles.panelHeader}>
                            <span>{mod().label}</span>
                            {mod().getHeaderActions?.()}
                        </div>
                        {mod().getPanel()()}
                    </div>
                )}
            </Show>
        );
    }
}

export class ToolbarHost {
    modules: ToolbarModule[];
    panelView: ToolbarPanelView;

    // Active module id, or null when collapsed. Remembered via lastOpenId so
    // reopening restores the last module.
    getActiveId: Accessor<string | null>;
    setActiveId: Setter<string | null>;
    private lastOpenId: string;

    // Set once PaneWorkspace builds the outer split: drives the panel pane's
    // fraction (and the editor pane's) so collapse/expand resizes them.
    private setPanelFraction?: Setter<number>;
    private setEditorFraction?: Setter<number>;
    private panelFraction = 0.28;

    constructor(modules: ToolbarModule[]) {
        this.modules = modules;
        this.panelView = new ToolbarPanelView(this);
        const first = modules.length > 0 ? modules[0].id : '';
        this.lastOpenId = first;
        [this.getActiveId, this.setActiveId] = createSignal<string | null>(null);
    }

    activeModule(): ToolbarModule | undefined {
        const id = this.getActiveId();
        return this.modules.find(m => m.id === id);
    }

    // PaneWorkspace hands us the outer frame's panel/editor fraction setters so
    // we can resize on collapse/expand.
    bindFractions(setPanel: Setter<number>, setEditor: Setter<number>) {
        this.setPanelFraction = setPanel;
        this.setEditorFraction = setEditor;
        this.applyFractions(this.getActiveId() !== null);
    }

    private applyFractions(open: boolean) {
        const panel = open ? this.panelFraction : 0;
        this.setPanelFraction?.(panel);
        this.setEditorFraction?.(1 - panel);
    }

    selectModule(id: string) {
        const mod = this.modules.find(m => m.id === id);
        if (mod?.isAction) {
            mod.onActivate();
            return;
        }

        if (this.getActiveId() === id) {
            this.setActiveId(null);
            this.applyFractions(false);
        } else {
            this.lastOpenId = id;
            this.setActiveId(id);
            this.applyFractions(true);
        }
    }

    // Whether a rail button reads as "on". An action module answers from its own
    // toggle (isActive); a panel module lights when it's the active panel.
    private isButtonActive(mod: ToolbarModule): boolean {
        if (mod.isAction) return mod.isActive?.() ?? false;
        return this.getActiveId() === mod.id;
    }

    // The thin activity-bar strip — always visible, rendered outside the split.
    getActivityBar(): () => JSX.Element {
        return () => (
            <div class={styles.activityBar}>
                <For each={this.modules}>
                    {mod => (
                        <>
                            <Show when={mod.id === 'terminal'}>
                                <div class={styles.activityDivider} aria-hidden="true" />
                            </Show>
                            <button
                                class={styles.activityButton}
                                classList={{
                                    [styles.active]: this.isButtonActive(mod),
                                    [styles.activityButtonBottom]: mod.id === 'settings',
                                }}
                                title={mod.label}
                                data-tour={`rail-${mod.id}`}
                                onClick={() => this.selectModule(mod.id)}
                            >
                                {mod.icon}
                            </button>
                        </>
                    )}
                </For>
            </div>
        );
    }
}
