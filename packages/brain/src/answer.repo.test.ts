// Repository checks for the AI answer service (task 15.5).
// Requirements: 1.7, 1.9, 10.8, 12.1, 12.3, 13.15, 13.17, 14.2, 14.7, 14.8,
// 14.9, 14.10, 14.11, 15.5, 15.6.
//
// Forbidden strings (the SDK name, the key prefix, the model literal and the
// env accessor) are built from parts so this file never trips its own scans.
// This file reads files only; it never reads GEMINI_* environment variables.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BRAIN_DIR = join(REPO_ROOT, 'packages', 'brain');
const SRC_DIR = join(BRAIN_DIR, 'src');

const SDK_NAME = '@google/' + 'genai';
const KEY_PATTERN = new RegExp('AI' + 'za' + '[0-9A-Za-z_-]{35}');
const MODEL_LITERAL = ['gemini', '3.5', 'flash', 'lite'].join('-');
const ENV_ACCESS = new RegExp('\\bprocess' + '\\.env\\b');
const API_HOST = 'generativelanguage' + '.googleapis.com';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'build', 'dist', '.next', '.gradle', '.cxx', '.kotlin', 'Pods',
]);

/** Repo-relative POSIX paths of tracked and untracked, non-ignored files. */
function listRepoFiles(): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter((p) => p.length > 0);
  } catch {
    return walk(REPO_ROOT);
  }
}

/** Filesystem fallback when git is unavailable. */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...walk(full));
    } else if (entry.isFile()) {
      found.push(relative(REPO_ROOT, full).split(sep).join('/'));
    }
  }
  return found;
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Text content, or null for missing or binary files. */
function readText(repoPath: string): string | null {
  const full = join(REPO_ROOT, repoPath);
  try {
    if (!statSync(full).isFile()) return null;
    const buf = readFileSync(full);
    return buf.includes(0) ? null : buf.toString('utf8');
  } catch {
    return null;
  }
}

/** Removes block comments, whole-line comments and ` // ` trailing comments. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/\s.*$/gm, '');
}

/** Module specifiers from import/export-from, dynamic import and require. */
function importSpecifiers(code: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"]+)\1/gm;
  return [...stripComments(code).matchAll(re)].map((m) => m[2] ?? '');
}

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.test\.[jt]sx?$/;

function srcFile(name: string): string {
  return readFileSync(join(SRC_DIR, name), 'utf8');
}

function srcNames(): string[] {
  return readdirSync(SRC_DIR).filter((n) => n.endsWith('.ts'));
}

/** Answer_Service and Mock_Client sources (test support excluded). */
function answerServiceSources(): string[] {
  return srcNames().filter(
    (n) => /^(?:answer|ai)\..*\.ts$/.test(n) && !TEST_FILE.test(n) && n !== 'answer.arbitraries.ts',
  );
}

const PURE_HELPERS = [
  'answer.prompt.ts',
  'answer.topic.ts',
  'answer.scam.ts',
  'answer.redact.ts',
  'answer.key.ts',
  'answer.text.ts',
  'answer.texts.ts',
  'models.ts',
];

function isNodeOnly(spec: string): boolean {
  return spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0] ?? spec);
}

function isUiFramework(spec: string): boolean {
  return /^(?:react|react-dom|react-native|next)(?:\/|$)/.test(spec) || /^@(?:react-native|next)\//.test(spec);
}

function isGeminiEntry(spec: string): boolean {
  return /(?:^|\/)gemini\.entry(?:\.[jt]s)?$/.test(spec) || spec === '@lazarus/brain/gemini';
}

function isSdk(spec: string): boolean {
  return spec === SDK_NAME || spec.startsWith(SDK_NAME + '/');
}

const repoFiles = listRepoFiles();

