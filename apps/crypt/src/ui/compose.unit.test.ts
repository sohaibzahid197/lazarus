import { describe, expect, it } from 'vitest';
import { INITIAL_T9_STATE, stepT9 } from '../t9/t9.step';
import { clearLast, composeUnits, isMessageBody, switchInputMode, truncateCompose } from './compose';
import { hasUrdu, textDirection } from './direction';

const pendingB = stepT9(stepT9(INITIAL_T9_STATE, { key: '2', at: 0 }), { key: '2', at: 100 });

describe('compose helpers', () => {
  it('truncates to 480 units, or 479 before a split surrogate pair', () => {
    expect(truncateCompose('a'.repeat(481))).toHaveLength(480);
    expect(truncateCompose('a'.repeat(479) + '😀')).toHaveLength(479);
    expect(truncateCompose('hi')).toBe('hi');
  });

  it('clears the Pending_Character first, then a whole code point', () => {
    const a = clearLast('hi', pendingB);
    expect(a.text).toBe('hi');
    expect(a.t9.group).toBeNull();
    expect(clearLast('a😀', INITIAL_T9_STATE).text).toBe('a');
    expect(clearLast('', INITIAL_T9_STATE).text).toBe('');
  });

  it('commits only the Pending_Character on Input_Mode switch', () => {
    const r = switchInputMode('hi ', pendingB);
    expect(r.text).toBe('hi b');
    expect(r.t9.group).toBeNull();
    expect(switchInputMode('hi', INITIAL_T9_STATE).text).toBe('hi');
  });

  it('counts the Pending_Character and checks Message_Body', () => {
    expect(composeUnits('hi', pendingB)).toBe(3);
    expect(isMessageBody('  ')).toBe(false);
    expect(isMessageBody('a'.repeat(481))).toBe(false);
    expect(isMessageBody(' HELP ')).toBe(true);
  });
});

describe('direction helpers', () => {
  it('uses the first strong character', () => {
    expect(textDirection('(1/2) مدد')).toBe('rtl');
    expect(textDirection('HELP مدد')).toBe('ltr');
    expect(textDirection('123 ?')).toBe('ltr');
    expect(hasUrdu('HELP مدد')).toBe(true);
    expect(hasUrdu('HELP')).toBe(false);
  });
});
