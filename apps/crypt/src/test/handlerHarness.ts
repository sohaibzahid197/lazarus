// Test-only harness for the Simulator_Route handler (Requirements 17.4, 18.3).
// Builds `createOuijaHandler` with a fixed clock, the brain's mock AiClient, a
// fresh limiter cell, SIMULATOR_NUMBER and TEST_KEY. No network, no real clock,
// no real Gemini key.
import {
  AiError,
  createMemoryCache,
  createMockClient,
  type AiErrorKind,
  type MockClient,
  type MockStep,
} from '@lazarus/brain';
import { createAiSetup, type AiSetup } from '../server/ai';
import type { BrainFns } from '../server/brainFns';
import { createOuijaHandler, type OuijaHandler } from '../server/handler';
import type { IpState } from '../server/ipLimiter';
import type { LimiterCell } from '../server/ipLimiter.store';
import { SIMULATOR_NUMBER } from '../server/simulatorNumber';
import { TEST_KEY } from './pbt';

/** Reply the mock AiClient gives when a test names none. */
export const DEFAULT_AI_REPLY = 'Keep tomatoes in a cool, dry place out of direct sun.';

/** The Client_Ip `post` sends when a test names none. */
export const DEFAULT_IP = '203.0.113.7';

export interface HarnessOptions {
  /** Server_Time: a fixed value, or a function a test can advance. */
  readonly now: number | (() => number);
  /** Text the mock AiClient returns (default `DEFAULT_AI_REPLY`). Ignored when `aiError` is set. */
  readonly aiReply?: string;
  /** Makes every mock AiClient call reject with an AiError of this kind. */
  readonly aiError?: AiErrorKind;
  /** With the fake TEST_KEY as Gemini_Api_Key (default true); false gives `answer: null`. */
  readonly withKey?: boolean;
  /** Replaces single brain functions, e.g. a throwing one for the 500 case. */
  readonly brain?: Partial<BrainFns>;
}

export interface Harness {
  readonly handler: OuijaHandler;
  /** The mock AiClient, or `null` when `withKey` is false. `client.calls` records every prompt. */
  readonly client: MockClient | null;
  /** This handler's own Ip_Rate_Limiter state cell. */
  readonly limiter: LimiterCell;
  readonly ai: AiSetup;
  readonly number: typeof SIMULATOR_NUMBER;
  readonly key: string;
}

/** A limiter cell with its own state, so tests never share the module-level store. */
export function createLimiterCell(initial: IpState = new Map<string, readonly number[]>()): LimiterCell {
  let state = initial;
  return {
    get: () => state,
    set: (s) => {
      state = s;
    },
  };
}

function mockSteps(options: HarnessOptions): readonly MockStep[] {
  if (options.aiError !== undefined) return [{ error: new AiError(options.aiError) }];
  return [{ text: options.aiReply ?? DEFAULT_AI_REPLY }];
}

export function makeHandler(options: HarnessOptions): Harness {
  const now = typeof options.now === 'number' ? ((t: number) => () => t)(options.now) : options.now;
  const withKey = options.withKey ?? true;
  const client = withKey ? createMockClient(mockSteps(options)) : null;
  const base = createAiSetup(
    { apiKey: withKey ? TEST_KEY : null, model: undefined },
    {
      createClient: () => client ?? createMockClient([]),
      createCache: () => createMemoryCache(),
    },
  );
  // The answer clock follows the harness clock, never the real one.
  const ai: AiSetup = base.answer === null ? base : { ...base, answer: { ...base.answer, clock: now } };
  const limiter = createLimiterCell();
  const handler = createOuijaHandler({
    now,
    ai: () => ai,
    limiter,
    number: SIMULATOR_NUMBER,
    ...(options.brain === undefined ? {} : { brain: options.brain }),
  });
  return { handler, client, limiter, ai, number: SIMULATOR_NUMBER, key: TEST_KEY };
}

export interface PostOptions {
  /** Sent as `x-forwarded-for`; `null` sends no header (Client_Ip `unknown`). Default `DEFAULT_IP`. */
  readonly ip?: string | null;
  /** Default `POST`. Any other method goes to `notAllowed()`, as route.ts does. */
  readonly method?: string;
}

export interface PostResult {
  readonly status: number;
  readonly headers: Headers;
  /** The raw response body. */
  readonly text: string;
  /** The parsed JSON body, or `undefined` when the body is not JSON. */
  readonly json: unknown;
}

/**
 * Sends one request to the handler. A string body is sent raw (for invalid
 * JSON and size tests); any other value is sent as `JSON.stringify(body)`.
 */
export async function post(handler: OuijaHandler, body: unknown, options: PostOptions = {}): Promise<PostResult> {
  const method = options.method ?? 'POST';
  const headers = new Headers({ 'content-type': 'application/json' });
  const ip = options.ip === undefined ? DEFAULT_IP : options.ip;
  if (ip !== null) headers.set('x-forwarded-for', ip);
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = new Request('http://localhost/api/ouija', { method, headers, ...(hasBody ? { body: raw } : {}) });
  const res = method === 'POST' ? await handler.POST(req) : handler.notAllowed();
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** Every string value inside a JSON value (object keys excluded), depth first. */
export function collectStrings(json: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const item of v as readonly unknown[]) walk(item);
    else if (typeof v === 'object' && v !== null) for (const item of Object.values(v)) walk(item);
  };
  walk(json);
  return out;
}

/** Every header as `name: value`, for privacy checks on headers. */
export function headerLines(headers: Headers): string[] {
  const out: string[] = [];
  headers.forEach((value, name) => out.push(`${name}: ${value}`));
  return out;
}
