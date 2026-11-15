import { DELIVERY_OUTCOMES, OUTCOMES } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { noteForDelivery, noteForOutcome } from './outcomeNotes';

describe('noteForOutcome', () => {
  it('names the outcomes of Requirement 11.6', () => {
    expect(noteForOutcome('ignored-stopped')).toBe(
      'No reply: this number texted STOP. Send START to get replies again.',
    );
    expect(noteForOutcome('rate-limited')).toBe(
      'No reply: reply limit for this number reached. Press New session to keep testing.',
    );
    expect(noteForOutcome('send-capped')).toBe(
      'No reply: daily send limit reached. Press New session to keep testing.',
    );
    expect(noteForOutcome('stopped')).toBe('No reply.');
    expect(noteForOutcome(null)).toBe('No reply.');
  });

  it('gives a non-empty note for every Outcome', () => {
    for (const o of OUTCOMES) expect(noteForOutcome(o).length).toBeGreaterThan(0);
  });
});

describe('noteForDelivery', () => {
  it('names the Delivery_Outcomes of Requirement 13.11', () => {
    expect(noteForDelivery('reminder-stopped')).toBe('Reminder not sent: STOP is on.');
    expect(noteForDelivery('reminder-expired')).toBe(
      'Reminder not sent: it was more than 1 hour late.',
    );
    expect(noteForDelivery('reminder-capped')).toBe(
      'Reminder not sent: daily send limit reached. Press New session to keep testing.',
    );
    expect(noteForDelivery('reminder-not-allowed')).toBe('Reminder not sent.');
    expect(noteForDelivery('reminder-failed')).toBe('Reminder not sent.');
  });

  it('never names a Reminder bubble label', () => {
    for (const o of DELIVERY_OUTCOMES) expect(noteForDelivery(o)).toMatch(/^Reminder not sent/);
  });
});
