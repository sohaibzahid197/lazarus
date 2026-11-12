import { ENGLISH_KEYWORD } from './aliases.js';
import type { RoutedCommand } from './router.types.js';

/**
 * Render a RoutedCommand back to a canonical SMS body.
 * QUESTION returns the argument unchanged; other commands return the English
 * keyword, followed by a single space and the argument when it is non-empty.
 */
export function printCommand(cmd: RoutedCommand): string {
  if (cmd.command === 'QUESTION') return cmd.argument;
  const keyword = ENGLISH_KEYWORD[cmd.command];
  return cmd.argument === '' ? keyword : `${keyword} ${cmd.argument}`;
}
