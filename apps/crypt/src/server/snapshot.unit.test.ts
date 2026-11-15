import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, REMINDER_HORIZON_MS, type GatewayState } from '@lazarus/brain';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SessionSnapshot, SnapshotReminder } from '../protocol/snapshot.types';
import { parseSnapshot } from './snapshot.parse';
import { printSnapshot } from './snapshot.print';
import { SIMULATOR_NUMBER } from './simulatorNumber';

const NOW = 1_767_225_600_000;

function reminderDueAt(dueAt: number): SnapshotReminder {
  return { id: 'r:mabc-a', slot: 1, dueAt, text: 'drink water', language: 'en', createdAt: NOW };
}

function withReminder(dueAt: number): SessionSnapshot {
  return { ...emptySnapshot(NOW), reminders: [reminderDueAt(dueAt)] };
}

function parsedState(snapshot: unknown): GatewayState {
  const result = parseSnapshot(snapshot, NOW, SIMULATOR_NUMBER);
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.state;
}

describe('parseSnapshot edge cases', () => {
  it('rejects an extra key in counters as unknown-field', () => {
    const base = emptySnapshot(NOW);
    const snapshot = { ...base, counters: { ...base.counters, extra: 0 } };
    expect(parseSnapshot(snapshot, NOW, SIMULATOR_NUMBER)).toEqual({ ok: false, error: 'unknown-field' });
  });

  it('accepts a Due_Time exactly at the Reminder_Horizon', () => {
    const state = parsedState(withReminder(NOW + REMINDER_HORIZON_MS));
    expect(state.reminders.status === 'ok' && state.reminders.reminders[0]?.dueAt).toBe(
      NOW + REMINDER_HORIZON_MS,
    );
  });

  it('rejects a Due_Time 1 ms past the Reminder_Horizon', () => {
    const result = parseSnapshot(withReminder(NOW + REMINDER_HORIZON_MS + 1), NOW, SIMULATOR_NUMBER);
    expect(result).toEqual({ ok: false, error: 'due-too-far' });
  });

  it('parses an empty snapshot to empty maps and sets', () => {
    const snapshot = emptySnapshot(NOW);
    const state = parsedState(snapshot);
    expect(state.stopList.size).toBe(0);
    expect(state.allowlist).toEqual(new Set());
    expect(state.rate.size).toBe(0);
    expect(state.slowDown.size).toBe(0);
    expect(state.counters).toEqual(snapshot.counters);
    expect(state.settings).toBe(DEFAULT_SETTINGS);
    expect(state.reminders).toEqual({ status: 'ok', reminders: [] });
  });
});

describe('printSnapshot guards', () => {
  it('throws when a Reminder has a non-null handedAt', () => {
    const state = parsedState(withReminder(NOW + 60_000));
    if (state.reminders.status !== 'ok') throw new Error('expected ok store');
    const handed = state.reminders.reminders.map((r) => ({ ...r, handedAt: NOW }));
    const bad: GatewayState = { ...state, reminders: { status: 'ok', reminders: handed } };
    expect(() => printSnapshot(bad, SIMULATOR_NUMBER)).toThrow();
  });

  it('throws on an unreadable Reminder store', () => {
    const bad: GatewayState = { ...parsedState(emptySnapshot(NOW)), reminders: { status: 'unreadable' } };
    expect(() => printSnapshot(bad, SIMULATOR_NUMBER)).toThrow();
  });

  it('prints the same snapshot when handedAt is null', () => {
    const snapshot = withReminder(NOW + 60_000);
    expect(printSnapshot(parsedState(snapshot), SIMULATOR_NUMBER)).toEqual(snapshot);
  });
});
