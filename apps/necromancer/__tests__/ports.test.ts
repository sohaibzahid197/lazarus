// Unit tests for the native payload decoders (task 16.4, Requirement 14.6).
// Only the decoders are imported; createLivePorts is never called, so no
// TurboModule is loaded.
import { ACTIVITY_OUTCOMES, DELIVERY_OUTCOMES } from '@lazarus/brain';
import {
  decodeActivity,
  decodeCount,
  decodeDeviceStatus,
  decodeExactAlarmAccess,
  decodeInbound,
  decodeKeyRead,
  decodePendingStops,
  decodeSendReport,
  decodeServiceStatus,
  decodeSetupMarks,
  inboundIdOf,
} from '../src/native/ports';

const SENDER = '+923001234567';
const BODY = 'my secret question about 9876 rupees';
const KEY = 'AIzaSyTestKey0000000000000000000000000';

/** Every run of 4 consecutive digits in the sender (Requirement 14.8). */
function digitWindows(number: string): string[] {
  const digits = number.replace(/\D/g, '');
  const out: string[] = [];
  for (let i = 0; i + 4 <= digits.length; i++) out.push(digits.slice(i, i + 4));
  return out;
}

let lines: string[] = [];
const log = (line: string): void => {
  lines.push(line);
};

beforeEach(() => {
  lines = [];
});

afterEach(() => {
  for (const line of lines) {
    expect(line).not.toContain(SENDER);
    expect(line).not.toContain(BODY);
    expect(line).not.toContain(KEY);
    for (const w of digitWindows(SENDER)) expect(line).not.toContain(w);
  }
});

const NON_OBJECTS: readonly unknown[] = [42, 'text', true, [], [1, 2]];

describe('decodeInbound', () => {
  const valid = { id: 'in-1', seq: 3, sender: SENDER, body: BODY, receivedAt: 1700000000000 };

  it('passes a valid payload unchanged without logging', () => {
    expect(decodeInbound(valid, log)).toEqual(valid);
    expect(lines).toEqual([]);
  });

  it('returns null silently for an empty queue', () => {
    expect(decodeInbound(null, log)).toBeNull();
    expect(decodeInbound(undefined, log)).toBeNull();
    expect(lines).toEqual([]);
  });

  it.each([
    ['id', 7],
    ['id', ''],
    ['seq', '3'],
    ['seq', 1.5],
    ['sender', 923001234567],
    ['body', null],
    ['receivedAt', -1],
    ['receivedAt', '1700000000000'],
  ])('drops a payload whose %s is %p and logs a masked sender', (field, value) => {
    const raw: Record<string, unknown> = { ...valid, [field]: value };
    expect(() => decodeInbound(raw, log)).not.toThrow();
    expect(decodeInbound(raw, log)).toBeNull();
    expect(lines.length).toBeGreaterThan(0);
    if (typeof raw.sender === 'string') expect(lines[0]).toContain('567');
  });

  it('drops a payload with a missing field', () => {
    const missing: Record<string, unknown> = { ...valid };
    delete missing.body;
    expect(decodeInbound(missing, log)).toBeNull();
    expect(lines).toHaveLength(1);
  });

  it.each(NON_OBJECTS)('drops non-object %p', (raw) => {
    expect(decodeInbound(raw, log)).toBeNull();
    expect(lines).toHaveLength(1);
  });
});

describe('inboundIdOf', () => {
  it('returns the id of a malformed payload', () => {
    expect(inboundIdOf({ id: 'in-9', body: 5 })).toBe('in-9');
  });

  it.each([{ id: '' }, { id: 9 }, {}, null, 'in-9', ['in-9']])('returns null for %p', (raw) => {
    expect(inboundIdOf(raw)).toBeNull();
  });
});

