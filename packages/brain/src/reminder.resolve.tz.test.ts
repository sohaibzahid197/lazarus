import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Validates: Requirements 3.1, 14.5
// Runs routeCommand → parseReminder → resolveDueTime in child Node processes
// with different TZ settings and checks the Due_Times do not change.

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TIMEOUT_MS = 60_000;
const ZONES = ['UTC', 'America/New_York'] as const;

const moduleUrl = (file: string): string => new URL(`./${file}`, import.meta.url).href;
const MODULE_URLS = [
  moduleUrl('router.ts'),
  moduleUrl('reminder.parse.ts'),
  moduleUrl('reminder.resolve.ts'),
];

const AT_10_PKT = Date.parse('2025-01-15T05:00:00.000Z');
const HORIZON_MS = 2_592_000_000;

interface Case {
  readonly input: string;
  readonly receivedAt: number;
}

type Outcome =
  | { readonly ok: true; readonly dueAt: number; readonly text: string }
  | { readonly ok: false; readonly error: string };

interface ChildReport {
  readonly timeZone: string;
  readonly offsetMinutes: number;
  readonly outcomes: readonly Outcome[];
}

const due = (iso: string, text: string): Outcome => ({ ok: true, dueAt: Date.parse(iso), text });
const fail = (error: string): Outcome => ({ ok: false, error });

const CASES: ReadonlyArray<readonly [Case, Outcome]> = [
  [{ input: 'REMIND 8pm take medicine', receivedAt: AT_10_PKT }, due('2025-01-15T15:00:00.000Z', 'take medicine')],
  [{ input: 'REMIND 20:00 call Ali', receivedAt: AT_10_PKT }, due('2025-01-15T15:00:00.000Z', 'call Ali')],
  [{ input: 'YAAD kal subah 9 dawai', receivedAt: AT_10_PKT }, due('2025-01-16T04:00:00.000Z', 'dawai')],
  [{ input: 'REMIND in 2 hours drink water', receivedAt: AT_10_PKT }, due('2025-01-15T07:00:00.000Z', 'drink water')],
  [{ input: 'یاد شام کو دوا لینی ہے', receivedAt: AT_10_PKT }, due('2025-01-15T13:00:00.000Z', 'دوا لینی ہے')],
  [{ input: 'REMIND today 8am x', receivedAt: AT_10_PKT }, fail('past')],
  [{ input: 'REMIND in 31 days x', receivedAt: AT_10_PKT }, fail('too-far')],
  [{ input: 'REMIND in 30 days x', receivedAt: AT_10_PKT }, { ok: true, dueAt: AT_10_PKT + HORIZON_MS, text: 'x' }],
  [
    { input: 'REMIND tomorrow 8am x', receivedAt: Date.parse('2025-01-15T18:30:00.000Z') },
    due('2025-01-16T03:00:00.000Z', 'x'),
  ],
  [
    { input: 'REMIND 8pm x', receivedAt: Date.parse('2025-01-15T15:00:00.000Z') },
    due('2025-01-16T15:00:00.000Z', 'x'),
  ],
  [
    { input: 'REMIND 8pm x', receivedAt: Date.parse('2025-01-01T15:30:00.000Z') },
    due('2025-01-02T15:00:00.000Z', 'x'),
  ],
];

// Inline child script: argv[1] = JSON module URLs, argv[2] = JSON cases.
const CHILD_SCRIPT = `
const [routerUrl, parseUrl, resolveUrl] = JSON.parse(process.argv[1]);
const cases = JSON.parse(process.argv[2]);
const { routeCommand } = await import(routerUrl);
const { parseReminder } = await import(parseUrl);
const { resolveDueTime } = await import(resolveUrl);
const outcomes = cases.map(({ input, receivedAt }) => {
  const routed = routeCommand(input);
  if (routed.command !== 'REMIND') return { ok: false, error: 'routed:' + routed.command };
  const parsed = parseReminder(routed.argument);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const resolved = resolveDueTime(parsed.expr, receivedAt);
  return resolved.ok
    ? { ok: true, dueAt: resolved.dueAt, text: parsed.text }
    : { ok: false, error: resolved.error };
});
process.stdout.write(JSON.stringify({
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  offsetMinutes: new Date(cases[0].receivedAt).getTimezoneOffset(),
  outcomes,
}));
`;

function runInZone(timeZone: string): Promise<ChildReport> {
  const cases = CASES.map(([c]) => c);
  const args = [
    '--import',
    './scripts/ts-resolve.mjs',
    '--input-type=module',
    '--eval',
    CHILD_SCRIPT,
    JSON.stringify(MODULE_URLS),
    JSON.stringify(cases),
  ];
  return new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      args,
      { cwd: PACKAGE_ROOT, timeout: TIMEOUT_MS, env: { ...process.env, TZ: timeZone } },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`child (TZ=${timeZone}) failed: ${error.message}\n${String(stderr)}`));
          return;
        }
        resolvePromise(JSON.parse(String(stdout)) as ChildReport);
      },
    );
  });
}

describe('Due_Time_Resolver ignores the process time zone (3.1, 14.5)', () => {
  it(
    'gives the same, expected Due_Times under TZ=UTC and TZ=America/New_York',
    async () => {
      const [utc, newYork] = await Promise.all(ZONES.map(runInZone));
      if (utc === undefined || newYork === undefined) throw new Error('missing child report');

      // The children really ran in different zones.
      expect(utc.timeZone).toBe('UTC');
      expect(newYork.timeZone).toBe('America/New_York');
      expect(utc.offsetMinutes).toBe(0);
      expect(newYork.offsetMinutes).toBe(300);

      const expected = CASES.map(([, outcome]) => outcome);
      expect(utc.outcomes).toEqual(expected);
      expect(newYork.outcomes).toEqual(utc.outcomes);
    },
    TIMEOUT_MS,
  );
});
