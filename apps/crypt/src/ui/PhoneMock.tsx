'use client';
// The Phone_Mock (Requirements 2.1, 2.6, 2.8, 3.7, 13.10, 14.1–14.5, 16.1, 19.1).
// Presentational: OuijaSimulator owns the session and the compose state.
// DOM order is the tab order of 16.1: Compose_Field, Input_Mode control,
// keypad keys, Clear, Send, New session. The Phone_Screen thread before them
// is focusable only so keyboard users can scroll a long thread.
import { DEFAULT_SETTINGS } from '@lazarus/brain';
import type { Bubble as BubbleData } from '../session/session.types';
import type { T9Key } from '../t9/keymap';
import type { T9State } from '../t9/t9.step';
import { Announcer } from './Announcer';
import { ComposeField, type InputMode } from './ComposeField';
import { Heartbeat } from './Heartbeat';
import { Keypad } from './Keypad';
import { modeIndicator } from './keypadInput';
import { PhoneScreen } from './PhoneScreen';
import { RepliesLeft } from './RepliesLeft';
import { StopBanner } from './StopBanner';
import {
  CONTROL_LABELS,
  NO_REPLIES_LEFT_HINT,
  REMINDERS_TAB_NOTE,
  activeRemindersText,
  repliesLeftText,
  type PhoneStateName,
} from './texts';

export interface PhoneMockProps {
  readonly phoneState: PhoneStateName;
  readonly error: string | null;
  readonly bubbles: readonly BubbleData[];
  readonly stopped: boolean;
  readonly repliesLeft: number;
  readonly activeReminders: number;
  /** Changes once per added reply or Reminder part (Requirement 14.7). */
  readonly pulseKey: number;
  readonly inputMode: InputMode;
  readonly text: string;
  readonly t9: T9State;
  readonly lengthWarning: boolean;
  readonly sendDisabled: boolean;
  readonly onTextChange: (text: string, truncated: boolean) => void;
  readonly onToggleInputMode: () => void;
  readonly onKey: (key: T9Key, at: number) => void;
  readonly onClear: () => void;
  readonly onSend: () => void;
  readonly onNewSession: () => void;
}

/** Text the Announcer reads when Replies_Left changes (Requirement 19.11). */
export function repliesAnnouncement(repliesLeft: number): string {
  const count = repliesLeftText(repliesLeft, DEFAULT_SETTINGS.perNumberLimit);
  return repliesLeft === 0 ? `${count}. ${NO_REPLIES_LEFT_HINT}` : count;
}

export function PhoneMock(props: PhoneMockProps) {
  const { phoneState, inputMode, t9 } = props;
  const mode = inputMode === 'keypad' ? modeIndicator(t9.mode) : null;
  const otherMode = inputMode === 'keypad' ? CONTROL_LABELS.keyboardMode : CONTROL_LABELS.keypadMode;
  return (
    <section
      className={`phone phone--${phoneState.toLowerCase()}`}
      aria-label="Phone"
      data-state={phoneState}
    >
      <div className="phone__status">
        <Heartbeat state={phoneState} pulseKey={props.pulseKey} />
        {phoneState === 'ERROR' && props.error !== null && <p className="phone__error">{props.error}</p>}
      </div>
      <PhoneScreen
        bubbles={props.bubbles}
        header={
          mode !== null && (
            <p className="phone__mode">
              <span className="visually-hidden">Keypad mode: </span>
              {mode}
            </p>
          )
        }
        banner={<StopBanner stopped={props.stopped} />}
      />
      <ComposeField
        inputMode={inputMode}
        text={props.text}
        t9={t9}
        lengthWarning={props.lengthWarning}
        onTextChange={props.onTextChange}
        onSend={props.onSend}
      />
      <div className="phone__controls">
        <button
          type="button"
          className="phone__button"
          aria-describedby="input-mode-hint"
          onClick={props.onToggleInputMode}
        >
          <span className="visually-hidden">Input: </span>
          {inputMode === 'keypad' ? CONTROL_LABELS.keypadMode : CONTROL_LABELS.keyboardMode}
        </button>
        <span id="input-mode-hint" className="visually-hidden">
          {`Press to switch to ${otherMode}`}
        </span>
      </div>
      <Keypad letterCase={t9.mode.letterCase} onKey={props.onKey} onClear={props.onClear} onSend={props.onSend} />
      <div className="phone__controls">
        <button type="button" className="phone__button" onClick={props.onClear}>
          {CONTROL_LABELS.clear}
        </button>
        <button
          type="button"
          className="phone__button phone__button--send"
          disabled={props.sendDisabled}
          onClick={props.onSend}
        >
          {CONTROL_LABELS.send}
        </button>
        <button type="button" className="phone__button" onClick={props.onNewSession}>
          {CONTROL_LABELS.newSession}
        </button>
      </div>
      <div className="phone__meta">
        <RepliesLeft repliesLeft={props.repliesLeft} />
        <p>{activeRemindersText(props.activeReminders)}</p>
        <p className="phone__reminders-note">{REMINDERS_TAB_NOTE}</p>
      </div>
      <Announcer bubbles={props.bubbles} mode={mode} repliesText={repliesAnnouncement(props.repliesLeft)} />
    </section>
  );
}
