// Unit tests for the Reminder_Store_Model (sms-reminders task 2.5).
// Validates: Requirements 5.1, 5.13, 7.5, 7.6, 8.2
import { describe, expect, it } from 'vitest';
import { isCanonicalNumber } from './gateway.number.js';
import type { CanonicalNumber } from './gateway.types.js';
import {
  activeFor,
  applyReminderChange,
  dueReminders,
  findBySlot,
  lowestFreeSlot,
  nextDueAt,
  type ReminderChange,
} from './reminder.store.js';
import {
  EMPTY_REMINDERS,
  type Reminder,
  type ReminderId,
  type ReminderSlot,
  type ReminderState,
} from './reminder.types.js';

const num = (s: string): CanonicalNumber => {
  if (!isCanonicalNumber(s)) throw new Error(`not canonical: ${s}`);
  return s;
};

const isReminderId = (id: string): id is ReminderId => id.startsWith('r:');
const rid = (s: string): ReminderId => {
  const id = `r:${s}`;
  if (!isReminderId(id)) throw new Error(`not a reminder id: ${id}`);
  return id;
};

const A = num('+923001234567');
const B = num('+923007654321');
const T0 = 1_736_917_200_000; // 2025-01-15T05:00:00Z

function rem(
  id: string,
  slot: ReminderSlot,
  dueAt: number,
  opts: { number?: CanonicalNumber; handedAt?: number | null } = {},
): Reminder {
  return {
    id: rid(id),
    number: opts.number ?? A,
    slot,
    dueAt,
    text: `text ${id}`,
    language: 'en',
    createdAt: T0,
    handedAt: opts.handedAt ?? null,
  };
}

const ok = (reminders: readonly Reminder[]): ReminderState => ({ status: 'ok', reminders });
const UNREADABLE: ReminderState = { status: 'unreadable' };

const listOf = (state: ReminderState): readonly Reminder[] =>
  state.status === 'ok' ? state.reminders : [];

describe('lowestFreeSlot', () => {
  it('returns 1 for no reminders', () => {
    expect(lowestFreeSlot([])).toBe(1);
  });

  it('returns the lowest gap', () => {
    expect(lowestFreeSlot([rem('a', 1, T0), rem('c', 3, T0)])).toBe(2);
    expect(lowestFreeSlot([rem('b', 2, T0), rem('e', 5, T0)])).toBe(1);
    expect(lowestFreeSlot([rem('a', 1, T0), rem('b', 2, T0), rem('d', 4, T0)])).toBe(3);
  });

  it('returns null when all 5 slots are used', () => {
    const five = ([1, 2, 3, 4, 5] as const).map((s) => rem(`x${String(s)}`, s, T0));
    expect(lowestFreeSlot(five)).toBeNull();
  });
});

describe('activeFor and findBySlot', () => {
  it('filters by number and finds by slot', () => {
    const state = ok([rem('a1', 1, T0), rem('b1', 1, T0, { number: B }), rem('a2', 2, T0)]);
    const active = activeFor(state, A);
    expect(active.map((r) => r.id)).toEqual([rid('a1'), rid('a2')]);
    expect(findBySlot(active, 2)?.id).toBe(rid('a2'));
    expect(findBySlot(active, 3)).toBeNull();
    expect(findBySlot(active, 0)).toBeNull();
    expect(findBySlot(active, 6)).toBeNull();
  });

  it('is empty for an unreadable store', () => {
    expect(activeFor(UNREADABLE, A)).toEqual([]);
  });
});