describe('decodeSendReport', () => {
  it('passes a valid done report', () => {
    const raw = { status: 'done', results: ['sent', 'failed-radio'], attempts: 2 };
    expect(decodeSendReport(raw, 2, log)).toEqual(raw);
    expect(lines).toEqual([]);
  });

  it.each(['refused-stopped', 'cancelled'])('passes status %s', (status) => {
    expect(decodeSendReport({ status }, 3, log)).toEqual({ status });
    expect(lines).toEqual([]);
  });

  it('fits results to the part count and marks bad entries failed-other', () => {
    const raw = { status: 'done', results: ['sent', 5], attempts: 1 };
    expect(decodeSendReport(raw, 3, log)).toEqual({
      status: 'done',
      results: ['sent', 'failed-other', 'failed-other'],
      attempts: 1,
    });
    expect(lines).toHaveLength(1);
  });

  it('defaults bad attempts to 1', () => {
    const raw = { status: 'done', results: ['sent'], attempts: 7 };
    expect(decodeSendReport(raw, 1, log)).toEqual({ status: 'done', results: ['sent'], attempts: 1 });
    expect(lines).toHaveLength(1);
  });

  it.each([{ status: 'weird', results: ['sent'], attempts: 1 }, ...NON_OBJECTS, null])(
    'never counts an unknown report %p as sent',
    (raw) => {
      expect(decodeSendReport(raw, 2, log)).toEqual({
        status: 'done',
        results: ['failed-other', 'failed-other'],
        attempts: 1,
      });
      expect(lines).toHaveLength(1);
    },
  );
});

describe('decodeDeviceStatus', () => {
  const valid = {
    smsPermission: true,
    notificationPermission: true,
    batteryOptimisationIgnored: false,
    inService: true,
    airplaneMode: false,
  };

  it('passes a valid payload', () => {
    expect(decodeDeviceStatus(valid, log)).toEqual(valid);
    expect(lines).toEqual([]);
  });

  it('turns wrong-typed and missing fields into false and names them', () => {
    const raw: Record<string, unknown> = { ...valid, smsPermission: 'yes' };
    delete raw.airplaneMode;
    expect(decodeDeviceStatus(raw, log)).toEqual({ ...valid, smsPermission: false, airplaneMode: false });
    expect(lines).toEqual(['ports: device status fields dropped: smsPermission, airplaneMode']);
  });

  it.each([...NON_OBJECTS, null, undefined])('returns null for non-object %p', (raw) => {
    expect(decodeDeviceStatus(raw, log)).toBeNull();
    expect(lines).toHaveLength(1);
  });
});

describe('decodeKeyRead', () => {
  it('passes a present key without logging it', () => {
    expect(decodeKeyRead({ status: 'present', key: KEY }, log)).toEqual({ status: 'present', key: KEY });
    expect(lines).toEqual([]);
  });

  it.each(['absent', 'unreadable'])('passes status %s', (status) => {
    expect(decodeKeyRead({ status }, log)).toEqual({ status });
    expect(lines).toEqual([]);
  });

  it.each([
    { status: 'present', key: '' },
    { status: 'present', key: 12 },
    { status: 'present' },
    { status: 'other', key: KEY },
    ...NON_OBJECTS,
    null,
  ])('treats %p as unreadable', (raw) => {
    expect(decodeKeyRead(raw, log)).toEqual({ status: 'unreadable' });
    expect(lines).toHaveLength(1);
  });
});

describe('decodeSetupMarks', () => {
  it('passes valid JSON', () => {
    expect(decodeSetupMarks('{"autostart":true,"recents":false}', log)).toEqual({
      autostart: true,
      recents: false,
    });
    expect(lines).toEqual([]);
  });

  it.each(['{"autostart":"true","recents":true}', '{"recents":true}', 'not json', '[]', 5, null])(
    'defaults bad marks in %p to false',
    (raw) => {
      const marks = decodeSetupMarks(raw, log);
      expect(marks.autostart).toBe(false);
      expect(lines).toHaveLength(1);
    },
  );
});

describe('decodeServiceStatus', () => {
  it.each(['running', 'stopped', 'paused'])('passes %s', (status) => {
    expect(decodeServiceStatus(status, log)).toBe(status);
    expect(lines).toEqual([]);
  });

  it.each(['RUNNING', '', 1, null, {}])('treats %p as stopped', (raw) => {
    expect(decodeServiceStatus(raw, log)).toBe('stopped');
    expect(lines).toHaveLength(1);
  });
});

