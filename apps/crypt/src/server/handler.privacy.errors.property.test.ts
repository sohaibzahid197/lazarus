// Feature: crypt-ouija-simulator, Property 23: No number, key or body in error responses
import { FIXED_TEXTS, GATEWAY_TEXTS, REMINDER_TEXTS } from '@lazarus/brain';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { MAX_REQUEST_BYTES } from '../protocol/limits';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { ErrorCode } from '../protocol/wire.types';
import {
  PHONE_FORMS,
  SIMULATOR_DIGITS,
  SIMULATOR_NUMBER_TEXT,
  invalidRequestArb,
  messageBodyArb,
} from '../test/arbitraries/request';
import { serverTimeArb, snapshotArb, snapshotViolationArb } from '../test/arbitraries/snapshot';
import { DEFAULT_IP, collectStrings, headerLines, makeHandler } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS, TEST_KEY } from '../test/pbt';
import type { BrainFns } from './brainFns';
import { IP_LIMIT, IP_WINDOW_MS } from './ipLimiter';

// A throwing sanitizer for the 500 case (Requirement 17.6). OuijaDeps has no
// sanitizer slot, so the module is wrapped here and switched on per run.
const fault = vi.hoisted(() => ({ sanitizer: null as string | null }));
vi.mock('./sanitize', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sanitize')>();
  return {
    ...real,
    sanitizeText: (...args: Parameters<typeof real.sanitizeText>) => {
      if (fault.sanitizer !== null) throw new Error(fault.sanitizer);
      return real.sanitizeText(...args);
    },
    sanitizeSnapshot: (...args: Parameters<typeof real.sanitizeSnapshot>) => {
      if (fault.sanitizer !== null) throw new Error(fault.sanitizer);
      return real.sanitizeSnapshot(...args);
    },
  };
});

type FaultPoint = keyof BrainFns | 'sanitizer';
type Kind = '405' | '413' | '429' | '400-shape' | '400-snapshot' | '500';

interface Case {
  readonly kind: Kind;
  readonly serverTime: number;
  readonly body: string;
  readonly goodSnapshot: SessionSnapshot;
  readonly badSnapshot: unknown;
  readonly badShape: string;
  readonly method: string;
  readonly fullWindow: readonly number[];
  readonly deliver: boolean;
  readonly faultPoint: FaultPoint;
  readonly phone: string;
}

const ERROR_CODES: readonly ErrorCode[] = [
  'method-not-allowed', 'body-too-large', 'rate-limited', 'invalid-json', 'invalid-type',
  'invalid-body', 'invalid-reminder-id', 'invalid-snapshot', 'internal',
];

/** Every fixed text of the brain: a body that is part of one may appear in a Slow_Down_Text. */
const FIXED_BRAIN_TEXTS: readonly string[] = [
  ...collectStrings(FIXED_TEXTS),
  ...collectStrings(GATEWAY_TEXTS),
  ...collectStrings(REMINDER_TEXTS),
];

/** Free text from the request that must never be echoed (Message_Body, Reminder_Texts). */
function mustNotEcho(text: string): boolean {
  if (text.length < 7) return false;
  if (ERROR_CODES.some((code) => code.includes(text))) return false;
  return !FIXED_BRAIN_TEXTS.some((t) => t.includes(text));
}

const caseArb: fc.Arbitrary<Case> = serverTimeArb.chain((serverTime) =>
  fc.record({
    kind: fc.constantFrom<Kind>('405', '413', '429', '400-shape', '400-snapshot', '500'),
    serverTime: fc.constant(serverTime),
    body: messageBodyArb,
    goodSnapshot: snapshotArb(serverTime),
    badSnapshot: snapshotViolationArb(serverTime).map((v) => v.snapshot),
    badShape: invalidRequestArb.map((r) => r.raw),
    method: fc.constantFrom('GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'),
    fullWindow: fc
      .array(fc.integer({ min: Math.max(0, serverTime - IP_WINDOW_MS + 1), max: serverTime }), {
        minLength: IP_LIMIT,
        maxLength: IP_LIMIT,
      })
      .map((ts) => [...ts].sort((a, b) => a - b)),
    deliver: fc.boolean(),
    faultPoint: fc.constantFrom<FaultPoint>(
      'runGatewayPipeline', 'applyChanges', 'finalizeSend', 'decideDelivery', 'sanitizer',
    ),
    phone: fc.constantFrom(...PHONE_FORMS),
  }),
);

/** Message of every injected error: the key, the Simulator_Number, a phone number and the body. */
function leakyMessage(c: Case): string {
  return `boom ${TEST_KEY} ${SIMULATOR_NUMBER_TEXT} ${SIMULATOR_DIGITS} ${c.phone} ${c.body}`;
}

