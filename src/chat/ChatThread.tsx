import { For, Index, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Check, ChevronDown, ChevronRight, ExternalLink, FastForward, GitFork, RotateCcw, Sparkles, X } from 'lucide-solid';
import styles from '../styles/ChatPane.module.css';
import { ChatBlock, TextBlock, ToolBlock } from './ChatBlockModel';
import type { EvidenceSnapshot } from './ChatBlockModel';
import type { ControlAction } from '../../shared/agentProtocol';
import { resolveToolSpec } from './ToolTypeSpecs';
import { ChatTranscriptView } from './ChatTranscriptView';
import { ChatFlow, formatDiffEvidence } from './ChatFlow';
import { parseAskQuestionInput } from '../../shared/agentQuestion';

function QuestionToolCard(props: {
    block: ToolBlock;
    flow: ChatFlow;
    stagedAction?: ControlAction;
    deferCommit?: boolean;
    onControlAction?: (toolCallId: string, action: ControlAction) => void;
    onClearAction?: (toolCallId: string) => void;
}) {
    const b = props.block;
    const stagedAnswer = props.stagedAction?.kind === 'answered' ? props.stagedAction.answer : undefined;
    const [selected, setSelected] = createSignal(stagedAnswer?.kind === 'option' ? stagedAnswer.optionId : undefined);
    const [text, setText] = createSignal(stagedAnswer?.kind === 'text' ? stagedAnswer.text : '');
    let question: ReturnType<typeof parseAskQuestionInput> | undefined;
    try { question = parseAskQuestionInput(b.input); } catch { /* Invalid calls settle as errors in the runtime. */ }
    const choose = (action: ControlAction) => {
        if (props.onControlAction) props.onControlAction(b.toolCallId, action);
        else void props.flow.respond(b.toolCallId, action);
    };
    const submit = () => {
        const typed = text().trim();
        if (typed) choose({ kind: 'answered', answer: { kind: 'text', text: typed } });
        else if (selected()) choose({ kind: 'answered', answer: { kind: 'option', optionId: selected()! } });
    };
    let wasDeferred = false;
    createEffect(() => {
        const deferred = !!props.deferCommit;
        // A second prompt can arrive after someone selects an answer. Keep that
        // choice when the UI switches from the local button to shared commit.
        if (deferred && !wasDeferred && b.getStatus() === 'pending' && (text().trim() || selected())) submit();
        wasDeferred = deferred;
    });
    const answerLabel = () => {
        const action = b.getControlAction();
        if (action?.kind !== 'answered') return undefined;
        const answer = action.answer;
        return answer.kind === 'text'
            ? answer.text
            : question?.options?.find(option => option.id === answer.optionId)?.label ?? answer.optionId;
    };
    return (
        <div class={styles.toolCard} data-status={b.getStatus()} data-tool-call-id={b.toolCallId}>
            <div class={styles.toolHeader}>
                <span class={styles.toolChevron}><ChevronRight size={12} /></span>
                <span class={styles.toolName}>Ask question</span>
                <span class={styles.toolSubject}>{question?.question ?? b.getSubject()}</span>
                <span class={styles.toolStatus}>{b.getStatus() === 'done' ? 'answered' : b.getStatus()}</span>
            </div>
            <Show when={question} fallback={<Show when={b.getOutput()}><pre class={styles.toolBody}>{b.getOutput()}</pre></Show>}>
                {value => <div class={styles.questionPanel}>
                    <div class={styles.questionEyebrow}>Question for you</div>
                    <div class={styles.questionTitle}>{value().question}</div>
                    <Show when={value().detail}><div class={styles.questionDetail}>{value().detail}</div></Show>
                    <Show when={b.getStatus() === 'pending'} fallback={
                        <div class={styles.questionResolved}>
                            {b.getStatus() === 'skipped' ? 'Skipped' : answerLabel() ?? b.getOutput()}
                        </div>
                    }>
                        <Show when={value().options}>
                            {options => <div class={styles.questionOptions} role="group" aria-label={value().question}>
                                <For each={options()}>{option => <label
                                    class={styles.questionOption}
                                    classList={{ [styles.questionOptionSelected]: selected() === option.id }}
                                >
                                    <input
                                        class={styles.questionRadio}
                                        type="radio"
                                        name={`question-${b.toolCallId}`}
                                        value={option.id}
                                        checked={selected() === option.id}
                                        onChange={() => {
                                            setSelected(option.id);
                                            setText('');
                                            if (props.deferCommit) choose({ kind: 'answered', answer: { kind: 'option', optionId: option.id } });
                                        }}
                                    />
                                    <span><strong>{option.label}</strong><Show when={option.detail}><small>{option.detail}</small></Show></span>
                                </label>}</For>
                            </div>}
                        </Show>
                        <textarea
                            class={styles.questionText}
                            aria-label="Your own answer"
                            placeholder={value().options ? 'Or type your answer…' : 'Type your answer…'}
                            value={text()}
                            maxLength={4000}
                            rows={2}
                            onInput={event => {
                                const value = event.currentTarget.value;
                                setText(value);
                                if (value) setSelected();
                                if (props.deferCommit) {
                                    if (value.trim()) choose({ kind: 'answered', answer: { kind: 'text', text: value.trim() } });
                                    else props.onClearAction?.(b.toolCallId);
                                }
                            }}
                        />
                        <div class={styles.questionActions}>
                            <span>{props.stagedAction?.kind === 'skipped' ? 'Skip selected' : props.stagedAction?.kind === 'answered' ? 'Answer selected' : props.deferCommit ? 'Choices are committed below' : 'Skip leaves this unanswered'}</span>
                            <button type="button" classList={{ [styles.controlSelected]: props.stagedAction?.kind === 'skipped' }} aria-pressed={props.stagedAction?.kind === 'skipped'} onClick={() => { setSelected(); setText(''); choose({ kind: 'skipped' }); }}><FastForward size={12} /> Skip</button>
                            <Show when={!props.deferCommit}>
                                <button type="button" class={styles.questionSubmit} disabled={!text().trim() && !selected()} onClick={submit}><Check size={12} /> Answer question</button>
                            </Show>
                        </div>
                    </Show>
                </div>}
            </Show>
        </div>
    );
}

