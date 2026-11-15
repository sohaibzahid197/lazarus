import { describe, expect, it } from 'vitest';
import { routeCommand } from './router.js';
import type { Language } from './router.types.js';

/** sms-reminders Requirements 1.5, 1.7, 1.10, 14.6: LIST and CANCEL routing examples. */
describe('routeCommand LIST examples', () => {
  it.each(['LIST', 'list?'])('routes "%s" to LIST', (input) => {
    const r = routeCommand(input);
    expect(r.command).toBe('LIST');
    expect(r.argument).toBe('');
    expect(r.argumentMissing).toBe(false);
  });

  it.each<readonly [string, Language]>([
    ['fehrist', 'roman-ur'],
    ['فہرست', 'ur'],
  ])('routes "%s" to LIST in %s', (input, language) => {
    const r = routeCommand(input);
    expect(r.command).toBe('LIST');
    expect(r.language).toBe(language);
  });

  it('routes "list of foods" to QUESTION', () => {
    expect(routeCommand('list of foods').command).toBe('QUESTION');
  });
});

describe('routeCommand CANCEL examples', () => {
  it.each([
    ['CANCEL 2', '2'],
    ['cancel ۲', '۲'],
  ])('routes "%s" to CANCEL with argument %s', (input, argument) => {
    const r = routeCommand(input);
    expect(r.command).toBe('CANCEL');
    expect(r.argument).toBe(argument);
    expect(r.argumentMissing).toBe(false);
  });

  it('marks bare CANCEL as argumentMissing', () => {
    const r = routeCommand('CANCEL');
    expect(r.command).toBe('CANCEL');
    expect(r.argument).toBe('');
    expect(r.argumentMissing).toBe(true);
  });

  it.each(['cancel my order', 'cancel 2 3', 'CANCEL 1234', 'cancel 2.'])(
    'routes "%s" to QUESTION',
    (input) => {
      const r = routeCommand(input);
      expect(r.command).toBe('QUESTION');
      expect(r.argumentMissing).toBe(false);
    },
  );
});

describe('routeCommand STOP wins over LIST and CANCEL', () => {
  it.each(['stop list', 'stop cancel 2'])('routes "%s" to STOP', (input) => {
    expect(routeCommand(input).command).toBe('STOP');
  });
});
