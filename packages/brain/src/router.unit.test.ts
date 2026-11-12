import { describe, expect, it } from 'vitest';
import { routeCommand } from './router.js';
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

describe('routeCommand aliases (Req 2.1, 3.2-3.8, 9.4)', () => {
  it('covers all 18 aliases', () => {
    expect(ALIAS_CASES).toHaveLength(18);
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

  it.each(['HELP', 'STOP', 'START'])('%s without argument is not missing', (kw) => {
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
  });
});
