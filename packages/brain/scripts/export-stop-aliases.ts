// Writes stopAliasAsset() as UTF-8 JSON to the --out path (Requirements 9.13, 17.7).
// Run by the Gradle `generateStopAliases` task from packages/brain:
//   node --import ./scripts/ts-resolve.mjs ./scripts/export-stop-aliases.ts --out <file>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stopAliasAsset } from '../src/stopAliases.js';

const USAGE = 'Usage: export-stop-aliases --out <file>';

/** Returns the --out value from `--out <file>` or `--out=<file>`, or null. */
export function parseOutArg(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg.startsWith('--out=')) return arg.slice('--out='.length) || null;
    if (arg === '--out') {
      const next = args[i + 1];
      return next !== undefined && next !== '' && !next.startsWith('--') ? next : null;
    }
  }
  return null;
}

function main(): void {
  const out = parseOutArg(process.argv.slice(2));
  if (out === null) {
    process.stderr.write(`export-stop-aliases: missing --out <file>\n${USAGE}\n`);
    process.exit(1);
  }
  const target = resolve(out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(stopAliasAsset()), { encoding: 'utf8' });
}

main();
