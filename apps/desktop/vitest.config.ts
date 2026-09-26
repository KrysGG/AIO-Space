import { defineConfig } from 'vitest/config';

const workspace = process.env['GITHUB_WORKSPACE'];

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The Electron smoke test launches the real app; give it room on slow CI machines.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // In CI, report failures with repo-relative paths so GitHub attaches them as annotations
    // (readable through the public API, unlike the raw log).
    reporters: workspace
      ? ['default', ['github-actions', { onWritePath: (path: string) => path.replace(`${workspace}/`, '') }]]
      : ['default'],
  },
});
