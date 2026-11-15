// JSON shapes exchanged between the Ouija_Simulator and POST /api/ouija.
import type { Command, DeliveryOutcome, Language, Outcome, SmsEncoding } from '@lazarus/brain';
import type { SessionSnapshot } from './snapshot.types';

export type SimulatorRequest =
  | { readonly type: 'message'; readonly body: string; readonly snapshot: SessionSnapshot }
  | { readonly type: 'deliver'; readonly reminderId: string; readonly snapshot: SessionSnapshot };

export interface ResponsePart {
  readonly text: string; // after redaction and masking
  readonly units: number; // countCodeUnits(text, encoding)
  readonly limit: number; // 160/70 when 1 part, 153/67 when 2..4
}

export interface SimulatorResponse {
  readonly kind: 'message' | 'deliver';
  readonly parts: readonly ResponsePart[]; // 0..4
  readonly encoding: SmsEncoding; // detectEncoding(joinSms(texts))
  readonly command: Command | null; // null for deliver
  readonly language: Language;
  readonly outcome: Outcome | null; // message only
  readonly deliveryOutcome: DeliveryOutcome | null; // deliver only; null for not-found and wait
  readonly snapshot: SessionSnapshot;
  readonly repliesLeft: number; // 0..DEFAULT_SETTINGS.perNumberLimit
  readonly serverTime: number;
}

export type ErrorCode =
  | 'method-not-allowed'
  | 'body-too-large'
  | 'rate-limited'
  | 'invalid-json'
  | 'invalid-type'
  | 'invalid-body'
  | 'invalid-reminder-id'
  | 'invalid-snapshot'
  | 'internal';

export type ErrorBody =
  | { readonly error: Exclude<ErrorCode, 'rate-limited'> }
  | { readonly error: 'rate-limited'; readonly slowDown?: string };
