import { Accessor, Component, JSX, Setter, createSignal } from 'solid-js';
import { For } from 'solid-js';
import { LiveTextBox, LiveContainer } from '../components/CoreVisuals';
import styles from '../styles/LiveComponent.module.css';
import { componentRegistry } from '../ComponentRegistry';
import { APP_VIEWPORT_ANCHOR, NoteCoordinator, NoteCoordinatorVisual, NoteLayerProps, appEditorLayer, noteAnchorParams } from '../annotation/AnnotationVisualFrames';
import { ContextItem, ContextView } from '../annotation/ContextItem';
import { TextDataModel } from '../textmodel/TextDataModel';
import { FixedTextDataModel } from '../textmodel/FixedTextDataModel';
import { LiveBaseComponent, LiveData } from '../components/BaseComponents';
import { Selectable } from '../interactions/SelectionManager';
import { revealElement } from '../utility/RevealScroll';
import { ViewBlock } from './Tabs';

interface LiveItem {
    id: string;
    getVisual(): () => JSX.Element;
}

export class LiveContainerComponent extends LiveBaseComponent implements ViewBlock, ContextView {
    getItems: Accessor<Array<LiveItem>>;
    setItems: Setter<Array<LiveItem>>;
    visualObj: Component<any>;

    contextItem: ContextItem;
    noteable: NoteCoordinator;
    selectable: Selectable;

    private textSource = new FixedTextDataModel('');

    get sourceId(): string {
        return this.id;
    }

    // ContextView: whichever child preview this container currently surfaces.
    get label(): string {
        return this.getPreviewText();
    }

    constructor(items: Array<LiveItem> = []) {
        super();
        componentRegistry.register(this, 'container');
        [this.getItems, this.setItems] = createSignal(items);
        this.visualObj = LiveContainer;
        for (const item of items) {
            componentRegistry.setParent(item.id, this.id);
        }

        // One shared context item for this container's note + selection.
        this.contextItem = new ContextItem(this);

        // As with the text view's block note: clear() is the whole teardown here.
        this.noteable = new NoteCoordinator(this, this, this.contextItem, () => this.clear());
        this.selectable = new Selectable({
            createContext: () => this.contextItem.register(),
            onSelect: () => this.noteable.setActive(),
            onDeselect: () => {
                this.noteable.updateNote("");
                this.noteable.setInactive();
                this.contextItem.deregister();
            },
        });
    }

    addSubcomponent(comp: LiveItem) {
        componentRegistry.setParent(comp.id, this.id);
        this.setItems(prev => [...prev, comp]);
    }

    setSubcomponents(items: Array<LiveItem>) {
        const current = componentRegistry.getChildren(this.id).map(e => e.id);
        const incoming = new Set(items.map(i => i.id));
        for (const id of current) {
            if (!incoming.has(id)) componentRegistry.deregister(id);
        }
        for (const item of items) {
            componentRegistry.setParent(item.id, this.id);
        }
        this.setItems(items);
    }

    getPreviewText(): string {
        const items = this.getItems();
        for (const item of items) {
            const preview = (item as any).getPreviewText?.();
            if (preview) return preview;
        }
        return '';
    }

    getDataSource(): TextDataModel {
        this.textSource.setValue(this.getPreviewText());
        return this.textSource;
    }

    // ContextView: scroll this container into view (evidence-pane chip click). A
    // container carries exactly one whole-scope item, so the argument is unused.
    scrollToItem(_item: ContextItem): void {
        revealElement(document.querySelector(`[data-component-id="${this.id}"]`));
    }

    // ContextView: a container's children are LiveItems, not annotation views.
    getSubViews(): ContextView[] {
        return [];
    }

    // ContextView: teardown — deselect, clear the note, drop from the pane.
    clear(): void {
        this.selectable.clear();
        this.noteable.setInactive();
        this.noteable.updateNote("");
        this.contextItem.deregister();
    }

    onMouseDown(e: MouseEvent) {
        e.stopPropagation();
    }

    noteLayer(): NoteLayerProps {
        return {
            clampAnchor: APP_VIEWPORT_ANCHOR,
            paramsFor: noteAnchorParams,
            strategy: 'note/span-above',
        };
    }

    editorLayer(): NoteLayerProps {
        return appEditorLayer();
    }

    onMouseUp(e: MouseEvent) {
        e.stopPropagation();
        if (!window.getSelection()?.isCollapsed) return;
        // Toggle drives the select/deselect callbacks, which handle pane
        // registration + note open/close.
        this.selectable.toggle();
    }

    getCoreVisual(): () => JSX.Element {
        const Comp = this.visualObj;
        return () => (
            <Comp
                id={this.id}
                selectable={this.selectable}
                ref={(el: HTMLElement) => this.setFrameEl(el)}
                style={{ 'anchor-name': this.noteable.spanAnchorName(this) }}
                onpointerdown={(e: MouseEvent) => this.onMouseDown(e)}
                onpointerup={(e: MouseEvent) => this.onMouseUp(e)}
            >
                <For each={this.getItems()}>
                    {item => item.getVisual()()}
                </For>
            </Comp>
        );
    }

    getVisual(): () => JSX.Element {
        return () => (
            <>
                {this.getCoreVisual()()}
                <NoteCoordinatorVisual value={this.noteable} />
            </>
        );
    }
}
