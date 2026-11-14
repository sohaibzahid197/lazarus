// Test-only guards (Requirements 1.6, 13.1). Installed by `test.setup.ts`.
//
// - Global `fetch` is replaced by a stub that records a violation and rejects,
//   so no test can reach the network through it.
// - `process.env` is wrapped in a Proxy that records every read of
//   `GEMINI_API_KEY` or `GEMINI_MODEL`. Only adapter tests (`gemini.*.test.ts`)
//   may read them; the setup file fails any other test that did.
//
// Violations are recorded rather than thrown at the call site, because the
// Answer_Service catches errors and a thrown guard error could be swallowed.

export const GUARDED_ENV_KEYS: readonly string[] = ['GEMINI_API_KEY', 'GEMINI_MODEL'];

export interface GuardViolation {
  readonly kind: 'fetch' | 'env';
  readonly detail: string;
}

const violations: GuardViolation[] = [];

/** Returns and clears every violation recorded so far. */
export function takeViolations(): GuardViolation[] {
  return violations.splice(0, violations.length);
}

/** True for adapter test files, which may read the Gemini env vars. */
export function isAdapterTestFile(filePath: string): boolean {
  const name = filePath.split(/[\\/]/).pop() ?? '';
  return /^gemini\..*\.test\.ts$/.test(name);
}

/** Replacement for global `fetch`. The URL is not recorded, as it could hold a key. */
export const guardedFetch: typeof fetch = () => {
  violations.push({ kind: 'fetch', detail: 'global fetch was called' });
  return Promise.reject(new Error('Network access is not allowed in tests.'));
};

function isGuardedKey(prop: string | symbol): prop is string {
  return typeof prop === 'string' && GUARDED_ENV_KEYS.includes(prop);
}

/** Wraps an env object so reads of the guarded keys are recorded. */
export function guardEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return new Proxy(env, {
    get(target, prop) {
      if (isGuardedKey(prop)) violations.push({ kind: 'env', detail: `read of ${prop}` });
      return Reflect.get(target, prop);
    },
    has(target, prop) {
      if (isGuardedKey(prop)) violations.push({ kind: 'env', detail: `check of ${prop}` });
      return Reflect.has(target, prop);
    },
  });
}

const INSTALLED = Symbol.for('lazarus.brain.testGuardsInstalled');

interface GuardFlag {
  [INSTALLED]?: true;
}

/** Installs both guards once per global scope. */
export function installGuards(): void {
  const flag = globalThis as GuardFlag;
  if (flag[INSTALLED] === true) return;
  flag[INSTALLED] = true;
  globalThis.fetch = guardedFetch;
  process.env = guardEnv(process.env);
}

/** Violations that fail a test in `filePath`: every fetch, and env reads outside adapter tests. */
export function blockingViolations(
  found: readonly GuardViolation[],
  filePath: string,
): GuardViolation[] {
  const adapter = isAdapterTestFile(filePath);
  return found.filter((v) => v.kind === 'fetch' || !adapter);
}
