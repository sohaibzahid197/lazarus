// Example tests for the Gemini adapter with a Fake_Genai_SDK and a stub Env_Config.
// No network: the SDK is never constructed because every test injects `genai`.
// Validates: Requirements 13.11, 13.13, 13.14, 14.6, 15.1, 16.1, 16.2, 16.5, 16.6
import { describe, expect, it } from 'vitest';
import { AiError, type AiErrorKind, type Prompt } from './ai.types.js';
import { callWithPolicy } from './answer.call.js';
import { createGeminiClient, mapSdkError, type EnvConfig } from './gemini.entry.js';
import { createFakeGenai, makeFakeError, type FakeErrorFields, type FakeStep } from './gemini.fake.js';
import { DEFAULT_GEMINI_MODEL, resolveModel } from './models.js';

const KEY = 'test-key-123';
const PROMPT: Prompt = { system: 'Answer briefly.', user: '<<<what is rain>>>' };

function setup(env: EnvConfig, steps: readonly FakeStep[] = [{ text: 'ok' }], model?: string) {
  const fake = createFakeGenai(steps);
  const logs: string[] = [];
  const client = createGeminiClient({
    env,
    genai: fake.factory,
    log: (line) => logs.push(line),
    ...(model === undefined ? {} : { model }),
  });
  return { fake, logs, client };
}

async function rejection(promise: Promise<unknown>): Promise<AiError> {
  const result = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(result).toBeInstanceOf(AiError);
  return result as AiError;
}

function kindOf(fields: FakeErrorFields): AiErrorKind {
  return mapSdkError(makeFakeError(fields)).kind;
}

describe('Gemini adapter: API key handling (Requirements 13.11, 14.6)', () => {
  const missingKeyEnvs: ReadonlyArray<readonly [string, EnvConfig]> = [
    ['missing', {}],
    ['empty', { GEMINI_API_KEY: '' }],
    ['whitespace', { GEMINI_API_KEY: ' \t\n ' }],
  ];

  it.each(missingKeyEnvs)('%s key: no SDK construction, no call, rejects with unknown', async (_label, env) => {
    const { fake, client } = setup(env);
    const error = await rejection(client.complete(PROMPT));
    expect(error.kind).toBe('unknown');
    expect(error.message).toContain('GEMINI_API_KEY');
    expect(fake.keys).toHaveLength(0);
    expect(fake.calls).toHaveLength(0);
  });

  it('present key goes only to the factory, not to the request, reply, log or error', async () => {
    const ok = setup({ GEMINI_API_KEY: ` ${KEY} ` });
    const reply = await ok.client.complete(PROMPT);
    expect(ok.fake.keys).toEqual([KEY]);
    expect(reply).not.toContain(KEY);
    expect(JSON.stringify(ok.fake.calls)).not.toContain(KEY);
    expect(ok.logs.join('\n')).not.toContain(KEY);

    const failing = setup({ GEMINI_API_KEY: KEY }, [
      { error: { status: 500, message: `server echoed ${KEY}` } },
    ]);
    const error = await rejection(failing.client.complete(PROMPT));
    expect(error.message).not.toContain(KEY);
    expect(failing.logs.join('\n')).not.toContain(KEY);
  });
});

describe('Gemini adapter: free-tier request shape (Requirements 16.1, 16.2)', () => {
  it('sends model, contents and config with only systemInstruction, maxOutputTokens and temperature', async () => {
    const { client, fake } = setup({ GEMINI_API_KEY: KEY });
    await client.complete(PROMPT);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) return;
    expect(Object.keys(call).sort()).toEqual(['config', 'contents', 'model']);
    expect(call.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(call.contents).toBe(PROMPT.user);
    expect(Object.keys(call.config).sort()).toEqual(['maxOutputTokens', 'systemInstruction', 'temperature']);
    expect(call.config.systemInstruction).toBe(PROMPT.system);
    expect(typeof call.config.maxOutputTokens).toBe('number');
    expect(typeof call.config.temperature).toBe('number');
    const serialized = JSON.stringify(call);
    for (const field of ['tools', 'toolConfig', 'cachedContent', 'batch', 'googleSearch', 'httpOptions']) {
      expect(serialized).not.toContain(field);
    }
  });
});

