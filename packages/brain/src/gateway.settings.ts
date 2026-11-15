// Settings and Allowlist functions (necromancer-sms-gateway design,
// "Settings, Allowlist and key" and "Settings wire format"; Requirements 4,
// 5.10, 5.11, 15). Pure: no storage, no clock.
import { isCanonicalNumber, isValidCountryCode, normalizeSender } from './gateway.number.js';
import type { CanonicalNumber, GatewaySettings } from './gateway.types.js';

/** Requirement 4.10: the Allowlist holds at most 500 entries. */
export const ALLOWLIST_MAX = 500;

const WIRE_VERSION = 1;

/** Requirement 15.3. */
export const DEFAULT_SETTINGS: GatewaySettings = Object.freeze({
  allowlistMode: false,
  perNumberLimit: 5,
  rateWindowMinutes: 60,
  dailySendCap: 200,
  defaultCountryCode: '92',
  ownNumber: null,
});

type IntegerField = 'perNumberLimit' | 'rateWindowMinutes' | 'dailySendCap';

/** Requirement 5.10: inclusive integer ranges. */
const INTEGER_RANGES: Readonly<Record<IntegerField, readonly [number, number]>> = {
  perNumberLimit: [1, 60],
  rateWindowMinutes: [1, 1440],
  dailySendCap: [1, 2000],
};

const WIRE_KEYS = [
  'v',
  'allowlistMode',
  'perNumberLimit',
  'rateWindowMinutes',
  'dailySendCap',
  'defaultCountryCode',
  'ownNumber',
] as const;

/** Fixed wire key order, so equal Settings serialize to equal strings. */
export function serializeSettings(s: GatewaySettings): string {
  return JSON.stringify({
    v: WIRE_VERSION,
    allowlistMode: s.allowlistMode,
    perNumberLimit: s.perNumberLimit,
    rateWindowMinutes: s.rateWindowMinutes,
    dailySendCap: s.dailySendCap,
    defaultCountryCode: s.defaultCountryCode,
    ownNumber: s.ownNumber,
  });
}

export type ParsedSettings =
  | { readonly status: 'ok'; readonly settings: GatewaySettings }
  | { readonly status: 'missing'; readonly settings: GatewaySettings }
  | { readonly status: 'invalid'; readonly settings: GatewaySettings };

function inRange(field: IntegerField, value: unknown): value is number {
  const [min, max] = INTEGER_RANGES[field];
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function hasExactKeys(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  return keys.length === WIRE_KEYS.length && WIRE_KEYS.every((k) => keys.includes(k));
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function toSettings(obj: Record<string, unknown>): GatewaySettings | null {
  const { v, allowlistMode, perNumberLimit, rateWindowMinutes, dailySendCap } = obj;
  const { defaultCountryCode, ownNumber } = obj;
  if (v !== WIRE_VERSION || typeof allowlistMode !== 'boolean') return null;
  if (!inRange('perNumberLimit', perNumberLimit)) return null;
  if (!inRange('rateWindowMinutes', rateWindowMinutes)) return null;
  if (!inRange('dailySendCap', dailySendCap)) return null;
  if (typeof defaultCountryCode !== 'string' || !isValidCountryCode(defaultCountryCode)) return null;
  const own = ownNumber === null || (typeof ownNumber === 'string' && isCanonicalNumber(ownNumber));
  if (!own) return null;
  return {
    allowlistMode,
    perNumberLimit,
    rateWindowMinutes,
    dailySendCap,
    defaultCountryCode,
    ownNumber: ownNumber as CanonicalNumber | null,
  };
}

/** Requirements 15.3, 15.4, 15.5: `missing` and `invalid` both carry the defaults. */
export function parseSettings(raw: string | null): ParsedSettings {
  if (raw === null) return { status: 'missing', settings: DEFAULT_SETTINGS };
  const value = safeJson(raw);
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  const record = isObject ? (value as Record<string, unknown>) : null;
  const settings = record !== null && hasExactKeys(record) ? toSettings(record) : null;
  return settings === null
    ? { status: 'invalid', settings: DEFAULT_SETTINGS }
    : { status: 'ok', settings };
}

export type FieldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly range: string };

export type SettingsField = IntegerField | 'defaultCountryCode' | 'ownNumber';

const COUNTRY_CODE_RANGE = '1 to 3 digits, not starting with 0';
const OWN_NUMBER_RANGE = 'a phone number of 7 to 15 digits';

function validateInteger(field: IntegerField, input: string): FieldResult<number> {
  const [min, max] = INTEGER_RANGES[field];
  const text = input.trim();
  const value = /^\d{1,5}$/.test(text) ? Number(text) : Number.NaN;
  return inRange(field, value) ? { ok: true, value } : { ok: false, range: `${min} to ${max}` };
}

function validateOwnNumber(input: string, cc: string): FieldResult<CanonicalNumber | null> {
  if (input.trim() === '') return { ok: true, value: null };
  const identity = normalizeSender(input.trim(), cc);
  return identity.kind === 'phone'
    ? { ok: true, value: identity.number }
    : { ok: false, range: OWN_NUMBER_RANGE };
}

/**
 * Requirements 5.10, 5.11: validate one Settings_Screen field. On failure
 * `range` holds the allowed range to show; the caller keeps the old value.
 * An empty Own_Number input clears it (no Own_Number).
 */
export function validateSettingsField(
  field: SettingsField,
  input: string,
  defaultCountryCode: string,
): FieldResult<number | string | CanonicalNumber | null> {
  if (field === 'ownNumber') return validateOwnNumber(input, defaultCountryCode);
  if (field === 'defaultCountryCode') {
    const text = input.trim();
    return isValidCountryCode(text) ? { ok: true, value: text } : { ok: false, range: COUNTRY_CODE_RANGE };
  }
  return validateInteger(field, input);
}

export type AllowlistAdd =
  | { readonly status: 'added'; readonly number: CanonicalNumber }
  | { readonly status: 'duplicate'; readonly number: CanonicalNumber }
  | { readonly status: 'invalid' }
  | { readonly status: 'full' };

/**
 * Requirements 4.4, 4.5, 4.10. Checks in order: automated input is
 * `invalid`, an existing entry is `duplicate`, a new number on a list of
 * ALLOWLIST_MAX entries is `full`, else `added`. The caller stores `number`.
 */
export function addToAllowlist(
  list: ReadonlySet<CanonicalNumber>,
  input: string,
  defaultCountryCode: string,
): AllowlistAdd {
  const identity = normalizeSender(input, defaultCountryCode);
  if (identity.kind !== 'phone') return { status: 'invalid' };
  if (list.has(identity.number)) return { status: 'duplicate', number: identity.number };
  if (list.size >= ALLOWLIST_MAX) return { status: 'full' };
  return { status: 'added', number: identity.number };
}
