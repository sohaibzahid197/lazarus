import 'server-only';
// POST /api/ouija handler (Requirements 7.7–7.13, 10.1–10.5, 17.6).
// Checks run in a fixed order and stop at the first failure (7.12):
//   1. method POST          → 405 (body not read)
//   2. body ≤ 16,384 bytes  → 413 (body not parsed)
//   3. Ip_Rate_Limiter      → 429 + Retry-After (state set only on accept)
//   4. JSON and shape       → 400
//   5. Session_Snapshot     → 400 invalid-snapshot
//   6. brain call and build → 200, or 500 internal on any throw
// The handler logs nothing (7.11) and error bodies carry only `{ error }`
// (plus `slowDown` on a 429, 7.13).
import { detectLanguage, GATEWAY_TEXTS, type CanonicalNumber, type Language } from '@lazarus/brain';
import { MAX_REQUEST_BYTES } from '../protocol/limits';
import type { SimulatorResponse } from '../protocol/wire.types';
import type { AiSetup } from './ai';
import { readCappedBody } from './body';
import { REAL_BRAIN, type BrainFns, type HandleCtx } from './brainFns';
import { clientIpFrom } from './clientIp';
import { handleDeliver } from './handle.deliver';
import { handleMessage } from './handle.message';
import { checkIp } from './ipLimiter';
import type { LimiterCell } from './ipLimiter.store';
import { isMessageBody, parseRequest } from './request.parse';
import { errorResponse, json } from './response.build';
import { sanitizeText } from './sanitize';
import { parseSnapshot } from './snapshot.parse';

export interface OuijaDeps {
  /** Server_Time source; production passes a monotonic clock. */
  readonly now: () => number;
  readonly ai: () => AiSetup;
  readonly limiter: LimiterCell;
  readonly number: CanonicalNumber;
  /** Replaces single brain functions, e.g. a throwing one for the 500 case. */
  readonly brain?: Partial<BrainFns>;
}

export interface OuijaHandler {
  POST(req: Request): Promise<Response>;
  notAllowed(): Response;
}

const FALLBACK_LANGUAGE: Language = 'en';

/**
 * Language of the 429 Slow_Down_Text, or `null` for none (10.4, 10.5):
 * a `message` with a valid Message_Body gets its own Language, a `deliver`
 * gets none, anything else gets English.
 */
function slowDownLanguage(raw: string): Language | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return FALLBACK_LANGUAGE;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return FALLBACK_LANGUAGE;
  const obj = value as Readonly<Record<string, unknown>>;
  if (obj.type === 'deliver') return null;
  if (obj.type === 'message' && isMessageBody(obj.body)) return detectLanguage(obj.body);
  return FALLBACK_LANGUAGE;
}

function rateLimited(raw: string, retryAfterSec: number, secrets: readonly string[]): Response {
  const lang = slowDownLanguage(raw);
  const body =
    lang === null
      ? { error: 'rate-limited' }
      : { error: 'rate-limited', slowDown: sanitizeText(GATEWAY_TEXTS[lang].slowDown, secrets) };
  return json(429, body, { 'retry-after': String(retryAfterSec) });
}

export function createOuijaHandler(deps: OuijaDeps): OuijaHandler {
  const brain: BrainFns = { ...REAL_BRAIN, ...deps.brain };

  async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return errorResponse('method-not-allowed');

    const read = await readCappedBody(req, MAX_REQUEST_BYTES);
    if (!read.ok) return errorResponse('body-too-large');

    const serverTime = deps.now(); // read once, used for every later step (7.1, 7.2)
    const check = checkIp(deps.limiter.get(), clientIpFrom(req.headers), serverTime);
    const ai = deps.ai();
    if (!check.accepted) return rateLimited(read.text, check.retryAfterSec, ai.secrets);
    deps.limiter.set(check.state); // recorded whatever the later status (10.2)

    const parsed = parseRequest(read.text);
    if (!parsed.ok) return errorResponse(parsed.error);

    const snap = parseSnapshot(parsed.request.snapshot, serverTime, deps.number);
    if (!snap.ok) return errorResponse('invalid-snapshot');

    const ctx: HandleCtx = { serverTime, number: deps.number, ai, brain };
    const response: SimulatorResponse =
      parsed.request.type === 'message'
        ? await handleMessage(parsed.request.body, snap.state, ctx)
        : handleDeliver(parsed.request.reminderId, snap.state, ctx);
    return json(200, response);
  }

  return {
    async POST(req: Request): Promise<Response> {
      try {
        return await handle(req);
      } catch {
        // No stack, body, Reminder_Text or env value leaves the server (7.10, 17.6).
        return errorResponse('internal');
      }
    },
    notAllowed(): Response {
      return errorResponse('method-not-allowed');
    },
  };
}
