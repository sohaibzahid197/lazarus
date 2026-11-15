import 'server-only';
import {
  localDayKey,
  type DeliveryOutcome,
  type GatewayState,
  type Language,
  type Reminder,
  type SendReport,
} from '@lazarus/brain';
import type { SimulatorResponse } from '../protocol/wire.types';
import type { HandleCtx } from './brainFns';
import { repliesLeft } from './repliesLeft';
import { buildParts } from './response.build';
import { sanitizeSnapshot } from './sanitize';
import { printSnapshot } from './snapshot.print';

// Handles one valid `deliver` Simulator_Request (Requirements 12.3, 13.4–13.6,
// 19.6). STOP, Late_Window, Daily_Send_Cap and the delivery text all come from
// the brain's `decideDelivery`; a stopped number always gets `reminder-stopped`
// and 0 parts (12.3).

/** Pakistan_Time offset in minutes, the argument the brain's `localDayKey` takes. */
const PAKISTAN_OFFSET_MINUTES = 300;

/**
 * Language when the Reminder_Id is not in the snapshot. The response then has
 * 0 parts and no Delivery_Outcome, so the client shows nothing (13.5).
 */
const NOT_FOUND_LANGUAGE: Language = 'en';

function findReminder(state: GatewayState, id: string): Reminder | undefined {
  if (state.reminders.status !== 'ok') return undefined;
  return state.reminders.reminders.find((r) => r.id === id);
}

/** The simulator hands every part to a perfect "radio": all parts are sent. */
function allSentReport(partCount: number): SendReport {
  return { status: 'done', results: Array.from({ length: partCount }, () => 'sent' as const), attempts: 1 };
}

function respond(
  state: GatewayState,
  ctx: HandleCtx,
  texts: readonly string[],
  language: Language,
  deliveryOutcome: DeliveryOutcome | null,
): SimulatorResponse {
  const { ai, number, serverTime } = ctx;
  const { parts, encoding } = buildParts(texts, ai.secrets);
  return {
    kind: 'deliver',
    parts,
    encoding,
    command: null,
    language,
    outcome: null,
    deliveryOutcome,
    snapshot: sanitizeSnapshot(printSnapshot(state, number), ai.secrets),
    repliesLeft: repliesLeft(state, number, serverTime),
    serverTime,
  };
}

export function handleDeliver(
  reminderId: string,
  state: GatewayState,
  ctx: HandleCtx,
): SimulatorResponse {
  const { brain, serverTime } = ctx;
  const r = findReminder(state, reminderId);
  if (r === undefined) return respond(state, ctx, [], NOT_FOUND_LANGUAGE, null);
  const today = localDayKey(serverTime, PAKISTAN_OFFSET_MINUTES);
  const step = brain.decideDelivery(r, state, serverTime, today);
  if (step.kind === 'wait') return respond(state, ctx, [], r.language, null);
  const s1 = brain.applyChanges(state, step.changes);
  if (step.kind === 'final') return respond(s1, ctx, [], r.language, step.outcome);
  const report = allSentReport(step.parts.length);
  const fin = brain.finalizeDelivery(r, step.parts.length, report, s1.counters, today);
  const s2 = brain.applyChanges(s1, fin.changes);
  return respond(s2, ctx, step.parts, r.language, fin.outcome);
}