function throwing(message: string): () => never {
  return () => {
    throw new Error(message);
  };
}

/** A valid request: a `deliver` for the first Reminder when asked and one exists, else a `message`. */
function validRequest(c: Case): Record<string, unknown> {
  const id = c.goodSnapshot.reminders[0]?.id;
  if (c.deliver && id !== undefined) return { type: 'deliver', reminderId: id, snapshot: c.goodSnapshot };
  return { type: 'message', body: c.body, snapshot: c.goodSnapshot };
}

/** The fault point actually reached by the request: `decideDelivery` only runs for a deliver. */
function faultFor(c: Case, req: Record<string, unknown>): FaultPoint {
  if (req.type === 'deliver') return c.faultPoint === 'sanitizer' ? 'sanitizer' : 'decideDelivery';
  return c.faultPoint === 'decideDelivery' ? 'runGatewayPipeline' : c.faultPoint;
}

function rawBody(c: Case): { raw: string; fault: FaultPoint | null } {
  switch (c.kind) {
    case '405':
    case '429':
      return { raw: JSON.stringify({ type: 'message', body: c.body, snapshot: c.goodSnapshot }), fault: null };
    case '413':
      // Valid JSON padded past the cap with the body itself, so only the size check fails.
      return {
        raw: JSON.stringify({ type: 'message', body: c.body, snapshot: c.goodSnapshot, pad: c.body.repeat(Math.ceil((MAX_REQUEST_BYTES + 1) / c.body.length)) }),
        fault: null,
      };
    case '400-shape':
      // Either a generated bad shape, or the body echoed in an extra field.
      return c.deliver
        ? { raw: c.badShape, fault: null }
        : { raw: JSON.stringify({ type: 'message', body: c.body, snapshot: c.goodSnapshot, note: c.body }), fault: null };
    case '400-snapshot':
      return { raw: JSON.stringify({ type: 'message', body: c.body, snapshot: c.badSnapshot }), fault: null };
    case '500': {
      const req = validRequest(c);
      return { raw: JSON.stringify(req), fault: faultFor(c, req) };
    }
  }
}

const EXPECTED_STATUS: Readonly<Record<Kind, number>> = {
  '405': 405, '413': 413, '429': 429, '400-shape': 400, '400-snapshot': 400, '500': 500,
};

describe('Simulator_Route error privacy', () => {
  /**
   * **Validates: Requirements 7.10, 9.5, 17.5**
   */
  it('Feature: crypt-ouija-simulator, Property 23: No number, key or body in error responses', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      await fc.assert(
        fc.asyncProperty(caseArb, async (c) => {
          const { raw, fault: point } = rawBody(c);
          const message = leakyMessage(c);
          const brain: Partial<BrainFns> =
            point === null || point === 'sanitizer' ? {} : { [point]: throwing(message) };
          fault.sanitizer = point === 'sanitizer' ? message : null;
          const h = makeHandler({ now: c.serverTime, brain });
          if (c.kind === '429') h.limiter.set(new Map([[DEFAULT_IP, c.fullWindow]]));

          const method = c.kind === '405' ? c.method : 'POST';
          const headers = new Headers({ 'content-type': 'application/json', 'x-forwarded-for': DEFAULT_IP });
          const hasBody = method !== 'GET' && method !== 'HEAD';
          const req = new Request('http://localhost/api/ouija', { method, headers, ...(hasBody ? { body: raw } : {}) });
          const res = await h.handler.POST(req);
          const text = await res.text();
          fault.sanitizer = null;

          expect(res.status).toBe(EXPECTED_STATUS[c.kind]);
          const body = JSON.parse(text) as Record<string, unknown>;
          // Only `error`, plus `slowDown` on a 429 (7.13): no stack, snapshot or parts.
          const allowed = c.kind === '429' ? ['error', 'slowDown'] : ['error'];
          expect(Object.keys(body).every((k) => allowed.includes(k))).toBe(true);
          expect(ERROR_CODES).toContain(body.error);

          const payload = [text, ...headerLines(res.headers)].join('\n');
          expect(payload).not.toContain(SIMULATOR_NUMBER_TEXT);
          expect(payload).not.toContain(SIMULATOR_DIGITS);
          expect(payload).not.toContain(TEST_KEY);
          expect(payload).not.toMatch(/\bat .+:\d+:\d+/); // no stack frame
          expect(payload).not.toContain('boom');
          const echoes = [c.body, ...c.goodSnapshot.reminders.map((r) => r.text)].filter(mustNotEcho);
          for (const t of echoes) expect(payload).not.toContain(t);
        }),
        CRYPT_PBT_OPTIONS,
      );
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      fault.sanitizer = null;
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });
});
