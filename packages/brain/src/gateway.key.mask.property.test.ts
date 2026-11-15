// Feature: necromancer-sms-gateway, Property 33: Masked key invariant
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { maskApiKey, validateApiKey } from './gateway.key.js';
import { GATEWAY_PBT_OPTIONS, apiKey } from './gateway.arbitraries.js';

const PREFIX = '••••';

/** Every substring of `key` with exactly `length` characters. */
function windowsOf(key: string, length: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + length <= key.length; i += 1) out.push(key.slice(i, i + length));
  return out;
}

describe('maskApiKey', () => {
  /** **Validates: Requirements 16.12, 16.13** */
  it('Req 16.12, 16.13: masked key is •••• plus the last 4 characters and hides the rest', () => {
    fc.assert(
      fc.property(apiKey, (key) => {
        expect(validateApiKey(key)).toEqual({ ok: true, key });
        const masked = maskApiKey(key);
        expect(masked).toHaveLength(8);
        expect(masked.startsWith(PREFIX)).toBe(true);
        expect(masked.endsWith(key.slice(-4))).toBe(true);
        expect(masked.includes(key)).toBe(false);
        // A 5-character window shows more of the key than the 4-character tail.
        for (const window of windowsOf(key, 5)) expect(masked.includes(window)).toBe(false);
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
