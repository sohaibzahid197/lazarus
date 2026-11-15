// Unit tests for the state wire format (necromancer-sms-gateway task 11.2,
// sms-reminders task 12.4).
// Validates: Requirements 3.7, 4.9, 15.5 (gateway); 12.6, 12.7, 12.8 (sms-reminders)
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, serializeSettings } from './gateway.settings.js';
import { decodeStoredState, serializeChanges, type DecodedState } from './gateway.state.js';
import type { CanonicalNumber, DayCounters, StateChange } from './gateway.types.js';
import type { Reminder, ReminderId } from './reminder.types.js';

const A = '+923001234567' as CanonicalNumber;
const B = '+923331112223' as CanonicalNumber;
const TODAY = '2024-01-02';
const R1: Reminder = {
  id: 'r:msg-1' as ReminderId,
  number: A,
  slot: 1,
  dueAt: 1_704_200_000_000,
  text: 'take medicine',
  language: 'en',
  createdAt: 1_704_190_000_000,
  handedAt: null,
};
const R2: Reminder = {
  id: 'r:msg-2' as ReminderId,
  number: B,
  slot: 2,
  dueAt: 1_704_300_000_000,
  text: 'دوا لیں',
  language: 'ur',
  createdAt: 1_704_195_000_000,
  handedAt: 1_704_300_000_500,
};

const counters: DayCounters = {
  dayKey: '2024-01-01',
  received: 5,
  repliesSent: 4,
  replied: 3,
  partsSent: 6,
  ignored: 1,
  handed: 0,
};

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stopList: [A],
    allowlist: [B],
    rate: [[A, [10, 20]]],
    slowDown: [[B, 7]],
    counters,
    settings: serializeSettings(DEFAULT_SETTINGS),
    paused: false,
    reminders: [],
    ...overrides,
  });
}

function decodeOk(json: string): Extract<DecodedState, { status: 'ok' }> {
  const r = decodeStoredState(json, TODAY);
  if (r.status !== 'ok') throw new Error('expected ok');
  return r;
}

