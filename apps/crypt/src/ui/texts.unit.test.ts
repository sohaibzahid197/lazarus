import { DEFAULT_SETTINGS } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { MAX_BODY_UNITS } from '../protocol/limits';
import { LENGTH_LIMIT_TEXT, repliesLeftText, STATE_LABELS } from './texts';

describe('UI texts', () => {
  it('formats the Replies_Left_Indicator', () => {
    const total = DEFAULT_SETTINGS.perNumberLimit;
    expect(repliesLeftText(total, total)).toBe('Replies left: 5 of 5');
    expect(repliesLeftText(0, total)).toBe('Replies left: 0 of 5');
  });

  it('names the same length limit as MAX_BODY_UNITS', () => {
    expect(LENGTH_LIMIT_TEXT).toContain(String(MAX_BODY_UNITS));
  });

  it('has the state labels of Requirement 14', () => {
    expect(STATE_LABELS).toEqual({
      ALIVE: 'Alive',
      SENDING: 'Sending…',
      SLEEPING: 'Sleeping: STOP is on',
      ERROR: 'Error',
    });
  });
});
