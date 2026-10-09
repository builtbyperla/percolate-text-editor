import { autocompletion } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { search, searchKeymap } from '@codemirror/search';
import type { KeyBinding } from '@codemirror/view';
import { filteredSelectionMatches } from './selectionMatches';

/**
 * Key bindings for transient editor UI. Search bindings live in the frame's
 * main keymap so Mod-f wins over the browser and works from the search panel.
 * Completion installs its own high-precedence keymap, including Ctrl-Space,
 * Escape, Enter, and snippet-field Tab navigation.
 */
export const transientEditorUIKeymap: readonly KeyBinding[] = searchKeymap;

/**
 * Stateful CodeMirror UI that should survive an edit/annotate mode round-trip
 * with the cached EditorState. Language packages contribute their local-name
 * completions and snippets through language data.
 */
export const transientEditorUIExtensions: Extension = [
    search({ top: true }),
    filteredSelectionMatches,
    autocompletion(),
];
