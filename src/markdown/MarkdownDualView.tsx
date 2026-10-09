import { JSX, createSignal, Show } from 'solid-js';
import { ViewBlock, Editor, SearchData, TabAction } from '../containers/Tabs';
import { ContextView } from '../annotation/ContextItem';
import { ContextViewHost } from '../interactions/ViewLocator';
import { DualTextView } from '../editor/DualTextView';
import { MarkdownView } from './MarkdownView';
import { textModelRegistry } from '../textmodel/TextModelRegistry';
import { FileSystemProvider } from '../fileexplorer/FileSystemProvider';
import { FileText, Eye, PencilLine, EyeClosed } from 'lucide-solid';
import mdStyles from '../styles/Markdown.module.css';

export class MarkdownDualView implements ViewBlock, Editor, ContextViewHost {
    ownsScroll: boolean = true;

    // The raw model key (the file path). Retained so makePeer rebuilds over the same
    // identity, and so the reader can fetchExisting the shared model.
    private key: string;

    // Raw editable side (owns save/watch bindings, the shared CmTextDataModel) and the
    // rendered reader (its own display-space annotations, observes the shared model).
    private rawView: DualTextView;
    private reader: MarkdownView;

    private getMode_: () => 'raw' | 'rendered';
    private setMode_: (m: 'raw' | 'rendered') => void;

    constructor(key: string, initialContent?: string) {
        this.key = key;
        this.rawView = new DualTextView(key, initialContent);
        this.rawView._initTextModel();

        const shared = textModelRegistry.fetchExisting(key)!;
        // Distinct sourceId keeps the reader's annotations separate from the editor's
        // (per-mode). It observes `shared` for re-derivation on raw edits.
        this.reader = new MarkdownView(`${key}::rendered`, shared);

        [this.getMode_, this.setMode_] = createSignal<'raw' | 'rendered'>('raw');
    }

    getMode(): 'raw' | 'rendered' {
        return this.getMode_();
    }

    toggleMode(): void {
        this.setMode_(this.getMode_() === 'raw' ? 'rendered' : 'raw');
    }

    makePeer(): MarkdownDualView {
        const peer = new MarkdownDualView(this.key);
        const binding = this.rawView.getSaveBinding();
        if (binding) peer.attachSaveBinding(binding.provider, binding.path);
        return peer;
    }

    revealSearch(data: SearchData): void {
        if (this.getMode_() === 'raw') this.rawView.revealSearch(data);
    }

    // Pass-throughs so the open flow binds save/watch to the raw child exactly as it
    // does for a plain DualTextView (openFileInEditor calls these before building the tab).
    attachSaveBinding(provider: FileSystemProvider, path: string): void {
        this.rawView.attachSaveBinding(provider, path);
    }
    attachFileBinding(disposeWatcher: () => void, requestClose: () => void): void {
        this.rawView.attachFileBinding(disposeWatcher, requestClose);
    }

    // Close-on-dirty confirm belongs to the raw child, which owns the buffer and its
    // save binding — without forwarding, a dirty markdown file would close silently.
    confirmClose(): Promise<boolean> {
        return this.rawView.confirmClose();
    }

    // Tab actions: the raw editor's own actions (whole-source toggle, Save), plus a
    // Raw/Preview toggle that flips which child is mounted.
    buildTabActions(): TabAction[] {
        const toggle = new TabAction(
            'toggle-markdown-mode',
            () => (
                <Show when={this.getMode_() === 'raw'} fallback={<EyeClosed size={16} />}>
                    <Eye size={16} />
                </Show>
            ),
            () => this.getMode_() === 'raw' ? 'Preview (rendered)' : 'Edit (raw)',
            () => this.toggleMode(),
        );
        return [toggle, ...this.rawView.buildTabActions()];
    }

    // ContextViewHost: surface BOTH children's context views, so the evidence pane can
    // reach annotations made in either mode.
    getContextViews(): ContextView[] {
        return [this.rawView, this.reader.getContextView()];
    }

    // DecorationProducer (duck-typed): forward the raw editor's dirty-dot memo so the
    // tab shows unsaved state — the save binding lives on the raw child.
    getTabDecorations() {
        return this.rawView.getTabDecorations();
    }

    // Scroll handoff across a tab switch, forwarded to the raw child (the side that
    // tracks an offset).
    getScrollOffset(): number {
        return this.rawView.getScrollOffset();
    }

    setScrollOffset(top: number): void {
        this.rawView.setScrollOffset(top);
    }

    getVisual(): () => JSX.Element {
        return () => (
            <div class={mdStyles.modeHost}>
                <Show when={this.getMode_() === 'raw'} fallback={this.reader.getVisual()()}>
                    {this.rawView.getVisual()()}
                </Show>
            </div>
        );
    }

    dispose(): void {
        this.rawView.dispose();
        this.reader.dispose();
    }
}
