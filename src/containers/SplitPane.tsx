import { ParentComponent, createSignal, Accessor, Setter, JSX, For, Show } from 'solid-js';
import styles from '../styles/SplitPane.module.css';
import { Tab, TabContainer, TabHeader, TabHeaderBar, ViewBlock } from './Tabs';
import { tabDragManager } from '../interactions/TabDragManager';

type SplitPaneBlock = () => JSX.Element;

export class SplitPaneFrame<T extends ViewBlock> implements ViewBlock {
    containerRef: HTMLDivElement | undefined;
    panes: T[] = [];
    blocks: SplitPaneBlock[] = [];

    // Pane flex sizes
    fractions: Accessor<number>[] = [];
    fractionSetters: Setter<number>[] = [];

    // Panes + dividers in a single array TODO: We will need to use these when we update, some kind of refresh mechanism based around this.blocks
    getBlocks: Accessor<SplitPaneBlock[]>;
    setBlocks: Setter<SplitPaneBlock[]>;

    private _paneBlockCache: Map<T, { block: SplitPaneBlock; fracSignal: Accessor<number>; fracSetter: Setter<number> }> = new Map();

    // Pane direction
    getIsHorizontal: Accessor<boolean>;
    setIsHorizontal: Setter<boolean>;

    // Compatability for nested split pane wrapping
    ownsScroll: boolean = true;

    constructor(isHorizontal: boolean = false, panes: T[] = []) {
        this.panes = panes;
        this._initBlocks();
        [this.getBlocks, this.setBlocks] = createSignal(this.blocks);
        [this.getIsHorizontal, this.setIsHorizontal] = createSignal(isHorizontal);
    }

    getPanes(): T[] {
        return [...this.panes];
    }

    removePane(p: T) {
        let index: number = -1;
        let i: number = 0;
        for (let item of this.panes) {
            if (item == p) {
                index = i;
            }
            i += 1;
        }

        if (index >= 0) {
            this.panes.splice(index, 1);
        }

        this.refreshBlocks();
    }

    addPane(p: T) {
        this.panes.push(p);
        this.refreshBlocks();
    }

    // Core logic
    getPaneIndex(pane: ViewBlock): number {
        for (let i = 0; i < this.panes.length; i++) {
            let p = this.panes[i];
            if (p == pane) {
                return i;
            }
        }
        return -1;
    }

    _initBlocks() {
        let blocks: SplitPaneBlock[] = [];
        let fractions: Accessor<number>[] = [];
        let fractionSetters: Setter<number>[] = [];
        const length = this.panes.length;
        const frac = length > 0 ? 1/length : 1;

        // Rebuilt fresh each pass: only panes still present get carried over,
        // so a removed pane's bundle can never be served back later.
        const nextCache: typeof this._paneBlockCache = new Map();

        for (let i = 0; i < this.panes.length; i ++) {
            // Create divider (skip first block, goes after pane). Dividers are
            // stateless (just an index-bound click handler), so no caching needed.
            if (i != 0) {
                blocks.push(this._createDividerBlock(i));
            }

            const pane = this.panes[i];
            let entry = this._paneBlockCache.get(pane);
            if (!entry) {
                const [fracSignal, fracSetter] = createSignal(frac);
                entry = { block: this._wrapPane(pane, fracSignal), fracSignal, fracSetter };
            } else {
                entry.fracSetter(frac);
            }
            nextCache.set(pane, entry);

            fractions.push(entry.fracSignal);
            fractionSetters.push(entry.fracSetter);
            blocks.push(entry.block);
        }

        this._paneBlockCache = nextCache;

        // Update blocks and the fraction signals
        this.blocks = blocks;
        this.fractions = fractions;
        this.fractionSetters = fractionSetters;
    }

    refreshBlocks() {
        this._initBlocks();
        this.setBlocks(this.blocks);
    }

    onTabPointerMove(_clientX: number, _clientY: number) {
        // No-op
    }

    clearHoverTarget() {
        // No-op
    }

    dropTab(_tab: Tab, _clientX: number, _clientY: number, _originTabBar: TabHeaderBar) {
        // No-op
    }

    // Visual helper methods
    _createDividerBlock(index: number): SplitPaneBlock {
        // Helper method for creating a pane divider drag bar
        return () => (
            <div class={styles.divider}
                onPointerDown={(ev) => {this.onDividerPointerDown(ev, index)}}
                >
            </div>
        )
    }

    _wrapPane(pane: T, frac: Accessor<number>) {
        const scrollClass = pane.ownsScroll ? styles.paneSelfManagedScroll : styles.paneScroll;
        return () => (
            <div class={styles.pane} style={{ flex: `${frac()} 1 0`, position: 'relative' }}>
                <div class={scrollClass}>
                    {pane.getVisual()()}
                </div>
            </div>
        );
    }

    // Movement: pane size adjustment via divider
    onDividerPointerDown(e: PointerEvent, index: number) {
        // Set up an event listener for the divider drag
        e.preventDefault();
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);

        const onMove = (ev: PointerEvent) => this.onDividerPointerMove(ev, index);
        const onUp = (ev: PointerEvent) => {
            el.releasePointerCapture(ev.pointerId);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    onDividerPointerMove(ev: PointerEvent, index: number) {
        // Compute the total local fraction (of both the panes adjacent to the divider)
        // then compute the local fraction new values relative to this total
        if (!this.containerRef) return;
        const rect = this.containerRef.getBoundingClientRect();
        const isHorizontal = this.getIsHorizontal();
        const totalSize = isHorizontal ? rect.width : rect.height;
        const pointerOffset = isHorizontal ? ev.clientX - rect.left : ev.clientY - rect.top;

        const aboveIdx = index - 1;
        const belowIdx = index;
        const minPx = 80;

        const combinedFrac = this.fractions[aboveIdx]() + this.fractions[belowIdx]();
        const combinedPx = combinedFrac * totalSize;

        let startOfAbovePx = 0;
        for (let i = 0; i < aboveIdx; i++) {
            startOfAbovePx += this.fractions[i]() * totalSize;
        }

        const rawAbovePx = pointerOffset - startOfAbovePx;
        const clampedAbovePx = Math.min(Math.max(rawAbovePx, minPx), combinedPx - minPx);

        this.fractionSetters[aboveIdx](clampedAbovePx / totalSize);
        this.fractionSetters[belowIdx](combinedFrac - clampedAbovePx / totalSize);
    }

    // Visual rendering
    getVisual() {
        return () => (
            <div
                class={styles.container}
                classList={{ [styles.horizontal]: this.getIsHorizontal() }}
                ref={(el) => { this.containerRef = el; }}>
                <For each={this.getBlocks()}>
                    {(block) => block()}
                </For>
            </div>
        );
    }
}
