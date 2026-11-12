/** All commands the router can produce. */
export const COMMANDS = [
  'HELP',
  'STOP',
  'START',
  'SCAM',
  'REMIND',
  'TRANSLATE',
  'QUESTION',
] as const;

export type Command = (typeof COMMANDS)[number];

/** Languages the detector can report. */
export const LANGUAGES = ['en', 'ur', 'roman-ur'] as const;

export type Language = (typeof LANGUAGES)[number];

/** Result of routing one SMS body. */
export interface RoutedCommand {
  readonly command: Command;
  readonly argument: string;
  readonly language: Language;
  readonly argumentMissing: boolean;
}
