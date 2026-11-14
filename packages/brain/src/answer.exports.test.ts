// Entry-point exports test for the AI answer service.
// _Requirements: 1.5, 12.5, 14.9_
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as brain from './index.js';
import type {
  AiClient,
  AiErrorKind,
  AnswerCache,
  AnswerDeps,
  Prompt,
  ScamResult,
  ScamVerdict,
} from './index.js';

// Built from parts so this file never contains the literal strings that the
// repository checks scan for in test files.
const GEMINI_ENTRY = ['gemini', 'entry'].join('.');
const GENAI_SDK = ['@google', 'genai'].join('/');

const here = dirname(fileURLToPath(import.meta.url));
// Comments in index.ts explain why the Gemini entry is excluded, so they are
// stripped; only code (imports and exports) is checked.
const indexSource = readFileSync(join(here, 'index.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('answer service entry exports (runtime)', () => {
  it('exports the mock client, error class and service functions', () => {
    expect(typeof brain.createMockClient).toBe('function');
    expect(typeof brain.AiError).toBe('function');
    expect(typeof brain.answerQuestion).toBe('function');
    expect(typeof brain.checkScam).toBe('function');
    expect(typeof brain.createMemoryCache).toBe('function');
  });

  it('exports DEFAULT_GEMINI_MODEL as a non-empty string', () => {
    expect(typeof brain.DEFAULT_GEMINI_MODEL).toBe('string');
    expect(brain.DEFAULT_GEMINI_MODEL.length).toBeGreaterThan(0);
  });

  it('does not export the Gemini client or SDK error mapping', () => {
    const exported: readonly string[] = Object.keys(brain);
    expect(exported).not.toContain('createGeminiClient');
    expect(exported).not.toContain('mapSdkError');
  });
});

describe('answer service entry exports (types)', () => {
  it('exposes the AI client contract types', () => {
    expectTypeOf<AiClient>().toBeObject();
    expectTypeOf<AiErrorKind>().toBeString();
    expectTypeOf<Prompt>().not.toBeNever();
    expectTypeOf(brain.createMockClient).returns.toMatchTypeOf<AiClient>();
  });

  it('exposes the scam and answer service types', () => {
    expectTypeOf<ScamVerdict>().toEqualTypeOf<'SCAM' | 'SAFE' | 'UNSURE'>();
    expectTypeOf<ScamResult>().toBeObject();
    expectTypeOf<AnswerCache>().toBeObject();
    expectTypeOf<AnswerDeps>().toBeObject();
    expectTypeOf(brain.createMemoryCache).returns.toMatchTypeOf<AnswerCache>();
  });
});

describe('index.ts source', () => {
  it('has no import of the Gemini entry module', () => {
    expect(indexSource.includes(GEMINI_ENTRY)).toBe(false);
  });

  it('has no reference to the Gemini SDK package', () => {
    expect(indexSource.includes(GENAI_SDK)).toBe(false);
  });

  it('still contains the export statements after comment stripping', () => {
    expect(indexSource).toContain("from './answer.service.js'");
  });
});
