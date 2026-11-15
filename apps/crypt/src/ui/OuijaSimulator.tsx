'use client';
// Root of the Ouija_Simulator (Requirements 2.1–2.3, 3.3, 3.11, 3.12, 6.1–6.3, 19.2).
// The session (requests, drip, reminders, epoch) lives in useOuijaSession.
// This component holds the Phone_Mock local state: compose text, T9State,
// Input_Mode and the length message, plus the 1,000 ms Multi_Tap_Timeout timer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { phoneState, sendDisabled } from '../session/session.reducer';
import type { Bubble } from '../session/session.types';
import { useOuijaSession } from '../session/useOuijaSession';
import type { T9Key } from '../t9/keymap';
import { INITIAL_T9_STATE, MULTI_TAP_TIMEOUT_MS, pendingOf, type T9State } from '../t9/t9.step';
import { clearLast, isMessageBody, switchInputMode, truncateCompose } from './compose';
import type { InputMode } from './ComposeField';
import { Examples } from './ExampleList';
import { flushPending, nextLengthWarning, pressKey } from './keypadInput';
import { PhoneMock } from './PhoneMock';

interface Compose {
  readonly inputMode: InputMode;
  readonly text: string;
  readonly t9: T9State;
  readonly lengthWarning: boolean;
}

const INITIAL_COMPOSE: Compose = {
  inputMode: 'keypad',
  text: '',
  t9: INITIAL_T9_STATE,
  lengthWarning: false,
};

/** Id of the newest reply or Reminder part; restarts the heartbeat pulse (14.7). */
function lastPartId(bubbles: readonly Bubble[]): number {
  for (let i = bubbles.length - 1; i >= 0; i -= 1) {
    const b = bubbles[i];
    if (b !== undefined && (b.kind === 'part' || b.kind === 'reminder-part')) return b.id;
  }
  return 0;
}

function withText(c: Compose, text: string, t9: T9State, limited: boolean): Compose {
  return { ...c, text, t9, lengthWarning: nextLengthWarning(c.lengthWarning, text, limited) };
}

/** Multi_Tap_Timeout timer: one at a time, restarted on each key press (3.3). */
function useTapTimer(onFire: () => void): { readonly restart: () => void; readonly stop: () => void } {
  const handle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    if (handle.current !== null) clearTimeout(handle.current);
    handle.current = null;
  }, []);
  const restart = useCallback(() => {
    stop();
    handle.current = setTimeout(() => {
      handle.current = null;
      onFire();
    }, MULTI_TAP_TIMEOUT_MS);
  }, [onFire, stop]);
  useEffect(() => stop, [stop]);
  return { restart, stop };
}

export function OuijaSimulator() {
  const { state, send, newSession } = useOuijaSession();
  const [compose, setCompose] = useState<Compose>(INITIAL_COMPOSE);
  const composeRef = useRef(compose);
  // Reads and writes go through the ref so two presses in one frame see each other.
  const update = useCallback((fn: (c: Compose) => Compose) => {
    const next = fn(composeRef.current);
    composeRef.current = next;
    setCompose(next);
  }, []);

  const flush = useCallback(() => {
    update((c) => {
      const edit = flushPending(c.text, c.t9);
      return withText(c, edit.text, edit.t9, edit.dropped);
    });
  }, [update]);
  const timer = useTapTimer(flush);

  const onKey = useCallback(
    (key: T9Key, at: number) => {
      const c = composeRef.current;
      const edit = pressKey(c.text, c.t9, { key, at });
      // A keypad press while typing with the keyboard switches back to Keypad_Input.
      update(() => ({ ...withText(c, edit.text, edit.t9, edit.dropped), inputMode: 'keypad' }));
      if (pendingOf(edit.t9) !== null) timer.restart();
      else timer.stop();
    },
    [timer, update],
  );

  const onTextChange = useCallback(
    (text: string, truncated: boolean) => {
      update((c) => withText(c, text, c.t9, truncated));
    },
    [update],
  );

  const onToggleInputMode = useCallback(() => {
    timer.stop();
    update((c) => {
      const edit = switchInputMode(c.text, c.t9);
      const next = withText(c, edit.text, edit.t9, false);
      return { ...next, inputMode: c.inputMode === 'keypad' ? 'keyboard' : 'keypad' };
    });
  }, [timer, update]);

  const onClear = useCallback(() => {
    timer.stop();
    update((c) => {
      const edit = clearLast(c.text, c.t9);
      return withText(c, edit.text, edit.t9, false);
    });
  }, [timer, update]);

  const onSend = useCallback(() => {
    timer.stop();
    const c = composeRef.current;
    const edit = flushPending(c.text, c.t9);
    const ready = isMessageBody(edit.text) && !sendDisabled(state, true);
    if (!ready) {
      update(() => withText(c, edit.text, edit.t9, edit.dropped));
      return;
    }
    send(edit.text);
    update(() => ({ ...c, text: '', t9: edit.t9, lengthWarning: false }));
  }, [send, state, timer, update]);

  const onNewSession = useCallback(() => {
    timer.stop();
    newSession();
    update(() => INITIAL_COMPOSE);
  }, [newSession, timer, update]);

  const onExample = useCallback(
    (text: string) => {
      timer.stop();
      update((c) => {
        const next = truncateCompose(text);
        // Discard any Pending_Character (Requirement 2.3).
        return withText(c, next, { ...c.t9, group: null }, next.length < text.length);
      });
    },
    [timer, update],
  );

  const pending = compose.inputMode === 'keypad' ? (pendingOf(compose.t9) ?? '') : '';
  return (
    <main className="simulator">
      <h1 className="simulator__title">Ouija simulator</h1>
      <PhoneMock
        phoneState={phoneState(state)}
        error={state.error}
        bubbles={state.bubbles}
        stopped={state.snapshot.stopped}
        repliesLeft={state.repliesLeft}
        activeReminders={state.snapshot.reminders.length}
        pulseKey={lastPartId(state.bubbles)}
        inputMode={compose.inputMode}
        text={compose.text}
        t9={compose.t9}
        lengthWarning={compose.lengthWarning}
        sendDisabled={sendDisabled(state, isMessageBody(compose.text + pending))}
        onTextChange={onTextChange}
        onToggleInputMode={onToggleInputMode}
        onKey={onKey}
        onClear={onClear}
        onSend={onSend}
        onNewSession={onNewSession}
      />
      <Examples setCompose={onExample} />
    </main>
  );
}
