// Shape check for a 200 body from the Simulator_Route (Requirement 6.7).
// The snapshot is only checked to be an object; the server validates it on the next request.
import { COMMANDS, DEFAULT_SETTINGS, DELIVERY_OUTCOMES, LANGUAGES, OUTCOMES } from '@lazarus/brain';
import type { SimulatorResponse } from './wire.types';

const MAX_PARTS = 4;
const ENCODINGS: readonly unknown[] = ['GSM-7', 'UCS-2'];
const KINDS: readonly unknown[] = ['message', 'deliver'];

type Obj = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullOr(value: unknown, allowed: readonly unknown[]): boolean {
  return value === null || allowed.includes(value);
}

function isPart(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.text === 'string' &&
    Number.isInteger(value.units) &&
    Number.isInteger(value.limit)
  );
}

function isParts(value: unknown): boolean {
  return Array.isArray(value) && value.length <= MAX_PARTS && value.every(isPart);
}

function isRepliesLeft(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= DEFAULT_SETTINGS.perNumberLimit
  );
}

/** True when `value` has every field the Ouija_Simulator relies on. */
export function isSimulatorResponse(value: unknown): value is SimulatorResponse {
  if (!isObject(value)) return false;
  return (
    KINDS.includes(value.kind) &&
    isParts(value.parts) &&
    ENCODINGS.includes(value.encoding) &&
    isNullOr(value.command, COMMANDS) &&
    (LANGUAGES as readonly unknown[]).includes(value.language) &&
    isNullOr(value.outcome, OUTCOMES) &&
    isNullOr(value.deliveryOutcome, DELIVERY_OUTCOMES) &&
    isObject(value.snapshot) &&
    isRepliesLeft(value.repliesLeft) &&
    Number.isSafeInteger(value.serverTime)
  );
}