describe('Gemini adapter: error mapping (Requirements 16.5, 16.6)', () => {
  it.each<FakeErrorFields>([
    { status: 429, message: 'Too Many Requests' },
    { message: '{"error":{"status":"RESOURCE_EXHAUSTED"}}' },
  ])('quota error %o maps to quota', async (fields) => {
    const { client, fake } = setup({ GEMINI_API_KEY: KEY }, [{ error: fields }]);
    expect((await rejection(client.complete(PROMPT))).kind).toBe('quota');
    expect(fake.calls).toHaveLength(1);
  });

  it.each<FakeErrorFields>([
    { status: 403, message: 'Billing required for this model' },
    { status: 403, message: 'PERMISSION_DENIED: permission denied for model' },
  ])('403 error %o maps to unknown with a single call and no other model', async (fields) => {
    const { client, fake } = setup({ GEMINI_API_KEY: KEY }, [{ error: fields }, { text: 'retried' }]);
    const outcome = await callWithPolicy(client, PROMPT, 1_000);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe('unknown');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls.map((c) => c.model)).toEqual([DEFAULT_GEMINI_MODEL]);
  });

  it.each<readonly [FakeErrorFields, AiErrorKind]>([
    [{ status: 408 }, 'timeout'],
    [{ status: 504 }, 'timeout'],
    [{ name: 'AbortError' }, 'timeout'],
    [{ name: 'TimeoutError' }, 'timeout'],
    [{ code: 'ETIMEDOUT' }, 'timeout'],
    [{ status: 500 }, 'network'],
    [{ status: 503 }, 'network'],
    [{ name: 'TypeError', message: 'fetch failed' }, 'network'],
    [{ code: 'ECONNRESET' }, 'network'],
    [{ code: 'ENOTFOUND' }, 'network'],
    [{ status: 400 }, 'unknown'],
    [{ status: 401 }, 'unknown'],
    [{ status: 404 }, 'unknown'],
    [{ message: 'something odd' }, 'unknown'],
  ])('mapSdkError(%o) is %s', (fields, kind) => {
    expect(kindOf(fields)).toBe(kind);
  });

  it('mapSdkError handles non-Error values and keeps an AiError unchanged', () => {
    expect(mapSdkError(undefined).kind).toBe('unknown');
    expect(mapSdkError('RESOURCE_EXHAUSTED').kind).toBe('quota');
    const existing = new AiError('network');
    expect(mapSdkError(existing)).toBe(existing);
  });

  it('mapSdkError never copies the SDK message', () => {
    const error = mapSdkError(makeFakeError({ status: 429, message: 'secret body text' }));
    expect(error.message).toBe('Gemini request failed (status 429)');
  });
});

describe('Gemini adapter: model selection (Requirements 13.13, 15.1)', () => {
  it('DEFAULT_GEMINI_MODEL is gemini-3.5-flash-lite', () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
  });

  it.each<readonly [string | undefined, string | undefined, string]>([
    [undefined, undefined, DEFAULT_GEMINI_MODEL],
    [undefined, '  ', DEFAULT_GEMINI_MODEL],
    [undefined, 'env-model', 'env-model'],
    ['option-model', 'env-model', 'option-model'],
    ['  ', 'env-model', 'env-model'],
  ])('resolveModel(%o, %o) is %s', (option, envValue, expected) => {
    expect(resolveModel(option, envValue)).toBe(expected);
  });

  it.each<readonly [string | undefined, string | undefined, string]>([
    [undefined, undefined, DEFAULT_GEMINI_MODEL],
    [undefined, 'env-model', 'env-model'],
    ['option-model', 'env-model', 'option-model'],
  ])('client with option %o and GEMINI_MODEL %o calls %s', async (option, envModel, expected) => {
    const env: EnvConfig =
      envModel === undefined ? { GEMINI_API_KEY: KEY } : { GEMINI_API_KEY: KEY, GEMINI_MODEL: envModel };
    const { client, fake } = setup(env, [{ text: 'ok' }], option);
    await client.complete(PROMPT);
    expect(fake.calls.map((c) => c.model)).toEqual([expected]);
  });
});
