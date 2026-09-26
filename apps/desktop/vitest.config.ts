import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The Electron smoke test launches the real app; give it room on slow CI machines.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
