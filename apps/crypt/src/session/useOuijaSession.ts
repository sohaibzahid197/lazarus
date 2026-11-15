// Effects of the Ouija_Simulator session (design section 4, C5–C8).
// The reducer stays pure; this hook owns the request, drip and pump timers,
// the one AbortController per epoch and New session. Browser only: no
// src/server import, no process.env, and nothing written to any storage (8.6).
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import type { SimulatorRequest } from '../protocol/wire.types';
import { isMessageBody } from '../ui/compose';
import { postOuija, type ApiEnv, type PostResult } from './api';
import { nextRequest, type NextRequest } from './outbox';
import { nextWakeDelay } from './reminderPump';
import { initialSession, sessionReducer } from './session.reducer';
import type { Action, SessionState } from './session.types';

/** Spacing between bubbles added from the drip queue (Requirements 11.1, 11.8). */
export const DRIP_INTERVAL_MS = 700;

/** Browser APIs the session uses; tests inject fake timers, a fake clock and a mocked fetch. */
export interface SessionEnv extends ApiEnv {
  readonly now: () => number;
}

export interface OuijaSession {
  readonly state: SessionState;
  /** Queues one `message` request; ignored while a message waits or the body is invalid. */
  readonly send: (body: string) => void;
  /** Session_Reset (Requirement 19.2): aborts, clears every timer, sends nothing. */
  readonly newSession: () => void;
}

export function defaultSessionEnv(): SessionEnv {
  return {
    now: () => Date.now(),
    fetch: (input, init) => globalThis.fetch(input, init),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    },
  };
}

interface InFlightRequest {
  readonly epoch: number;
  readonly controller: AbortController;
}

/** One timer slot: at most one pending timer of a kind at a time. */
interface TimerSlot {
  handle: unknown;
}

function clearSlot(env: SessionEnv, slot: TimerSlot): void {
  if (slot.handle !== null) env.clearTimeout(slot.handle);
  slot.handle = null;
}

function toRequest(next: Exclude<NextRequest, null>, state: SessionState): SimulatorRequest {
  return next.type === 'message'
    ? { type: 'message', body: next.body, snapshot: state.snapshot }
    : { type: 'deliver', reminderId: next.reminderId, snapshot: state.snapshot };
}

/** Maps a PostResult to the reducer action tagged with the request's epoch; `aborted` maps to none. */
export function actionForResult(
  result: PostResult,
  next: Exclude<NextRequest, null>,
  epoch: number,
  browserNow: number,
): Action | null {
  const request = next.type;
  const reminderId = next.type === 'deliver' ? next.reminderId : undefined;
  const tag = reminderId === undefined ? {} : { reminderId };
  switch (result.kind) {
    case 'ok':
      return { type: 'response', epoch, request, response: result.response, browserNow };
    case 'rate-limited':
      return { type: 'rate-limited', epoch, request, slowDown: result.slowDown, browserNow, ...tag };
    case 'failed':
      return { type: 'failed', epoch, request, browserNow, ...tag };
    case 'invalid-snapshot':
      return { type: 'invalid-snapshot', epoch, nowMs: browserNow };
    case 'aborted':
      return null;
  }
}

/** Request effect: starts the outbox's next request when nothing is in flight (C5, C6). */
function useRequestEffect(
  state: SessionState,
  dispatch: Dispatch<Action>,
  env: SessionEnv,
  current: { value: InFlightRequest | null },
  wake: number,
): void {
  useEffect(() => {
    const browserNow = env.now();
    const next = nextRequest(state, browserNow + state.clockOffset, browserNow);
    if (next === null || current.value !== null) return;
    const epoch = state.epoch;
    const controller = new AbortController();
    const mine: InFlightRequest = { epoch, controller };
    current.value = mine;
    dispatch(
      next.type === 'deliver'
        ? { type: 'request-started', request: 'deliver', reminderId: next.reminderId }
        : { type: 'request-started', request: 'message' },
    );
    void postOuija(toRequest(next, state), controller.signal, env).then((result) => {
      if (current.value === mine) current.value = null;
      const action = actionForResult(result, next, epoch, env.now());
      if (action !== null) dispatch(action);
    });
  }, [state, dispatch, env, current, wake]);
}

/** Drip effect: first item at once, then one every 700 ms, never closer than 700 ms (11.1, 11.8). */
function useDripEffect(
  state: SessionState,
  dispatch: Dispatch<Action>,
  env: SessionEnv,
  slot: TimerSlot,
  lastAdded: { value: number | null },
): void {
  const pending = state.drip.length;
  useEffect(() => {
    if (pending === 0 || slot.handle !== null) return;
    const last = lastAdded.value;
    const delay = last === null ? 0 : Math.max(0, last + DRIP_INTERVAL_MS - env.now());
    slot.handle = env.setTimeout(() => {
      slot.handle = null;
      lastAdded.value = env.now();
      dispatch({ type: 'drip-tick' });
    }, delay);
  }, [pending, dispatch, env, slot, lastAdded]);
}

/** Pump effect: one wake-up timer for the next Reminder check (C7); waking re-runs the request effect. */
function usePumpEffect(
  state: SessionState,
  env: SessionEnv,
  slot: TimerSlot,
  setWake: Dispatch<(n: number) => number>,
): void {
  useEffect(() => {
    clearSlot(env, slot);
    const browserNow = env.now();
    const delay = nextWakeDelay(state, browserNow + state.clockOffset, browserNow);
    if (delay === null) return;
    slot.handle = env.setTimeout(() => {
      slot.handle = null;
      setWake((n) => n + 1);
    }, delay);
  }, [state, env, slot, setWake]);
}

/** Owns the Simulator_Session: `useReducer(sessionReducer)` plus every effect of design section 4. */
export function useOuijaSession(envOverride?: SessionEnv): OuijaSession {
  const [env] = useState<SessionEnv>(() => envOverride ?? defaultSessionEnv());
  const [state, dispatch] = useReducer(sessionReducer, undefined, () => initialSession(env.now()));
  const [wake, setWake] = useState(0);
  const [current] = useState<{ value: InFlightRequest | null }>(() => ({ value: null }));
  const [dripSlot] = useState<TimerSlot>(() => ({ handle: null }));
  const [pumpSlot] = useState<TimerSlot>(() => ({ handle: null }));
  const [lastAdded] = useState<{ value: number | null }>(() => ({ value: null }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const stopAll = useCallback((): void => {
    current.value?.controller.abort();
    current.value = null;
    clearSlot(env, dripSlot);
    clearSlot(env, pumpSlot);
    lastAdded.value = null;
  }, [env, current, dripSlot, pumpSlot, lastAdded]);

  // Any Session_Reset (New session or an invalid-snapshot reset) bumps the
  // epoch: abort the old request and drop old timers (C6, 11.9, 13.12).
  const epoch = state.epoch;
  const seenEpoch = useRef(epoch);
  useEffect(() => {
    if (seenEpoch.current === epoch) return;
    seenEpoch.current = epoch;
    stopAll();
  }, [epoch, stopAll]);

  useEffect(() => stopAll, [stopAll]);

  useRequestEffect(state, dispatch, env, current, wake);
  useDripEffect(state, dispatch, env, dripSlot, lastAdded);
  usePumpEffect(state, env, pumpSlot, setWake);

  const send = useCallback((body: string): void => {
    if (stateRef.current.waitingMessage !== null || !isMessageBody(body)) return;
    dispatch({ type: 'send', body });
  }, []);

  const newSession = useCallback((): void => {
    stopAll();
    dispatch({ type: 'new-session', nowMs: env.now() });
  }, [env, stopAll]);

  return { state, send, newSession };
}
