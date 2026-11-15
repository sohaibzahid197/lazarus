// Pure reducer of the Ouija_Simulator Session_State (design section 4).
// No browser API, timer, fetch or src/server import: effects live in useOuijaSession.
import { DEFAULT_SETTINGS, GATEWAY_TEXTS } from '@lazarus/brain';
import type { Language } from '@lazarus/brain';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorResponse } from '../protocol/wire.types';
import {
  CONNECTION_ERROR_TEXT,
  NEW_SESSION_TEXT,
  REPLY_LIMIT_NOTE,
  SESSION_RESET_TEXT,
  type PhoneStateName,
} from '../ui/texts';
import { noteForDelivery, noteForOutcome } from './outcomeNotes';
import type {
  Action,
  Bubble,
  DripItem,
  LanguageLabel,
  RequestType,
  SessionState,
} from './session.types';

/** Wait before retrying a failed or rate-limited `deliver` (Requirement 13.8). */
export const DELIVER_RETRY_MS = 60_000;
/** Floor for the next check after a `wait` response (design C8). */
export const RECHECK_FLOOR_MS = 1_000;

const LANGUAGE_LABELS: Readonly<Record<Language, LanguageLabel>> = {
  en: 'English',
  ur: 'Urdu',
  'roman-ur': 'Roman Urdu',
};

/** Session_State of a new Simulator_Session on page load (Requirement 8.5, 19.7). */
export function initialSession(nowMs: number): SessionState {
  return {
    epoch: 0,
    snapshot: emptySnapshot(nowMs),
    repliesLeft: DEFAULT_SETTINGS.perNumberLimit,
    clockOffset: 0,
    bubbles: [],
    nextBubbleId: 1,
    drip: [],
    inFlight: null,
    waitingMessage: null,
    retryAt: new Map(),
    recheckAt: new Map(),
    error: null,
  };
}

/** Session_Reset (Requirement 19.2 a–j): everything cleared, `note` is the only bubble. */
export function resetSession(state: SessionState, nowMs: number, note: string): SessionState {
  return {
    epoch: state.epoch + 1,
    snapshot: emptySnapshot(nowMs),
    repliesLeft: DEFAULT_SETTINGS.perNumberLimit,
    clockOffset: state.clockOffset,
    bubbles: [{ id: state.nextBubbleId, kind: 'note', text: note }],
    nextBubbleId: state.nextBubbleId + 1,
    drip: [],
    inFlight: null,
    waitingMessage: null,
    retryAt: new Map(),
    recheckAt: new Map(),
    error: null,
  };
}

function addBubble(state: SessionState, item: DripItem): SessionState {
  const bubble: Bubble = { ...item, id: state.nextBubbleId };
  return { ...state, bubbles: [...state.bubbles, bubble], nextBubbleId: state.nextBubbleId + 1 };
}

function partItems(response: SimulatorResponse): DripItem[] {
  const total = response.parts.length;
  const isMessage = response.kind === 'message';
  return response.parts.map((part, i): DripItem => {
    const first = i === 0;
    const base: DripItem = {
      kind: isMessage ? 'part' : 'reminder-part',
      text: part.text,
      badge: {
        n: i + 1,
        total,
        encoding: response.encoding,
        units: part.units,
        limit: part.limit,
      },
    };
    if (!first) return base;
    return isMessage
      ? { ...base, languageLabel: LANGUAGE_LABELS[response.language] }
      : { ...base, reminderLabel: true };
  });
}

function messageItems(response: SimulatorResponse): DripItem[] {
  if (response.parts.length === 0) {
    return [{ kind: 'note', text: noteForOutcome(response.outcome) }];
  }
  const items = partItems(response);
  if (response.outcome === 'rate-limited' && response.parts.length === 1) {
    items.push({ kind: 'note', text: REPLY_LIMIT_NOTE });
  }
  return items;
}

function deliverItems(response: SimulatorResponse): DripItem[] {
  if (response.parts.length > 0) return partItems(response);
  if (response.deliveryOutcome === null) return [];
  return [{ kind: 'note', text: noteForDelivery(response.deliveryOutcome) }];
}

function keepIds(
  times: ReadonlyMap<string, number>,
  snapshot: SessionSnapshot,
  drop: string | undefined,
): Map<string, number> {
  const ids = new Set(snapshot.reminders.map((r) => r.id));
  const kept = new Map<string, number>();
  for (const [id, at] of times) {
    if (ids.has(id) && id !== drop) kept.set(id, at);
  }
  return kept;
}

