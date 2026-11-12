import { describe, expect, it } from 'vitest';
import { printCommand } from './printer.js';
import type { RoutedCommand } from './router.types.js';

function cmd(
  command: RoutedCommand['command'],
  argument: string,
  overrides: Partial<RoutedCommand> = {},
): RoutedCommand {
  return { command, argument, language: 'en', argumentMissing: false, ...overrides };
}

describe('printCommand', () => {
  it('prints SCAM with its argument as "SCAM free money" (Req 7.3)', () => {
    expect(printCommand(cmd('SCAM', 'free money'))).toBe('SCAM free money');
  });

  it('prints bare HELP with no trailing space (Req 7.4)', () => {
    expect(printCommand(cmd('HELP', ''))).toBe('HELP');
  });

  it('prints STOP with no trailing space (Req 7.4)', () => {
    const out = printCommand(cmd('STOP', ''));
    expect(out).toBe('STOP');
    expect(out.endsWith(' ')).toBe(false);
  });

  it('uses the English keyword even for non-English routed commands (Req 7.3)', () => {
    expect(printCommand(cmd('STOP', '', { language: 'ur' }))).toBe('STOP');
  });

  it('prints a missing-argument command as the bare keyword (Req 7.4)', () => {
    expect(printCommand(cmd('SCAM', '', { argumentMissing: true }))).toBe('SCAM');
  });

  it('returns the QUESTION argument unchanged (Req 7.6)', () => {
    expect(printCommand(cmd('QUESTION', 'kya haal hai?'))).toBe('kya haal hai?');
    expect(printCommand(cmd('QUESTION', ''))).toBe('');
    expect(printCommand(cmd('QUESTION', 'مدد چاہیے', { language: 'ur' }))).toBe('مدد چاہیے');
  });
});
