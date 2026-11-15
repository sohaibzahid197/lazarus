import { describe, expect, it } from 'vitest';
import { emptySnapshot } from './emptySnapshot';
import { isSimulatorResponse } from './response.check';
import type { SimulatorResponse } from './wire.types';

// 2026-01-01T00:00:00Z, which is 05:00 on 2026-01-01 in Pakistan_Time.
const NEW_YEAR_UTC = 1_767_225_600_000;
const HOUR = 3_600_000;

function designExample(): SimulatorResponse {
  return {
    kind: 'message',
    parts: [{ text: 'Lazarus: text any question.', units: 148, limit: 160 }],
    encoding: 'GSM-7',
    command: 'HELP',
    language: 'en',
    outcome: 'replied',
    deliveryOutcome: null,
    snapshot: emptySnapshot(NEW_YEAR_UTC),
    repliesLeft: 4,
    serverTime: NEW_YEAR_UTC,
  };
}

describe('emptySnapshot', () => {
  it('returns the empty Session_Snapshot of Requirement 8.5', () => {
    expect(emptySnapshot(NEW_YEAR_UTC)).toEqual({
      stopped: false,
      receiveTimes: [],
      slowDownAt: null,
      counters: {
        dayKey: '2026-01-01',
        received: 0,
        repliesSent: 0,
        replied: 0,
        partsSent: 0,
        ignored: 0,
        handed: 0,
      },
      reminders: [],
    });
  });

  it('takes the day key in Pakistan_Time (UTC+5)', () => {
    // 18:59 UTC on 31 Dec is 23:59 in Pakistan; 19:00 UTC is midnight.
    expect(emptySnapshot(NEW_YEAR_UTC - 5 * HOUR - 60_000).counters.dayKey).toBe('2025-12-31');
    expect(emptySnapshot(NEW_YEAR_UTC - 5 * HOUR).counters.dayKey).toBe('2026-01-01');
  });
});

describe('isSimulatorResponse', () => {
  it('accepts the design example response', () => {
    expect(isSimulatorResponse(designExample())).toBe(true);
  });

  it('rejects 5 parts', () => {
    const part = { text: 'x', units: 1, limit: 153 };
    const value = { ...designExample(), parts: [part, part, part, part, part] };
    expect(isSimulatorResponse(value)).toBe(false);
  });

  it('rejects a non-integer repliesLeft', () => {
    expect(isSimulatorResponse({ ...designExample(), repliesLeft: 2.5 })).toBe(false);
  });

  it('rejects repliesLeft 6, above DEFAULT_SETTINGS.perNumberLimit', () => {
    expect(isSimulatorResponse({ ...designExample(), repliesLeft: 6 })).toBe(false);
  });

  it('rejects a missing snapshot', () => {
    const value: Record<string, unknown> = { ...designExample() };
    delete value.snapshot;
    expect(isSimulatorResponse(value)).toBe(false);
  });
});
