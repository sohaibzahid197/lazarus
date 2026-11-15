import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';

// Flat config for @lazarus/crypt (design section 7, Requirements 1.1, 1.2, 1.3, 1.6, 1.8).
// `npm run build` runs `npm run lint` first, so any error here fails the build.

const BRAIN_INTERNALS = {
  // Brain internals: only the main entry and the `gemini` subpath are public (1.2).
  regex: '^@lazarus/brain/(?!gemini$)',
  message: 'Import from @lazarus/brain (or @lazarus/brain/gemini in src/server/ai.ts), not its internals.',
};
const INTO_PACKAGES = {
  // A relative path into packages/ bypasses the package entry (1.2).
  regex: '^\\.{1,2}/(?:.*/)?packages(?:/|$)',
  message: 'Import @lazarus/brain by package name, not by a relative path into packages/.',
};
const SERVER_FROM_CLIENT = {
  // Client and shared code must never pull in server-only modules (1.3).
  regex: '^\\.{1,2}/(?:.*/)?server(?:/|$)',
  message: 'src/server modules are server-only; do not import them from ui, session, t9 or protocol.',
};
const GEMINI_ONLY_IN_AI = {
  name: '@lazarus/brain/gemini',
  message: '@lazarus/brain/gemini (and the API key it uses) is allowed only in src/server/ai.ts.',
};

/** Builds one `no-restricted-imports` setting; flat config replaces, not merges, rule options. */
function restrictImports({ allowGemini = false, forbidServer = false } = {}) {
  return [
    'error',
    {
      paths: allowGemini ? [] : [GEMINI_ONLY_IN_AI],
      patterns: forbidServer
        ? [BRAIN_INTERNALS, INTO_PACKAGES, SERVER_FROM_CLIENT]
        : [BRAIN_INTERNALS, INTO_PACKAGES],
    },
  ];
}

const CLIENT_DIRS = ['src/ui/**', 'src/session/**', 'src/t9/**', 'src/protocol/**'];

export default defineConfig(
  {
    ignores: [
      'node_modules/',
      '.next/',
      'test-results/',
      'playwright-report/',
      'next-env.d.ts',
      'tsconfig.tsbuildinfo',
    ],
  },

  // Type-aware strict rules for all TypeScript. `strict-type-checked` includes
  // `no-explicit-any` and every `no-unsafe-*` rule; they are restated as errors
  // below so a later preset change cannot weaken them.
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/no-unsafe-unary-minus': 'error',
    },
  },

  // This file is plain JS outside the TS project: lint it without type information.
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.strict, tseslint.configs.disableTypeChecked],
  },

  // Next.js recommended rules.
  {
    files: ['**/*.ts', '**/*.tsx'],
    ...nextPlugin.configs.recommended,
  },

  // Import boundaries for everything that is linted.
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    rules: { 'no-restricted-imports': restrictImports() },
  },
  {
    files: ['src/server/ai.ts'],
    rules: { 'no-restricted-imports': restrictImports({ allowGemini: true }) },
  },
  {
    files: CLIENT_DIRS,
    rules: { 'no-restricted-imports': restrictImports({ forbidServer: true }) },
  },

  // Only src/server/env.ts reads the environment (1.6). Root-level config
  // files (next, vitest, playwright) are build tooling and may read it.
  {
    files: ['src/**'],
    ignores: ['src/server/env.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read environment variables only in src/server/env.ts.',
        },
      ],
    },
  },
);
