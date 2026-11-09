import tseslint from 'typescript-eslint';

// Flat config (ESLint 10). The `recommended` set already turns on
// `@typescript-eslint/no-explicit-any`; we restate it at `error` so the
// `any` type is forbidden at lint/build time (Requirement 1.4).
export default tseslint.config(
  {
    ignores: ['node_modules/', 'dist/'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