describe('decodePendingStops', () => {
  const good = { id: 1, sender: SENDER, marker: 'STOP', receivedAt: 1700000000000 };

  it('passes valid records', () => {
    expect(decodePendingStops(JSON.stringify([good]), log)).toEqual([good]);
    expect(lines).toEqual([]);
  });

  it('skips bad rows with one masked line each', () => {
    const rows = [
      good,
      { ...good, id: 2, marker: 'stop now' },
      { ...good, id: '3' },
      { ...good, id: 4, body: BODY },
      7,
    ];
    expect(decodePendingStops(JSON.stringify(rows), log)).toEqual([good]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('567');
  });

  it.each(['{}', 'not json', 5, null])('returns [] for non-array %p', (raw) => {
    expect(decodePendingStops(raw, log)).toEqual([]);
    expect(lines).toHaveLength(1);
  });
});

describe('decodeActivity', () => {
  const entry = { receivedAt: 1700000000000, who: '••••••••••567', command: 'HELP', outcome: 'replied' };

  it('passes valid entries, including command NONE', () => {
    const none = { ...entry, command: 'NONE' };
    expect(decodeActivity(JSON.stringify([entry, none]), log)).toEqual([entry, none]);
    expect(lines).toEqual([]);
  });

  it('drops malformed entries with one counting line', () => {
    const rows = [entry, { ...entry, command: 'DANCE' }, { ...entry, outcome: 'x' }, { ...entry, who: 5 }, null];
    expect(decodeActivity(JSON.stringify(rows), log)).toEqual([entry]);
    expect(lines).toEqual(['ports: dropped 4 malformed activity entries']);
  });

  it('passes reminder Delivery_Outcomes and reminders-failed (sms-reminders 13.1)', () => {
    const sent = { ...entry, command: 'REMIND', outcome: 'reminder-sent' };
    const failed = { receivedAt: 1700000000000, who: '', command: 'NONE', outcome: 'reminders-failed' };
    expect(decodeActivity(JSON.stringify([sent, failed]), log)).toEqual([sent, failed]);
    expect(lines).toEqual([]);
  });

  it.each(DELIVERY_OUTCOMES)('passes Delivery_Outcome %s with command REMIND', (outcome) => {
    const row = { ...entry, command: 'REMIND', outcome };
    expect(decodeActivity(JSON.stringify([row]), log)).toEqual([row]);
    expect(lines).toEqual([]);
  });

  it('passes every Activity_Outcome and still drops an unknown reminder outcome', () => {
    const rows = ACTIVITY_OUTCOMES.map((outcome) => ({ ...entry, outcome }));
    expect(decodeActivity(JSON.stringify(rows), log)).toEqual(rows);
    expect(lines).toEqual([]);
    const unknown = { ...entry, command: 'REMIND', outcome: 'reminder-lost' };
    expect(decodeActivity(JSON.stringify([unknown]), log)).toEqual([]);
    expect(lines).toEqual(['ports: dropped 1 malformed activity entries']);
  });

  it.each(['{}', 'oops', 3, undefined])('returns [] for non-array %p', (raw) => {
    expect(decodeActivity(raw, log)).toEqual([]);
    expect(lines).toHaveLength(1);
  });
});

describe('decodeCount', () => {
  it('passes a non-negative integer', () => {
    expect(decodeCount(0)).toBe(0);
    expect(decodeCount(4)).toBe(4);
  });

  it.each([-1, 1.5, '3', null, Number.NaN, {}])('returns 0 for %p', (raw) => {
    expect(decodeCount(raw)).toBe(0);
  });
});

describe('decodeExactAlarmAccess', () => {
  it.each([true, false])('passes boolean %p', (raw) => {
    expect(decodeExactAlarmAccess(raw, log)).toBe(raw);
    expect(lines).toEqual([]);
  });

  it.each(['true', 1, null, undefined, {}])('treats %p as denied with one line', (raw) => {
    expect(decodeExactAlarmAccess(raw, log)).toBe(false);
    expect(lines).toEqual(['ports: exact alarm access unreadable, treated as denied']);
  });
});
