// Browser client for POST /api/ouija (Requirements 6.5–6.7, 10.6, 10.7, 13.8, 13.12).
// Maps every HTTP result to one PostResult; never throws.
import { isSimulatorResponse } from '../protocol/response.check';
import type { SimulatorRequest, SimulatorResponse } from '../protocol/wire.types';

export const OUIJA_URL = '/api/ouija';
export const REQUEST_TIMEOUT_MS = 30_000;

export type PostResult =
  | { readonly kind: 'ok'; readonly response: SimulatorResponse }
  | { readonly kind: 'rate-limited'; readonly slowDown: string | null }
  | { readonly kind: 'invalid-snapshot' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'aborted' };

/** Browser APIs used by postOuija, injectable for tests. */
export interface ApiEnv {
  readonly fetch: typeof fetch;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

function defaultEnv(): ApiEnv {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    },
  };
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}

function errorField(body: unknown, key: 'error' | 'slowDown'): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Readonly<Record<string, unknown>>)[key];
  return typeof value === 'string' ? value : null;
}

function mapResponse(req: SimulatorRequest, status: number, body: unknown): PostResult {
  if (status === 200) {
    return isSimulatorResponse(body) ? { kind: 'ok', response: body } : { kind: 'failed' };
  }
  if (status === 429) return { kind: 'rate-limited', slowDown: errorField(body, 'slowDown') };
  if (status === 400) {
    if (req.type === 'deliver' || errorField(body, 'error') === 'invalid-snapshot') {
      return { kind: 'invalid-snapshot' };
    }
  }
  return { kind: 'failed' };
}

/** Links the caller's signal (Session_Reset) to an internal controller that the timeout also aborts. */
function linkSignal(outer: AbortSignal, inner: AbortController): () => void {
  const onAbort = (): void => {
    inner.abort();
  };
  outer.addEventListener('abort', onAbort);
  return () => {
    outer.removeEventListener('abort', onAbort);
  };
}

/** Reads the live flag; a plain property read would be narrowed by the early return. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Sends one Simulator_Request. `signal` aborts on Session_Reset and yields `aborted`; the 30 s timeout yields `failed`. */
export async function postOuija(
  req: SimulatorRequest,
  signal: AbortSignal,
  env: ApiEnv = defaultEnv(),
): Promise<PostResult> {
  if (signal.aborted) return { kind: 'aborted' };
  const controller = new AbortController();
  const unlink = linkSignal(signal, controller);
  const timer = env.setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const res = await env.fetch(OUIJA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
      credentials: 'omit',
    });
    const body = parseJson(await res.text());
    if (isAborted(signal)) return { kind: 'aborted' };
    return mapResponse(req, res.status, body);
  } catch {
    return isAborted(signal) ? { kind: 'aborted' } : { kind: 'failed' };
  } finally {
    env.clearTimeout(timer);
    unlink();
  }
}
