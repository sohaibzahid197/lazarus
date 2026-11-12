import type { Command } from './router.types.js';

/** Lowercase keyword to Command. English, Roman Urdu and Urdu script. */
export const ALIAS_TABLE: ReadonlyMap<string, Command> = new Map<string, Command>([
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
]);

export const ROMAN_URDU_ALIASES: ReadonlySet<string> = new Set([
  'madad',
  'band',
  'shuru',
  'dhoka',
  'yaad',
  'tarjuma',
]);

/** Canonical English keyword used by the printer. */
export const ENGLISH_KEYWORD: Readonly<Record<Exclude<Command, 'QUESTION'>, string>> = {
  HELP: 'HELP',
  STOP: 'STOP',
  START: 'START',
  SCAM: 'SCAM',
  REMIND: 'REMIND',
  TRANSLATE: 'TRANSLATE',
};
