// Source guards: static scans of the committed Crypt_App sources (task 17.1).
// Requirements 1.2, 1.3, 1.6, 1.9, 7.6, 7.11, 8.6, 9.5, 14.1, 17.1, 19.6.
// Test code (`*.test.*` and `src/test/**`) is excluded from the scans of shipped
// code, because tests must hold the Simulator_Number and the fake key to check
// that neither leaks.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = resolve(APP, '..', '..');
const SRC = join(APP, 'src');

/** Built from parts so this file never holds the literal it looks for. */
const SIM_DIGITS = ['999', '666', '000', '000', '666'].join('');
const SIM_NUMBER = `+${SIM_DIGITS}`;

interface SourceFile {
  readonly rel: string; // relative to apps/crypt, forward slashes
  readonly text: string;
}

const SKIP_DIRS = new Set(['node_modules', '.next', 'test-results', 'playwright-report', '.git']);

function walk(dir: string, filter: (name: string) => boolean): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(abs, filter));
    } else if (entry.isFile() && filter(entry.name)) {
      out.push({ rel: relative(APP, abs).split('\\').join('/'), text: readFileSync(abs, 'utf8') });
    }
  }
  return out;
}

const isCode = (name: string): boolean => /\.(ts|tsx)$/.test(name);
const isTestPath = (rel: string): boolean => /\.test\.tsx?$/.test(rel) || rel.startsWith('src/test/');

const ALL_CODE = walk(SRC, isCode);
/** Shipped TypeScript: every non-test file under src. */
const SHIPPED = ALL_CODE.filter((f) => !isTestPath(f.rel));

/** Removes block and line comments (keeps `://` in URLs), so prose never counts as code. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Import specifiers of `import … from 'x'`, `import 'x'`, `export … from 'x'` and `import('x')`. */
function importsOf(code: string): string[] {
  const specs: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;
  for (const m of stripComments(code).matchAll(re)) {
    if (m[1] !== undefined) specs.push(m[1]);
  }
  return specs;
}

/** `[file:line] text` for each line that matches, for readable failures. */
function hits(files: readonly SourceFile[], re: RegExp, strip = true): string[] {
  const out: string[] = [];
  for (const f of files) {
    const lines = (strip ? stripComments(f.text) : f.text).split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) out.push(`${f.rel}:${String(i + 1)} ${line.trim()}`);
    });
  }
  return out;
}

function firstCodeLine(text: string): string {
  const line = stripComments(text)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  return line ?? '';
}

