import { describe, expect, it } from 'vitest';
import { isT9Text } from './keymap';
import { INITIAL_T9_STATE, flushT9, pendingOf, stepT9, type KeyEvent, type T9State } from './t9.step';

function run(events: readonly KeyEvent[], s: T9State = INITIAL_T9_STATE): T9State {
  return events.reduce(stepT9, s);
}

describe('stepT9', () => {
  it('cycles a group and wraps (5 presses of 2 show a)', () => {
    const s = run([0, 100, 200, 300, 400].map((at) => ({ key: '2' as const, at })));
    expect(s.committed).toBe('');
    expect(pendingOf(s)).toBe('a');
  });

  it('starts a new group at the 1,000 ms timeout and on a different key', () => {
    const s = run([
      { key: '2', at: 0 },
      { key: '2', at: 999 },
      { key: '2', at: 1_999 },
      { key: '3', at: 2_000 },
    ]);
    expect(s.committed).toBe('ba');
    expect(pendingOf(s)).toBe('d');
  });

  it('* commits and flips case; # switches to Number_Mode keeping case', () => {
    const s = run([
      { key: '4', at: 0 },
      { key: '*', at: 10 },
      { key: '4', at: 20 },
      { key: '#', at: 30 },
      { key: '2', at: 40 },
      { key: '2', at: 50 },
    ]);
    expect(s.committed).toBe('gG22');
    expect(pendingOf(s)).toBeNull();
    expect(s.mode).toEqual({ entry: 'number', letterCase: 'upper' });
  });

  it('flushT9 commits the pending character and is a no-op without one', () => {
    const s = flushT9(run([{ key: '0', at: 0 }]));
    expect(s.committed).toBe(' ');
    expect(flushT9(s)).toBe(s);
  });
});

describe('isT9Text', () => {
  it('accepts Key_Map characters and rejects others', () => {
    expect(isT9Text("Hello, World 123?!'-.")).toBe(true);
    expect(isT9Text('مدد')).toBe(false);
    expect(isT9Text('a\nb')).toBe(false);
  });
});