describe('repository: secrets and env files', () => {
  it('root .gitignore lists .env and .env is not tracked', () => {
    const lines = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain('.env');
    expect(repoFiles.filter((p) => baseName(p) === '.env')).toEqual([]);
  });

  it('.env.example has an empty GEMINI_API_KEY and an optional GEMINI_MODEL', () => {
    const lines = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8').split(/\r?\n/).map((l) => l.trimEnd());
    expect(lines).toContain('GEMINI_API_KEY=');
    const modelLine = lines.findIndex((l) => l === 'GEMINI_MODEL=' || l === `GEMINI_MODEL=${MODEL_LITERAL}`);
    expect(modelLine).toBeGreaterThanOrEqual(0);
    const comments = lines.slice(Math.max(0, modelLine - 3), modelLine).filter((l) => l.startsWith('#'));
    expect(comments.some((l) => /optional/i.test(l))).toBe(true);
  });

  it('docs state the default is free-tier Flash-Lite, models retire, GEMINI_MODEL switches it', () => {
    const docs = [readText('.env.example') ?? '', readText('README.md') ?? ''];
    const states = (re: RegExp): boolean => docs.some((d) => re.test(d));
    expect(states(/free-tier Flash-Lite/i)).toBe(true);
    expect(states(/retired/i)).toBe(true);
    expect(states(/GEMINI_MODEL[^\n]*no code change|no code change[^\n]*GEMINI_MODEL/i)).toBe(true);
  });

  it('no repository file contains a Gemini API key', () => {
    const offenders = repoFiles.filter((p) => baseName(p) !== '.env' && KEY_PATTERN.test(readText(p) ?? ''));
    expect(offenders).toEqual([]);
  });

  it('the model name literal appears only in models.ts, tests and docs', () => {
    const allowed = (p: string): boolean =>
      p === 'packages/brain/src/models.ts' || TEST_FILE.test(p) || p.endsWith('.md') || baseName(p) === '.env.example';
    const offenders = repoFiles.filter((p) => !allowed(p) && (readText(p) ?? '').includes(MODEL_LITERAL));
    expect(offenders).toEqual([]);
  });
});

describe('repository: Gemini SDK usage', () => {
  it('every package.json that declares the SDK pins an exact version', () => {
    const manifests = repoFiles.filter((p) => baseName(p) === 'package.json');
    const versions = manifests.flatMap((p) => {
      const json = JSON.parse(readText(p) ?? '{}') as Record<string, Record<string, string> | undefined>;
      return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
        .map((field) => json[field]?.[SDK_NAME])
        .filter((v): v is string => typeof v === 'string');
    });
    const brain = JSON.parse(readFileSync(join(BRAIN_DIR, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(brain.dependencies?.[SDK_NAME]).toBeDefined();
    for (const v of versions) {
      expect(v).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-wyz.-]+)?$/);
      expect(v).not.toMatch(/[\^~*<>xX]/);
    }
  });

  it('the SDK is imported only by src/gemini.entry.ts', () => {
    const importers = repoFiles.filter(
      (p) => CODE_FILE.test(p) && importSpecifiers(readText(p) ?? '').some(isSdk),
    );
    expect(importers).toEqual(['packages/brain/src/gemini.entry.ts']);
  });

  it('no non-test source reads process env outside gemini.entry.ts and the test guard', () => {
    const allowed = new Set(['gemini.entry.ts', 'test.guard.ts']);
    const offenders = srcNames().filter(
      (n) => !TEST_FILE.test(n) && !allowed.has(n) && ENV_ACCESS.test(stripComments(srcFile(n))),
    );
    expect(offenders).toEqual([]);
  });

  it('gemini.entry.ts makes no hand-written HTTP calls', () => {
    const entry = srcFile('gemini.entry.ts');
    expect(entry).not.toMatch(/\bfetch\b/);
    expect(entry).not.toContain(API_HOST);
  });
});

describe('repository: Answer_Service source scans', () => {
  const sources = answerServiceSources();

  it('finds the Answer_Service and Mock_Client sources', () => {
    expect(sources).toEqual(expect.arrayContaining(['answer.service.ts', 'ai.mock.ts', 'ai.types.ts']));
  });

  it('has no Gemini entry, SDK, React Native, Next.js or Node-only imports', () => {
    const offenders = sources.flatMap((n) =>
      importSpecifiers(srcFile(n))
        .filter((s) => isGeminiEntry(s) || isSdk(s) || isUiFramework(s) || isNodeOnly(s))
        .map((s) => `${n}: ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it('has no console calls', () => {
    const offenders = sources.filter((n) => /\bconsole\s*\./.test(stripComments(srcFile(n))));
    expect(offenders).toEqual([]);
  });

  it('pure helpers read no clock and no randomness', () => {
    const banned = [/\bDate\.now\b/, /\bnew\s+Date\b/, /\bMath\.random\b/];
    const offenders = PURE_HELPERS.filter((n) => {
      const code = stripComments(srcFile(n));
      return banned.some((re) => re.test(code));
    });
    expect(offenders).toEqual([]);
  });
});
