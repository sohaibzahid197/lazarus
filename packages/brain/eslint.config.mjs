import tseslint from 'typescript-eslint';

// Flat config (ESLint 10). The `recommended` set already turns on
// `@typescript-eslint/no-explicit-any`; we restate it at `error` so the
// `any` type is forbidden at lint/build time (Requirement 1.4, 8.4).
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
  // Purity for the command router modules only (Requirements 8.1, 8.4).
  // Tests are excluded: they are not in this file list.
  {
    files: [
      'src/router.ts',
      'src/language.ts',
      'src/normalize.ts',
      'src/aliases.ts',
      'src/printer.ts',
      'src/router.types.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Router modules must be pure: no Date.' },
        { name: 'console', message: 'Router modules must be pure: no console.' },
        { name: 'fetch', message: 'Router modules must be pure: no network.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Router modules must be deterministic: no Math.random.',
        },
        { object: 'globalThis', property: 'Date', message: 'No Date in router modules.' },
        { object: 'globalThis', property: 'console', message: 'No console in router modules.' },
        { object: 'globalThis', property: 'fetch', message: 'No fetch in router modules.' },
      ],
    },
  },
);
