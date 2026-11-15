import 'server-only';
import {
  localDayKey,
  type GatewayDecision,
  type GatewayState,
  type InboundMessage,
  type SendReport,
} from '@lazarus/brain';
import type { SimulatorResponse } from '../protocol/wire.types';
import type { HandleCtx } from './brainFns';
import { messageIdFor } from './messageId';
import { repliesLeft } from './repliesLeft';
import { buildParts } from './response.build';
import { sanitizeSnapshot } from './sanitize';
import { printSnapshot } from './snapshot.print';

// Handles one valid `message` Simulator_Request (Requirements 7.1–7.6, 9.4,
// 12.1–12.7, 13.1, 19.6). Routing, Language, splitting, STOP/START, limits,
// reminders and every reply text come from `runGatewayPipeline` (7.6).

/** Pakistan_Time offset in minutes, the argument the brain's `localDayKey` takes. */
const PAKISTAN_OFFSET_MINUTES = 300;

function inboundFor(body: string, state: GatewayState, ctx: HandleCtx): InboundMessage {
  const receiveCount = (state.rate.get(ctx.number) ?? []).length;
  return {
    id: messageIdFor(ctx.serverTime, receiveCount),
    seq: 0,
    sender: ctx.number,
    body,
    receivedAt: ctx.serverTime,
  };
}

/** The simulator hands every part to a perfect "radio": all parts are sent. */
function allSentReport(decision: GatewayDecision): SendReport | null {
  if (decision.parts.length === 0) return null;
  return { status: 'done', results: decision.parts.map(() => 'sent' as const), attempts: 1 };
}

export async function handleMessage(
  body: string,
  state: GatewayState,
  ctx: HandleCtx,
): Promise<SimulatorResponse> {
  const { brain, ai, number, serverTime } = ctx;
  const today = localDayKey(serverTime, PAKISTAN_OFFSET_MINUTES);
  const decision = await brain.runGatewayPipeline(
    inboundFor(body, state, ctx),
    state,
    { paused: false, today },
    { answer: ai.answer },
  );
  const s1 = brain.applyChanges(state, decision.changes);
  const final = brain.finalizeSend(decision, allSentReport(decision), s1.counters, today);
  const s2 = brain.applyChanges(s1, final.changes);
  const { parts, encoding } = buildParts(decision.parts, ai.secrets);
  return {
    kind: 'message',
    parts,
    encoding,
    command: decision.command,
    language: decision.language,
    outcome: final.outcome,
    deliveryOutcome: null,
    snapshot: sanitizeSnapshot(printSnapshot(s2, number), ai.secrets),
    repliesLeft: repliesLeft(s2, number, serverTime),
    serverTime,
  };
}
