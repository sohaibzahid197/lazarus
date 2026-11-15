// Client-bundle scan (Requirements 1.3, 9.5, 17.7). Run only by
// `npm run test:bundle`, which first runs `next build --webpack` with
// GEMINI_API_KEY set to a fixed fake key, never a real one.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEST_KEY } from '../src/test/pbt';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const NEXT_DIR = join(APP_DIR, '.next');
const STATIC_DIR = join(NEXT_DIR, 'static');
const PRERENDER_DIR = join(NEXT_DIR, 'server', 'app');

/** The key the build used: the script's CRYPT_TEST_KEY override, else the fixed fake key. */
const BUILD_KEY = process.env['CRYPT_TEST_KEY'] ?? TEST_KEY;

/** Pre-rendered documents of `/` and `/crypt`: the HTML and the RSC payload for client navigation. */
const PRERENDERED = ['index.html', 'crypt.html', 'index.rsc', 'crypt.rsc'];

interface Needle {
  readonly label: string;
  readonly pattern: RegExp;
}

function literal(label: string, text: string): Needle {
  return { label, pattern: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) };
}

/** Strings that must appear in no client file and no pre-rendered page. */
const SECRET_NEEDLES: readonly Needle[] = [
  literal('test key', BUILD_KEY),
  literal('fixed fake key', TEST_KEY),
  literal('Simulator_Number', '+999666000000666'),
  literal('Simulator_Number digits', '999666000000666'),
  literal('GEMINI_API_KEY name', 'GEMINI_API_KEY'),
  { label: 'GEMINI_ env name', pattern: /GEMINI_[A-Z]/ },
  { label: 'NEXT_PUBLIC_ env name', pattern: /NEXT_PUBLIC_/ },
];

/** String literals that exist only in src/server, the server-only package or the Gemini adapter. */
const SERVER_CODE_NEEDLES: readonly Needle[] = [
  literal('server-only guard', 'cannot be imported from a Client Component'),
  literal('src/server/clientIp.ts', 'x-forwarded-for'),
  literal('src/server/response.build.ts error code', 'body-too-large'),
  literal('src/server/response.build.ts error code', 'method-not-allowed'),
  literal('src/server/snapshot.parse.ts error', 'too-many-times'),
  literal('src/server/snapshot.parse.ts error', 'created-after-due'),
  literal('src/server/snapshot.parse.ts error', 'time-in-future'),
  literal('@google/genai', '@google/genai'),
  literal('Gemini endpoint', 'generativelanguage.googleapis.com'),
  literal('Gemini call', 'generateContent'),
];

/** 7 or more digits, counting digits separated only by spaces or hyphens as one run (15.10). */
const DIGIT_RUN = /[0-9](?:[ -]*[0-9]){6,}/;
/**
 * Hashed asset paths are not page text: `/_next/static/chunks/page-8211e87ff6b6d616.js`
 * in HTML, and `static/chunks/app/page-6589238788768821.js` (no `/_next/`) in the RSC payload.
 * A content hash can be all digits by chance.
 */
const ASSET_PATH = /(?:\/_next\/|\bstatic\/(?:chunks|css|media)\/)[^"'\s)\\]*/g;

interface Hit {
  readonly file: string;
  readonly label: string;
  readonly match: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** latin1 keeps one char per byte, so ASCII needles are found in text and binary files alike. */
function read(path: string): string {
  return readFileSync(path, 'latin1');
}

function findHits(file: string, text: string, needles: readonly Needle[]): Hit[] {
  return needles.flatMap(({ label, pattern }) => {
    const m = pattern.exec(text);
    return m === null ? [] : [{ file, label, match: m[0] }];
  });
}

function findDigitRun(file: string, text: string): Hit[] {
  const m = DIGIT_RUN.exec(text.replace(ASSET_PATH, ''));
  return m === null ? [] : [{ file, label: '7-digit run', match: m[0] }];
}

function describeHits(hits: readonly Hit[]): string {
  return hits.map((h) => `${h.file}: ${h.label} -> ${JSON.stringify(h.match)}`).join('\n');
}

function rel(path: string): string {
  return relative(APP_DIR, path);
}

describe('client bundle scan', () => {
  it('finds a production build to scan', () => {
    expect(existsSync(join(NEXT_DIR, 'BUILD_ID')), 'run `npm run test:bundle`, which builds first').toBe(true);
    expect(walk(STATIC_DIR).some((f) => f.endsWith('.js'))).toBe(true);
    for (const name of PRERENDERED) expect(existsSync(join(PRERENDER_DIR, name)), name).toBe(true);
  });

  it('the matchers detect planted leaks', () => {
    const planted = `a="${BUILD_KEY}";b="+999666000000666";c=process.env.GEMINI_MODEL;d="x-forwarded-for"`;
    const labels = findHits('planted', planted, [...SECRET_NEEDLES, ...SERVER_CODE_NEEDLES]).map((h) => h.label);
    expect(labels).toEqual(
      expect.arrayContaining(['test key', 'Simulator_Number', 'GEMINI_ env name', 'src/server/clientIp.ts']),
    );
    expect(findDigitRun('planted', '<p>0300-123 4567</p>')).toHaveLength(1);
    expect(findDigitRun('planted', '<script src="/_next/static/chunks/page-82116877166.js"></script>')).toHaveLength(0);
    expect(findDigitRun('planted', '6:\\"static/chunks/app/page-6589238788768821.js\\"')).toHaveLength(0);
  });

  it('no client file holds the key, the Simulator_Number, env names or server code', () => {
    const hits = walk(STATIC_DIR).flatMap((f) =>
      findHits(rel(f), read(f), [...SECRET_NEEDLES, ...SERVER_CODE_NEEDLES]),
    );
    expect(hits, describeHits(hits)).toEqual([]);
  });

  it('the pre-rendered / and /crypt hold no key, Simulator_Number, env name, server code or 7-digit run', () => {
    const hits = PRERENDERED.flatMap((name) => {
      const path = join(PRERENDER_DIR, name);
      const text = read(path);
      return [...findHits(rel(path), text, [...SECRET_NEEDLES, ...SERVER_CODE_NEEDLES]), ...findDigitRun(rel(path), text)];
    });
    expect(hits, describeHits(hits)).toEqual([]);
  });
});
