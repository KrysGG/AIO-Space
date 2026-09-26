import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * electron-vite 5 externalizes `dependencies` in main/preload by default (`build.externalizeDeps`).
 * @aio/core is a devDependency on purpose so it (shipped as TypeScript source) gets bundled instead.
 */
export default defineConfig({
  main: {},
  preload: {},
  renderer: { plugins: [react()] },
});
