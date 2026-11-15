/**
 * Source guards: static scans of the committed Necromancer sources.
 * Requirements 16.1 and 16.24 (no environment or build-config reads for the key or
 * model), 16.2 and 17.11 (no API key value in any file), 17.6 (no `any`),
 * 17.7 (no separately maintained STOP keyword list in Kotlin).
 */
// A module, so these names do not clash with other script-style test files.
export {};

type Dirent = { name: string; isDirectory: () => boolean; isFile: () => boolean };
type Fs = {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string, options: { withFileTypes: true }) => Dirent[];
};
type Path = {
  join: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
};
/** Jest runs on Node; the app tsconfig has no Node types (`require` comes from RN's globals). */
declare const __dirname: string;
const fs = require('node:fs') as Fs;
const path = require('node:path') as Path;

const APP = path.join(__dirname, '..');

/** Generated, vendored or VCS directories, relative to the app root. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'android/build',
  'android/app/build',
  'android/app/.cxx',
  'android/.gradle',
]);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|jar|apk|aab|keystore|jks|ttf|otf|so|o|a|bin|class|dex)$/i;

interface SourceFile {
  readonly rel: string;
  readonly text: string;
}

/** Every text file under `dir` (absolute), with paths relative to the app root. */
function walk(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(APP, abs);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(rel) && entry.name !== 'node_modules') out.push(...walk(abs));
    } else if (entry.isFile() && !BINARY_EXT.test(entry.name)) {
      const text = fs.readFileSync(abs, 'utf8');
      if (!text.includes('\u0000')) out.push({ rel, text });
    }
  }
  return out;
}

/** Comments removed, so prose such as "Strict: any field" never counts as a type. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// Built from pieces so this file never matches its own patterns.
const KEY_PATTERN = new RegExp('AI' + 'za' + '[0-9A-Za-z_-]{35}');
const ENV_ACCESS = new RegExp('\\bprocess' + '\\.env\\b');
const KEY_VAR = 'GEMINI_' + 'API_KEY';
const MODEL_VAR = 'GEMINI_' + 'MODEL';

/**
 * The one allowed use of the key variable name: `gateway/ai.ts` hands the key read from
 * the Api_Key_Store to `createGeminiClient` as `env: { GEMINI_API_KEY: key }`, the call
 * the design prescribes (design §"Gemini client for React Native"). That is an object
 * key in the options, not a read of an environment variable (Requirement 16.1).
 */
const AI_FILE = path.join('src', 'gateway', 'ai.ts');
const ALLOWED_KEY_USE = new RegExp(`env:\\s*\\{\\s*${KEY_VAR}:\\s*key\\s*\\}`, 'g');

/** A local, gitignored `.env` may hold a real key; it is never committed (16.24). */
const appFiles = walk(APP).filter(f => f.rel.split(/[\\/]/).pop() !== '.env');
const srcFiles = walk(path.join(APP, 'src')).filter(f => /\.(ts|tsx|js)$/.test(f.rel));
/**
 * Production Kotlin only. Unit tests under `src/test` and `src/androidTest` feed
 * STOP inputs such as "بند" to the check on purpose; they are test data, not a
 * keyword list the app uses (Requirement 17.7).
 */
const kotlinFiles = walk(path.join(APP, 'android', 'app', 'src')).filter(
  f => f.rel.endsWith('.kt') && !/[\\/]src[\\/](test|androidTest)[\\/]/.test(f.rel),
);

function offenders(files: SourceFile[], test: (f: SourceFile) => boolean): string[] {
  return files.filter(test).map(f => f.rel);
}

describe('scan coverage', () => {
  test('every guard scans at least one file', () => {
    expect(appFiles.length).toBeGreaterThan(0);
    expect(srcFiles.length).toBeGreaterThan(0);
    expect(kotlinFiles.length).toBeGreaterThan(0);
    expect(srcFiles.map(f => f.rel)).toContain(AI_FILE);
  });
});

describe('src reads no environment or key config (16.1, 16.24)', () => {
  test('no process environment access', () => {
    expect(offenders(srcFiles, f => ENV_ACCESS.test(f.text))).toEqual([]);
  });

  test('no Gemini model variable', () => {
    expect(offenders(srcFiles, f => f.text.includes(MODEL_VAR))).toEqual([]);
  });

  test('the key variable name appears only as the env option key in gateway/ai.ts', () => {
    const allowed = (f: SourceFile): string =>
      f.rel === AI_FILE ? f.text.replace(ALLOWED_KEY_USE, '') : f.text;
    expect(offenders(srcFiles, f => allowed(f).includes(KEY_VAR))).toEqual([]);
    const ai = srcFiles.find(f => f.rel === AI_FILE)?.text ?? '';
    expect(ai.match(ALLOWED_KEY_USE)).toHaveLength(1);
  });
});

describe('src has no any type (17.6)', () => {
  test('no `: any` annotation or `as any` assertion', () => {
    const usesAny = (f: SourceFile): boolean => {
      const code = stripComments(f.text);
      return /:\s*any\b/.test(code) || /\bas\s+any\b/.test(code);
    };
    expect(offenders(srcFiles, usesAny)).toEqual([]);
  });
});

describe('no API key value in the app (16.2, 17.11)', () => {
  test('no file matches the Gemini API key pattern', () => {
    expect(offenders(appFiles, f => KEY_PATTERN.test(f.text))).toEqual([]);
  });
});

describe('Kotlin keeps no STOP keyword list (17.7)', () => {
  test('no Kotlin source holds a "band" or "بند" literal', () => {
    expect(offenders(kotlinFiles, f => /"band"/i.test(f.text) || f.text.includes('"بند"'))).toEqual(
      [],
    );
  });
});
