import { DualTextView, AnnotatorViewFrame } from '../DualTextView';
import { DiffSide } from './diffDecorations';
import { TextDataModel } from '../../textmodel/TextDataModel';
import { RangesDataModel } from '../RangesDataModel';
import { DiffAnnotatorViewFrame, DiffMeta } from './DiffAnnotatorViewFrame';
import { diffExtension } from './diffDecorations';
import { userSettings } from '../../UserSettings';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { DiffScheduler } from './DiffScheduler';
import { DiffContextCoordinator } from './DiffContextCoordinator';
import { FoldingController } from '../folding';

export class DiffDualTextView extends DualTextView {
    constructor(
        key: string,
        initialContent: string,
        private side: DiffSide,
        private getOtherModel: () => TextDataModel | null,
        private ranges: RangesDataModel,
        private readonly readOnly = false,
    ) {
        super(key, initialContent);
    }

    // The shared per-view diff (set by DiffView after both models exist). Both this
    // side's edit and annotate projections read its snapshot instead of re-diffing.
    private scheduler: DiffScheduler | null = null;
    setScheduler(scheduler: DiffScheduler) {
        this.scheduler = scheduler;
    }

    private contextCoordinator: DiffContextCoordinator | null = null;
    setContextCoordinator(coordinator: DiffContextCoordinator) {
        this.contextCoordinator = coordinator;
        coordinator.registerFoldView(this.side, this);
        coordinator.registerModeView(this.side, this);
    }

    toggleAnnotate(): void {
        if (this.contextCoordinator) this.contextCoordinator.toggleMode(this.side);
        else super.toggleAnnotate();
    }

    protected onScrollerMounted(el: HTMLDivElement): void {
        this.contextCoordinator?.registerScroller(this.side, el);
    }

    protected editorExtension(): Extension {
        const otherModel = this.getOtherModel();
        if (!otherModel || !this.scheduler) return [];
        return [
            diffExtension(this.scheduler, this.side, userSettings.editorTheme(), this.ranges),
            ...(this.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        ];
    }

    protected editorFoldingEnabled(): boolean {
        // A standalone side has nobody with which to preserve alignment.
        return this.contextCoordinator != null;
    }

    protected editorFoldingController(): FoldingController | null {
        const coordinator = this.contextCoordinator;
        if (!coordinator) return null;
        return {
            info: (state, line) => coordinator.coordinatedFoldInfo(this.side, state, line),
            toggle: (_view, line) => coordinator.toggleFold(this.side, line),
            onChange: (before, after) => coordinator.synchronizeFoldChange(this.side, before, after),
        };
    }

    protected foldingInfo(state: EditorState, line: number) {
        return this.contextCoordinator?.coordinatedFoldInfo(this.side, state, line) ?? null;
    }

    toggleEditorFold(line: number): void {
        this.contextCoordinator?.toggleFold(this.side, line);
    }

    toggleAnnotatorFold(line: number): void {
        this.contextCoordinator?.toggleFold(this.side, line);
    }

    protected unfoldAnnotatorLine(line: number): void {
        this.contextCoordinator?.unfoldLine(this.side, line);
    }

    refreshCoordinatedFoldControls(): void {
        this.getEditorFrame()?.refreshRuler();
        this.getAnnotatorFrame()?.refreshFolding();
    }

    rulerRanges(): RangesDataModel {
        return this.ranges;
    }

    protected newAnnotatorFrame(sourceId: string, getClampBox: () => HTMLElement | null, text: string, model: TextDataModel | null): AnnotatorViewFrame {
        const meta: DiffMeta = {
            side: this.side,
            getOtherModel: this.getOtherModel,
            ranges: this.ranges,
            scheduler: this.scheduler,
        };
        // Build the agent-payload callback here (coordinator + side are in scope) and pass
        // it in — the frame just calls it. No diff state cached on the frame.
        const getAdditionalData = () => this.contextCoordinator?.diffPayload(this.side);
        return new DiffAnnotatorViewFrame(this, sourceId, getClampBox, text, model, meta, getAdditionalData);
    }
}
