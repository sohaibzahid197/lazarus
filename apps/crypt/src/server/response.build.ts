import 'server-only';
// Builds reply parts and JSON responses for POST /api/ouija
// (Requirements 1.11, 7.4, 7.5, 7.13, 17.3).
import { countCodeUnits, detectEncoding, getPartLimits, joinSms } from '@lazarus/brain';
import type { SmsEncoding } from '@lazarus/brain';
import type { ErrorCode, ResponsePart } from '../protocol/wire.types';
import { sanitizeText } from './sanitize';

export interface BuiltParts {
  readonly parts: ResponsePart[];
  readonly encoding: SmsEncoding;
}

/**
 * Sanitizes each part first, then derives the encoding, code units and part
 * limit from the sanitized text, so each Part_Badge matches what the browser
 * receives (17.3). Part order and text are otherwise unchanged (7.5).
 */
export function buildParts(texts: readonly string[], secrets: readonly string[]): BuiltParts {
  const sanitized = texts.map((t) => sanitizeText(t, secrets));
  const encoding = detectEncoding(joinSms([...sanitized]));
  const { single, multi } = getPartLimits(encoding);
  const limit = sanitized.length === 1 ? single : multi;
  const parts = sanitized.map((text) => ({
    text,
    units: countCodeUnits(text, encoding),
    limit,
  }));
  return { parts, encoding };
}

/** JSON response with `no-store` caching; never sets a cookie (1.11). */
export function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

const STATUS_FOR: Readonly<Record<ErrorCode, number>> = {
  'method-not-allowed': 405,
  'body-too-large': 413,
  'rate-limited': 429,
  'invalid-json': 400,
  'invalid-type': 400,
  'invalid-body': 400,
  'invalid-reminder-id': 400,
  'invalid-snapshot': 400,
  internal: 500,
};

/** Error response whose body holds only the `error` code (7.13). */
export function errorResponse(code: ErrorCode): Response {
  return json(STATUS_FOR[code], { error: code });
}
