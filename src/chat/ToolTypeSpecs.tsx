export type ToolPresentation = 'inline' | 'card' | 'terminal';

export interface ToolTypeSpec {
    // Human label shown in the card header ("Read file", "Run", …).
    label: string;
    presentation: ToolPresentation;
}

export const TOOL_TYPE_SPECS: Record<string, ToolTypeSpec> = {
    ask_question: { label: 'Ask question', presentation: 'card' },
    read:   { label: 'Read file', presentation: 'inline' },
    edit:   { label: 'Edit file', presentation: 'card' },
    run:    { label: 'Run',       presentation: 'terminal' },
    search: { label: 'Search',    presentation: 'inline' },
    read_file: { label: 'Read file', presentation: 'card' },
    list_directory: { label: 'List directory', presentation: 'card' },
    search_text: { label: 'Search', presentation: 'card' },
    write_file: { label: 'Write file', presentation: 'card' },
    edit_file: { label: 'Edit file', presentation: 'card' },
    undo_file_write: { label: 'Undo file write', presentation: 'card' },
    run_command: { label: 'Run command', presentation: 'terminal' },
    update_stub_fixture: { label: 'Update test fixture', presentation: 'card' },
};

const FALLBACK_SPEC: ToolTypeSpec = {
    label: 'Tool', presentation: 'card',
};

// Resolve a type key to its spec, falling back to a generic card for unknown
// types (with the raw type as the label so it's still identifiable).
export function resolveToolSpec(type: string): ToolTypeSpec {
    const spec = TOOL_TYPE_SPECS[type];
    if (spec) return spec;
    return { ...FALLBACK_SPEC, label: type };
}
