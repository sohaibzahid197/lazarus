import { ALIAS_TABLE } from './aliases.js';
import { detectLanguage } from './language.js';
import { normalizeMessage } from './normalize.js';
import type { Command, RoutedCommand } from './router.types.js';

const TRAILING_PUNCT = /[.,!?:;]+$/;
const ARG_REQUIRED: ReadonlySet<Command> = new Set<Command>(['SCAM', 'REMIND', 'TRANSLATE']);

/** Classify an SMS body into one command. Total, pure, decides on the first token only. */
export function routeCommand(input: string): RoutedCommand {
  const text = normalizeMessage(input);
  const language = detectLanguage(input);
  const space = text.indexOf(' ');
  const token = space === -1 ? text : text.slice(0, space);
  const rest = space === -1 ? '' : text.slice(space + 1);
  const keyword = token.replace(TRAILING_PUNCT, '').toLowerCase();
  const command = ALIAS_TABLE.get(keyword);
  if (command === undefined) {
    return { command: 'QUESTION', argument: text, language, argumentMissing: false };
  }
  return {
    command,
    argument: rest,
    language,
    argumentMissing: ARG_REQUIRED.has(command) && rest === '',
  };
}
