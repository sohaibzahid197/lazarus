// Replies_Left walk example (Requirements 18.10, 19.6).
import { DEFAULT_SETTINGS, GATEWAY_TEXTS, splitSms } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorResponse } from '../protocol/wire.types';
import { makeHandler, post, type Harness } from '../test/handlerHarness';

/** 2026-01-01 00:00 UTC, a fixed Server_Time start. */
const START = 1_767_225_600_000;
/** Gap between requests: well inside the Rate_Limiter window. */
const STEP_MS = 1_000;

function clock(): { now: () => number; advance: () => void } {
  let t = START;
  return { now: () => t, advance: () => (t += STEP_MS) };
}

async function sendHelp(h: Harness, snapshot: SessionSnapshot): Promise<SimulatorResponse> {
  const res = await post(h.handler, { type: 'message', body: 'HELP', snapshot });
  expect(res.status).toBe(200);
  return res.json as SimulatorResponse;
}

const texts = (r: SimulatorResponse): string[] => r.parts.map((p) => p.text);

describe('Replies_Left walk', () => {
  it('counts down to 0, rate-limits the next HELP, and starts over after a Session_Reset', async () => {
    const limit = DEFAULT_SETTINGS.perNumberLimit;
    const c = clock();
    const h = makeHandler({ now: c.now });
    const helpParts = splitSms(GATEWAY_TEXTS.en.help);

    let snapshot = emptySnapshot(c.now());
    for (let i = 1; i <= limit; i += 1) {
      const r = await sendHelp(h, snapshot);
      expect(r.command).toBe('HELP');
      expect(r.outcome).toBe('replied');
      expect(texts(r)).toEqual(helpParts);
      expect(r.repliesLeft).toBe(limit - i);
      snapshot = r.snapshot;
      c.advance();
    }

    const limited = await sendHelp(h, snapshot);
    expect(limited.outcome).toBe('rate-limited');
    expect(texts(limited)).toEqual([GATEWAY_TEXTS.en.slowDown]);
    expect(limited.repliesLeft).toBe(0);
    c.advance();

    const fresh = await sendHelp(h, emptySnapshot(c.now()));
    expect(fresh.outcome).toBe('replied');
    expect(texts(fresh)).toEqual(helpParts);
    expect(fresh.repliesLeft).toBe(limit - 1);
    expect(h.client?.calls ?? []).toHaveLength(0);
  });
});
