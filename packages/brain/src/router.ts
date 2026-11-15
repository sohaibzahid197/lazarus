import { ALIAS_TABLE } from './aliases.js';
import { detectLanguage } from './language.js';
import { normalizeMessage } from './normalize.js';
import type { Command, Language, RoutedCommand } from './router.types.js';
import { trailingPunctuationRegex } from './stopAliases.js';

const TRAILING_PUNCT = trailingPunctuationRegex();
const ARG_REQUIRED: ReadonlySet<Command> = new Set<Command>(['SCAM', 'REMIND', 'TRANSLATE']);
/** One token of 1 to 3 ASCII or Extended Arabic-Indic digits. */
const SLOT_TOKEN = /^[0-9\u06F0-\u06F9]{1,3}$/;

/** Requirement 1.2–1.6: LIST and CANCEL only in their strict form, else QUESTION. */
function strictForm(
  command: 'LIST' | 'CANCEL',
  rest: string,
  text: string,
  language: Language,
): RoutedCommand {
  const question: RoutedCommand = { command: 'QUESTION', argument: text, language, argumentMissing: false };
  if (command === 'LIST') {
    return rest === '' ? { command, argument: '', language, argumentMissing: false } : question;
  }
  if (rest === '') return { command, argument: '', language, argumentMissing: true };
  return SLOT_TOKEN.test(rest) ? { command, argument: rest, language, argumentMissing: false } : question;
}

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
  if (command === 'LIST' || command === 'CANCEL') {
    return strictForm(command, rest, text, language);
  }
  return {
    command,
    argument: rest,
    language,
    argumentMissing: ARG_REQUIRED.has(command) && rest === '',
  };
}