function ToolCard(props: {
    block: ToolBlock;
    flow: ChatFlow;
    stagedAction?: ControlAction;
    deferCommit?: boolean;
    onControlAction?: (toolCallId: string, action: ControlAction) => void;
    onClearAction?: (toolCallId: string) => void;
    onOpenFileEdit?: (block: ToolBlock) => void;
}) {
    const b = props.block;
    if (b.type === 'ask_question') return <QuestionToolCard block={b} flow={props.flow} stagedAction={props.stagedAction} deferCommit={props.deferCommit} onControlAction={props.onControlAction} onClearAction={props.onClearAction} />;
    const spec = resolveToolSpec(b.type);
    const [now, setNow] = createSignal(Date.now());
    const ticker = b.getApproval()?.kind === 'timed' ? setInterval(() => setNow(Date.now()), 100) : undefined;
    onCleanup(() => { if (ticker) clearInterval(ticker); });
    const remaining = () => Math.max(0, (b.getApproval()?.autoApproveAt ?? now()) - now());
    const countdown = () => `${(remaining() / 1_000).toFixed(1)}s`;
    const showBody = () => spec.presentation !== 'inline' && (b.getOutput() !== '' || b.getStatus() === 'running');
    const choose = (action: ControlAction) => {
        if (props.onControlAction) props.onControlAction(b.toolCallId, action);
        else void props.flow.respond(b.toolCallId, action);
    };
    const selected = (kind: ControlAction['kind']) => props.stagedAction?.kind === kind;
    const [previewOpen, setPreviewOpen] = createSignal(b.getStatus() === 'pending');
    let cachedBuffer: ReturnType<ChatFlow['fileEditBuffer']> | undefined;
    const editBuffer = () => {
        const ref = b.getFileEdit();
        if (!ref) return undefined;
        return cachedBuffer ??= props.flow.fileEditBuffer(ref);
    };
    return (
        <div class={styles.toolCard} data-status={b.getStatus()} data-tool-call-id={b.toolCallId}>
            <div class={styles.toolHeader}>
                <span class={styles.toolChevron}><ChevronRight size={12} /></span>
                <span class={styles.toolName}>{spec.label}</span>
                <Show when={b.getSubject()}>
                    <span class={styles.toolSubject}>{b.getSubject()}</span>
                </Show>
                <span class={styles.toolStatus}>{b.getStatus()}</span>
            </div>
            <Show when={showBody()}>
                <pre class={styles.toolBody}>{b.getOutput()}</pre>
            </Show>
            <Show when={b.getFileEdit()}>
                {ref => <div class={styles.fileEditPreview}>
                    <div class={styles.fileEditHeader}>
                        <button type="button" onClick={() => setPreviewOpen(open => !open)} aria-expanded={previewOpen()}>
                            <ChevronDown size={12} /> {previewOpen() ? 'Hide diff' : 'Show diff'}
                        </button>
                        <Show when={b.getUserModified()}><span>User modified</span></Show>
                        <Show when={b.getStatus() === 'pending'}>
                            <button type="button" onClick={() => props.onOpenFileEdit?.(b)}>Open diff</button>
                        </Show>
                    </div>
                    <Show when={previewOpen()}>
                        <Show when={editBuffer()?.getContent()} fallback={<span class={styles.fileEditLoading}>Loading diff…</span>}>
                            <pre class={styles.fileEditPatch}>{editBuffer()?.patch()}</pre>
                        </Show>
                        <Show when={editBuffer()?.getError()}>{error => <span class={styles.fileEditError}>{error()}</span>}</Show>
                    </Show>
                </div>}
            </Show>
            <Show when={b.getStatus() === 'pending'}>
                <div class={styles.approvalPanel}>
                    <span class={styles.approvalLabel}>
                        {b.getApproval()?.kind === 'timed'
                            ? <>Auto-approves in <span class={styles.approvalCountdown}>{countdown()}</span></>
                            : 'Approval requested'}
                    </span>
                    <div class={styles.toolControls}>
                        <button class={styles.controlReject} classList={{ [styles.controlSelected]: selected('rejected') }} aria-pressed={selected('rejected')} type="button" onClick={() => choose({ kind: 'rejected' })}>
                            <X size={12} /> Reject
                        </button>
                        <button classList={{ [styles.controlSelected]: selected('skipped') }} aria-pressed={selected('skipped')} type="button" onClick={() => choose({ kind: 'skipped' })}>
                            <FastForward size={12} /> Skip
                        </button>
                        <button class={styles.controlApprove} classList={{ [styles.controlSelected]: selected('approved') }} aria-pressed={selected('approved')} type="button" onClick={() => choose({ kind: 'approved' })}>
                            <Check size={12} /> Approve
                        </button>
                    </div>
                </div>
            </Show>
            <Show when={['write_file', 'edit_file'].includes(b.type) && b.getStatus() === 'done' && b.getOutput().includes('undoOperationId:') && !b.getOutput().includes('undoStatus: undone')}>
                <div class={styles.undoPanel}>
                    <span>The file was committed atomically.</span>
                    <button type="button" onClick={() => void props.flow.undo(b.toolCallId)}>
                        <RotateCcw size={12} /> Undo
                    </button>
                </div>
            </Show>
            <Show when={['write_file', 'edit_file'].includes(b.type) && b.getOutput().includes('undoStatus: undone')}>
                <div class={styles.undoPanel}><span>This write was undone.</span></div>
            </Show>
        </div>
    );
}

