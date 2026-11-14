import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { AI_ERROR_KINDS, AiError, isAiError, toAiError } from './ai.types.js';

const prompt = { system: 's', user: 'u' };

describe('ai.types', () => {
  it('keeps AiError unchanged through toAiError', () => {
    const e = new AiError('quota', 'x');
    expect(toAiError(e)).toBe(e);
    expect(isAiError(e)).toBe(true);
  });

  it('turns foreign values into a fixed unknown error', () => {
    for (const v of ['secret-key', new Error('secret-key'), null, 42]) {
      const e = toAiError(v);
      expect(e.kind).toBe('unknown');
      expect(e.message).toBe('Unknown AI error');
    }
    expect(AI_ERROR_KINDS).toEqual(['quota', 'timeout', 'network', 'unknown']);
  });
});

describe('createMockClient', () => {
  it('consumes steps in order, repeats the last, records calls', async () => {
    const c = createMockClient([{ text: 'a' }, { text: 'b' }]);
    expect(await c.complete(prompt)).toBe('a');
    expect(await c.complete(prompt)).toBe('b');
    expect(await c.complete(prompt)).toBe('b');
    expect(c.calls).toHaveLength(3);
  });

  it('supports error, reject, throws and value steps', async () => {
    const err = new AiError('timeout');
    await expect(createMockClient([{ error: err }]).complete(prompt)).rejects.toBe(err);
    await expect(createMockClient([{ reject: 'boom' }]).complete(prompt)).rejects.toBe('boom');
    expect(() => createMockClient([{ throws: 'sync' }]).complete(prompt)).toThrow();
    expect(await createMockClient([{ value: 7 }]).complete(prompt)).toBe(7 as unknown as string);
  });

  it('hang never settles', async () => {
    const c = createMockClient([{ hang: true }]);
    const result = await Promise.race([
      c.complete(prompt).then(() => 'settled'),
      new Promise<string>((r) => setTimeout(() => r('pending'), 20)),
    ]);
    expect(result).toBe('pending');
  });
});