function applyResponse(
  state: SessionState,
  request: RequestType,
  response: SimulatorResponse,
  browserNow: number,
): SessionState {
  const clockOffset = response.serverTime - browserNow;
  const snapshot = response.snapshot;
  const deliveredId = request === 'deliver' ? state.inFlight?.reminderId : undefined;
  const retryAt = keepIds(state.retryAt, snapshot, deliveredId);
  const recheckAt = keepIds(state.recheckAt, snapshot, deliveredId);
  if (request === 'deliver' && deliveredId !== undefined) {
    const waiting =
      response.parts.length === 0 && response.deliveryOutcome === null
        ? snapshot.reminders.find((r) => r.id === deliveredId)
        : undefined;
    if (waiting !== undefined) {
      recheckAt.set(deliveredId, Math.max(waiting.dueAt - clockOffset, browserNow + RECHECK_FLOOR_MS));
    }
  }
  const items = request === 'message' ? messageItems(response) : deliverItems(response);
  return {
    ...state,
    snapshot,
    repliesLeft: response.repliesLeft,
    clockOffset,
    inFlight: null,
    waitingMessage: request === 'message' ? null : state.waitingMessage,
    drip: [...state.drip, ...items],
    retryAt,
    recheckAt,
  };
}

function scheduleRetry(state: SessionState, reminderId: string | undefined, browserNow: number): SessionState {
  const id = reminderId ?? state.inFlight?.reminderId;
  const retryAt = new Map(state.retryAt);
  if (id !== undefined && state.snapshot.reminders.some((r) => r.id === id)) {
    retryAt.set(id, browserNow + DELIVER_RETRY_MS);
  }
  return { ...state, inFlight: null, retryAt };
}

function applyRateLimited(
  state: SessionState,
  request: RequestType,
  slowDown: string | null,
  reminderId: string | undefined,
  browserNow: number,
): SessionState {
  if (request === 'deliver') return scheduleRetry(state, reminderId, browserNow);
  const text = slowDown ?? GATEWAY_TEXTS.en.slowDown;
  return {
    ...state,
    inFlight: null,
    waitingMessage: null,
    drip: [...state.drip, { kind: 'note', text, urgent: true }],
  };
}

function applyFailed(
  state: SessionState,
  request: RequestType,
  reminderId: string | undefined,
  browserNow: number,
): SessionState {
  if (request === 'deliver') return scheduleRetry(state, reminderId, browserNow);
  return {
    ...state,
    inFlight: null,
    waitingMessage: null,
    error: CONNECTION_ERROR_TEXT,
    drip: [...state.drip, { kind: 'note', text: CONNECTION_ERROR_TEXT, urgent: true }],
  };
}

/** Pure reducer; every epoch-tagged action from an old epoch is dropped (design C6). */
export function sessionReducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'send':
      return {
        ...addBubble(state, { kind: 'outgoing', text: action.body }),
        waitingMessage: { type: 'message', body: action.body },
        error: null,
      };
    case 'request-started':
      return {
        ...state,
        inFlight:
          action.reminderId === undefined
            ? { type: action.request }
            : { type: action.request, reminderId: action.reminderId },
      };
    case 'response':
      if (action.epoch !== state.epoch) return state;
      return applyResponse(state, action.request, action.response, action.browserNow);
    case 'rate-limited':
      if (action.epoch !== state.epoch) return state;
      return applyRateLimited(state, action.request, action.slowDown, action.reminderId, action.browserNow);
    case 'failed':
      if (action.epoch !== state.epoch) return state;
      return applyFailed(state, action.request, action.reminderId, action.browserNow);
    case 'invalid-snapshot':
      if (action.epoch !== state.epoch) return state;
      return resetSession(state, action.nowMs, SESSION_RESET_TEXT);
    case 'drip-tick': {
      const [first, ...rest] = state.drip;
      if (first === undefined) return state;
      return { ...addBubble(state, first), drip: rest };
    }
    case 'new-session':
      return resetSession(state, action.nowMs, NEW_SESSION_TEXT);
  }
}

/** The one Phone_Mock state, by precedence SENDING, ERROR, SLEEPING, ALIVE (Requirement 14.2). */
export function phoneState(s: SessionState): PhoneStateName {
  if (s.inFlight !== null || s.waitingMessage !== null || s.drip.length > 0) return 'SENDING';
  if (s.error !== null) return 'ERROR';
  if (s.snapshot.stopped) return 'SLEEPING';
  return 'ALIVE';
}

/** Send_Key disabled state (Requirements 6.2, 6.3, 11.5). */
export function sendDisabled(s: SessionState, composeHasBody: boolean): boolean {
  if (!composeHasBody || s.waitingMessage !== null) return true;
  return s.drip.some((item) => item.kind === 'part');
}
