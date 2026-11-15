import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@lazarus/brain';
import { CRYPT_PBT_OPTIONS, TEST_KEY } from './pbt';

describe('test setup', () => {
  it('runs every property at least 100 times', () => {
    expect(CRYPT_PBT_OPTIONS.numRuns).toBeGreaterThanOrEqual(100);
  });

  it('uses a fixed fake 39-character test key', () => {
    expect(TEST_KEY).toHaveLength(39);
    expect(TEST_KEY.startsWith('FAKE-')).toBe(true);
  });

  it('resolves the brain source with its .js import suffixes', () => {
    expect(DEFAULT_SETTINGS.perNumberLimit).toBe(5);
  });
});
