
// Reuse the shared disposer shape rather than minting another one.
export type { Dispose } from '../fileexplorer/FileSystemProvider';
import type { Dispose } from '../fileexplorer/FileSystemProvider';

export interface SearchQuery {
    query: string;
    caseSensitive?: boolean;
    regex?: boolean;
    wholeWord?: boolean;
}

// One match. line/column are 1-based (ripgrep's convention); preview is the
// matching line's text for display.
export interface SearchMatch {
    path: string;
    line: number;
    column: number;
    preview: string;
}

export interface SearchProvider {
    run(query: SearchQuery, onMatch: (m: SearchMatch) => void, onDone: () => void): Dispose;
}