function ContextPreview(props: { item: EvidenceSnapshot; source: string; sourceId: string }) {
    const [open, setOpen] = createSignal(false);
    const wholeFile = () => props.item.type === 'text';
    const isCode = () => props.item.presentation === 'code'
        || (props.item.presentation == null && !props.sourceId.endsWith('::rendered'));
    const snippet = () => props.item.label.replace(/\s+/g, ' ').trim();
    const lines = () => props.item.preview?.lines ?? props.item.label.split('\n');
    const lineNumber = (index: number) => props.item.preview ? props.item.preview.startLine + index : undefined;
    const selected = (index: number) => {
        const number = lineNumber(index);
        const preview = props.item.preview;
        return number != null && preview?.selectedStartLine != null
            && number >= preview.selectedStartLine
            && number <= (preview.selectedEndLine ?? preview.selectedStartLine);
    };
    const location = () => {
        const preview = props.item.preview;
        if (!preview) return '';
        const end = preview.startLine + preview.lines.length - 1;
        return preview.startLine === end ? `L${end}` : `L${preview.startLine}–${end}`;
    };
    return (
        <div class={styles.contextEntry} data-scope={wholeFile() ? 'file' : 'selection'}>
            <button
                class={styles.contextStrip}
                type="button"
                data-has-note={props.item.note.trim() ? 'true' : 'false'}
                aria-expanded={open()}
                aria-label={`Context from ${props.source}: ${wholeFile() ? 'whole file' : snippet()}${props.item.note.trim() ? `; note: ${props.item.note}` : ''}`}
                onClick={() => setOpen(value => !value)}
            >
                <span class={styles.contextKind}>Context</span>
                <span class={styles.contextSnippet}>{wholeFile() ? `Whole file · ${props.source}` : snippet()}</span>
                <Show when={props.item.note.trim()}>
                    <span class={styles.contextNoteSnippet}>{props.item.note}</span>
                </Show>
                <ChevronDown class={styles.contextCaret} size={12} />
            </button>
            <Show when={open()}>
                <div class={styles.contextPeek}>
                    <div class={styles.contextPeekHeader} data-presentation={isCode() ? 'code' : 'text'}>
                        <span>{wholeFile() ? 'File' : isCode() ? 'Editor' : 'Text'}</span>
                        <code title={props.source}>{props.source}</code>
                        <Show when={isCode()}><span class={styles.contextLocation}>{location()}</span></Show>
                        <button class={styles.contextJump} type="button" aria-label="Jump to file (coming soon)" title="Jump to file (coming soon)" disabled>
                            <ExternalLink size={12} />
                        </button>
                    </div>
                    <Show when={isCode()} fallback={<div class={styles.contextTextPreview}>{props.item.label}</div>}>
                        <div class={styles.contextCodeLines}>
                            <For each={lines()}>{(line, index) => (
                                <div class={styles.contextCodeLine} classList={{ [styles.contextCodeLineSelected]: selected(index()) }}>
                                    <span class={styles.contextLineNumber}>{lineNumber(index()) ?? '–'}</span>
                                    <span class={styles.contextLineText}>{line}</span>
                                </div>
                            )}</For>
                        </div>
                    </Show>
                    <Show when={props.item.note.trim()}>
                        <div class={styles.contextPeekNote}><span aria-hidden="true">✎</span><span>{props.item.note}</span></div>
                    </Show>
                </div>
            </Show>
        </div>
    );
}

