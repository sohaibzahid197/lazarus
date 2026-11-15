// Unit tests for the state wire format (necromancer-sms-gateway task 11.2).
// Validates: Requirements 3.7, 4.9, 15.5
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, serializeSettings } from './gateway.settings.js';
import { decodeStoredState, serializeChanges, type DecodedState } from './gateway.state.js';
import type { CanonicalNumber, DayCounters, StateChange } from './gateway.types.js';

const A = '+923001234567' as CanonicalNumber;
const B = '+923331112223' as CanonicalNumber;
const TODAY = '2024-01-02';

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

  it('serializes an empty change list as an empty array', () => {
    expect(serializeChanges([])).toBe('[]');
  });
});
