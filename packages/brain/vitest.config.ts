import { defineConfig } from 'vitest/config';

// Configured for non-watch single runs (`vitest --run`). `passWithNoTests`
// keeps the scaffolding phase green before any test files exist.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Fails tests that call global fetch or (outside gemini.*.test.ts) read
    // GEMINI_API_KEY / GEMINI_MODEL (Requirements 1.6, 13.1).
    setupFiles: ['./src/test.setup.ts'],
    watch: false,
    passWithNoTests: true,
  },
});
