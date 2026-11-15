import { defineConfig } from 'vitest/config';

// Client-bundle scan only. Run by `npm run test:bundle` after a production
// build made with the fake test key (Requirement 17.7).
export default defineConfig({
  test: {
    include: ['bundle/**/*.bundle.test.ts'],
    environment: 'node',
    watch: false,
  },
});