function DiffPreview(props: { text: string; source: string; additionalData: unknown }) {
    const [open, setOpen] = createSignal(false);
    const summary = () => {
        const payload = props.additionalData as { diff?: { hunks?: { oldCount: number; newCount: number }[] } } | undefined;
        const hunks = payload?.diff?.hunks;
        if (!hunks) return `Before → after · ${props.source}`;
        const added = hunks.reduce((sum, hunk) => sum + hunk.newCount, 0);
        const removed = hunks.reduce((sum, hunk) => sum + hunk.oldCount, 0);
        return `${hunks.length} change ${hunks.length === 1 ? 'region' : 'regions'} · +${added} −${removed} · ${props.source}`;
    };
    return (
        <div class={styles.diffEntry}>
            <button class={styles.contextStrip} type="button" aria-expanded={open()} aria-label={`Diff from ${props.source}: ${summary()}`} onClick={() => setOpen(value => !value)}>
                <span class={styles.contextKind}>DIFF</span>
                <span class={styles.contextSnippet}>{summary()}</span>
                <ChevronDown class={styles.contextCaret} size={12} />
            </button>
            <Show when={open()}>
                <pre class={styles.diffPeek}>{props.text}</pre>
            </Show>
        </div>
    );
}

function EvidenceChrome(props: { block: TextBlock }) {
    const groups = () => props.block.evidence ?? [];
    const attachments = () => props.block.attachments ?? [];
    return (
        <>
            <Show when={attachments().length > 0}>
                <div class={styles.attachmentList} aria-label="Message attachments">
                    <Index each={attachments()}>{file => (
                        <span class={styles.attachmentPill}>
                            <span class={styles.attachmentKind}>File</span>
                            <span class={styles.attachmentName} title={file().name}>{file().name}</span>
                        </span>
                    )}</Index>
                </div>
            </Show>
            <Show when={groups().length > 0}>
                <div class={styles.contextList} aria-label="Message context">
                    <Index each={groups()}>
                        {g => (
                            <Index each={g().items}>
                                {e => <ContextPreview item={e()} source={g().label} sourceId={g().sourceId} />}
                            </Index>
                        )}
                    </Index>
                </div>
            </Show>
            <Index each={groups()}>
                {g => (
                    <Index each={g().items}>
                        {e => <Show when={formatDiffEvidence(e().additionalData)}>
                            {text => <DiffPreview text={text()} source={g().label} additionalData={e().additionalData} />}
                        </Show>}
                    </Index>
                )}
            </Index>
        </>
    );
}

