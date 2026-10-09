import { For, Show, createSignal, JSX, Accessor, Setter, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { Search } from 'lucide-solid';
import { ToolbarModule } from '../toolbar/ToolbarModule';
import { OpenTargetRouter } from '../fileexplorer/OpenTargetRouter';
import { openFileInEditor } from '../fileexplorer/openFileInEditor';
import type { FileSystemProvider, FsEntry } from '../fileexplorer/FileSystemProvider';
import type { SearchProvider, SearchMatch } from './SearchProvider';
import searchStyles from '../styles/Search.module.css';

interface FileGroup {
    path: string;
    matches: SearchMatch[];
    expanded: boolean;
}

// The panel's ephemeral results state, owned by a store created in the panel
// body (so it has a reactive root — a class field would be created outside one).
interface ResultsState {
    groups: FileGroup[];
    searching: boolean;
}

function basename(path: string): string {
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return i < 0 ? path : path.slice(i + 1);
}

export class SearchView extends ToolbarModule {
    readonly id = 'search';
    readonly icon: JSX.Element = <Search size={18} />;
    readonly label = 'Search';

    private provider: SearchProvider;
    private router: OpenTargetRouter;
    // Needed to open a clicked result: the shared opener reads/watches the file
    // through it. Threaded in at construction, same as the file explorer's.
    private fileProvider: FileSystemProvider;

    // Query text + flags. Signals so the input and toggle buttons drive re-runs.
    private getQuery: Accessor<string>;
    private setQuery: Setter<string>;
    private getCaseSensitive: Accessor<boolean>;
    private setCaseSensitive: Setter<boolean>;
    private getRegex: Accessor<boolean>;
    private setRegex: Setter<boolean>;
    private getWholeWord: Accessor<boolean>;
    private setWholeWord: Setter<boolean>;

    constructor(provider: SearchProvider, router: OpenTargetRouter, fileProvider: FileSystemProvider) {
        super();
        this.provider = provider;
        this.router = router;
        this.fileProvider = fileProvider;
        [this.getQuery, this.setQuery] = createSignal('');
        [this.getCaseSensitive, this.setCaseSensitive] = createSignal(false);
        [this.getRegex, this.setRegex] = createSignal(false);
        [this.getWholeWord, this.setWholeWord] = createSignal(false);
    }

    // Whether search actually works in this build. NullSearchProvider (browser
    // dev) reports false so the panel shows a hint instead of empty results.
    private available(): boolean {
        const p = this.provider as { isAvailable?: () => boolean };
        return p.isAvailable ? p.isAvailable() : true;
    }

    private openMatch(m: SearchMatch): void {
        const entry: FsEntry = { name: '', path: m.path, kind: 'file' };
        void openFileInEditor(entry, this.fileProvider, this.router, {
            searchData: { line: m.line, column: m.column },
        });
    }

    getPanel(): () => JSX.Element {
        return () => {
            // Results store, owned by this panel mount. Cleared + repopulated per
            // run; path-granular writes below keep rows/counts reactive.
            const [results, setResults] = createStore<ResultsState>({ groups: [], searching: false });

            // In-flight run disposer (cancels rg) + debounce timer, both torn
            // down before a new run and on unmount.
            let disposeRun: (() => void) | null = null;
            let debounceTimer: ReturnType<typeof setTimeout> | null = null;

            const runSearch = () => {
                disposeRun?.();
                disposeRun = null;

                const query = this.getQuery();
                setResults({ groups: [], searching: false });
                if (!query) return;

                setResults('searching', true);
                // Row index of each file group by path, so a new match on a known
                // path appends to that group instead of scanning the array.
                const indexByPath = new Map<string, number>();

                disposeRun = this.provider.run(
                    {
                        query,
                        caseSensitive: this.getCaseSensitive(),
                        regex: this.getRegex(),
                        wholeWord: this.getWholeWord(),
                    },
                    (m: SearchMatch) => {
                        const idx = indexByPath.get(m.path);
                        if (idx === undefined) {
                            // New file: append a group. produce() lets us push to
                            // the groups array in one granular write.
                            setResults(produce(s => { s.groups.push({ path: m.path, matches: [m], expanded: true }); }));
                            indexByPath.set(m.path, results.groups.length - 1);
                        } else {
                            // Known file: append to just that group's matches —
                            // path-granular, so only its rows + count re-render.
                            setResults('groups', idx, 'matches', ms => [...ms, m]);
                        }
                    },
                    () => setResults('searching', false),
                );
            };

            // Debounced entry — coalesces a burst of keystrokes / flag toggles
            // into one rg spawn.
            const scheduleSearch = () => {
                if (debounceTimer !== null) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    debounceTimer = null;
                    runSearch();
                }, 200);
            };

            // Panel unmount (rail collapse / module switch): cancel any in-flight
            // rg and drop the pending debounce so nothing runs against a dead store.
            onCleanup(() => {
                if (debounceTimer !== null) clearTimeout(debounceTimer);
                disposeRun?.();
            });

            return (
                <div class={searchStyles.panel}>
                    <div class={searchStyles.controls}>
                        <input
                            class={searchStyles.input}
                            type="text"
                            placeholder="Search"
                            value={this.getQuery()}
                            onInput={e => {
                                this.setQuery(e.currentTarget.value);
                                scheduleSearch();
                            }}
                        />
                        <div class={searchStyles.flags}>
                            <button
                                class={searchStyles.flag}
                                classList={{ [searchStyles.flagOn]: this.getCaseSensitive() }}
                                title="Match case"
                                onClick={() => { this.setCaseSensitive(v => !v); scheduleSearch(); }}
                            >Aa</button>
                            <button
                                class={searchStyles.flag}
                                classList={{ [searchStyles.flagOn]: this.getWholeWord() }}
                                title="Match whole word"
                                onClick={() => { this.setWholeWord(v => !v); scheduleSearch(); }}
                            >W</button>
                            <button
                                class={searchStyles.flag}
                                classList={{ [searchStyles.flagOn]: this.getRegex() }}
                                title="Use regular expression"
                                onClick={() => { this.setRegex(v => !v); scheduleSearch(); }}
                            >.*</button>
                        </div>
                    </div>

                    <div class={searchStyles.results}>
                        <Show
                            when={this.available()}
                            fallback={<div class={searchStyles.hint}>Search is only available in the desktop build.</div>}
                        >
                            <Show
                                when={results.groups.length > 0}
                                fallback={
                                    <div class={searchStyles.hint}>
                                        {this.getQuery()
                                            ? (results.searching ? 'Searching…' : 'No results')
                                            : ''}
                                    </div>
                                }
                            >
                                <For each={results.groups}>
                                    {(group, gi) => (
                                        <div class={searchStyles.group}>
                                            <div
                                                class={searchStyles.groupHeader}
                                                onClick={() => setResults('groups', gi(), 'expanded', e => !e)}
                                            >
                                                {group.expanded ? '▾ ' : '▸ '}
                                                {basename(group.path)}
                                                <span class={searchStyles.groupCount}>{group.matches.length}</span>
                                            </div>
                                            <Show when={group.expanded}>
                                                <For each={group.matches}>
                                                    {m => (
                                                        <div
                                                            class={searchStyles.matchRow}
                                                            onClick={() => this.openMatch(m)}
                                                        >
                                                            <span class={searchStyles.matchLine}>{m.line}</span>
                                                            <span class={searchStyles.matchPreview}>{m.preview.trim()}</span>
                                                        </div>
                                                    )}
                                                </For>
                                            </Show>
                                        </div>
                                    )}
                                </For>
                            </Show>
                        </Show>
                    </div>
                </div>
            );
        };
    }
}
