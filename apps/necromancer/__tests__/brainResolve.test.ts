import { routeCommand } from '@lazarus/brain';
import { createGeminiClient } from '@lazarus/brain/gemini';

const PROMPT = { system: 'Answer briefly.', user: 'hi' };
const KEY = 'test-key-from-process-env-000000000000';

/** Jest runs on Node; the app tsconfig has no Node types. */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

type Init = { headers: Record<string, string> };

function recordingFetch(calls: Array<{ url: string; init: Init }>) {
  return async (url: string, init: Init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] }),
    };
  };
}

test('@lazarus/brain resolves to the brain sources', () => {
  expect(routeCommand('HELP')).toMatchObject({ command: 'HELP', language: 'en' });
});

test('@lazarus/brain/gemini is the native client: it uses the fetch option', async () => {
  const calls: Array<{ url: string; init: Init }> = [];
  const client = createGeminiClient({ env: { GEMINI_API_KEY: KEY }, fetch: recordingFetch(calls) });
  await expect(client.complete(PROMPT)).resolves.toBe('hello');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toMatch(/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
  expect(calls[0]?.init.headers['x-goog-api-key']).toBe(KEY);
});

test('@lazarus/brain/gemini never reads process.env', async () => {
  const saved = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = KEY;
  const calls: Array<{ url: string; init: Init }> = [];
  try {
    const client = createGeminiClient({ fetch: recordingFetch(calls) });
    await expect(client.complete(PROMPT)).rejects.toBeDefined();
    expect(calls).toHaveLength(0);
  } finally {
    if (saved === undefined) {
      delete env.GEMINI_API_KEY;
    } else {
      env.GEMINI_API_KEY = saved;
    }
  }
});