function turnHeader(blocks: ChatBlock[], i: number): { isNewTurn: boolean; label: string } {
    const block = blocks[i];
    const origin = block.kind === 'text' ? (block as TextBlock).origin : 'agent';
    const previous = i > 0 ? blocks[i - 1] : undefined;
    const previousOrigin = previous?.kind === 'text' ? (previous as TextBlock).origin : 'agent';
    return {
        isNewTurn: block.role !== previous?.role || origin !== previousOrigin,
        label: origin === 'system' ? 'System' : block.role === 'assistant' ? 'Assistant' : 'User',
    };
}

export function ChatThread(props: {
    flow: ChatFlow;
    getScroller?: () => HTMLElement | undefined;
    getNotePortalMount: () => HTMLElement | undefined;
    getStagedAction?: (toolCallId: string) => ControlAction | undefined;
    onControlAction?: (toolCallId: string, action: ControlAction) => void;
    onClearAction?: (toolCallId: string) => void;
    pendingActionCount?: number;
    stagedActionCount?: number;
    onProceed?: () => void;
    onOpenFileEdit?: (block: ToolBlock) => void;
}) {
    const flow = props.flow;
    const transcript = new ChatTranscriptView(flow.store, props.getNotePortalMount);
    return (
        <div
            class={styles.chatThread}
            ref={el => {
                transcript.setRootEl(el);
                // The parent's ref fires before its children's, so this is already set.
                const scroller = props.getScroller?.();
                if (scroller) transcript.setClampEl(scroller);
            }}
        >

            <Show when={flow.getMessages().length === 0}>
                <div class={styles.chatEmpty}>
                    <span class={styles.chatEmptyIcon}><Sparkles size={18} /></span>
                    <strong>Ready when you are</strong>
                    <span>Ask about the open workspace, or attach evidence from an annotation.</span>
                </div>
            </Show>

            <For each={flow.getMessages()}>
                {(block, i) => {
                    const { isNewTurn, label } = turnHeader(flow.getMessages(), i());
                    return (
                        <>
                            <Show when={isNewTurn}>
                                <div class={styles.turnDivider} />
                                <div class={styles.roleLabel} data-role={block.role}>{label}</div>
                            </Show>
                            <div class={styles.chatRow} data-role={block.role} data-kind={block.kind} data-origin={block.kind === 'text' ? (block as TextBlock).origin : 'agent'} data-block-id={block.id}>
                                {block.kind === 'tool'
                                    ? <ToolCard
                                        block={block as ToolBlock}
                                        flow={flow}
                                        stagedAction={props.getStagedAction?.((block as ToolBlock).toolCallId)}
                                        deferCommit={(props.pendingActionCount ?? 0) > 1}
                                        onControlAction={props.onControlAction}
                                        onClearAction={props.onClearAction}
                                        onOpenFileEdit={props.onOpenFileEdit}
                                    />
                                    : (
                                        <div class={styles.chatBubble}>
                                            <EvidenceChrome block={block as TextBlock} />
                                            {transcript.renderBlockBody(block as TextBlock)}
                                        </div>
                                    )}
                                <Show when={block.kind === 'text' && (block as TextBlock).origin !== 'system' && block.ownsVisual() && flow.getSessionId()}>
                                    <button
                                        class={styles.forkFromButton}
                                        type="button"
                                        aria-label="Fork session from this message"
                                        title="Fork from here"
                                        onClick={() => {
                                            const sessionId = flow.getSessionId();
                                            if (sessionId) void flow.forkSession(sessionId, block.id);
                                        }}
                                    >
                                        <GitFork size={12} />
                                    </button>
                                </Show>
                            </div>
                        </>
                    );
                }}
            </For>
            <Show when={(props.pendingActionCount ?? 0) > 1}>
                <div class={styles.turnProceed}>
                    <span>{props.stagedActionCount ?? 0} of {props.pendingActionCount} choices made</span>
                    <button type="button" disabled={(props.stagedActionCount ?? 0) === 0} onClick={() => props.onProceed?.()}>
                        Proceed with choices
                    </button>
                </div>
            </Show>
            {/* Trailing spacer so the last message clears the floating composer
                and scroll-to-bottom lands it above the composer, not behind. */}
            <div class={styles.threadSpacer} />
        </div>
    );
}
