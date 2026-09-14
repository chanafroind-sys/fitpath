import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Two builds, one output directory.
 *
 * `--mode loader` produces `fitpath.js`: a classic script, self-contained,
 * with no imports of its own, small enough that a store cannot object to it.
 * It resolves everything else by absolute URL from wherever it was served.
 *
 * `--mode modal` produces `modal.js` and its chunks as ES modules: the fit
 * check, the engine functions it calls, and — in a chunk of its own, loaded
 * only when there is a maneuver to draw — the viewer and Three.js.
 *
 * The engine and the viewer are aliased to their sources, as the demo does,
 * because neither has a build step and pointing here means the widget can
 * never drift onto a stale copy of the geometry.
 */
const engineSource = fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url));
const viewerSource = fileURLToPath(new URL('../../packages/viewer/src/index.ts', import.meta.url));

export default defineConfig(({ mode }) => {
  const shared = {
    resolve: { alias: { '@fitpath/engine': engineSource, '@fitpath/viewer': viewerSource } },
  };

  if (mode === 'loader') {
    return {
      ...shared,
      build: {
        target: 'es2020',
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        minify: 'esbuild',
        lib: {
          entry: fileURLToPath(new URL('./src/loader.ts', import.meta.url)),
          formats: ['iife'],
          name: 'fitpathLoader',
          fileName: () => 'fitpath.js',
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    };
  }

  return {
    ...shared,
    // Relative, so the chunk-preload helper resolves `chunks/` against
    // `modal.js` itself — wherever it is served from — rather than against
    // the store's page.
    base: './',
    build: {
      target: 'es2020',
      outDir: 'dist',
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: true,
      minify: 'esbuild',
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: { modal: fileURLToPath(new URL('./src/modal/index.ts', import.meta.url)) },
        preserveEntrySignatures: 'allow-extension',
        output: {
          format: 'es',
          entryFileNames: 'modal.js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          // Three is most of the widget and never changes between releases of
          // the widget itself; its own chunk keeps it cached across them.
          manualChunks: { three: ['three'] },
        },
      },
    },
  };
});
