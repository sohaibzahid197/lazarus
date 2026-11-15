// Unit tests for applyPendingStop (necromancer-sms-gateway Requirements 9.15, 18.13).
import { describe, expect, it } from 'vitest';
import { buildActivityEntry } from './gateway.activity.js';
import { zeroCounters } from './gateway.counters.js';
import { applyPendingStop, decodePendingStopRecord } from './gateway.pending.js';
import type { PendingStopRecord } from './gateway.pending.js';
import { applyChanges } from './gateway.pipeline.js';
import { DEFAULT_SETTINGS } from './gateway.settings.js';
import type { CanonicalNumber, GatewayState } from './gateway.types.js';
import { EMPTY_REMINDERS } from './reminder.types.js';

const OWN = '+923001234567' as CanonicalNumber;
const ALREADY_STOPPED = '+923339998877' as CanonicalNumber;
const RECEIVED_AT = 1767225600000;

// Allowlist_Mode is on with an empty Allowlist: a Pending_Stop_Record must ignore it (Requirement 3.2).
const makeState = (): GatewayState => ({
  reminders: EMPTY_REMINDERS,
  stopList: new Set([ALREADY_STOPPED]),
  allowlist: new Set(),
  rate: new Map(),
  slowDown: new Map(),
  counters: zeroCounters('2026-01-01'),
  settings: { ...DEFAULT_SETTINGS, allowlistMode: true, ownNumber: OWN },
});

const record = (sender: string): PendingStopRecord => ({
  id: 3,
  sender,
  marker: 'STOP',
  receivedAt: RECEIVED_AT,
});

describe('applyPendingStop', () => {
  it('adds a Phone_Number to the Stop_List with outcome stopped and 0 parts', () => {
    const state = makeState();
    const decision = applyPendingStop(record('+92 311 1234567'), state);

    expect(decision.outcome).toBe('stopped');
    expect(decision.parts).toHaveLength(0);
    expect(decision.changes).toEqual([
            { type: 'stop-add', number: '+923111234567' },
            { type: 'reminder-remove-all', number: '+923111234567' },
          ]);

    const next = applyChanges(state, decision.changes);
    expect([...next.stopList].sort()).toEqual([ALREADY_STOPPED, '+923111234567'].sort());
  });

  it('ignores an Automated_Sender (JAZZ) and leaves the Stop_List unchanged', () => {
    const state = makeState();
    const decision = applyPendingStop(record('JAZZ'), state);

    expect(decision.outcome).toBe('ignored-automated');
    expect(decision.parts).toHaveLength(0);
    expect(decision.changes).toEqual([]);
    expect([...applyChanges(state, decision.changes).stopList]).toEqual([ALREADY_STOPPED]);
  });

  it('ignores the Own_Number given in national format and leaves the Stop_List unchanged', () => {
    const state = makeState();
    const decision = applyPendingStop(record('0300 1234567'), state);

    expect(decision.outcome).toBe('ignored-own-number');
    expect(decision.parts).toHaveLength(0);
    expect(decision.changes).toEqual([]);
    expect([...applyChanges(state, decision.changes).stopList]).toEqual([ALREADY_STOPPED]);
  });

  it('builds an Activity_Entry with the record receive time and Command STOP', () => {
    const decision = applyPendingStop(record('03111234567'), makeState());
    const entry = buildActivityEntry(decision, decision.outcome);

    expect(entry.receivedAt).toBe(RECEIVED_AT);
    expect(entry.command).toBe('STOP');
    expect(entry.outcome).toBe('stopped');
    expect(entry.who).not.toContain('3111234567');
  });
});

describe('decodePendingStopRecord', () => {
  it('decodes the wire format and rejects a record with a body key', () => {
    const raw = { id: 7, sender: '+92 300 1234567', marker: 'STOP', receivedAt: RECEIVED_AT };
    expect(decodePendingStopRecord(raw)).toEqual(raw);
    expect(decodePendingStopRecord({ ...raw, body: 'STOP please' })).toBeNull();
  });
});
