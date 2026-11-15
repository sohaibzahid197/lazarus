import { describe, expect, it } from 'vitest';
import type { CanonicalNumber } from './gateway.types.js';
import {
  ALLOWLIST_MAX,
  DEFAULT_SETTINGS,
  addToAllowlist,
  parseSettings,
  serializeSettings,
  validateSettingsField,
} from './gateway.settings.js';

const WIRE =
  '{"v":1,"allowlistMode":false,"perNumberLimit":5,"rateWindowMinutes":60,"dailySendCap":200,"defaultCountryCode":"92","ownNumber":null}';

describe('gateway.settings smoke', () => {
  it('serializes the defaults to the documented wire format', () => {
    expect(serializeSettings(DEFAULT_SETTINGS)).toBe(WIRE);
    expect(parseSettings(WIRE)).toEqual({ status: 'ok', settings: DEFAULT_SETTINGS });
  });

  it('returns missing for null and invalid for bad data', () => {
    expect(parseSettings(null)).toEqual({ status: 'missing', settings: DEFAULT_SETTINGS });
    for (const raw of ['', 'nope', '[]', WIRE.slice(0, 20), WIRE.replace('"v":1', '"v":2'),
      WIRE.replace(':5,', ':61,'), WIRE.replace(':5,', ':5.5,'), WIRE.replace('"92"', '"092"'),
      WIRE.replace('null}', '"0300"}'), WIRE.replace('}', ',"x":1}'), WIRE.replace(',"ownNumber":null', '')]) {
      expect(parseSettings(raw).status).toBe('invalid');
    }
  });

  it('validates fields and reports ranges', () => {
    expect(validateSettingsField('perNumberLimit', ' 60 ', '92')).toEqual({ ok: true, value: 60 });
    expect(validateSettingsField('perNumberLimit', '61', '92')).toEqual({ ok: false, range: '1 to 60' });
    expect(validateSettingsField('rateWindowMinutes', '1.5', '92')).toEqual({ ok: false, range: '1 to 1440' });
    expect(validateSettingsField('dailySendCap', '2000', '92')).toEqual({ ok: true, value: 2000 });
    expect(validateSettingsField('dailySendCap', '0', '92').ok).toBe(false);
    expect(validateSettingsField('defaultCountryCode', '44', '92')).toEqual({ ok: true, value: '44' });
    expect(validateSettingsField('defaultCountryCode', '0', '92').ok).toBe(false);
    expect(validateSettingsField('ownNumber', '0300 1234567', '92')).toEqual({ ok: true, value: '+923001234567' });
    expect(validateSettingsField('ownNumber', '', '92')).toEqual({ ok: true, value: null });
    expect(validateSettingsField('ownNumber', 'JAZZ', '92').ok).toBe(false);
  });

  it('adds to the Allowlist with duplicate, invalid and full results', () => {
    const n = '+923001234567' as CanonicalNumber;
    expect(addToAllowlist(new Set(), '0300-1234567', '92')).toEqual({ status: 'added', number: n });
    expect(addToAllowlist(new Set([n]), '+92 300 1234567', '92')).toEqual({ status: 'duplicate', number: n });
    expect(addToAllowlist(new Set(), 'BANK', '92')).toEqual({ status: 'invalid' });
    const full = new Set(Array.from({ length: ALLOWLIST_MAX }, (_, i) => `+1555${String(i).padStart(7, '0')}` as CanonicalNumber));
    expect(addToAllowlist(full, '0300-1234567', '92')).toEqual({ status: 'full' });
  });
});
