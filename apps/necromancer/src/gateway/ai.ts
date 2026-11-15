// AI client factory (necromancer-sms-gateway design, "JS glue", `gateway/ai.ts`).
// Reads the Gemini_Api_Key through the KeyStore port, builds the AI_Client through
// `@lazarus/brain/gemini` with no model name (Requirement 16.17) and holds only the
// client, its cache and the Masked_Key. The raw key lives only inside the client's
// closure; no field, snapshot or log line here holds it (Requirement 16.14).
// With no readable key, `answerDeps()` is null, so the Gateway_Pipeline sends the
// Try_Later_Text and makes no AI_Client call (Requirement 16.18 and 16.20).
import { createMemoryCache, maskApiKey, validateApiKey, type AnswerDeps } from '@lazarus/brain';
import { createGeminiClient } from '@lazarus/brain/gemini';
import type { KeyStorePort, LogFn, Unsubscribe } from '../native/ports';

export type AiKeyStatus = 'present' | 'absent' | 'unreadable';

/** What the UI may see: never the key, only its Masked_Key (Requirement 16.11). */
export interface AiSnapshot {
  readonly status: AiKeyStatus;
  readonly maskedKey: string | null;
}

export type SaveKeyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid' | 'write-failed' };

export interface AiHolder {
  /** Reads the key and rebuilds the client (Requirement 16.15). Never rejects. */
  refresh(): Promise<void>;
  /** Deps for the Answer_Service, or null when no readable key is stored. */
  answerDeps(): AnswerDeps | null;
  snapshot(): AiSnapshot;
  /** Validates, writes, then rebuilds (Requirement 16.3, 16.5, 16.6). Never rejects. */
  save(rawKey: string): Promise<SaveKeyResult>;
  /** Deletes the key, then rebuilds (Requirement 16.8). Resolves false if the delete failed. */
  remove(): Promise<boolean>;
  /** Called after every snapshot change. */
  subscribe(listener: () => void): Unsubscribe;
}

interface Built {
  readonly snapshot: AiSnapshot;
  readonly deps: AnswerDeps | null;
}

const EMPTY: Built = { snapshot: { status: 'absent', maskedKey: null }, deps: null };
const dropLog: LogFn = () => undefined;

function buildDeps(key: string, now: () => number, log: LogFn): AnswerDeps {
  // No model and no process env: the entry point uses its default free-tier model.
  const client = createGeminiClient({ env: { GEMINI_API_KEY: key }, log });
  return { client, cache: createMemoryCache(), clock: now };
}

/**
 * `now` is the Answer_Service clock (ms). `log` gets only lines the brain has
 * already redacted and phone-masked; the default drops them.
 */
export function createAiHolder(
  keyStore: KeyStorePort,
  now: () => number,
  log: LogFn = dropLog,
): AiHolder {
  let built: Built = EMPTY;
  let generation = 0;
  const listeners = new Set<() => void>();

  const publish = (next: Built): void => {
    built = next;
    for (const listener of [...listeners]) listener();
  };

  const refresh = async (): Promise<void> => {
    const mine = ++generation;
    const read = await keyStore.readKey(); // never rejects (KeyStorePort contract)
    if (mine !== generation) return; // a later refresh owns the result
    if (read.status !== 'present') {
      publish({ snapshot: { status: read.status, maskedKey: null }, deps: null });
      return;
    }
    publish({
      snapshot: { status: 'present', maskedKey: maskApiKey(read.key) },
      deps: buildDeps(read.key, now, log),
    });
  };

  const save = async (rawKey: string): Promise<SaveKeyResult> => {
    const check = validateApiKey(rawKey);
    if (!check.ok) return { ok: false, reason: 'invalid' };
    try {
      await keyStore.saveKey(check.key);
    } catch {
      log('ai: key save failed'); // no error text: it could echo the key
      return { ok: false, reason: 'write-failed' };
    }
    await refresh();
    return { ok: true };
  };

  const remove = async (): Promise<boolean> => {
    let ok = true;
    try {
      await keyStore.deleteKey();
    } catch {
      log('ai: key delete failed');
      ok = false;
    }
    await refresh(); // show what the store holds now, either way
    return ok;
  };

  return {
    refresh,
    answerDeps: () => built.deps,
    snapshot: () => built.snapshot,
    save,
    remove,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
