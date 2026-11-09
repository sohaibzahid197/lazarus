import { defineConfig } from 'vitest/config';

// Configured for non-watch single runs (`vitest --run`). `passWithNoTests`
// keeps the scaffolding phase green before any test files exist.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    watch: false,
    passWithNoTests: true,
  },
});
