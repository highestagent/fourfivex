import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: __dirname,
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    // One sandbox node for the whole file; tests share it and run in order.
    fileParallelism: false,
  },
});
