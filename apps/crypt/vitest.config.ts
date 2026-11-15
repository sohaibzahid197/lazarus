import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Single runs only (`vitest --run`). Vitest 5 has no `environmentMatchGlobs`,
// so two projects split the suite: `*.test.ts` in node, `*.test.tsx` in jsdom.
//
// `.js` -> `.ts`: the brain is TypeScript source that imports its own files
// with `.js` suffixes. Vite already tries the `.ts` file for a `.js` import
// made from a TypeScript module, which is how packages/brain runs its own
// tests with no extra config, so no alias is needed here.
//
// `server-only` throws outside the React server condition, so tests use an
// empty stub. `next build` and the source guards still enforce it.
const serverOnlyStub = fileURLToPath(new URL('./src/test/serverOnlyStub.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { 'server-only': serverOnlyStub },
  },
  test: {
    // The suite is `src/**/*.test.ts` + `src/**/*.test.tsx`, split by project.
    // No root `include`: `extends: true` would concatenate it into each project
    // and run every file in both environments.
    watch: false,
    projects: [
      {
        extends: true,
        test: { name: 'node', include: ['src/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: { name: 'jsdom', include: ['src/**/*.test.tsx'], environment: 'jsdom' },
      },
    ],
  },
});