describe('decodeStoredState', () => {
  it('decodes a valid payload', () => {
    const r = decodeOk(payload({ paused: true }));
    expect([...r.state.stopList]).toEqual([A]);
    expect(r.state.allowlist).toEqual(new Set([B]));
    expect(r.state.rate).toEqual(new Map([[A, [10, 20]]]));
    expect(r.state.slowDown).toEqual(new Map([[B, 7]]));
    expect(r.state.counters).toEqual(counters);
    expect(r.state.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.settingsStatus).toBe('ok');
    expect(r.paused).toBe(true);
  });

  it('only treats paused: true as paused', () => {
    expect(decodeOk(payload({ paused: 'true' })).paused).toBe(false);
    expect(decodeOk(payload({ paused: undefined })).paused).toBe(false);
  });

  it('maps a null or non-array Allowlist to unreadable (Requirement 4.9)', () => {
    expect(decodeOk(payload({ allowlist: null })).state.allowlist).toBe('unreadable');
    expect(decodeOk(payload({ allowlist: { a: 1 } })).state.allowlist).toBe('unreadable');
    expect(decodeOk(payload({ allowlist: [] })).state.allowlist).toEqual(new Set());
  });

  it('drops invalid numbers from every number collection', () => {
    const r = decodeOk(
      payload({
        stopList: [A, 'bad', 7, null, '+0123456789'],
        allowlist: [B, '12345', {}],
        rate: [[A, [20, 'x', -1, 10]], ['bad', [1]], [B]],
        slowDown: [[B, 7], ['nope', 3], [A, 'x']],
      }),
    );
    expect([...r.state.stopList]).toEqual([A]);
    expect([...(r.state.allowlist as ReadonlySet<CanonicalNumber>)]).toEqual([B]);
    expect(r.state.rate).toEqual(new Map([[A, [10, 20]]]));
    expect(r.state.slowDown).toEqual(new Map([[B, 7]]));
  });

  it('falls back to zero counters for today when counters are malformed', () => {
    const r = decodeOk(payload({ counters: { ...counters, received: -1 } }));
    expect(r.state.counters).toEqual({
      dayKey: TODAY,
      received: 0,
      repliesSent: 0,
      replied: 0,
      partsSent: 0,
      ignored: 0,
      handed: 0,
    });
  });

  it('resets invalid settings to defaults with status invalid (Requirement 15.5)', () => {
    for (const settings of ['{"v":2}', 'not json', 42]) {
      const r = decodeOk(payload({ settings }));
      expect(r.settingsStatus).toBe('invalid');
      expect(r.state.settings).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('reports missing settings with defaults when settings is null', () => {
    const r = decodeOk(payload({ settings: null }));
    expect(r.settingsStatus).toBe('missing');
    expect(r.state.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('reports unreadable for unparseable JSON or a bad Stop_List, without throwing (Requirement 3.7)', () => {
    for (const json of ['{', '', 'null', '[]', '"x"', payload({ stopList: null }), payload({ stopList: 'A' })]) {
      expect(decodeStoredState(json, TODAY)).toEqual({ status: 'unreadable' });
    }
  });
});

describe('decodeStoredState reminders (sms-reminders 12.6, 12.7, 12.8)', () => {
  it('decodes a valid payload with reminders to ok', () => {
    const r = decodeOk(
      payload({
        reminders: [
          { id: 'r:msg-1', number: A, slot: 1, dueAt: 1_704_200_000_000, text: 'take medicine', language: 'en', createdAt: 1_704_190_000_000, handedAt: null },
          { id: 'r:msg-2', number: B, slot: 2, dueAt: 1_704_300_000_000, text: 'دوا لیں', language: 'ur', createdAt: 1_704_195_000_000, handedAt: 1_704_300_000_500 },
        ],
      }),
    );
    expect(r.state.reminders).toEqual({ status: 'ok', reminders: [R1, R2] });
  });
  it('decodes an empty reminders array to an empty ok store', () => {
    expect(decodeOk(payload()).state.reminders).toEqual({ status: 'ok', reminders: [] });
  });
  it('decodes a missing reminders key to unreadable, never empty', () => {
    const { reminders: _omit, ...rest } = JSON.parse(payload()) as Record<string, unknown>;
    expect(_omit).toEqual([]);
    expect(decodeOk(JSON.stringify(rest)).state.reminders).toEqual({ status: 'unreadable' });
  });
  it('decodes reminders: null to unreadable', () => {
    expect(decodeOk(payload({ reminders: null })).state.reminders).toEqual({ status: 'unreadable' });
  });
});
describe('serializeChanges', () => {
  it('round trips every StateChange variant through JSON.parse', () => {
    const changes: StateChange[] = [
      { type: 'stop-add', number: A },
      { type: 'stop-remove', number: A },
      { type: 'rate-record', number: A, at: 3 },
      { type: 'slowdown-record', number: B, at: 9 },
      { type: 'counters', counters },
      { type: 'allow-add', number: B },
      { type: 'allow-remove', number: B },
    ];
    expect(JSON.parse(serializeChanges(changes))).toEqual(changes);
  });

  it('round trips the reminder change types with exactly their declared keys', () => {
    const changes: StateChange[] = [
      { type: 'reminder-add', reminder: R1 },
      { type: 'reminder-add', reminder: R2 },
      { type: 'reminder-remove', id: 'r:msg-1' as ReminderId },
      { type: 'reminder-remove-all', number: B },
      { type: 'reminder-handed', id: 'r:msg-2' as ReminderId, at: 1_704_300_000_500 },
    ];
    const json = serializeChanges(changes);
    expect(JSON.parse(json)).toEqual(changes);
    expect(json).toBe(
      '[' +
        '{"type":"reminder-add","reminder":{"id":"r:msg-1","number":"+923001234567","slot":1,"dueAt":1704200000000,"text":"take medicine","language":"en","createdAt":1704190000000,"handedAt":null}},' +
        '{"type":"reminder-add","reminder":{"id":"r:msg-2","number":"+923331112223","slot":2,"dueAt":1704300000000,"text":"دوا لیں","language":"ur","createdAt":1704195000000,"handedAt":1704300000500}},' +
        '{"type":"reminder-remove","id":"r:msg-1"},' +
        '{"type":"reminder-remove-all","number":"+923331112223"},' +
        '{"type":"reminder-handed","id":"r:msg-2","at":1704300000500}' +
        ']',
    );
  });
  it('round trips a reminder-add Reminder back through decodeStoredState (12.8)', () => {
    const added = (JSON.parse(serializeChanges([{ type: 'reminder-add', reminder: R2 }])) as [{ reminder: unknown }])[0];
    expect(decodeOk(payload({ reminders: [added.reminder] })).state.reminders).toEqual({ status: 'ok', reminders: [R2] });
  });
  it('serializes an empty change list as an empty array', () => {
    expect(serializeChanges([])).toBe('[]');
  });
});
