// Shared ignore set — the single source both the workspace watcher and the
// search handler read, so the live tree and search agree on what's hidden.
// Main-side only: both consumers (main.ts) run in the main process, so this is
// never marshalled across the IPC boundary.

// Directories never worth watching or searching. Recursive chokidar watching
// floods on large repos, so this set is load-bearing, not cosmetic. Mirrors the
// dirs VS Code excludes by default; ripgrep additionally honours .gitignore on
// its own, so this is the floor, not the whole story.
export const DEFAULT_IGNORE_DIRS = ['node_modules', '.git', 'dist', 'out'] as const;

// chokidar `ignored` predicate: skip any path that has an ignored dir as one of
// its path segments. Segment-based (not substring) so a file literally named
// "dist.ts" isn't caught while "src/dist/x" is. Works for both files inside an
// ignored dir and the dir entry itself.
export function isIgnoredPath(targetPath: string): boolean {
    const segments = targetPath.split(/[\\/]/);
    return segments.some(seg => (DEFAULT_IGNORE_DIRS as readonly string[]).includes(seg));
}

// ripgrep exclude globs, one `!dir` per ignored dir. Passed as `--glob` args so
// search hides the same dirs the tree does, on top of rg's own .gitignore
// handling.
export function ignoreGlobs(): string[] {
    return DEFAULT_IGNORE_DIRS.map(dir => `!**/${dir}/**`);
}
