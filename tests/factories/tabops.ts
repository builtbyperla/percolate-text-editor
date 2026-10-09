import { Tab, TabContainer } from '../../src/containers/Tabs';
import { makeTab } from './panes';

// A randomized-sequence harness for TabContainer: each operation is an object
// that knows when it applies, how to pick its own arguments, and how to describe
// itself. A runner composes them into sequences, so adding an operation means
// adding one object rather than editing every property test.

// Seeded PRNG (mulberry32). Seeded, not Math.random, so a failing sequence is
// reproducible from its seed alone.
export class Rng {
    private state: number;

    constructor(seed: number) {
        this.state = seed;
    }

    next(): number {
        this.state |= 0;
        this.state = (this.state + 0x6D2B79F5) | 0;
        let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    int(maxExclusive: number): number {
        return Math.floor(this.next() * maxExclusive);
    }

    bool(): boolean {
        return this.next() < 0.5;
    }

    pick<T>(items: readonly T[]): T {
        return items[this.int(items.length)];
    }
}

// What an operation reports about the state it touched, so a property can say
// "this op should not have moved the active tab" without re-deriving intent.
export interface OpEffect {
    // Human-readable call, e.g. 'moveTab(2->0)'. Printed in failure output.
    description: string;

    // The tab this op targeted, when it had one.
    target: Tab | null;

    // Does this op legitimately change the active tab? Properties use this to
    // separate "active moved" from "active moved when nothing asked".
    activates: boolean;
}

// One operation the fuzzer can apply. Stateless — all state lives in the
// container it is handed.
export abstract class TabOp {
    abstract readonly name: string;

    // Can this run against the container's current state? A move needs a tab to
    // move; a remove needs something to remove.
    canApply(_c: TabContainer): boolean {
        return true;
    }

    // Pick arguments and apply. Returns what it did.
    abstract apply(c: TabContainer, rng: Rng): OpEffect;
}

// Mint labels that stay unique across a whole run, so a failure trace names a
// specific tab rather than an ambiguous 'tab-1'.
let minted = 0;
export function resetLabels(): void {
    minted = 0;
}
function freshTab(prefix: string): Tab {
    return makeTab(`${prefix}-${minted++}`);
}

export class AddTabOp extends TabOp {
    readonly name = 'addTab';

    apply(c: TabContainer, rng: Rng): OpEffect {
        const tab = freshTab('add');
        const activate = rng.bool();
        // An empty container activates its first tab regardless of the flag, so
        // this op only claims to activate when it truly drives the change.
        const wasEmpty = c.isEmpty();
        c.addTab(tab, activate);
        return {
            description: `addTab(${tab.getLabel()}, activate=${activate})`,
            target: tab,
            activates: activate || wasEmpty,
        };
    }
}

// Adds a tab in the BACKGROUND — never activating. Its own op rather than a
// flag on AddTabOp, so a property can compose a set that provably never moves
// the active tab. Excluded from ALL_OPS (AddTabOp already covers both cases).
export class BackgroundAddTabOp extends TabOp {
    readonly name = 'backgroundAdd';

    // An empty container activates its first tab whatever the flag says, so
    // this op only applies where it can honour "never activates".
    canApply(c: TabContainer): boolean {
        return !c.isEmpty();
    }

    apply(c: TabContainer, _rng: Rng): OpEffect {
        const tab = freshTab('bg');
        c.addTab(tab, false);
        return { description: `addTab(${tab.getLabel()}, activate=false)`, target: tab, activates: false };
    }
}

export class InsertTabOp extends TabOp {
    readonly name = 'insertTab';

    apply(c: TabContainer, rng: Rng): OpEffect {
        const tab = freshTab('ins');
        const index = rng.int(c.getTabs().length + 1);
        const activate = rng.bool();
        const wasEmpty = c.isEmpty();
        c.insertTab(index, tab, activate);
        return {
            description: `insertTab(${index}, ${tab.getLabel()}, activate=${activate})`,
            target: tab,
            activates: activate || wasEmpty,
        };
    }
}

export class SelectTabOp extends TabOp {
    readonly name = 'selectTab';

    canApply(c: TabContainer): boolean {
        return !c.isEmpty();
    }

    apply(c: TabContainer, rng: Rng): OpEffect {
        const tab = rng.pick(c.getTabs());
        c.selectTab(tab);
        return { description: `selectTab(${tab.getLabel()})`, target: tab, activates: true };
    }
}

export class RemoveTabOp extends TabOp {
    readonly name = 'removeTab';

    canApply(c: TabContainer): boolean {
        return !c.isEmpty();
    }

