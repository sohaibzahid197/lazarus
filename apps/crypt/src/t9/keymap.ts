// T9 Key_Map (Glossary). Pure data, no browser API.

export type DigitKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type T9Key = DigitKey | '*' | '#';

export const DIGIT_KEYS: readonly DigitKey[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
export const T9_KEYS: readonly T9Key[] = [...DIGIT_KEYS, '*', '#'];

/** Lower-case Key_Map characters of each digit key, in multi-tap order. */
export const KEY_MAP: Readonly<Record<DigitKey, readonly string[]>> = {
  '1': ['.', ',', '?', '!', "'", '-', '1'],
  '2': ['a', 'b', 'c', '2'],
  '3': ['d', 'e', 'f', '3'],
  '4': ['g', 'h', 'i', '4'],
  '5': ['j', 'k', 'l', '5'],
  '6': ['m', 'n', 'o', '6'],
  '7': ['p', 'q', 'r', 's', '7'],
  '8': ['t', 'u', 'v', '8'],
  '9': ['w', 'x', 'y', 'z', '9'],
  '0': [' ', '0'],
};

export function isDigitKey(key: string): key is DigitKey {
  return key.length === 1 && key >= '0' && key <= '9';
}

const T9_CHARS: ReadonlySet<string> = new Set(
  DIGIT_KEYS.flatMap((k) => KEY_MAP[k].flatMap((c) => [c, c.toUpperCase()])),
);

/** True when every character of `text` appears in the Key_Map (either case). */
export function isT9Text(text: string): boolean {
  for (const ch of text) {
    if (!T9_CHARS.has(ch)) return false;
  }
  return true;
}
