// Test-only reference T9_Decoder (Property 1, Property 4). Written as an
// explicit list of character groups straight from Requirements 4.2–4.5, with
// its own copy of the Key_Map, and independent of `stepT9`.
import type { KeyEvent, LetterCase, T9Mode } from '../t9/t9.step';

/** Glossary Key_Map, lower case, restated here so the reference does not share KEY_MAP. */
const KEYS: Readonly<Record<string, string>> = {
  '1': ".,?!'-1", '2': 'abc2', '3': 'def3', '4': 'ghi4', '5': 'jkl5',
  '6': 'mno6', '7': 'pqrs7', '8': 'tuv8', '9': 'wxyz9', '0': ' 0',
};

interface RefGroup {
  readonly key: string;
  presses: number;
  lastAt: number;
  readonly letterCase: LetterCase;
}

export interface ReferenceDecode {
  readonly text: string;
  readonly mode: T9Mode;
  readonly pending: string | null;
  /** Letter_Mode character groups opened (4.2, 4.3), for Property 4. */
  readonly groups: number;
}

function groupChar(g: RefGroup): string {
  const chars = (KEYS[g.key] ?? '').split(''); // all Key_Map characters are single UTF-16 units
  const ch = chars[(g.presses - 1) % chars.length] ?? '';
  return g.letterCase === 'upper' ? ch.toUpperCase() : ch;
}

/** Decode valid Key_Events (non-decreasing integer times) from `start`, with no final flush. */
export function referenceDecodeT9(events: readonly KeyEvent[], start: T9Mode): ReferenceDecode {
  const items: (string | RefGroup)[] = []; // Number_Mode digits and Letter_Mode groups, in order
  let entry = start.entry;
  let letterCase = start.letterCase;
  let open: RefGroup | null = null; // last item of `items` while its group is still open
  let groups = 0;
  for (const e of events) {
    if (e.key === '*' || e.key === '#') {
      open = null; // commit first (4.4)
      if (e.key === '*') letterCase = letterCase === 'lower' ? 'upper' : 'lower';
      else entry = entry === 'letter' ? 'number' : 'letter';
    } else if (entry === 'number') {
      items.push(e.key); // once per press, whatever the time (4.4)
    } else if (open !== null && open.key === e.key && e.at - open.lastAt < 1_000) {
      open.presses += 1; // same key within the Multi_Tap_Timeout (4.2)
      open.lastAt = e.at;
    } else {
      open = { key: e.key, presses: 1, lastAt: e.at, letterCase }; // new group (4.3)
      items.push(open);
      groups += 1;
    }
  }
  const committed = items.filter((it) => it !== open);
  return {
    text: committed.map((it) => (typeof it === 'string' ? it : groupChar(it))).join(''),
    mode: { entry, letterCase },
    pending: open === null ? null : groupChar(open),
    groups,
  };
}
