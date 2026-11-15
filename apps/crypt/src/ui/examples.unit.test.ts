import { detectLanguage, routeCommand, type Command } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { MAX_BODY_UNITS } from '../protocol/limits';
import { EXAMPLE_MESSAGES } from './examples';

// Requirement 2.2: exactly 10 example messages, checked against the brain's
// own router and language detector as the oracle.

function at(i: number): string {
  const text = EXAMPLE_MESSAGES[i];
  if (text === undefined) throw new Error(`no example at index ${String(i)}`);
  return text;
}

describe('EXAMPLE_MESSAGES', () => {
  it('has exactly 10 distinct messages', () => {
    expect(EXAMPLE_MESSAGES).toHaveLength(10);
    expect(new Set(EXAMPLE_MESSAGES).size).toBe(10);
  });

  it('has the fixed command texts of 2.2', () => {
    expect(at(0)).toBe('HELP');
    expect(at(3)).toBe('REMIND in 1 minute drink water');
    expect(at(4)).toBe('LIST');
    expect(at(5)).toBe('CANCEL 1');
    expect(at(6)).toBe('STOP');
    expect(at(7)).toBe('START');
  });

  const expectedCommands: readonly (readonly [number, Command])[] = [
    [0, 'HELP'],
    [1, 'QUESTION'],
    [2, 'SCAM'],
    [3, 'REMIND'],
    [4, 'LIST'],
    [5, 'CANCEL'],
    [6, 'STOP'],
    [7, 'START'],
  ];

  it.each(expectedCommands)('example %i routes to %s', (i, command) => {
    const routed = routeCommand(at(i));
    expect(routed.command).toBe(command);
    expect(routed.argumentMissing).toBe(false);
  });

  it('the SCAM example carries text after the keyword', () => {
    expect(routeCommand(at(2)).argument.trim().length).toBeGreaterThan(0);
  });

  it('includes one Roman Urdu and one Urdu script message', () => {
    expect(detectLanguage(at(8))).toBe('roman-ur');
    expect(detectLanguage(at(9))).toBe('ur');
  });

  it('has exactly one roman-ur and one ur example', () => {
    const languages = EXAMPLE_MESSAGES.map((t) => detectLanguage(t));
    expect(languages.filter((l) => l === 'roman-ur')).toHaveLength(1);
    expect(languages.filter((l) => l === 'ur')).toHaveLength(1);
  });

  it.each(EXAMPLE_MESSAGES.map((t, i) => [i, t] as const))(
    'example %i is a valid Message_Body (1 to 480 code units, non-blank)',
    (_i, text) => {
      expect(text.length).toBeGreaterThanOrEqual(1);
      expect(text.length).toBeLessThanOrEqual(MAX_BODY_UNITS);
      expect(/\S/.test(text)).toBe(true);
    },
  );
});
