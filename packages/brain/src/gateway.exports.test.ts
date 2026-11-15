// Entry-point exports test for the Gateway_Module.
// _Requirements: 17.6, 17.10_
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as brain from './index.js';
import {
  ACTIVITY_LOG_MAX,
  addToAllowlist,
  ALLOWLIST_MAX,
  API_KEY_INVALID_MESSAGE,
  applyChanges,
  applyPendingStop,
  buildActivityEntry,
  checkRate,
  completeReply,
  countersFor,
  countInWindow,
  decodePendingStopRecord,
  decodeStoredState,
  DEFAULT_SETTINGS,
  deriveHeartbeat,
  evaluateInbound,
  FALLBACK_COUNTRY_CODE,
  finalizeSend,
  GATEWAY_TEXTS,
  isCanonicalNumber,
  isValidCountryCode,
  KEYWORD_TRAILING_PUNCTUATION,
  localDayKey,
  maskApiKey,
  maskNumber,
  maskSender,
  normalizeSender,
  orderInbound,
  orderPendingStops,
  OUTCOMES,
  parseSettings,
  printNumber,
  pruneRate,
  RATE_RETENTION_MS,
  recordFinal,
  releaseParts,
  reserveParts,
  runGatewayPipeline,
  serializeChanges,
  serializeSettings,
  SLEEP_REASONS,
  slowDownDue,
  STOP_ALIAS_LIST,
  STOP_MARKER,
  stopAliasAsset,
  stopKeywordCheck,
  trailingPunctuationRegex,
  trimActivityLog,
  validateApiKey,
  validateSettingsField,
  zeroCounters,
} from './index.js';
import type {
  ActivityEntry,
  GatewaySettings,
  GatewayState,
  Heartbeat,
  Outcome,
  SleepReason,
} from './index.js';

const gatewayFunctions: Readonly<Record<string, unknown>> = {
  addToAllowlist,
  applyChanges,
  applyPendingStop,
  buildActivityEntry,
  checkRate,
  completeReply,
  countersFor,
  countInWindow,
  decodePendingStopRecord,
  decodeStoredState,
  deriveHeartbeat,
  evaluateInbound,
  finalizeSend,
  isCanonicalNumber,
  isValidCountryCode,
  localDayKey,
  maskApiKey,
  maskNumber,
  maskSender,
  normalizeSender,
  orderInbound,
  orderPendingStops,
  parseSettings,
  printNumber,
  pruneRate,
  recordFinal,
  releaseParts,
  reserveParts,
  runGatewayPipeline,
  serializeChanges,
  serializeSettings,
  slowDownDue,
  stopAliasAsset,
  stopKeywordCheck,
  trailingPunctuationRegex,
  trimActivityLog,
  validateApiKey,
  validateSettingsField,
  zeroCounters,
};

// Symbols defined only in gateway.arbitraries.ts (test-only module).
const ARBITRARY_ONLY = [
  'GATEWAY_PBT_OPTIONS',
  'languageArb',
  'countryCode',
  'canonicalNumber',
  'canonicalNumberIn',
  'formattingOf',
  'formattedNumber',
  'automatedAddress',
  'anyBody',
  'timeArb',
  'dayKeyArb',
  'dayCounters',
  'gatewayState',
  'deviceStatus',
  'sendReport',
  'stopAliasBody',
  'pendingStopRecord',
] as const;

describe('gateway entry exports (runtime)', () => {
  it.each(Object.entries(gatewayFunctions))('exports %s as a function', (_name, value) => {
    expect(typeof value).toBe('function');
  });

  it('exports the gateway constants', () => {
    expect(OUTCOMES.length).toBeGreaterThan(0);
    expect(SLEEP_REASONS.length).toBeGreaterThan(0);
    expect(STOP_ALIAS_LIST.length).toBeGreaterThan(0);
    expect(STOP_MARKER).toBe('STOP');
    expect(typeof KEYWORD_TRAILING_PUNCTUATION).toBe('string');
    expect(typeof FALLBACK_COUNTRY_CODE).toBe('string');
    expect(typeof API_KEY_INVALID_MESSAGE).toBe('string');
    expect(typeof GATEWAY_TEXTS).toBe('object');
    expect(typeof DEFAULT_SETTINGS).toBe('object');
    expect(Number.isInteger(RATE_RETENTION_MS)).toBe(true);
    expect(Number.isInteger(ACTIVITY_LOG_MAX)).toBe(true);
    expect(Number.isInteger(ALLOWLIST_MAX)).toBe(true);
  });

  it('does not export the test-only arbitraries', () => {
    const exported: readonly string[] = Object.keys(brain);
    for (const name of ARBITRARY_ONLY) {
      expect(exported).not.toContain(name);
    }
  });

  it('does not export the Gemini client', () => {
    expect(Object.keys(brain)).not.toContain('createGeminiClient');
  });
});

describe('gateway entry exports (types)', () => {
  it('derives Outcome and SleepReason from their constant lists', () => {
    expectTypeOf<Outcome>().toEqualTypeOf<(typeof OUTCOMES)[number]>();
    expectTypeOf<SleepReason>().toEqualTypeOf<(typeof SLEEP_REASONS)[number]>();
  });

  it('exposes the gateway object types', () => {
    expectTypeOf<GatewaySettings>().toBeObject();
    expectTypeOf<GatewayState>().toBeObject();
    expectTypeOf<ActivityEntry>().toBeObject();
    expectTypeOf(deriveHeartbeat).returns.toEqualTypeOf<Heartbeat>();
    expectTypeOf(DEFAULT_SETTINGS).toMatchTypeOf<GatewaySettings>();
  });
});
