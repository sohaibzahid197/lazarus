// AI client factory tests (Requirement 16.6, 16.8, 16.14, 16.15, 16.17, 16.18, 16.20).
// The Native_Module is the ports mock; `fetch` is a local recorder, so no network call.
import { createAiHolder, type AiHolder } from '../src/gateway/ai';
import type { KeyStatus } from '../src/native/ports';
import { createMockPorts, MOCK_KEY, type MockPorts } from './support/mockPorts';

const NEW_KEY = 'AIzaSecondKey_1111111111111111111-zz';
const PROMPT = { system: 'rules', user: '<<<hi>>>' };

/** Makes the keyStore mock behave like a real store: save and delete change what readKey returns. */
function withStore(mock: MockPorts, initial: KeyStatus): { current: () => KeyStatus } {
  let stored = initial;
  mock.scripts.readKey.setDefault(() => stored);
  mock.scripts.saveKey.setDefault((key) => {
    stored = { status: 'present', key };
  });
  mock.scripts.deleteKey.setDefault(() => {
    stored = { status: 'absent' };
  });
  return { current: () => stored };
}

type Sent = { url: string; headers: Record<string, string> };

function recordFetch(): Sent[] {
  const sent: Sent[] = [];
  const fake = (url: string, init: { headers: Record<string, string> }) => {
    sent.push({ url, headers: init.headers });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    });
  };
  (globalThis as { fetch: unknown }).fetch = fake;
  return sent;
}

function publicState(holder: AiHolder): string {
  return JSON.stringify({ holder, snapshot: holder.snapshot(), deps: holder.answerDeps() });
}

const realFetch = globalThis.fetch;
const consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  consoleSpies.push(
    ...(['log', 'warn', 'error', 'info', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    ),
  );
});

afterEach(() => {
  const printed = consoleSpies.flatMap((s) => s.mock.calls.flat().map(String)).join('\n');
  expect(printed).not.toContain(MOCK_KEY);
  expect(printed).not.toContain(NEW_KEY);
  consoleSpies.splice(0).forEach((s) => s.mockRestore());
  globalThis.fetch = realFetch;
});

describe('createAiHolder', () => {
  it('builds deps and a Masked_Key when a key is present', async () => {
    const mock = createMockPorts();
    const holder = createAiHolder(mock.ports.keyStore, () => 5);
    expect(holder.answerDeps()).toBeNull();
    await holder.refresh();
    expect(holder.snapshot()).toEqual({ status: 'present', maskedKey: `••••${MOCK_KEY.slice(-4)}` });
    const deps = holder.answerDeps();
    expect(deps).not.toBeNull();
    expect(deps?.clock()).toBe(5);
    expect(publicState(holder)).not.toContain(MOCK_KEY);
  });

  it('uses the stored key in the header only, with the default model', async () => {
    const sent = recordFetch();
    const holder = createAiHolder(createMockPorts().ports.keyStore, () => 0);
    await holder.refresh();
    await expect(holder.answerDeps()?.client.complete(PROMPT)).resolves.toBe('ok');
    expect(sent).toHaveLength(1);
    expect(sent[0].headers['x-goog-api-key']).toBe(MOCK_KEY);
    expect(sent[0].url).not.toContain(MOCK_KEY);
  });

  it.each(['absent', 'unreadable'] as const)('gives null deps when the key is %s', async (status) => {
    const mock = createMockPorts();
    mock.scripts.readKey.resolve({ status });
    const holder = createAiHolder(mock.ports.keyStore, () => 0);
    await holder.refresh();
    expect(holder.answerDeps()).toBeNull();
    expect(holder.snapshot()).toEqual({ status, maskedKey: null });
  });

  it('save validates, writes the trimmed key and rebuilds with it', async () => {
    const sent = recordFetch();
    const mock = createMockPorts();
    withStore(mock, { status: 'present', key: MOCK_KEY });
    const holder = createAiHolder(mock.ports.keyStore, () => 0);
    await holder.refresh();
    const before = holder.answerDeps();
    let notified = 0;
    holder.subscribe(() => notified++);

    await expect(holder.save('  not a key  ')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(mock.names(['saveKey'])).toEqual([]);

    await expect(holder.save(`  ${NEW_KEY}\n`)).resolves.toEqual({ ok: true });
    expect(mock.calls.find((c) => c.method === 'saveKey')?.args).toEqual([NEW_KEY]);
    expect(holder.answerDeps()).not.toBe(before);
    expect(holder.snapshot().maskedKey).toBe(`••••${NEW_KEY.slice(-4)}`);
    expect(notified).toBe(1);
    await holder.answerDeps()?.client.complete(PROMPT);
    expect(sent[0].headers['x-goog-api-key']).toBe(NEW_KEY);
    expect(publicState(holder)).not.toContain(NEW_KEY);
  });

  it('reports a failed write and keeps the old client', async () => {
    const mock = createMockPorts();
    mock.scripts.saveKey.reject(`write failed for ${NEW_KEY}`);
    const holder = createAiHolder(mock.ports.keyStore, () => 0, (line) => console.warn(line));
    await holder.refresh();
    const before = holder.answerDeps();
    await expect(holder.save(NEW_KEY)).resolves.toEqual({ ok: false, reason: 'write-failed' });
    expect(holder.answerDeps()).toBe(before);
  });

  it('remove deletes the key and drops the client', async () => {
    const mock = createMockPorts();
    withStore(mock, { status: 'present', key: MOCK_KEY });
    const holder = createAiHolder(mock.ports.keyStore, () => 0);
    await holder.refresh();
    await expect(holder.remove()).resolves.toBe(true);
    expect(holder.answerDeps()).toBeNull();
    expect(holder.snapshot()).toEqual({ status: 'absent', maskedKey: null });
  });

  it('a later refresh wins over an earlier one that resolves after it', async () => {
    const mock = createMockPorts();
    let releaseFirst: (v: KeyStatus) => void = () => undefined;
    const first = new Promise<KeyStatus>((r) => {
      releaseFirst = r;
    });
    let calls = 0;
    mock.scripts.readKey.setDefault(() => (++calls === 1 ? first : { status: 'absent' }));
    const holder = createAiHolder(mock.ports.keyStore, () => 0);
    const a = holder.refresh();
    await holder.refresh();
    releaseFirst({ status: 'present', key: MOCK_KEY });
    await a;
    expect(holder.snapshot().status).toBe('absent');
    expect(holder.answerDeps()).toBeNull();
  });
});
