import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [swc.vite()],
  resolve: { alias: { '@veer/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) } },
  test: { environment: 'node' },
});
