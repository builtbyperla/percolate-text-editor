import { Tab, ViewBlock } from './Tabs';
import { wireTabDecorations } from './tabDecorations';
import { SourceId } from '../textmodel/SourceId';
import { DualTextView } from '../editor/DualTextView';
import { MarkdownView } from '../markdown/MarkdownView';
import { MarkdownDualView } from '../markdown/MarkdownDualView';
import { DiffView } from '../editor/diff/DiffView';

export class FileTab extends Tab {
    constructor(source: SourceId, view: DualTextView, ownsScroll: boolean = true) {
        super(source, view, ownsScroll);
        this.setActions(view.buildTabActions());
        // Give the tab direct access to the view's reactive badges and mode.
        wireTabDecorations(this, view);
    }

    copy(): Tab {
        return new FileTab(this.copySource(), (this.view as DualTextView).makePeer(), this.ownsScroll);
    }
}

export class MarkdownTab extends Tab {
    constructor(source: SourceId, view: MarkdownView, ownsScroll: boolean = true) {
        super(source, view, ownsScroll);
    }
}

export class MarkdownFileTab extends Tab {
    constructor(source: SourceId, view: MarkdownDualView, ownsScroll: boolean = true) {
        super(source, view, ownsScroll);
        this.setActions(view.buildTabActions());
        wireTabDecorations(this, view);
        const base = source.label();
        this.getLabel = () => view.getMode() === 'rendered' ? `${base} (Preview)` : base;
    }

    // Copy builds a fresh PEER dual view sharing the raw model; the peer carries no
    // save/watch binding (it mirrors, doesn't second-write to disk).
    copy(): Tab {
        return new MarkdownFileTab(this.copySource(), (this.view as MarkdownDualView).makePeer(), this.ownsScroll);
    }
}

// A split-view diff tab. No actions today; the subclass exists so diff copy is
// first-class and future diff-specific actions have a home.
export class DiffTab extends Tab {
    constructor(source: SourceId, view: DiffView, ownsScroll: boolean = true) {
        super(source, view, ownsScroll);
    }

    // Copy builds a fresh peer DiffView (shared per-side models) — a live mirror.
    copy(): Tab {
        return new DiffTab(this.copySource(), (this.view as DiffView).makePeer(), this.ownsScroll);
    }

    canCopy(): boolean { return !(this.view as DiffView).isProposal; }
}

export class TerminalTab extends Tab {
    constructor(source: SourceId, view: ViewBlock, ownsScroll: boolean = false) {
        super(source, view, ownsScroll);
    }

    canCopy(): boolean {
        return false;
    }
}

export class SampleTab extends Tab {
    constructor(source: SourceId, view: ViewBlock, ownsScroll: boolean = false) {
        super(source, view, ownsScroll);
    }
}