const isClientComponent = (f: SourceFile): boolean => /^['"]use client['"];?$/.test(firstCodeLine(f.text));

/** Resolves a relative import to an apps/crypt-relative path, or null for packages. */
function resolveRelative(fromRel: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(APP, dirname(fromRel), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  const found = candidates.find((c) => existsSync(c) && isCode(c));
  return found === undefined ? null : relative(APP, found).split('\\').join('/');
}

describe('Feature: crypt-ouija-simulator, source guards', () => {
  it('finds the source tree it scans', () => {
    expect(SHIPPED.length).toBeGreaterThan(40);
    expect(SHIPPED.map((f) => f.rel)).toContain('src/server/env.ts');
    expect(SHIPPED.map((f) => f.rel)).toContain('src/ui/ExampleList.tsx');
  });

  it('reads process.env only in src/server/env.ts (1.6)', () => {
    const offenders = hits(
      SHIPPED.filter((f) => f.rel !== 'src/server/env.ts'),
      /\bprocess\s*\.\s*env\b|\bprocess\s*\[\s*['"]env['"]\s*\]/,
    );
    expect(offenders).toEqual([]);
  });

  it('reads no environment variable other than GEMINI_API_KEY and GEMINI_MODEL (1.6)', () => {
    const env = SHIPPED.find((f) => f.rel === 'src/server/env.ts');
    expect(env).toBeDefined();
    const names = [...stripComments(env?.text ?? '').matchAll(/\bsource\s*\.\s*([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(new Set(['GEMINI_API_KEY', 'GEMINI_MODEL']));
  });

  it('imports the brain only through its public entry points (1.2)', () => {
    const offenders: string[] = [];
    for (const f of ALL_CODE) {
      for (const spec of importsOf(f.text)) {
        const internal = spec.startsWith('@lazarus/brain/') && spec !== '@lazarus/brain/gemini';
        const intoPackages = spec.startsWith('.') && /(^|\/)packages(\/|$)/.test(spec);
        if (internal || intoPackages) offenders.push(`${f.rel}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('imports @lazarus/brain/gemini only in src/server/ai.ts (1.3)', () => {
    const users = SHIPPED.filter((f) => importsOf(f.text).includes('@lazarus/brain/gemini')).map((f) => f.rel);
    expect(users).toEqual(['src/server/ai.ts']);
  });

  it('starts every src/server module and dashboard.data.ts with server-only (1.3)', () => {
    const serverOnly = SHIPPED.filter(
      (f) => f.rel.startsWith('src/server/') || f.rel === 'src/dashboard/dashboard.data.ts',
    );
    expect(serverOnly.length).toBeGreaterThan(15);
    const offenders = serverOnly.filter((f) => firstCodeLine(f.text) !== "import 'server-only';").map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('never imports src/server from ui, session, t9 or protocol (1.3)', () => {
    const clientSide = SHIPPED.filter((f) => /^src\/(ui|session|t9|protocol)\//.test(f.rel));
    const offenders: string[] = [];
    for (const f of clientSide) {
      for (const spec of importsOf(f.text)) {
        const target = resolveRelative(f.rel, spec);
        if (target?.startsWith('src/server/') === true) offenders.push(`${f.rel}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps server-only modules out of every client component import graph (1.3, 9.5)', () => {
    const roots = SHIPPED.filter(isClientComponent).map((f) => f.rel);
    expect(roots.length).toBeGreaterThan(0);
    const byRel = new Map(SHIPPED.map((f) => [f.rel, f] as const));
    const seen = new Set<string>();
    const queue = [...roots];
    const offenders: string[] = [];
    while (queue.length > 0) {
      const rel = queue.pop();
      if (rel === undefined || seen.has(rel)) continue;
      seen.add(rel);
      const file = byRel.get(rel);
      if (file === undefined) continue;
      if (rel.startsWith('src/server/') || rel === 'src/dashboard/dashboard.data.ts') offenders.push(rel);
      for (const spec of importsOf(file.text)) {
        if (spec === '@lazarus/brain/gemini' || spec === 'server-only') offenders.push(`${rel}: ${spec}`);
        const target = resolveRelative(rel, spec);
        if (target !== null) queue.push(target);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the Crypt_Dashboard a server component (15.7)', () => {
    const dashboard = SHIPPED.filter((f) => f.rel.startsWith('src/dashboard/') || f.rel === 'src/app/crypt/page.tsx');
    expect(dashboard.filter(isClientComponent).map((f) => f.rel)).toEqual([]);
    expect(hits(dashboard, /\bfetch\s*\(|<form\b|<input\b|<textarea\b|contentEditable/)).toEqual([]);
  });

  it('declares the Node.js runtime for the Simulator_Route (1.9)', () => {
    const route = readFileSync(join(SRC, 'app/api/ouija/route.ts'), 'utf8');
    expect(stripComments(route)).toMatch(/export const runtime = 'nodejs';/);
  });

  it('uses no NEXT_PUBLIC_ variable and exposes no env in next.config (9.5)', () => {
    const config = { rel: 'next.config.ts', text: readFileSync(join(APP, 'next.config.ts'), 'utf8') };
    expect(hits([...SHIPPED, config], /NEXT_PUBLIC_/)).toEqual([]);
    expect(hits([config], /\benv\s*:/)).toEqual([]);
  });

  it('writes nothing to browser storage, cookies or the URL (8.6, 1.11)', () => {
    const offenders = hits(
      SHIPPED,
      /\b(localStorage|sessionStorage|indexedDB)\b|document\s*\.\s*cookie|\b(pushState|replaceState)\s*\(|[Ss]et-[Cc]ookie|cookies\s*\(/,
    );
    expect(offenders).toEqual([]);
  });

  it('makes no console call in shipped code (7.11)', () => {
    expect(hits(SHIPPED, /\bconsole\s*\.\s*[a-z]+\s*\(/)).toEqual([]);
  });

  it('holds the Simulator_Number literal only in src/server/simulatorNumber.ts (17.1)', () => {
    const offenders = SHIPPED.filter(
      (f) => f.rel !== 'src/server/simulatorNumber.ts' && f.text.includes(SIM_DIGITS),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
    const home = SHIPPED.find((f) => f.rel === 'src/server/simulatorNumber.ts');
    expect(home?.text.includes(SIM_NUMBER)).toBe(true);
  });

  it('defines no rate limit, window or send cap of its own (19.6)', () => {
    // Values must come from DEFAULT_SETTINGS; a literal assignment duplicates the brain.
    const assigned = hits(SHIPPED, /\b(perNumberLimit|rateWindowMinutes|dailySendCap)\s*[:=]\s*\d/);
    expect(assigned).toEqual([]);
    // The UI text takes "of 5" from DEFAULT_SETTINGS, never as a literal.
    expect(hits(SHIPPED, /Replies left: [^'"`]* of \d/)).toEqual([]);
  });

  it('contains no command routing, language detection or SMS splitting of its own (7.6)', () => {
    // Command keyword matching on raw text (alias tables, regexes, upper-cased compares).
    const regexOrCompare = hits(SHIPPED, /\/[^/\n]*\b(HELP|STOP|START|SCAM|REMIND|LIST|CANCEL)\b[^/\n]*\/[gimsuy]*/).concat(
      hits(SHIPPED, /\.(toUpperCase|toLowerCase)\(\)\s*(===|!==|==|\.startsWith|\.includes)/),
    );
    expect(regexOrCompare).toEqual([]);
    // Roman Urdu marker word lists (the brain's Language_Detector owns them).
    const markers = hits(
      SHIPPED.filter((f) => f.rel !== 'src/ui/examples.ts'),
      /\[[^\]]*['"](kya|hai|aap|mein|nahi|kaise)['"][^\]]*\]/,
    );
    expect(markers).toEqual([]);
    // SMS part limits as code literals (the SMS_Splitter and getPartLimits own them).
    expect(hits(SHIPPED, /(?<![\w.'"-])(153|160|67|70)(?![\w.'"-])/)).toEqual([]);
  });

  it('commits no real-looking Gemini API key (1.6, 9.5)', () => {
    const files = walk(APP, (name) => /\.(ts|tsx|js|mjs|cjs|json|md|css|env|example|ya?ml)$/.test(name) || name.startsWith('.env'));
    const rootExample = { rel: '../../.env.example', text: readFileSync(join(REPO, '.env.example'), 'utf8') };
    const offenders = hits([...files, rootExample], /AIza[0-9A-Za-z_-]{35}/, false);
    expect(offenders).toEqual([]);
    // .env.example lists both names with empty values (1.6).
    expect(rootExample.text).toMatch(/^GEMINI_API_KEY=\s*$/m);
    expect(rootExample.text).toMatch(/^GEMINI_MODEL=\s*$/m);
  });

  describe('theme uses only the Theme_Tokens (14.1)', () => {
    const css = stripComments(readFileSync(join(SRC, 'app/globals.css'), 'utf8'));
    const TOKENS = new Set(['#0b0f0c', '#141a16', '#e6f2e9', '#8fa396', '#39ff88', '#ffb347', '#ff4d5e']);
    const declarations = [...css.matchAll(/(?:^|[\s;{])(-{0,2}[a-z][a-z0-9-]*)\s*:\s*([^;{}]+);/g)].map((m) => ({
      prop: m[1] ?? '',
      value: (m[2] ?? '').trim(),
    }));

    it('defines the spacing scale and radius tokens', () => {
      const vars = new Map(declarations.filter((d) => d.prop.startsWith('--')).map((d) => [d.prop, d.value]));
      expect(['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'].map((v) => vars.get(v))).toEqual([
        '4px', '8px', '12px', '16px', '24px', '32px',
      ]);
      expect(vars.get('--radius')).toBe('14px');
    });

    it('uses only token hex colors and no rgb, hsl or named colors', () => {
      const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
      expect(hexes.filter((h) => !TOKENS.has(h))).toEqual([]);
      expect(css).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/);
      const named = /(^|[\s,(])(white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|silver)(?=$|[\s,)])/i;
      const colorProps = declarations.filter((d) => !d.prop.startsWith('--') && /color|background|border|outline|fill|stroke|shadow|filter/.test(d.prop));
      expect(colorProps.filter((d) => named.test(d.value))).toEqual([]);
    });

    it('uses radius 14 and the spacing scale for every radius, margin, padding and gap', () => {
      const radius = declarations.filter((d) => /radius$/.test(d.prop) && !d.prop.startsWith('--'));
      expect(radius.length).toBeGreaterThan(0);
      expect(radius.filter((d) => !/^(var\(--radius\)|14px)$/.test(d.value))).toEqual([]);
      const spaceProp = /^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(row-|column-)?gap$/;
      const spaceValue = /^(0|auto|var\(--s[1-6]\)|(4|8|12|16|24|32)px)$/;
      const bad = declarations
        .filter((d) => spaceProp.test(d.prop))
        .filter((d) => !d.value.split(/\s+/).every((part) => spaceValue.test(part)));
      expect(bad).toEqual([]);
    });

    it('sets no inline style or hex color in components', () => {
      const tsx = SHIPPED.filter((f) => f.rel.endsWith('.tsx'));
      expect(hits(tsx, /\bstyle\s*=\s*\{/)).toEqual([]);
      expect(hits(SHIPPED, /#[0-9a-fA-F]{6}\b/)).toEqual([]);
    });
  });
});
