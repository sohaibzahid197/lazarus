// Client Session_State of the Ouija_Simulator and the actions of its reducer.
// Browser only: no import from src/server.
import type { SmsEncoding } from '@lazarus/brain';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorResponse } from '../protocol/wire.types';

export type BubbleKind = 'outgoing' | 'part' | 'reminder-part' | 'note';

export type LanguageLabel = 'English' | 'Urdu' | 'Roman Urdu';

export type RequestType = 'message' | 'deliver';

export interface PartBadge {
  readonly n: number;
  readonly total: number;
  readonly encoding: SmsEncoding;
  readonly units: number;
  readonly limit: number;
}

export interface Bubble {
  readonly id: number;
  readonly kind: BubbleKind;
  readonly text: string;
  readonly badge?: PartBadge;
  /** First part of a message reply only (Requirement 2.7). */
  readonly languageLabel?: LanguageLabel;
  /** First part of a Reminder delivery only (Requirement 13.7). */
  readonly reminderLabel?: boolean;
  /** Announce through the assertive live region (Requirement 16.11). */
  readonly urgent?: boolean;
}

/** A bubble still waiting in the drip queue; it gets its id when added. */
export type DripItem = Omit<Bubble, 'id'>;

/** A message queued behind an in-flight `deliver` request (design C5). */
export interface Outgoing {
  readonly type: 'message';
  readonly body: string;
}

export interface InFlight {
  readonly type: RequestType;
  readonly reminderId?: string;
}

export interface SessionState {
  readonly epoch: number;
  readonly snapshot: SessionSnapshot;
  readonly repliesLeft: number;
  /** Server_Time minus the browser clock at the latest accepted response. */
  readonly clockOffset: number;
  readonly bubbles: readonly Bubble[];
  readonly nextBubbleId: number;
  /** Items still to be added to the Phone_Screen, in order. */
  readonly drip: readonly DripItem[];
  readonly inFlight: InFlight | null;
  /** Sent or queued message whose response has not arrived yet. */
  readonly waitingMessage: Outgoing | null;
  /** Browser ms of the one pending retry per Reminder_Id (Requirement 13.8). */
  readonly retryAt: ReadonlyMap<string, number>;
  /** Browser ms of the next check after a `wait` response (design C8). */
  readonly recheckAt: ReadonlyMap<string, number>;
  readonly error: string | null;
}

export type Action =
  | { readonly type: 'send'; readonly body: string }
  | { readonly type: 'request-started'; readonly request: RequestType; readonly reminderId?: string }
  | {
      readonly type: 'response';
      readonly epoch: number;
      readonly request: RequestType;
      readonly response: SimulatorResponse;
      readonly browserNow: number;
    }
  | {
      readonly type: 'rate-limited';
      readonly epoch: number;
      readonly request: RequestType;
      readonly slowDown: string | null;
      readonly reminderId?: string;
      readonly browserNow: number;
    }
  | {
      readonly type: 'failed';
      readonly epoch: number;
      readonly request: RequestType;
      readonly reminderId?: string;
      readonly browserNow: number;
    }
  | { readonly type: 'invalid-snapshot'; readonly epoch: number; readonly nowMs: number }
  | { readonly type: 'drip-tick' }
  | { readonly type: 'new-session'; readonly nowMs: number };
