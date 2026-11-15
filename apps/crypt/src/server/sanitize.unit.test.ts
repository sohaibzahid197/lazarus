import { describe, expect, it } from 'vitest';
import { REMINDER_TEXT_MAX, countCodeUnits } from '@lazarus/brain';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SessionSnapshot, SnapshotReminder } from '../protocol/snapshot.types';
import { TEST_KEY } from '../test/pbt';
import { buildParts, errorResponse, json } from './response.build';
import { sanitizeSnapshot, sanitizeText } from './sanitize';

const NOW = 1_767_225_600_000;
const SECRETS = [TEST_KEY] as const;
// A fake secret shorter than `[redacted]`, so redaction makes the text longer.
const SHORT_SECRET = 'zq';

function snapshotWithText(text: string): SessionSnapshot {
  const reminder: SnapshotReminder = {
    id: 'r:mabc-a',
    slot: 1,
    dueAt: NOW + 60_000,
    text,
    language: 'en',
    createdAt: NOW,
  };
  return { ...emptySnapshot(NOW), reminders: [reminder] };
}

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

describe('sanitizeText', () => {
  it('masks a phone number and keeps its last 3 digits', () => {
    expect(sanitizeText('call +923001234567 now', SECRETS)).toBe('call +*********567 now');
  });

  it('replaces the Gemini key with [redacted]', () => {
    expect(sanitizeText(`key ${TEST_KEY} here`, SECRETS)).toBe('key [redacted] here');
  });
});

describe('sanitizeSnapshot', () => {
  it('sanitizes Reminder_Texts and leaves the day key and other fields alone', () => {
    const s = snapshotWithText(`ring 03001234567 ${TEST_KEY}`);
    const out = sanitizeSnapshot(s, SECRETS);
    expect(out.reminders[0]?.text).toBe('ring ********567 [redacted]');
    expect(out.counters).toEqual(s.counters);
    expect(out.reminders[0]?.id).toBe('r:mabc-a');
  });

  it('clamps a Reminder_Text grown past 140 units by a short secret', () => {
    const text = SHORT_SECRET + 'a'.repeat(REMINDER_TEXT_MAX - SHORT_SECRET.length);
    const out = sanitizeSnapshot(snapshotWithText(text), [SHORT_SECRET]);
    const result = out.reminders[0]?.text ?? '';
    expect(result.length).toBe(REMINDER_TEXT_MAX);
    expect(result.startsWith('[redacted]')).toBe(true);
  });

  it('clamps to 139 units when unit 140 would be a lone high surrogate', () => {
    // After redaction: '[redacted]' (10) + 129 'a' = 139 units, then the emoji at units 140-141.
    const text = SHORT_SECRET + 'a'.repeat(129) + '😀';
    const out = sanitizeSnapshot(snapshotWithText(text), [SHORT_SECRET]);
    const result = out.reminders[0]?.text ?? '';
    expect(result.length).toBe(REMINDER_TEXT_MAX - 1);
    expect(isHigh(result.charCodeAt(result.length - 1))).toBe(false);
  });
});

describe('buildParts', () => {
  it('uses the single limits 160 (GSM-7) and 70 (UCS-2) for 1 part', () => {
    const gsm = buildParts(['Hello there'], SECRETS);
    expect(gsm.encoding).toBe('GSM-7');
    expect(gsm.parts).toEqual([{ text: 'Hello there', units: 11, limit: 160 }]);

    const ucs = buildParts(['آج موسم اچھا ہے'], SECRETS);
    expect(ucs.encoding).toBe('UCS-2');
    expect(ucs.parts[0]?.limit).toBe(70);
  });

  it('uses the multi limits 153 (GSM-7) and 67 (UCS-2) for 2 parts', () => {
    const gsm = buildParts(['(1/2) first part', '(2/2) second part'], SECRETS);
    expect(gsm.encoding).toBe('GSM-7');
    expect(gsm.parts.map((p) => p.limit)).toEqual([153, 153]);

    const ucs = buildParts(['(1/2) پہلا حصہ', '(2/2) دوسرا حصہ'], SECRETS);
    expect(ucs.encoding).toBe('UCS-2');
    expect(ucs.parts.map((p) => p.limit)).toEqual([67, 67]);
  });

  it('counts code units on the sanitized text', () => {
    const { parts, encoding } = buildParts([`key ${TEST_KEY} +923001234567`], SECRETS);
    const text = 'key [redacted] +*********567';
    expect(parts[0]?.text).toBe(text);
    expect(parts[0]?.units).toBe(countCodeUnits(text, encoding));
  });

  it('returns no parts for an empty list', () => {
    expect(buildParts([], SECRETS).parts).toEqual([]);
  });
});

describe('json and errorResponse', () => {
  it('sets JSON and no-store headers and no cookie', async () => {
    const res = json(200, { ok: true });
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  it('error responses carry only the error code with the matching status', async () => {
    const res = errorResponse('invalid-snapshot');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-snapshot' });
    expect(errorResponse('internal').status).toBe(500);
  });
});
