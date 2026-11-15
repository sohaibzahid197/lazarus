// Shared settings for every property test and handler test.

/** fast-check options for every Crypt property test (at least 100 runs, Requirement 18.1). */
export const CRYPT_PBT_OPTIONS = { numRuns: 100 } as const;

/**
 * Fixed fake Gemini key (39 characters, the length of a real key). Never a
 * real key. Same value as the `test:bundle` fallback and the Playwright
 * CRYPT_TEST_KEY, so privacy checks look for one string everywhere.
 */
export const TEST_KEY = 'FAKE-crypt-test-key-not-a-real-key-0001';
