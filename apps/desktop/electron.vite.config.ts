import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * electron-vite 5 externalizes `dependencies` in main/preload by default (`build.externalizeDeps`).
 * @aio/core is a devDependency on purpose so it (shipped as TypeScript source) gets bundled instead.
 * Sandboxed preloads can't load packages at all, so the web app preload bundles tldts (D-033).
 */
export default defineConfig({
  main: {},
  preload: {
    build: {
      externalizeDeps: { exclude: ['tldts'] },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          webapp: resolve(__dirname, 'src/preload/webapp.ts'),
        },
      },
    },
  },
  renderer: { plugins: [react()] },
});
