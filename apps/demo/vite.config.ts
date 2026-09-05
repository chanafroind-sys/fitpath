import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The demo is a consumer of @fitpath/engine, never a copy of it.
 *
 * The alias points at the engine's TypeScript sources rather than a build
 * output because the engine has no build step: its relative imports carry
 * explicit `.ts` extensions so the same files run under Node, under Vitest and
 * through this bundler. Pointing here means the demo can never drift onto a
 * stale copy of the geometry.
 */
const engineSource = fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url));

export default defineConfig({
  // Relative, so the same build works on a project-scoped GitHub Pages URL
  // (/fitpath/) and from a local `vite preview` without a rebuild.
  base: './',
  resolve: {
    alias: { '@fitpath/engine': engineSource },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Three is most of the bundle and never changes between deploys.
        // Its own chunk keeps it cached across releases of the app itself.
        manualChunks: { three: ['three'] },
      },
    },
  },
});
