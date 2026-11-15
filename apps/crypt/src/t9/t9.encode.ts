// T9_Encoder (Requirement 4.7, 4.8): turns a T9_Text into Key_Events that
// `decodeT9` from Lower_Case Letter_Mode decodes back to the same text
// (committed text + Pending_Character). Pure, no browser API or clock.
import { DIGIT_KEYS, KEY_MAP, type DigitKey } from './keymap';
import { MULTI_TAP_TIMEOUT_MS, type KeyEvent, type LetterCase } from './t9.step';

export type EncodeResult =
  | { readonly ok: true; readonly events: readonly KeyEvent[] }
  | { readonly ok: false; readonly error: 'not-t9-text' | 'too-long' };

export const MAX_ENCODE_CHARS = 200;
/** Spacing of presses inside one group, and after a group or `*`. */
const PRESS_GAP_MS = 100;

interface KeySpot {
  readonly key: DigitKey;
  readonly presses: number;
}

/** Lower-case Key_Map character → key and number of presses. */
const SPOTS: ReadonlyMap<string, KeySpot> = new Map(
  DIGIT_KEYS.flatMap((key) => KEY_MAP[key].map((ch, i) => [ch, { key, presses: i + 1 }] as const)),
);

function caseOf(ch: string): LetterCase | null {
  const lower = ch.toLowerCase();
  if (lower === ch.toUpperCase()) return null; // digit, space or punctuation
  return ch === lower ? 'lower' : 'upper';
}

/** Encode a T9_Text of 0 to 200 characters, starting in Lower_Case Letter_Mode. */
export function encodeT9(text: string): EncodeResult {
  // Code points, not UTF-16 units, so an emoji counts as 1 character.
  const chars = Array.from(text);
  if (chars.length > MAX_ENCODE_CHARS) return { ok: false, error: 'too-long' };
  const events: KeyEvent[] = [];
  let t = 0;
  let letterCase: LetterCase = 'lower';
  let prevKey: DigitKey | null = null;
  for (const ch of chars) {
    const spot = SPOTS.get(ch.toLowerCase());
    if (spot === undefined) return { ok: false, error: 'not-t9-text' };
    const c = caseOf(ch);
    if (c !== null && c !== letterCase) {
      events.push({ key: '*', at: t });
      letterCase = c;
      t += PRESS_GAP_MS;
      prevKey = null; // `*` commits the group, so no extra gap is needed
    }
    if (spot.key === prevKey) t += MULTI_TAP_TIMEOUT_MS; // start a new group on the same key
    for (let p = 0; p < spot.presses; p++) {
      events.push({ key: spot.key, at: t });
      t += PRESS_GAP_MS;
    }
    prevKey = spot.key;
  }
  return { ok: true, events };
}