describe('applyReminderChange reminder-add', () => {
  it('adds a reminder to an empty store', () => {
    const r = rem('a', 1, T0 + 1000);
    const next = applyReminderChange(EMPTY_REMINDERS, { type: 'reminder-add', reminder: r });
    expect(listOf(next)).toEqual([r]);
  });

  it('ignores an add on a used slot', () => {
    const start = ok([rem('a', 2, T0)]);
    const next = applyReminderChange(start, { type: 'reminder-add', reminder: rem('b', 2, T0) });
    expect(listOf(next)).toEqual(listOf(start));
  });

  it('allows the same slot for a different number', () => {
    const start = ok([rem('a', 2, T0)]);
    const other = rem('b', 2, T0, { number: B });
    const next = applyReminderChange(start, { type: 'reminder-add', reminder: other });
    expect(listOf(next)).toHaveLength(2);
  });

  it('ignores a sixth reminder for one number', () => {
    const five = ([1, 2, 3, 4, 5] as const).map((s) => rem(`x${String(s)}`, s, T0));
    const start = ok(five);
    // Every slot 1 to 5 is taken, so a sixth add for this number cannot land anywhere.
    const next = applyReminderChange(start, { type: 'reminder-add', reminder: rem('six', 1, T0) });
    expect(listOf(next)).toEqual(five);
    expect(activeFor(next, A)).toHaveLength(5);
  });

  it('ignores an add with an existing id', () => {
    const start = ok([rem('a', 1, T0)]);
    const next = applyReminderChange(start, { type: 'reminder-add', reminder: rem('a', 2, T0) });
    expect(listOf(next)).toEqual(listOf(start));
  });
});

describe('applyReminderChange removals and handed', () => {
  it('reminder-remove deletes only that id', () => {
    const start = ok([rem('a', 1, T0), rem('b', 2, T0)]);
    const next = applyReminderChange(start, { type: 'reminder-remove', id: rid('a') });
    expect(listOf(next).map((r) => r.id)).toEqual([rid('b')]);
  });

  it('reminder-remove-all removes one number and keeps other numbers', () => {
    const b1 = rem('b1', 1, T0, { number: B });
    const b2 = rem('b2', 2, T0 + 5, { number: B });
    const start = ok([rem('a1', 1, T0), b1, rem('a2', 2, T0), b2]);
    const next = applyReminderChange(start, { type: 'reminder-remove-all', number: A });
    expect(listOf(next)).toEqual([b1, b2]);
    expect(activeFor(next, A)).toEqual([]);
  });

  it('reminder-handed sets handedAt on that id only', () => {
    const start = ok([rem('a', 1, T0), rem('b', 2, T0)]);
    const next = applyReminderChange(start, { type: 'reminder-handed', id: rid('a'), at: T0 + 7 });
    expect(listOf(next).map((r) => r.handedAt)).toEqual([T0 + 7, null]);
  });
});

describe('applyReminderChange on an unreadable store', () => {
  const changes: readonly ReminderChange[] = [
    { type: 'reminder-add', reminder: rem('a', 1, T0) },
    { type: 'reminder-remove', id: rid('a') },
    { type: 'reminder-remove-all', number: A },
    { type: 'reminder-handed', id: rid('a'), at: T0 },
  ];

  it.each(changes.map((c) => [c.type, c] as const))('%s leaves it unreadable', (_t, change) => {
    expect(applyReminderChange(UNREADABLE, change)).toEqual({ status: 'unreadable' });
  });
});

describe('dueReminders', () => {
  it('orders by dueAt then id, excluding handed and future reminders', () => {
    const now = T0 + 10_000;
    const state = ok([
      rem('c', 1, T0 + 5_000),
      rem('future', 2, now + 1),
      rem('b', 3, T0 + 5_000, { number: B }),
      rem('handed', 4, T0, { handedAt: T0 + 1 }),
      rem('z', 5, T0 + 1_000),
      rem('atNow', 1, now, { number: B }),
    ]);
    expect(dueReminders(state, now).map((r) => r.id)).toEqual([
      rid('z'),
      rid('b'),
      rid('c'),
      rid('atNow'),
    ]);
  });

  it('is empty for an unreadable store', () => {
    expect(dueReminders(UNREADABLE, T0)).toEqual([]);
  });
});

describe('nextDueAt', () => {
  it('returns the earliest dueAt among reminders not handed', () => {
    const state = ok([
      rem('h', 1, T0 + 100, { handedAt: T0 + 100 }),
      rem('a', 2, T0 + 500),
      rem('b', 3, T0 + 300, { number: B }),
    ]);
    expect(nextDueAt(state)).toBe(T0 + 300);
  });

  it('returns null when every reminder is handed, the store is empty or unreadable', () => {
    expect(nextDueAt(ok([rem('h', 1, T0, { handedAt: T0 })]))).toBeNull();
    expect(nextDueAt(EMPTY_REMINDERS)).toBeNull();
    expect(nextDueAt(UNREADABLE)).toBeNull();
  });
});
