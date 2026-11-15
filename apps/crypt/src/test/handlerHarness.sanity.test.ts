// Sanity checks for the handler harness and the request arbitraries.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_TEXTS } from '@lazarus/brain';
import { emptySnapshot } from '../protocol/emptySnapshot';
import { isSimulatorResponse } from '../protocol/response.check';
import { isMessageBody, parseRequest } from '../server/request.parse';
import { SIMULATOR_NUMBER } from '../server/simulatorNumber';
import {
  aiReplyArb,
  invalidRequestArb,
  messageBodyArb,
  SIMULATOR_DIGITS,
  SIMULATOR_NUMBER_TEXT,
} from './arbitraries/request';
import { collectStrings, makeHandler, post } from './handlerHarness';
import { CRYPT_PBT_OPTIONS, TEST_KEY } from './pbt';

const NOW = 1_767_225_600_000;

describe('handler harness', () => {
  it('drives one HELP request through the handler', async () => {
    const h = makeHandler({ now: NOW });
    const res = await post(h.handler, { type: 'message', body: 'HELP', snapshot: emptySnapshot(NOW) });
    expect(res.status).toBe(200);
    expect(isSimulatorResponse(res.json)).toBe(true);
    if (!isSimulatorResponse(res.json)) return;
    expect(res.json.command).toBe('HELP');
    expect(res.json.outcome).toBe('replied');
    expect(res.json.repliesLeft).toBe(4);
    expect(res.json.serverTime).toBe(NOW);
    expect(res.json.parts.map((p) => p.text).join('')).toContain(GATEWAY_TEXTS.en.help.slice(0, 20));
    expect(h.client?.calls).toHaveLength(0);
    expect(h.limiter.get().get('203.0.113.7')).toEqual([NOW]);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('records AI calls for a QUESTION and has no client without a key', async () => {
    const withKey = makeHandler({ now: NOW, aiReply: 'Store them cool.' });
    const body = { type: 'message', body: 'How can I keep tomatoes fresh longer?', snapshot: emptySnapshot(NOW) };
    expect((await post(withKey.handler, body)).status).toBe(200);
    expect(withKey.client?.calls.length).toBe(1);
    expect(withKey.ai.secrets).toEqual([TEST_KEY]);
    const noKey = makeHandler({ now: NOW, withKey: false });
    expect(noKey.client).toBeNull();
    expect(noKey.ai.answer).toBeNull();
    expect((await post(noKey.handler, body)).status).toBe(200);
  });

  it('post sends GET to notAllowed and collectStrings finds nested strings', async () => {
    const h = makeHandler({ now: NOW });
    expect((await post(h.handler, '', { method: 'GET' })).status).toBe(405);
    expect(collectStrings({ a: ['x', { b: 'y' }], c: 1, d: null })).toEqual(['x', 'y']);
  });

  it('privacy constants match the server Simulator_Number', () => {
    expect(SIMULATOR_NUMBER_TEXT).toBe(SIMULATOR_NUMBER);
    expect(SIMULATOR_DIGITS).toBe(SIMULATOR_NUMBER.slice(1));
  });
});

describe('request arbitraries', () => {
  it('messageBodyArb gives valid Message_Bodies and aiReplyArb gives strings', () => {
    fc.assert(
      fc.property(messageBodyArb, aiReplyArb, (body, reply) => {
        expect(isMessageBody(body)).toBe(true);
        expect(typeof reply).toBe('string');
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('invalidRequestArb fails parseRequest with the named error', () => {
    fc.assert(
      fc.property(invalidRequestArb, ({ raw, error }) => {
        expect(parseRequest(raw)).toEqual({ ok: false, error });
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
