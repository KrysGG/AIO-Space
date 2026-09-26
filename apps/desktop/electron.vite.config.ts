import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * @aio/core is a devDependency on purpose: externalizeDepsPlugin only externalizes
 * `dependencies`, so core (shipped as TypeScript source) gets bundled into main/preload.
 */
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
});
