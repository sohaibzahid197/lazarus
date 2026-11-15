'use client';
// Compose_Field with its `n/480` counter and length message
// (Requirements 2.6, 3.1, 5.1–5.8). Presentational: the parent owns the text,
// the T9State, the Input_Mode and the length warning, and decides in `onSend`
// whether a Message_Body can be sent. Styles come from globals.css.
import { useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { MAX_BODY_UNITS } from '../protocol/limits';
import { pendingOf, type T9State } from '../t9/t9.step';
import { composeUnits, truncateCompose } from './compose';
import { hasUrdu, textDirection } from './direction';
import { LENGTH_LIMIT_TEXT } from './texts';

export type InputMode = 'keypad' | 'keyboard';

export interface ComposeFieldProps {
  readonly inputMode: InputMode;
  /** Committed Compose_Field text. */
  readonly text: string;
  /** Supplies the Pending_Character in Keypad_Input. */
  readonly t9: T9State;
  readonly lengthWarning: boolean;
  /** Keyboard_Input edit; `truncated` is true when 5.4 cut the text. */
  readonly onTextChange: (text: string, truncated: boolean) => void;
  /** Enter without Shift, outside an IME composition (5.2, 5.7, 5.8). */
  readonly onSend: () => void;
  /**
   * The Keypad_Input field got focus (click, tap or Tab): switch to
   * Keyboard_Input so physical typing always works. The T9 keypad buttons
   * still switch back to Keypad_Input when clicked.
   */
  readonly onKeyboardFocus: () => void;
}

const COUNTER_ID = 'compose-counter';
const WARNING_ID = 'compose-warning';

export function ComposeField({
  inputMode,
  text,
  t9,
  lengthWarning,
  onTextChange,
  onSend,
  onKeyboardFocus,
}: ComposeFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pending = inputMode === 'keypad' ? pendingOf(t9) : null;
  const shown = text + (pending ?? '');
  const units = pending === null ? text.length : composeUnits(text, t9);
  const describedBy = lengthWarning ? `${COUNTER_ID} ${WARNING_ID}` : COUNTER_ID;

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    const next = truncateCompose(raw);
    onTextChange(next, next.length < raw.length);
  };

  // Render the textarea in the same event, then focus it with the caret at the
  // end. Focusing inside the user's gesture lets mobile browsers open the
  // on-screen keyboard.
  const handleKeypadFieldFocus = () => {
    flushSync(onKeyboardFocus);
    const area = textareaRef.current;
    if (area === null) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // Let the input method editor finish its composition (5.7).
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    onSend();
  };

  return (
    <div className="compose">
      {inputMode === 'keyboard' ? (
        <textarea
          ref={textareaRef}
          className="compose__field"
          aria-label="Message"
          aria-describedby={describedBy}
          dir="auto"
          lang={hasUrdu(text) ? 'ur' : undefined}
          rows={3}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div
          className="compose__field"
          role="textbox"
          aria-multiline="true"
          aria-label="Message"
          aria-describedby={describedBy}
          tabIndex={0}
          onFocus={handleKeypadFieldFocus}
          dir={textDirection(shown)}
          lang={hasUrdu(shown) ? 'ur' : undefined}
        >
          {text}
          {pending !== null && <u className="compose__pending">{pending}</u>}
        </div>
      )}
      <p id={COUNTER_ID} className="compose__counter">
        {`${String(units)}/${String(MAX_BODY_UNITS)}`}
      </p>
      {lengthWarning && (
        <p id={WARNING_ID} className="compose__warning">
          {LENGTH_LIMIT_TEXT}
        </p>
      )}
    </div>
  );
}
