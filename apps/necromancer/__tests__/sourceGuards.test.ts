/**
 * Source guards: static scans of the committed Necromancer sources.
 * Requirements 16.1 and 16.24 (no environment or build-config reads for the key or
 * model), 16.2 and 17.11 (no API key value in any file), 17.6 (no `any`),
 * 17.7 (no separately maintained STOP keyword list in Kotlin), sms-reminders 11.12
 * (no time parsing or slot logic in `src`; reminder logic comes from `@lazarus/brain`).
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

// sms-reminders Requirement 11.12: the app only runs the brain's decisions.
const REMINDERS_FILE = path.join('src', 'gateway', 'reminders.ts');
const LOOP_REMINDERS_FILE = path.join('src', 'gateway', 'loopReminders.ts');
/** Urdu day-period words the brain's parser owns, built from pieces like the patterns above. */
const SLOT_WORDS = new RegExp('\\b(' + ['sub' + 'ah', 'sha' + 'am', 'ra' + 'at'].join('|') + ')\\b', 'i');
/** `% 12` (or `%12`) hour math for 12-hour clocks. */
const HOUR_MATH = new RegExp('%\\s*' + '12\\b');
/**
 * An `am` or `pm` token (also `a.m.`, `[ap]m`) inside a regex body. A letter before or
 * after means another word (`name`, `ample`), except a regex escape such as `\b` or `\d`.
 */
const AM_PM = new RegExp(
  '(?:(?<![a-z])|(?<=\\\\[bdsw]))(?:[ap]|\\[ap\\])(?:\\\\?\\.\\??)?m(?![a-z])',
  'i',
);
/**
 * Regex literals (after a token that can start an expression, so division is skipped)
 * and string arguments of `new RegExp(...)`.
 */
const REGEX_LITERAL =
  /(?:^|[=(,:[!&|?{};]|\breturn)\s*\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/[dgimsuy]*/gm;
const REGEX_CTOR = /\bRegExp\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
function regexBodies(code: string): string[] {
  const bodies: string[] = [];
  for (const m of code.matchAll(REGEX_LITERAL)) bodies.push(m[1] ?? '');
  for (const m of code.matchAll(REGEX_CTOR)) bodies.push(m[2] ?? '');
  return bodies;
}
/** Reminder logic exported by `@lazarus/brain` that `src` must import, never re-implement. */
const BRAIN_REMINDER_LOGIC = [
  'parseReminder',
  'resolveDueTime',
  'printTimeExpression',
  'isValidTimeExpression',
  'pkWallClock',
  'pkDayStart',
  'formatWhen',
  'nextDueAt',
  'lowestFreeSlot',
  'decideDelivery',
  'dueReminders',
  'finalizeDelivery',
  'reconcileOnLoad',
];
const LOCAL_DECLARATION = new RegExp(
  `\\b(?:function\\s*\\*?|const|let|var|class)\\s+(?:${BRAIN_REMINDER_LOGIC.join('|')})\\b`,
);
/** Named imports of one module specifier in `code`. */
function namedImports(code: string, from: string): string[] {
  const names: string[] = [];
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']+)'/g;
  for (const m of code.matchAll(re)) {
    if (m[2] !== from) continue;
    for (const part of (m[1] ?? '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (name) names.push(name);
    }
  }
  return names;
}
describe('src holds no time parsing or slot logic (sms-reminders 11.12)', () => {
  test('the reminder sources are scanned', () => {
    const rels = srcFiles.map(f => f.rel);
    expect(rels).toContain(REMINDERS_FILE);
    expect(rels).toContain(LOOP_REMINDERS_FILE);
  });
  test('no subah, shaam or raat', () => {
    expect(offenders(srcFiles, f => SLOT_WORDS.test(f.text))).toEqual([]);
  });
  test('no am or pm regex', () => {
    const hasAmPm = (f: SourceFile): boolean =>
      regexBodies(stripComments(f.text)).some(body => AM_PM.test(body));
    expect(offenders(srcFiles, hasAmPm)).toEqual([]);
  });
  test('the am/pm scan finds regex literals and RegExp strings', () => {
    expect(regexBodies('const r = /(\\d+)\\s*pm/i;').some(b => AM_PM.test(b))).toBe(true);
    expect(regexBodies("x.match(/[ap]\\.?m/)").some(b => AM_PM.test(b))).toBe(true);
    expect(regexBodies("new RegExp('\\\\bam\\\\b')").some(b => AM_PM.test(b))).toBe(true);
    expect(regexBodies('const n = a / pm / b;')).toEqual([]);
  });
  test('no % 12 hour math', () => {
    expect(offenders(srcFiles, f => HOUR_MATH.test(stripComments(f.text)))).toEqual([]);
  });
});
describe('src imports reminder logic from @lazarus/brain (sms-reminders 11.12)', () => {
  test('no src file declares its own copy of a brain reminder function', () => {
    expect(offenders(srcFiles, f => LOCAL_DECLARATION.test(stripComments(f.text)))).toEqual([]);
  });
  test('no src file reaches into the brain package by path', () => {
    const deepImport = /from\s*'[^']*(?:packages\/brain|@lazarus\/brain\/src)[^']*'/;
    expect(offenders(srcFiles, f => deepImport.test(f.text))).toEqual([]);
  });
  test('the reminders runner takes its delivery decisions from @lazarus/brain', () => {
    const code = srcFiles.find(f => f.rel === REMINDERS_FILE)?.text ?? '';
    expect(namedImports(code, '@lazarus/brain')).toEqual(
      expect.arrayContaining(['decideDelivery', 'dueReminders', 'finalizeDelivery', 'reconcileOnLoad']),
    );
  });
  test('the loop reminders work item imports from @lazarus/brain', () => {
    const code = srcFiles.find(f => f.rel === LOOP_REMINDERS_FILE)?.text ?? '';
    expect(namedImports(code, '@lazarus/brain')).toEqual(
      expect.arrayContaining(['reminderWriteFailed']),
    );
  });
});
