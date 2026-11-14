import type { AiClient } from './ai.types.js';

export type { Language } from './router.types.js';

export type Topic = 'health' | 'legal' | 'money';
export type RequestKind = 'question' | 'scam';
export type ScamVerdict = 'SCAM' | 'SAFE' | 'UNSURE';

export interface ScamResult {
  readonly verdict: ScamVerdict;
  /** Non-empty, normalizeMessage-stable, single line, at most MAX_REASON_CODE_POINTS. */
  readonly reason: string;
}

export interface AnswerCache {
  /** Returns the value if present and expiresAt > now. A hit marks the entry most recently used. */
  get(key: string, now: number): string | undefined;
  set(key: string, value: string, expiresAt: number): void;
  size(): number;
}

/** Dependencies of the Answer_Service. No sender, phone or user-id field by design. */
export interface AnswerDeps {
  readonly client: AiClient;
  readonly cache: AnswerCache;
  readonly clock: () => number;
  /** Secrets to redact from model output. Default: none. */
  readonly secrets?: readonly string[];
  /** Per-call timeout in ms. Default CALL_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}
