// `send-capped` example (Requirement 19.15): Replies_Left counts messages, the
// Daily_Send_Cap counts SMS parts, so Replies_Left > 0 does not guarantee a reply.
import { DEFAULT_SETTINGS, countInWindow, countersFor, localDayKey } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorResponse } from '../protocol/wire.types';
import { makeHandler, post, type Harness } from '../test/handlerHarness';

/** 2026-01-01 00:00 UTC, a fixed Server_Time. */
const NOW = 1_767_225_600_000;

/** A mock AI answer long enough to need at least 2 GSM-7 parts. */
const LONG_REPLY = Array.from(
  { length: 8 },
  () => 'Keep tomatoes in a cool, dry place out of direct sun and use them soon.',
).join(' ');

/** The empty snapshot with `handed` set for today (Pakistan_Time day key). */
function snapshotWithHanded(handed: number): SessionSnapshot {
  const base = emptySnapshot(NOW);
  expect(base.counters.dayKey).toBe(localDayKey(NOW, 300));
  return { ...base, counters: { ...base.counters, handed } };
}

/** The Glossary Replies_Left formula, computed directly with brain exports. */
function formula(s: SessionSnapshot): number {
  const today = localDayKey(NOW, 300);
  if (countersFor(s.counters, today).handed >= DEFAULT_SETTINGS.dailySendCap) return 0;
  const windowMs = DEFAULT_SETTINGS.rateWindowMinutes * 60_000;
  return Math.max(0, DEFAULT_SETTINGS.perNumberLimit - countInWindow(s.receiveTimes, NOW, windowMs));
}

async function ask(h: Harness, snapshot: SessionSnapshot): Promise<SimulatorResponse> {
  const res = await post(h.handler, { type: 'message', body: 'How can I keep tomatoes fresh longer?', snapshot });
  expect(res.status).toBe(200);
  return res.json as SimulatorResponse;
}

describe('send-capped example', () => {
  it('caps a multi-part reply one part below the cap while Replies_Left stays above 0', async () => {
    const cap = DEFAULT_SETTINGS.dailySendCap;
    const h = makeHandler({ now: NOW, aiReply: LONG_REPLY });

    const r = await ask(h, snapshotWithHanded(cap - 1));

    expect(r.command).toBe('QUESTION');
    expect(r.outcome).toBe('send-capped');
    expect(r.parts).toHaveLength(0);
    expect(r.snapshot.counters.handed).toBe(cap - 1);
    expect(r.repliesLeft).toBe(formula(r.snapshot));
    expect(r.repliesLeft).toBe(DEFAULT_SETTINGS.perNumberLimit - 1);
    expect(h.client?.calls ?? []).toHaveLength(1);
  });

  it('caps any reply when handed is at the cap, with Replies_Left 0 and no AI call', async () => {
    const cap = DEFAULT_SETTINGS.dailySendCap;
    const h = makeHandler({ now: NOW, aiReply: LONG_REPLY });

    const r = await ask(h, snapshotWithHanded(cap));

    expect(r.outcome).toBe('send-capped');
    expect(r.parts).toHaveLength(0);
    expect(r.snapshot.counters.handed).toBe(cap);
    expect(r.repliesLeft).toBe(formula(r.snapshot));
    expect(r.repliesLeft).toBe(0);
    expect(h.client?.calls ?? []).toHaveLength(0);
  });
});
