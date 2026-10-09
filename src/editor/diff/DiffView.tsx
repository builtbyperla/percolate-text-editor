import { JSX, createEffect, createSignal, Show, untrack, type Accessor } from 'solid-js';
import { ViewBlock } from '../../containers/Tabs';
import { SplitPaneFrame } from '../../containers/SplitPane';
import { Columns2, Rows2 } from 'lucide-solid';
import diffStyles from '../../styles/Diff.module.css';
import { RangesDataModel } from '../RangesDataModel';
import { DiffDualTextView } from './DiffDualTextView';
import { DiffScheduler } from './DiffScheduler';
import { DiffTextSource } from './DiffTextSource';
import { DiffContextCoordinator } from './DiffContextCoordinator';
import type { ControlAction, ToolStatus } from '../../../shared/agentProtocol';
import type { FileEditBuffer } from '../../chat/FileEditBuffer';
import type { ContextView } from '../../annotation/ContextItem';

interface ProposalBinding {
    buffer: FileEditBuffer;
    status: Accessor<ToolStatus>;
    onAction: (action: ControlAction) => void;
}

export class DiffView implements ViewBlock {
    ownsScroll: boolean = true;
    readonly isProposal: boolean;

    // The composite source key (children key on `${key}::old` / `::new`). Retained
    // so makePeer can rebuild a fresh DiffView over the same identity.
    private key: string;

    private oldView: DiffDualTextView;
    private newView: DiffDualTextView;
    private split: SplitPaneFrame<DiffDualTextView>;

    private scheduler: DiffScheduler;

    // Owns cross-side coordination: agent-context payloads and scroll mirroring between
    // the two panes. Held so dispose can detach its scroll listeners.
    private coordinator: DiffContextCoordinator;
    private unsubscribeFoldReconcile: (() => void) | null = null;

    private getSideBySide: () => boolean;
    private setSideBySide: (v: boolean) => void;

    constructor(key: string, oldText: string, newText: string, private readonly proposal?: ProposalBinding) {
        this.key = key;
        this.isProposal = !!proposal;
        // Per-side ranges models: diff spacers written by CM6 decoration layer and
        // annotate-mode InnerText, read by the ruler for row alignment.
        const oldRanges = new RangesDataModel();
        const newRanges = new RangesDataModel();

        // Build diff-aware text views. Each side knows its diff side and how to reach
        // the other model. All diff wiring happens in DiffDualTextView's overrides.
        this.oldView = new DiffDualTextView(
            `${key}::old`,
            oldText,
            'old',
            () => this.newView.getTextModel(),
            oldRanges,
            !!proposal,
        );
        this.newView = new DiffDualTextView(
            `${key}::new`,
            newText,
            'new',
            () => this.oldView.getTextModel(),
            newRanges,
        );

        // Diff panes open in reader mode; their ruler toggles stay paired.
        this.oldView.setAnnotateMode();
        this.newView.setAnnotateMode();

        // Eagerly initialize models so getOtherModel resolves immediately.
        this.oldView._initTextModel();
        this.newView._initTextModel();

        this.scheduler = new DiffScheduler(() => ({
            oldText: this.oldView.getTextModel()?.getValue() ?? '',
            newText: this.newView.getTextModel()?.getValue() ?? '',
        }));
        this.oldView.getTextModel()?.onChange(() => this.scheduler.request());
        this.newView.getTextModel()?.onChange(() => this.scheduler.request());
        if (proposal) this.newView.getTextModel()?.onChange(() => {
            const value = this.newView.getTextModel()?.getValue() ?? '';
            if (proposal.status() === 'pending' && value !== proposal.buffer.getContent()?.after) proposal.buffer.edit(value);
        });
        this.oldView.setScheduler(this.scheduler);
        this.newView.setScheduler(this.scheduler);
        this.scheduler.recomputeNow();

        const diffSource = new DiffTextSource(
            key, this.oldView.getTextModel()!, this.newView.getTextModel()!, this.scheduler,
        );
        this.coordinator = new DiffContextCoordinator(diffSource);
        this.unsubscribeFoldReconcile = this.scheduler.subscribe(() => this.coordinator.reconcileFolds());
        this.oldView.setContextCoordinator(this.coordinator);
        this.newView.setContextCoordinator(this.coordinator);

        // Draggable split pane.
        this.split = new SplitPaneFrame<DiffDualTextView>(true, [this.oldView, this.newView]);
        [this.getSideBySide, this.setSideBySide] = createSignal(true);
    }

    makePeer(): DiffView {
        const oldText = this.oldView.getTextModel()?.getValue() ?? '';
        const newText = this.newView.getTextModel()?.getValue() ?? '';
        return new DiffView(this.key, oldText, newText);
    }

    // Expose both sides to evidence navigation, including proposal diff tabs.
    getContextViews(): ContextView[] {
        return [this.oldView, this.newView];
    }

    private toggleLayout() {
        const next = !this.getSideBySide();
        this.setSideBySide(next);
        this.split.setIsHorizontal(next);
    }

    getVisual(): () => JSX.Element {
        return () => {
            if (this.proposal) createEffect(() => {
                const content = this.proposal!.buffer.getContent();
                if (!content || content.settled) return;
                // The left side is the base revision captured when the write was
                // attempted. Only a new buffer value may reconcile the candidate;
                // reading its model reactively would replay stale text on typing.
                const candidate = this.newView.getTextModel();
                if (candidate && untrack(candidate.getValue) !== content.after) {
                    candidate.setValue(content.after ?? '');
                }
            });
            return (
            <div class={diffStyles.root}>
                <div class={diffStyles.toolbar}>
                    <Show when={this.proposal}>
                        {binding => <>
                            <span class={diffStyles.proposalLabel}>{binding().status() === 'pending' ? 'Proposed edit' : binding().status()}</span>
                            <Show when={binding().status() === 'pending'}>
                                <div class={diffStyles.proposalActions}>
                                    <button type="button" onClick={() => binding().onAction({ kind: 'rejected' })}>Reject</button>
                                    <button type="button" onClick={() => binding().onAction({ kind: 'skipped' })}>Skip</button>
                                    <button type="button" class={diffStyles.proposalApprove} onClick={() => binding().onAction({ kind: 'approved' })}>Approve</button>
                                </div>
                            </Show>
                        </>}
                    </Show>
                    <button
                        class={diffStyles.layoutToggle}
                        title={this.getSideBySide() ? 'Stacked view' : 'Side-by-side view'}
                        onclick={() => this.toggleLayout()}
                    >
                        <Show when={this.getSideBySide()} fallback={<Columns2 size={14} />}>
                            <Rows2 size={14} />
                        </Show>
                    </button>
                </div>
                <div class={diffStyles.panes} inert={this.proposal && this.proposal.status() !== 'pending' ? true : undefined}>
                    {this.split.getVisual()()}
                </div>
            </div>
            );
        };
    }

    dispose() {
        this.unsubscribeFoldReconcile?.();
        this.unsubscribeFoldReconcile = null;
        this.coordinator.dispose();
        this.scheduler.dispose();
        this.oldView.dispose();
        this.newView.dispose();
    }
}
