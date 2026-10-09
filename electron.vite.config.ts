import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';

// electron-vite runs three parallel Vite builds — one per Electron process
// role. Each entry gets its own root config; the top-level object just maps
// them by name. The renderer inherits the app's regular Vite setup so nothing
// about the Solid + CodeMirror bundle changes when we run inside Electron.
//
// Entries use resolve(__dirname, ...) — electron-vite normalizes each sub-build
// to its own root and rejects entries that look like bare module specifiers.
export default defineConfig({
    // Main process: full Node runtime, no browser globals. externalizeDepsPlugin
    // keeps `dependencies` out of the bundle so Electron/Node resolve them at
    // runtime — required for native modules later (node-pty in Step 5).
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            outDir: 'out/main',
            rollupOptions: {
                input: { index: resolve(__dirname, 'electron/main.ts') },
                output: { entryFileNames: '[name].cjs', format: 'cjs' },
            },
        },
    },
    // Preload: runs in the renderer's isolated world, but bundled as a single
    // CommonJS file (Chromium loads preload synchronously — no dynamic imports).
    // Emit as .js (not the default .mjs) so a sandboxed preload path resolves.
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            outDir: 'out/preload',
            rollupOptions: {
                input: { index: resolve(__dirname, 'electron/preload.ts') },
                output: { entryFileNames: '[name].cjs', format: 'cjs' },
            },
        },
    },
    // Renderer: your existing Solid + CodeMirror app. Same plugins as vite.config.ts
    // so the bundle produced here matches the one produced by `npm run build`.
    renderer: {
        root: '.',
        plugins: [devtools(), solidPlugin()],
        define: { __DEMO__: 'false' },
        build: {
            outDir: 'out/renderer',
            target: 'esnext',
            rollupOptions: {
                input: { index: resolve(__dirname, 'index.html') },
            },
        },
    },
});
