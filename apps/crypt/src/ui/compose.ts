// Pure Compose_Field helpers used by ComposeField, Keypad and PhoneMock.
// `text` is the committed Compose_Field text. The T9State supplies only the
// Pending_Character (its open group); its own `committed` field is not read.
import { MAX_BODY_UNITS } from '../protocol/limits';
import { pendingOf, type T9State } from '../t9/t9.step';

export interface ComposeEdit {
  readonly text: string;
  readonly t9: T9State;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Drop the open group, so no Pending_Character is shown. */
function withoutPending(t9: T9State): T9State {
  return t9.group === null ? t9 : { ...t9, group: null };
}

/**
 * Keep at most MAX_BODY_UNITS UTF-16 code units, or one fewer when the last
 * kept unit would be a lone high surrogate (Requirement 5.4).
 */
export function truncateCompose(text: string): string {
  if (text.length <= MAX_BODY_UNITS) return text;
  const cut = isHighSurrogate(text.charCodeAt(MAX_BODY_UNITS - 1)) ? MAX_BODY_UNITS - 1 : MAX_BODY_UNITS;
  return text.slice(0, cut);
}

/**
 * Clear_Key (Requirement 3.8): remove the Pending_Character if one is shown,
 * otherwise the last code point of the text (a surrogate pair as a whole).
 */
export function clearLast(text: string, t9: T9State): ComposeEdit {
  if (pendingOf(t9) !== null) return { text, t9: withoutPending(t9) };
  if (text.length === 0) return { text, t9 };
  const end = text.length;
  const pair =
    end >= 2 && isLowSurrogate(text.charCodeAt(end - 1)) && isHighSurrogate(text.charCodeAt(end - 2));
  return { text: text.slice(0, pair ? end - 2 : end - 1), t9 };
}

/**
 * Input_Mode switch (Requirement 5.3): commit the Pending_Character to the end
 * of the text and change nothing else. The T9 mode and case are kept.
 */
export function switchInputMode(text: string, t9: T9State): ComposeEdit {
  const pending = pendingOf(t9);
  if (pending === null) return { text, t9 };
  return { text: text + pending, t9: withoutPending(t9) };
}

/** Counter value `n` of `n/480`: text plus any Pending_Character (Requirement 2.6). */
export function composeUnits(text: string, t9: T9State): number {
  return text.length + (pendingOf(t9)?.length ?? 0);
}

/** Message_Body: 1 to MAX_BODY_UNITS code units with a non-whitespace character. */
export function isMessageBody(text: string): boolean {
  return text.length >= 1 && text.length <= MAX_BODY_UNITS && /\S/u.test(text);
}
