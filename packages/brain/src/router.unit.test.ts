import { describe, expect, it } from 'vitest';
import { routeCommand } from './router.js';
import { ALIAS_TABLE } from './aliases.js';
import type { Command } from './router.types.js';

type AliasCase = readonly [alias: string, command: Command];

const ALIAS_CASES: readonly AliasCase[] = [
  ['help', 'HELP'],
  ['stop', 'STOP'],
  ['start', 'START'],
  ['scam', 'SCAM'],
  ['remind', 'REMIND'],
  ['translate', 'TRANSLATE'],
  ['madad', 'HELP'],
  ['band', 'STOP'],
  ['shuru', 'START'],
  ['dhoka', 'SCAM'],
  ['yaad', 'REMIND'],
  ['tarjuma', 'TRANSLATE'],
  ['مدد', 'HELP'],
  ['بند', 'STOP'],
  ['شروع', 'START'],
  ['دھوکہ', 'SCAM'],
  ['یاد', 'REMIND'],
  ['ترجمہ', 'TRANSLATE'],
];

/** LIST and CANCEL keywords (sms-reminders Requirement 1.1); they route only in a strict form. */
const STRICT_ALIAS_CASES: readonly AliasCase[] = [
  ['list', 'LIST'],
  ['fehrist', 'LIST'],
  ['فہرست', 'LIST'],
  ['cancel', 'CANCEL'],
  ['mansookh', 'CANCEL'],
  ['منسوخ', 'CANCEL'],
];

describe('routeCommand aliases (Req 2.1, 3.2-3.8, 9.4)', () => {
  it('covers all 24 aliases of the 8 keyword Commands', () => {
    expect(ALIAS_CASES).toHaveLength(18);
    expect(STRICT_ALIAS_CASES).toHaveLength(6);
    expect(ALIAS_TABLE.size).toBe(24);
    for (const [alias, command] of [...ALIAS_CASES, ...STRICT_ALIAS_CASES]) {
      expect(ALIAS_TABLE.get(alias)).toBe(command);
    }
  });

  it.each(ALIAS_CASES)('routes "%s" to %s with its argument', (alias, command) => {
    const r = routeCommand(`${alias} some text`);
    expect(r.command).toBe(command);
    expect(r.argument).toBe('some text');
    expect(r.argumentMissing).toBe(false);
  });
});

describe('routeCommand formatting tolerance', () => {
  it('handles 2 or more consecutive spaces (Req 2.3)', () => {
    const r = routeCommand('SCAM    free   money');
    expect(r.command).toBe('SCAM');
    expect(r.argument).toBe('free money');
  });

  it('handles mixed case keywords (Req 2.1)', () => {
    expect(routeCommand('StOp').command).toBe('STOP');
    expect(routeCommand('HeLp').command).toBe('HELP');
  });

  it('treats start and START the same (Req 3.4)', () => {
    expect(routeCommand('start').command).toBe('START');
    expect(routeCommand('START').command).toBe('START');
  });

  it('ignores trailing punctuation on the keyword (Req 2.2)', () => {
    expect(routeCommand('STOP!').command).toBe('STOP');
    expect(routeCommand('help?!').command).toBe('HELP');
    const r = routeCommand('scam: free money');
    expect(r.command).toBe('SCAM');
    expect(r.argument).toBe('free money');
  });

  it('preserves argument case (Req 5.4)', () => {
    const r = routeCommand('translate Hello World');
    expect(r.command).toBe('TRANSLATE');
    expect(r.argument).toBe('Hello World');
  });
});

describe('routeCommand argumentMissing (Req 5.4)', () => {
  it.each(['SCAM', 'REMIND', 'TRANSLATE'])('%s without argument is missing', (kw) => {
    const r = routeCommand(kw);
    expect(r.command).toBe(kw);
    expect(r.argument).toBe('');
    expect(r.argumentMissing).toBe(true);
  });

  it('CANCEL without argument is missing (sms-reminders Req 1.6)', () => {
    const r = routeCommand('CANCEL');
    expect(r.command).toBe('CANCEL');
    expect(r.argument).toBe('');
    expect(r.argumentMissing).toBe(true);
  });
  it.each(['HELP', 'STOP', 'START', 'LIST'])('%s without argument is not missing', (kw) => {
    const r = routeCommand(kw);
    expect(r.command).toBe(kw);
    expect(r.argumentMissing).toBe(false);
  });
});

describe('routeCommand fallbacks (Req 1.2, 1.3, 4.6, 4.7)', () => {
  it('routes a punctuation-only first token to QUESTION with full text', () => {
    const r = routeCommand('!!! help');
    expect(r.command).toBe('QUESTION');
    expect(r.argument).toBe('!!! help');
    expect(r.argumentMissing).toBe(false);
  });

  it('routes empty and whitespace-only input to QUESTION with empty argument', () => {
    for (const s of ['', '   ', '\t\n']) {
      const r = routeCommand(s);
      expect(r.command).toBe('QUESTION');
      expect(r.argument).toBe('');
      expect(r.argumentMissing).toBe(false);
    }
  });

  it('routes unknown keywords to QUESTION with normalized text', () => {
    const r = routeCommand('  what   is the weather ');
    expect(r.command).toBe('QUESTION');
    expect(r.argument).toBe('what is the weather');
  });

  it('only looks at the first token, so STOP wins over later keywords', () => {
    expect(routeCommand('stop scam remind').command).toBe('STOP');
    expect(routeCommand('please stop').command).toBe('QUESTION');
    expect(routeCommand('stop list').command).toBe('STOP');
    expect(routeCommand('stop cancel 2').command).toBe('STOP');
    expect(routeCommand('please list my reminders').command).toBe('QUESTION');
    expect(routeCommand('remind cancel 2').command).toBe('REMIND');
  });
});

describe('routeCommand LIST and CANCEL (sms-reminders Req 1.2-1.7, 1.10, 14.6)', () => {
  it.each(['LIST', 'list?', 'fehrist', 'فہرست'])('"%s" routes to LIST with no argument', (body) => {
    const r = routeCommand(body);
    expect(r).toMatchObject({ command: 'LIST', argument: '', argumentMissing: false });
  });
  it('detects the Language of LIST and CANCEL bodies', () => {
    expect(routeCommand('fehrist').language).toBe('roman-ur');
    expect(routeCommand('فہرست').language).toBe('ur');
    expect(routeCommand('منسوخ ۲').language).toBe('ur');
    expect(routeCommand('list').language).toBe('en');
    expect(routeCommand('cancel 2').language).toBe('en');
  });
  it('routes CANCEL with a slot token, keeping the digits unchanged', () => {
    expect(routeCommand('CANCEL 2')).toMatchObject({ command: 'CANCEL', argument: '2', argumentMissing: false });
    expect(routeCommand('cancel ۲')).toMatchObject({ command: 'CANCEL', argument: '۲', argumentMissing: false });
    expect(routeCommand('cancel! 2').command).toBe('CANCEL');
  });
  it.each(['list of foods', 'cancel my order', 'cancel 2 3', 'CANCEL 1234', 'cancel 2.'])(
    '"%s" still routes to QUESTION with the full normalized text',
    (body) => {
      const r = routeCommand(body);
      expect(r).toMatchObject({ command: 'QUESTION', argument: body, argumentMissing: false });
    },
  );
});
