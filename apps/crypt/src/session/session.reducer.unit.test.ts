import { describe, expect, it } from 'vitest';
import type { SimulatorResponse } from '../protocol/wire.types';
import { NEW_SESSION_TEXT, REPLY_LIMIT_NOTE } from '../ui/texts';
import { initialSession, phoneState, sendDisabled, sessionReducer } from './session.reducer';
import type { SessionState } from './session.types';

const NOW = 1_767_225_600_000;

function reply(over: Partial<SimulatorResponse> = {}): SimulatorResponse {
  const base = initialSession(NOW).snapshot;
  return {
    kind: 'message',
    parts: [
      { text: '(1/2) hello', units: 11, limit: 153 },
      { text: '(2/2) there', units: 11, limit: 153 },
    ],
    encoding: 'GSM-7',
    command: 'QUESTION',
    language: 'roman-ur',
    outcome: 'replied',
    deliveryOutcome: null,
    snapshot: { ...base, receiveTimes: [NOW] },
    repliesLeft: 4,
    serverTime: NOW + 500,
    ...over,
  };
}

function sent(): SessionState {
  let s = sessionReducer(initialSession(NOW), { type: 'send', body: 'hi' });
  s = sessionReducer(s, { type: 'request-started', request: 'message' });
  return s;
}

describe('sessionReducer', () => {
  it('drips message parts with badges and a language label on the first part only', () => {
    const s = sessionReducer(sent(), {
      type: 'response', epoch: 0, request: 'message', response: reply(), browserNow: NOW,
    });
    expect(s.repliesLeft).toBe(4);
    expect(s.clockOffset).toBe(500);
    expect(s.waitingMessage).toBeNull();
    expect(s.drip.map((d) => d.languageLabel)).toEqual(['Roman Urdu', undefined]);
    expect(s.drip[1]?.badge).toEqual({ n: 2, total: 2, encoding: 'GSM-7', units: 11, limit: 153 });
    expect(phoneState(s)).toBe('SENDING');
    expect(sendDisabled(s, true)).toBe(true);
    const done = sessionReducer(sessionReducer(s, { type: 'drip-tick' }), { type: 'drip-tick' });
    expect(done.bubbles.map((b) => b.text)).toEqual(['hi', '(1/2) hello', '(2/2) there']);
    expect(phoneState(done)).toBe('ALIVE');
  });

  it('adds the reply-limit note after a 1-part rate-limited reply', () => {
    const s = sessionReducer(sent(), {
      type: 'response', epoch: 0, request: 'message', browserNow: NOW,
      response: reply({ outcome: 'rate-limited', parts: [{ text: 'slow', units: 4, limit: 160 }] }),
    });
    expect(s.drip.map((d) => d.text)).toEqual(['slow', REPLY_LIMIT_NOTE]);
  });

  it('ignores stale responses and resets on new-session', () => {
    const s = sent();
    const stale = sessionReducer(s, {
      type: 'response', epoch: 7, request: 'message', response: reply(), browserNow: NOW,
    });
    expect(stale).toBe(s);
    const r = sessionReducer(s, { type: 'new-session', nowMs: NOW });
    expect(r.epoch).toBe(1);
    expect(r.bubbles.map((b) => b.text)).toEqual([NEW_SESSION_TEXT]);
    expect(r.waitingMessage).toBeNull();
  });

  it('schedules a recheck after a wait and a retry after a failed deliver', () => {
    const reminder = {
      id: 'r:a', slot: 1 as const, dueAt: NOW + 10_000, text: 'drink water', language: 'en' as const, createdAt: NOW,
    };
    const base: SessionState = {
      ...initialSession(NOW),
      snapshot: { ...initialSession(NOW).snapshot, reminders: [reminder] },
    };
    const started = sessionReducer(base, { type: 'request-started', request: 'deliver', reminderId: 'r:a' });
    const waited = sessionReducer(started, {
      type: 'response', epoch: 0, request: 'deliver', browserNow: NOW,
      response: reply({ kind: 'deliver', parts: [], command: null, outcome: null, snapshot: base.snapshot, serverTime: NOW }),
    });
    expect(waited.recheckAt.get('r:a')).toBe(NOW + 10_000);
    expect(waited.drip).toEqual([]);
    const failed = sessionReducer(started, {
      type: 'failed', epoch: 0, request: 'deliver', reminderId: 'r:a', browserNow: NOW,
    });
    expect(failed.retryAt.get('r:a')).toBe(NOW + 60_000);
    expect(failed.bubbles).toEqual([]);
    expect(failed.inFlight).toBeNull();
  });
});
