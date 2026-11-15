import 'server-only';
import { MAX_BODY_UNITS } from '../protocol/limits';

// Request shape check of the Simulator_Route (Requirements 6.2, 7.7), step 4
// of the check order. The snapshot stays `unknown` here; `parseSnapshot`
// validates it next (step 5), so a missing snapshot becomes `invalid-snapshot`.

export type RequestParseError = 'invalid-json' | 'invalid-type' | 'invalid-body' | 'invalid-reminder-id';

export type ParsedRequest =
  | { readonly type: 'message'; readonly body: string; readonly snapshot: unknown }
  | { readonly type: 'deliver'; readonly reminderId: string; readonly snapshot: unknown };

export type RequestParse =
  | { readonly ok: true; readonly request: ParsedRequest }
  | { readonly ok: false; readonly error: RequestParseError };

const MAX_REMINDER_ID = 64;
const MESSAGE_KEYS: ReadonlySet<string> = new Set(['type', 'body', 'snapshot']);
const DELIVER_KEYS: ReadonlySet<string> = new Set(['type', 'reminderId', 'snapshot']);

/** A Message_Body: a string of 1 to 480 UTF-16 code units with a non-whitespace character. */
export function isMessageBody(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_BODY_UNITS && /\S/.test(value);
}

function isReminderId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_REMINDER_ID;
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(obj: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(obj).every((k) => allowed.has(k));
}

const fail = (error: RequestParseError): RequestParse => ({ ok: false, error });

export function parseRequest(raw: string): RequestParse {
  const parsed = parseJson(raw);
  if (!parsed.ok) return fail('invalid-json');
  const obj = parsed.value;
  if (!isRecord(obj)) return fail('invalid-type');
  if (obj.type === 'message') {
    if (!onlyKeys(obj, MESSAGE_KEYS)) return fail('invalid-type');
    if (!isMessageBody(obj.body)) return fail('invalid-body');
    return { ok: true, request: { type: 'message', body: obj.body, snapshot: obj.snapshot } };
  }
  if (obj.type === 'deliver') {
    if (!onlyKeys(obj, DELIVER_KEYS)) return fail('invalid-type');
    if (!isReminderId(obj.reminderId)) return fail('invalid-reminder-id');
    return { ok: true, request: { type: 'deliver', reminderId: obj.reminderId, snapshot: obj.snapshot } };
  }
  return fail('invalid-type');
}
