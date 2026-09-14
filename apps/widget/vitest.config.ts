import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const engineSource = fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url));
const viewerSource = fileURLToPath(new URL('../../packages/viewer/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@fitpath/engine': engineSource, '@fitpath/viewer': viewerSource } },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
