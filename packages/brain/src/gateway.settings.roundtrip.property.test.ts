// Feature: necromancer-sms-gateway, Property 30: Settings round trip
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseSettings, serializeSettings } from './gateway.settings.js';
import { GATEWAY_PBT_OPTIONS, settings } from './gateway.arbitraries.js';

describe('serializeSettings / parseSettings round trip', () => {
  /** **Validates: Requirements 15.4** */
  it('Req 15.4: parseSettings(serializeSettings(s)) is ok with settings equal to s', () => {
    fc.assert(
      fc.property(settings, (s) => {
        expect(parseSettings(serializeSettings(s))).toEqual({ status: 'ok', settings: s });
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
