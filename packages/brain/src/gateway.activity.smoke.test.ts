import { describe, expect, it } from 'vitest';
import { ACTIVITY_LOG_MAX, buildActivityEntry, trimActivityLog } from './gateway.activity.js';
import { isCanonicalNumber, maskSender } from './gateway.number.js';
import type { ActivityEntry, CanonicalNumber, GatewayDecision } from './gateway.types.js';

const num = (s: string): CanonicalNumber => {
  if (!isCanonicalNumber(s)) throw new Error(`not canonical: ${s}`);
  return s;
};

const decision = (over: Partial<GatewayDecision>): GatewayDecision => ({
  messageId: 'm1',
  receivedAt: 1_000,
  sender: { kind: 'phone', number: num('+923001234567') },
  command: 'HELP',
  language: 'en',
  outcome: 'replied',
  parts: [],
  changes: [],
  ...over,
});

const entry = (receivedAt: number, outcome: ActivityEntry['outcome'] = 'replied'): ActivityEntry => ({
  receivedAt,
  who: '+••••••••••567',
  command: 'HELP',
  outcome,
});

describe('gateway.activity smoke', () => {
  it('masks a phone sender and keeps time, command and the given outcome', () => {
    const e = buildActivityEntry(decision({}), 'send-failed');
    expect(e).toEqual({
      receivedAt: 1_000,
      who: '+•••••••••567',
      command: 'HELP',
      outcome: 'send-failed',
    });
    expect(JSON.stringify(e)).not.toMatch(/3001/);
  });

  it('uses the Masked_Sender for an automated sender and NONE when the router did not run', () => {
    const e = buildActivityEntry(
      decision({ sender: { kind: 'automated', masked: maskSender('JAZZ-INFO') }, command: null }),
      'ignored-automated',
    );
    expect(e.who).toBe('••••••NFO');
    expect(e.command).toBe('NONE');
    expect(e.outcome).toBe('ignored-automated');
  });

  it('keeps the newest entries first and at most ACTIVITY_LOG_MAX', () => {
    expect(ACTIVITY_LOG_MAX).toBe(200);
    let log: ActivityEntry[] = [];
    for (let t = 1; t <= 205; t++) log = trimActivityLog(log, entry(t));
    expect(log).toHaveLength(200);
    expect(log[0]?.receivedAt).toBe(205);
    expect(log[199]?.receivedAt).toBe(6);
  });

  it('places an older late entry by receive time and puts a tie ahead of the existing one', () => {
    const log = trimActivityLog([entry(30), entry(10)], entry(20));
    expect(log.map((e) => e.receivedAt)).toEqual([30, 20, 10]);
    const tied = trimActivityLog([entry(5, 'replied')], entry(5, 'stopped'));
    expect(tied.map((e) => e.outcome)).toEqual(['stopped', 'replied']);
  });
});
