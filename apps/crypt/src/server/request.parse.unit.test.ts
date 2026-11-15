import { describe, expect, it } from 'vitest';
import { isMessageBody, parseRequest } from './request.parse';

const snap = { stopped: false };

describe('parseRequest', () => {
  it('accepts a message request and keeps the snapshot unchecked', () => {
    expect(parseRequest(JSON.stringify({ type: 'message', body: 'HELP', snapshot: snap }))).toEqual({
      ok: true,
      request: { type: 'message', body: 'HELP', snapshot: snap },
    });
  });

  it('accepts a deliver request', () => {
    expect(parseRequest(JSON.stringify({ type: 'deliver', reminderId: 'r:ma-a', snapshot: snap }))).toEqual({
      ok: true,
      request: { type: 'deliver', reminderId: 'r:ma-a', snapshot: snap },
    });
  });

  it('leaves a missing snapshot for the Snapshot_Parser', () => {
    const r = parseRequest(JSON.stringify({ type: 'message', body: 'HELP' }));
    expect(r).toEqual({ ok: true, request: { type: 'message', body: 'HELP', snapshot: undefined } });
  });

  it.each([
    ['not json', '{', 'invalid-json'],
    ['array', '[]', 'invalid-type'],
    ['null', 'null', 'invalid-type'],
    ['unknown type', JSON.stringify({ type: 'ping', snapshot: snap }), 'invalid-type'],
    ['extra field', JSON.stringify({ type: 'message', body: 'HELP', snapshot: snap, x: 1 }), 'invalid-type'],
    ['body missing', JSON.stringify({ type: 'message', snapshot: snap }), 'invalid-body'],
    ['body not string', JSON.stringify({ type: 'message', body: 5, snapshot: snap }), 'invalid-body'],
    ['body whitespace', JSON.stringify({ type: 'message', body: ' \n', snapshot: snap }), 'invalid-body'],
    ['body 481 units', JSON.stringify({ type: 'message', body: 'a'.repeat(481), snapshot: snap }), 'invalid-body'],
    ['empty reminder id', JSON.stringify({ type: 'deliver', reminderId: '', snapshot: snap }), 'invalid-reminder-id'],
    ['long reminder id', JSON.stringify({ type: 'deliver', reminderId: 'r'.repeat(65), snapshot: snap }), 'invalid-reminder-id'],
    ['body on deliver', JSON.stringify({ type: 'deliver', reminderId: 'r:a', body: 'x', snapshot: snap }), 'invalid-type'],
  ])('rejects %s', (_name, raw, error) => {
    expect(parseRequest(raw)).toEqual({ ok: false, error });
  });
});

describe('isMessageBody', () => {
  it('accepts 1 and 480 units and rejects 0', () => {
    expect(isMessageBody('a')).toBe(true);
    expect(isMessageBody('a'.repeat(480))).toBe(true);
    expect(isMessageBody('')).toBe(false);
  });
});
