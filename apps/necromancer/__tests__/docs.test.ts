/**
 * Checks on the Necromancer README and the generated stop alias asset.
 * Requirements 17.7 (stop alias asset is exported from brain),
 * 17.12 (README documents the known limitations).
 */
import { stopAliasAsset } from '@lazarus/brain';

type Fs = {
  readFileSync: (path: string, encoding: 'utf8') => string;
  mkdtempSync: (prefix: string) => string;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
};
type Path = { join: (...parts: string[]) => string };
type Os = { tmpdir: () => string };
type ChildProcess = {
  execFileSync: (
    file: string,
    args: readonly string[],
    options: { cwd: string; stdio: 'pipe'; timeout: number },
  ) => unknown;
};
/** Jest runs on Node; the app tsconfig has no Node types (`require` comes from RN's globals). */
declare const __dirname: string;
declare const process: { execPath: string };
const fs = require('node:fs') as Fs;
const path = require('node:path') as Path;
const os = require('node:os') as Os;
const childProcess = require('node:child_process') as ChildProcess;

const README = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const BRAIN = path.join(__dirname, '..', '..', '..', 'packages', 'brain');

/** Text of the `## Known limitations` section, up to the next `## ` heading. */
function knownLimitations(): string {
  const start = README.search(/^## Known limitations\s*$/m);
  if (start < 0) return '';
  const rest = README.slice(start);
  const next = rest.slice(3).search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

describe('README', () => {
  const section = knownLimitations();

  it('has a Known limitations heading', () => {
    expect(README).toMatch(/^## Known limitations\s*$/m);
  });

  it.each([
    ['the 60-second Send_Timeout', /60-second Send_Timeout/],
    ['the 30-second retry wait', /30-second retry wait/],
    ['the fallback STOP detection', /Fallback STOP detection/i],
    ['unlogged paused messages', /Unlogged paused messages/i],
  ])('mentions %s under Known limitations', (_label, pattern) => {
    expect(section).toMatch(pattern);
  });
});

describe('export-stop-aliases script', () => {
  let dir = '';

  afterEach(() => {
    if (dir !== '') fs.rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('writes exactly stopAliasAsset() as JSON', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazarus-stop-aliases-'));
    const out = path.join(dir, 'stop_aliases.json');
    childProcess.execFileSync(
      process.execPath,
      ['--import', './scripts/ts-resolve.mjs', './scripts/export-stop-aliases.ts', '--out', out],
      { cwd: BRAIN, stdio: 'pipe', timeout: 60_000 },
    );
    const written = fs.readFileSync(out, 'utf8');
    expect(written).toBe(JSON.stringify(stopAliasAsset()));
    expect(JSON.parse(written)).toEqual(stopAliasAsset());
  }, 90_000);
});
