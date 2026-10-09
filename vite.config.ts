/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Demo builds (`npm run build:demo`) set DEMO=1. The flag drops desktop-only
// pieces (terminal) and the bottom bar, and turns on the demo intro overlay.
const isDemo = process.env.DEMO === '1';

// Attribution has to travel with the bundle, not just live in the repo. The
// notices file is generated into the project root by `npm run notices`; this
// copies it into the build output so a deployed demo actually carries it.
function copyNotices(outDir: string) {
  return {
    name: 'copy-third-party-notices',
    closeBundle() {
      const src = join(import.meta.dirname, 'THIRD-PARTY-NOTICES.txt');
      if (!existsSync(src)) {
        console.warn('THIRD-PARTY-NOTICES.txt missing — run `npm run notices`.');
        return;
      }
      copyFileSync(src, join(import.meta.dirname, outDir, 'THIRD-PARTY-NOTICES.txt'));
    },
  };
}

export default defineConfig({
  plugins: [
    devtools(),
    solidPlugin(),
    ...(isDemo ? [copyNotices('dist-demo')] : []),
  ],
  server: {
    port: 3000,
  },
  // Substituted as a literal so `if (!__DEMO__)` branches are dead-code
  // eliminated — the terminal and its @xterm deps leave the demo bundle rather
  // than shipping unused. Vitest reads this same config, so tests get the flag
  // too (without it, every guard throws ReferenceError at import time).
  define: {
    __DEMO__: JSON.stringify(isDemo),
  },
  build: {
    // Demo builds get their own directory so they never clobber a normal build.
    outDir: isDemo ? 'dist-demo' : 'dist',
    target: 'esnext',
    minify: 'esbuild',
    // Never ship sourcemaps — they'd hand over the original source.
    sourcemap: false,
  },
  esbuild: {
    legalComments: 'none',
    // Demo builds drop console noise — the app is full of drag/tab debugging
    // traces that fire on every interaction and read as breakage in a public
    // demo. Minification alone does NOT remove these: a console call has
    // observable side effects, so it is never dead code.
    //
    // `drop` operates on the parsed AST, which is what makes it safe here — a
    // console.log INSIDE a string literal (the diff sample's content, and the
    // in-memory stub's main.ts) is data, not a call, and survives. A text-based
    // strip would corrupt both. Verified: sample strings intact, our own traces
    // gone, and console.warn/error still present so real failures stay visible.
    drop: isDemo ? ['console'] : [],
  },
  // Vitest reads this config directly, so tests transform .tsx through the same
  // solid plugin the app uses.
  test: {
    root: import.meta.dirname,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
  },
});