    apply(c: TabContainer, rng: Rng): OpEffect {
        const tab = rng.pick(c.getTabs());
        // Removing the ACTIVE tab must hand the slot to a neighbour; removing
        // any other must leave the active tab alone.
        const activates = tab === c.getActiveTab();
        c.removeTab(tab);
        return { description: `removeTab(${tab.getLabel()})`, target: tab, activates };
    }
}

export class CloseTabOp extends TabOp {
    readonly name = 'closeTab';

    canApply(c: TabContainer): boolean {
        return !c.isEmpty();
    }

    apply(c: TabContainer, rng: Rng): OpEffect {
        const tab = rng.pick(c.getTabs());
        const activates = tab === c.getActiveTab();
        c.closeTab(tab);
        return { description: `closeTab(${tab.getLabel()})`, target: tab, activates };
    }
}

export class MoveTabOp extends TabOp {
    readonly name = 'moveTab';

    canApply(c: TabContainer): boolean {
        return c.getTabs().length > 1;
    }

    apply(c: TabContainer, rng: Rng): OpEffect {
        const count = c.getTabs().length;
        const from = rng.int(count);
        const to = rng.int(count);
        c.moveTab(from, to);
        // Reordering never changes WHICH tab is active.
        return { description: `moveTab(${from}->${to})`, target: null, activates: false };
    }
}

// --- drag-visual ops ------------------------------------------------------
// The insert cursor is per-header signal state driven by the BAR across all its
// headers. These ops exercise that cross-header coordination, which structural
// ops never touch.

// Show the insert cursor at a position, as a drag hover does.
export class ShowInsertAtOp extends TabOp {
    readonly name = 'showInsertAt';

    canApply(c: TabContainer): boolean {
        return !c.isEmpty();
    }

    apply(c: TabContainer, rng: Rng): OpEffect {
        // Include length (the end-cap index) as a valid position.
        const index = rng.int(c.getTabs().length + 1);
        c.headerBar.showInsertLineAtIndex(index);
        return { description: `showInsertLineAtIndex(${index})`, target: null, activates: false };
    }
}

// End a drag hover: every insert cursor must go away.
export class ClearInsertOp extends TabOp {
    readonly name = 'clearInsert';

    apply(c: TabContainer, _rng: Rng): OpEffect {
        c.headerBar.clearInsertVisuals();
        return { description: 'clearInsertVisuals()', target: null, activates: false };
    }
}

// The full operation set. A property test that wants a subset passes its own.
export const ALL_OPS: readonly TabOp[] = [
    new AddTabOp(),
    new InsertTabOp(),
    new SelectTabOp(),
    new RemoveTabOp(),
    new CloseTabOp(),
    new MoveTabOp(),
];

// Structural ops interleaved with drag-visual ops — a drag hovering while tabs
// change underneath it.
export const ALL_OPS_WITH_DRAG: readonly TabOp[] = [
    ...ALL_OPS,
    new ShowInsertAtOp(),
    new ClearInsertOp(),
];

// One applied step: the effect, plus the state either side of it. Properties
// read these rather than re-deriving state, so an assertion failure can print
// the exact transition that broke.
export interface Step {
    index: number;
    effect: OpEffect;
    activeBefore: Tab | null;
    activeAfter: Tab | null;
    tabsBefore: readonly Tab[];
    tabsAfter: readonly Tab[];
}

// Apply `count` randomly chosen applicable operations, recording each step.
// `onStep` runs after every step for per-transition assertions.
export function runSequence(
    c: TabContainer,
    rng: Rng,
    count: number,
    ops: readonly TabOp[] = ALL_OPS,
    onStep?: (step: Step) => void,
): Step[] {
    const steps: Step[] = [];

    for (let i = 0; i < count; i++) {
        const applicable = ops.filter(op => op.canApply(c));
        if (applicable.length === 0) break;

        const op = rng.pick(applicable);
        const activeBefore = c.getActiveTab();
        const tabsBefore = c.getTabs();

        const effect = op.apply(c, rng);

        const step: Step = {
            index: i,
            effect,
            activeBefore,
            activeAfter: c.getActiveTab(),
            tabsBefore,
            tabsAfter: c.getTabs(),
        };
        steps.push(step);
        onStep?.(step);
    }

    return steps;
}

// Render a sequence as a runnable-looking script, so a failure is actionable
// rather than just a seed number.
export function describeSequence(seed: number, steps: readonly Step[], upTo?: number): string {
    const end = upTo != null ? upTo + 1 : steps.length;
    const lines = steps.slice(0, end).map(s => `  ${s.index}: ${s.effect.description}`);
    return [`seed=${seed}`, ...lines].join('\n');
}
