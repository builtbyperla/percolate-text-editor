export interface AppMetadata {
    /** Product name used by Electron and in the in-app title bar. */
    name: string;
    /** Browser/window title; this can later include a workspace or document name. */
    windowTitle: string;
    description: string;
    windowChrome: {
        /** Compact IDE-style title-bar height, shared by every desktop OS. */
        titleBarHeight: number;
    };
}

/**
 * User-facing application metadata shared by Electron's main process and the
 * renderer. Keep product naming here so native and web titles stay in sync.
 */
export const APP_METADATA = {
    name: 'Percolate',
    windowTitle: 'Percolate',
    description: 'A workspace for inspecting and collaborating with agents.',
    windowChrome: {
        titleBarHeight: 32,
    },
} as const satisfies AppMetadata;
