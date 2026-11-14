import { afterEach, describe, expect, it } from 'vitest';
import {
  blockingViolations,
  guardedFetch,
  isAdapterTestFile,
  takeViolations,
} from './test.guard.js';

// Each test drains the violations it creates on purpose, so the setup file's
// afterEach check stays green.
afterEach(() => {
  takeViolations();
});

describe('fetch guard', () => {
  it('is installed as global fetch, rejects and records a violation', async () => {
    expect(globalThis.fetch).toBe(guardedFetch);
    await expect(fetch('https://example.com/?key=secret')).rejects.toThrow(/not allowed/);
    const found = takeViolations();
    expect(found).toEqual([{ kind: 'fetch', detail: 'global fetch was called' }]);
    expect(JSON.stringify(found)).not.toContain('secret');
  });
});

describe('env guard', () => {
  it('records reads and checks of GEMINI_API_KEY and GEMINI_MODEL', () => {
    void process.env.GEMINI_API_KEY;
    void ('GEMINI_MODEL' in process.env);
    expect(takeViolations().map((v) => v.kind)).toEqual(['env', 'env']);
  });

  it('does not record other keys and keeps writes working', () => {
    process.env.LAZARUS_GUARD_TEST = 'x';
    expect(process.env.LAZARUS_GUARD_TEST).toBe('x');
    delete process.env.LAZARUS_GUARD_TEST;
    expect(process.env.LAZARUS_GUARD_TEST).toBeUndefined();
    expect(takeViolations()).toEqual([]);
  });
});

describe('blockingViolations', () => {
  const env = { kind: 'env', detail: 'read of GEMINI_API_KEY' } as const;
  const net = { kind: 'fetch', detail: 'global fetch was called' } as const;

  it('allows env reads only in adapter test files', () => {
    expect(blockingViolations([env, net], '/x/src/gemini.unit.test.ts')).toEqual([net]);
    expect(blockingViolations([env, net], '/x/src/answer.unit.test.ts')).toEqual([env, net]);
  });

  it('recognises adapter test files by name', () => {
    expect(isAdapterTestFile('C:\\x\\src\\gemini.property.test.ts')).toBe(true);
    expect(isAdapterTestFile('/x/src/gemini.entry.ts')).toBe(false);
    expect(isAdapterTestFile('/x/src/answer.gemini.test.ts')).toBe(false);
  });
});
