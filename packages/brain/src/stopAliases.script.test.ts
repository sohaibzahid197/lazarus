import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopAliasAsset } from './stopAliases.js';

// Validates: Requirements 17.7

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT_ARGS = ['--import', './scripts/ts-resolve.mjs', './scripts/export-stop-aliases.ts'];
const TIMEOUT_MS = 30_000;

interface RunResult {
  code: number;
  stderr: string;
}

function runScript(extraArgs: readonly string[]): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [...SCRIPT_ARGS, ...extraArgs],
      { cwd: PACKAGE_ROOT, timeout: TIMEOUT_MS },
      (error, _stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolvePromise({ code, stderr: String(stderr) });
      },
    );
  });
}

describe('export-stop-aliases script', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lazarus-stop-aliases-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes stopAliasAsset() as UTF-8 JSON to --out', async () => {
    const out = join(dir, 'nested', 'stop_aliases.json');
    const result = await runScript(['--out', out]);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    const parsed: unknown = JSON.parse(await readFile(out, 'utf8'));
    expect(parsed).toEqual(stopAliasAsset());
  }, TIMEOUT_MS);

  it('exits non-zero when --out is missing', async () => {
    const result = await runScript([]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('missing --out');
  }, TIMEOUT_MS);
});
