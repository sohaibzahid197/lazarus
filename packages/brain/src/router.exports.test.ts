import { describe, expect, expectTypeOf, it } from 'vitest';
import { detectLanguage, printCommand, routeCommand } from './index.js';
import type { Command, Language, RoutedCommand } from './index.js';

describe('package entry exports', () => {
  it('exposes the router API as functions', () => {
    expect(typeof routeCommand).toBe('function');
    expect(typeof detectLanguage).toBe('function');
    expect(typeof printCommand).toBe('function');
  });

  it('has the expected function signatures', () => {
    expectTypeOf(routeCommand).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(routeCommand).returns.toEqualTypeOf<RoutedCommand>();
    expectTypeOf(detectLanguage).returns.toEqualTypeOf<Language>();
    expectTypeOf(printCommand).parameters.toEqualTypeOf<[RoutedCommand]>();
    expectTypeOf(printCommand).returns.toEqualTypeOf<string>();
  });
});

describe('type-level checks', () => {
  it('Command is the union of the 7 commands', () => {
    expectTypeOf<Command>().toEqualTypeOf<
      'HELP' | 'STOP' | 'START' | 'SCAM' | 'REMIND' | 'TRANSLATE' | 'QUESTION'
    >();
  });

  it('Language is the union en | ur | roman-ur', () => {
    expectTypeOf<Language>().toEqualTypeOf<'en' | 'ur' | 'roman-ur'>();
  });

  it('RoutedCommand has the documented readonly shape', () => {
    expectTypeOf<RoutedCommand>().toEqualTypeOf<{
      readonly command: Command;
      readonly argument: string;
      readonly language: Language;
      readonly argumentMissing: boolean;
    }>();
  });
});

describe('performance and robustness', () => {
  it('routes a 10,000-character input in under 50 ms', () => {
    const input = 'a'.repeat(10_000);
    const start = Date.now();
    const result = routeCommand(input);
    const elapsed = Date.now() - start;
    expect(result.command).toBe('QUESTION');
    expect(elapsed).toBeLessThan(50);
  });

  it('routes a 100,000-character input without throwing', () => {
    const input = 'SCAM ' + 'kya hai \t'.repeat(12_000);
    expect(input.length).toBeGreaterThanOrEqual(100_000);
    expect(() => routeCommand(input)).not.toThrow();
    expect(() => detectLanguage(input)).not.toThrow();
  });
});
