import { defineConfig } from '@playwright/test';

// Runs against the production build made by `npm run test:bundle`.
// Port 3100: no Gemini key (Smoke_Test, accessibility).
// Port 3101: the fixed fake test key (served-HTML privacy check, 17.8).
// CRYPT_TEST_KEY is a fake string, never a real key. It matches TEST_KEY in
// src/test/pbt.ts and the fallback in the `test:bundle` script.
export const CRYPT_TEST_KEY = 'FAKE-crypt-test-key-not-a-real-key-0001';
export const NO_KEY_URL = 'http://localhost:3100';
export const TEST_KEY_URL = 'http://localhost:3101';

export default defineConfig({
  testDir: 'e2e',
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: { baseURL: NO_KEY_URL },
  webServer: [
    {
      command: 'next start -p 3100',
      url: NO_KEY_URL,
      // Empty value: readGeminiEnv treats it as no key, even if the shell has one.
      env: { GEMINI_API_KEY: '', GEMINI_MODEL: '' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'next start -p 3101',
      url: TEST_KEY_URL,
      env: { GEMINI_API_KEY: CRYPT_TEST_KEY, GEMINI_MODEL: '' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
