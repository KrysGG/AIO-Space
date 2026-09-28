import { defineConfig } from 'vitest/config';

const workspace = process.env['GITHUB_WORKSPACE'];

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The Electron smoke test launches the real app; give it room on slow CI machines.
    testTimeout: 60_000,
    // Several test files launch the real app; running them one at a time keeps timing-sensitive
    // checks (like the smoke test's short polls) from competing for the CPU.
    fileParallelism: false,
    hookTimeout: 60_000,
    // In CI, report failures with repo-relative paths so GitHub attaches them as annotations
    // (readable through the public API, unlike the raw log). Windows paths come with forward slashes.
    reporters: workspace
      ? ['default', ['github-actions', { onWritePath: (path: string) => path.replace(`${workspace.replaceAll('\\', '/')}/`, '') }]]
      : ['default'],
  },
});
