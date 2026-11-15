// Gateway_Pipeline (necromancer-sms-gateway design, "Pipeline", "Gateway_Pipeline
// check order" and "Send finalization"). Pure functions apart from the injected
// timer used by the async wrapper `runGatewayPipeline`.
// No GatewayDecision, PendingReply or StateChange built here holds the body text
// (Requirement 14.7), except the Reminder_Text inside the `reminder-add` of a
// REMIND (sms-reminders 5.12, 14.7).
import type { AnswerDeps } from './answer.types.js';
import { answerQuestion, checkScam } from './answer.service.js';
import { FIXED_TEXTS } from './answer.texts.js';
import { notAllowed, stopChanges } from './gateway.checks.js';
import { countersFor, recordFinal, releaseParts, reserveParts } from './gateway.counters.js';
import { normalizeSender } from './gateway.number.js';
import { checkRate, pruneRate, slowDownDue } from './gateway.rate.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
import type {
  CanonicalNumber,
  DayCounters,
  FinalOutcome,
  GatewayDecision,
  GatewayState,
  InboundMessage,
  Outcome,
  PipelineContext,
  SendReport,
  SenderIdentity,
  StateChange,
} from './gateway.types.js';
import { cappedReminderChanges, reminderReply, type ReminderCommand } from './reminder.pipeline.js';
import { applyReminderChange } from './reminder.store.js';
import type { ReminderState } from './reminder.types.js';
import { routeCommand } from './router.js';
import type { Command, Language, RoutedCommand } from './router.types.js';
import { splitSms } from './sms.js';

const MS_PER_MINUTE = 60_000;
/** Language used for decisions made before the router runs. */
const DEFAULT_LANGUAGE: Language = 'en';

/** A decision that still needs its Reply_Text before the Daily_Send_Cap check (Requirement 5.8). */
export interface PendingReply {
  readonly messageId: string;
  readonly receivedAt: number;
  readonly number: CanonicalNumber;
  readonly command: Command;
  readonly language: Language;
  /** Provisional Outcome when the reply fits under the Daily_Send_Cap. */
  readonly outcome: Extract<Outcome, 'replied' | 'started' | 'rate-limited'>;
  /** Local day key from the PipelineContext, used for the cap check. */
  readonly today: string;
  /** Changes decided so far (stop-remove, rate-record, slowdown-record, reminder-add/-remove). */
  readonly changes: readonly StateChange[];
}

/** What the Answer_Service gets: only the argument and the Language (Requirement 6.9). */
export interface AnswerRequest {
  readonly kind: 'question' | 'scam';
  readonly argument: string;
  readonly language: Language;
}

export type EvalStep =
  | { readonly kind: 'final'; readonly decision: GatewayDecision }
  | { readonly kind: 'reply'; readonly pending: PendingReply; readonly text: string }
  | { readonly kind: 'answer'; readonly pending: PendingReply; readonly request: AnswerRequest };

export interface PipelineDeps {
  /** null when no readable Gemini_Api_Key (Requirement 16.18). */
  readonly answer: AnswerDeps | null;
  readonly route?: (input: string) => RoutedCommand; // default routeCommand
  readonly split?: (text: string) => string[]; // default splitSms
  readonly answerQuestion?: typeof answerQuestion;
  readonly checkScam?: typeof checkScam;
  readonly answerTimeoutMs?: number; // default 25_000
  readonly startTimer?: (ms: number, fire: () => void) => () => void; // default setTimeout/clearTimeout
}

type Phone = Extract<SenderIdentity, { kind: 'phone' }>;

interface Routed {
  readonly msg: InboundMessage;
  readonly sender: Phone;
  readonly routed: RoutedCommand;
  readonly ctx: PipelineContext;
  /** SMS_Splitter for the List_Formatter (sms-reminders 6.5). */
  readonly split: (text: string) => string[];
}

// ---------------------------------------------------------------- decisions

function finalStep(
  msg: InboundMessage,
  sender: SenderIdentity,
  command: Command | null,
  language: Language,
  outcome: Outcome,
  changes: readonly StateChange[] = [],
): EvalStep {
  const decision: GatewayDecision = {
    messageId: msg.id,
    receivedAt: msg.receivedAt,
    sender,
    command,
    language,
    outcome,
    parts: [],
    changes,
  };
  return { kind: 'final', decision };
}

function routedFinal(r: Routed, outcome: Outcome, changes: readonly StateChange[] = []): EvalStep {
  return finalStep(r.msg, r.sender, r.routed.command, r.routed.language, outcome, changes);
}

function pendingFor(
  r: Routed,
  outcome: PendingReply['outcome'],
  changes: readonly StateChange[],
): PendingReply {
  return {
    messageId: r.msg.id,
    receivedAt: r.msg.receivedAt,
    number: r.sender.number,
    command: r.routed.command,
    language: r.routed.language,
    outcome,
    today: r.ctx.today,
    changes,
  };
}

// ---------------------------------------------------------------- checks

const isOwnNumber = (sender: Phone, state: GatewayState): boolean =>
  state.settings.ownNumber !== null && sender.number === state.settings.ownNumber;

const windowMs = (state: GatewayState): number => state.settings.rateWindowMinutes * MS_PER_MINUTE;

const hasText = (s: string): boolean => /\S/.test(s);

/** Requirement 9.10, 9.11: only a STOP from a Phone_Number that is not the Own_Number is acted on. */
function evaluatePaused(
  msg: InboundMessage,
  sender: SenderIdentity,
  state: GatewayState,
  route: (input: string) => RoutedCommand,
): EvalStep {
  if (sender.kind !== 'phone' || isOwnNumber(sender, state)) {
    return finalStep(msg, sender, null, DEFAULT_LANGUAGE, 'ignored-paused');
  }
  const routed = route(msg.body);
  if (routed.command === 'STOP') {
    return finalStep(msg, sender, 'STOP', routed.language, 'stopped', stopChanges(sender.number));
  }
  return finalStep(msg, sender, routed.command, routed.language, 'ignored-paused');
}

/** REMIND, LIST, CANCEL: local reply plus at most one reminder change, no Answer_Service (sms-reminders 5.9). */
function reminderStep(
  r: Routed,
  routed: ReminderCommand,
  pending: PendingReply,
  reminders: ReminderState,
): EvalStep {
  const { msg, sender, split } = r;
  const reply = reminderReply(routed, sender.number, msg.id, msg.receivedAt, reminders, split);
  const changes = [...pending.changes, ...reply.changes];
  return { kind: 'reply', pending: { ...pending, changes }, text: reply.text };
}

/**
 * Reply-text table (design, "Reply text selection"). QUESTION with text and SCAM
 * with an argument need the Answer_Service, or get the Try_Later_Text when no
 * Gemini_Api_Key is readable (Requirement 16.18). STOP never reaches this point.
 */
function replyFor(
  r: Routed,
  pending: PendingReply,
  aiAvailable: boolean,
  reminders: ReminderState,
): EvalStep {
  const { command, argument, argumentMissing, language } = r.routed;
  const texts = GATEWAY_TEXTS[language];
  const reply = (text: string): EvalStep => ({ kind: 'reply', pending, text });
  const ask = (kind: AnswerRequest['kind']): EvalStep =>
    aiAvailable
      ? { kind: 'answer', pending, request: { kind, argument, language } }
      : reply(FIXED_TEXTS[language].tryLater);
  switch (command) {
    case 'START':
      return reply(texts.welcomeBack);
    case 'QUESTION':
      return hasText(argument) ? ask('question') : reply(texts.help);
    case 'SCAM':
      return argumentMissing ? reply(texts.usage.SCAM) : ask('scam');
    case 'TRANSLATE':
      return reply(argumentMissing ? texts.usage.TRANSLATE : texts.notAvailable);
    case 'REMIND':
    case 'LIST':
    case 'CANCEL':
      // Bare REMIND gets the usage hint inside `reminderReply`, after the
      // unreadable-store check (sms-reminders 5.4, 12.7; design flowchart).
      return reminderStep(r, { ...r.routed, command }, pending, reminders);
    case 'HELP':
    case 'STOP':
      return reply(texts.help);
  }
}

/** Rate_Limiter, then the cap at `handed === cap`, then the reply text (Requirement 5.1–5.4, 5.12). */
function evaluateLimits(
  r: Routed,
  state: GatewayState,
  base: readonly StateChange[],
  aiAvailable: boolean,
): EvalStep {
  const { number } = r.sender;
  const t = r.msg.receivedAt;
  const times = state.rate.get(number) ?? [];
  const { accepted } = checkRate(times, t, state.settings.perNumberLimit, windowMs(state));
  if (!accepted) {
    if (!slowDownDue(state.slowDown.get(number), t, windowMs(state))) {
      return routedFinal(r, 'rate-limited', base);
    }
    const changes = [...base, { type: 'slowdown-record', number, at: t } as const];
    const pending = pendingFor(r, 'rate-limited', changes);
    return { kind: 'reply', pending, text: GATEWAY_TEXTS[r.routed.language].slowDown };
  }
  const changes = [...base, { type: 'rate-record', number, at: t } as const];
  const handed = countersFor(state.counters, r.ctx.today).handed;
  if (handed >= state.settings.dailySendCap) {
    // A CANCEL at the cap still removes the reminder (sms-reminders 7.7).
    const capped = cappedReminderChanges(r.routed, number, state.reminders);
    return routedFinal(r, 'send-capped', [...changes, ...capped]);
  }
  const outcome = r.routed.command === 'START' ? 'started' : 'replied';
  return replyFor(r, pendingFor(r, outcome, changes), aiAvailable, state.reminders);
}

/** START: Stop_List removal, then the Allowlist gate (Requirement 3.4, 3.5, 3.13, 4.8, 4.11). */
function evaluateStart(r: Routed, state: GatewayState, aiAvailable: boolean): EvalStep {
  const { number } = r.sender;
  const base: readonly StateChange[] = state.stopList.has(number)
    ? [{ type: 'stop-remove', number }]
    : [];
  if (notAllowed(number, state)) return routedFinal(r, 'started', base);
  return evaluateLimits(r, state, base, aiAvailable);
}

function evaluateRouted(r: Routed, state: GatewayState, aiAvailable: boolean): EvalStep {
  const { number } = r.sender;
  if (r.routed.command === 'STOP') {
    return routedFinal(r, 'stopped', stopChanges(number));
  }
  if (r.routed.command === 'START') return evaluateStart(r, state, aiAvailable);
  if (state.stopList.has(number)) return routedFinal(r, 'ignored-stopped');
  if (notAllowed(number, state)) return routedFinal(r, 'ignored-not-allowed');
  return evaluateLimits(r, state, [], aiAvailable);
}

/**
 * Synchronous: all checks up to the point where a Reply_Text is needed
 * (Requirement 7.3). The router is called at most once, and never for
 * Automated_Senders or the Own_Number (Requirement 6.1, 7.5).
 */
export function evaluateInbound(
  msg: InboundMessage,
  state: GatewayState,
  ctx: PipelineContext,
  route: (input: string) => RoutedCommand,
  aiAvailable: boolean,
  split: (text: string) => string[] = splitSms,
): EvalStep {
  const sender = normalizeSender(msg.sender, state.settings.defaultCountryCode);
  if (ctx.paused) return evaluatePaused(msg, sender, state, route);
  if (sender.kind !== 'phone') {
    return finalStep(msg, sender, null, DEFAULT_LANGUAGE, 'ignored-automated');
  }
  if (isOwnNumber(sender, state)) {
    return finalStep(msg, sender, null, DEFAULT_LANGUAGE, 'ignored-own-number');
  }
  const routed = route(msg.body);
  return evaluateRouted({ msg, sender, routed, ctx, split }, state, aiAvailable);
}

const keptWhenCapped = (c: StateChange): boolean =>
  c.type !== 'slowdown-record' && c.type !== 'reminder-add';

/**
 * Synchronous: splits the Reply_Text once and applies the Daily_Send_Cap
 * (Requirement 5.8, 6.8). A capped reply keeps the Stop_List and rate changes
 * but drops the slowdown-record, because no Slow_Down_Text is sent, and the
 * reminder-add, because no Reminder_Set_Text is sent; a reminder-remove stays
 * (sms-reminders 5.11, 7.7).
 */
export function completeReply(
  pending: PendingReply,
  replyText: string,
  state: GatewayState,
  split: (text: string) => string[],
): GatewayDecision {
  const parts = split(replyText);
  const counters = countersFor(state.counters, pending.today);
  const base = {
    messageId: pending.messageId,
    receivedAt: pending.receivedAt,
    sender: { kind: 'phone', number: pending.number } as const,
    command: pending.command,
    language: pending.language,
  };
  if (counters.handed + parts.length > state.settings.dailySendCap) {
    const changes = pending.changes.filter(keptWhenCapped);
    return { ...base, outcome: 'send-capped', parts: [], changes };
  }
  const reserved = reserveParts(counters, pending.today, parts.length);
  return {
    ...base,
    outcome: pending.outcome,
    parts,
    changes: [...pending.changes, { type: 'counters', counters: reserved }],
  };
}

// ---------------------------------------------------------------- state fold

function withSet<T>(set: ReadonlySet<T>, value: T, add: boolean): ReadonlySet<T> {
  const next = new Set(set);
  if (add) next.add(value);
  else next.delete(value);
  return next;
}

/** Appends `at` for `number` and prunes every record older than 24 hours before `at` (Requirement 5.10). */
function withRate(
  rate: GatewayState['rate'],
  number: CanonicalNumber,
  at: number,
): GatewayState['rate'] {
  const next = new Map<CanonicalNumber, readonly number[]>();
  for (const [n, times] of rate) {
    const kept = pruneRate(n === number ? [...times, at] : times, at);
    if (kept.length > 0) next.set(n, kept);
  }
  if (!rate.has(number)) next.set(number, [at]);
  return next;
}

function applyChange(state: GatewayState, change: StateChange): GatewayState {
  switch (change.type) {
    case 'stop-add':
      return { ...state, stopList: withSet(state.stopList, change.number, true) };
    case 'stop-remove':
      return { ...state, stopList: withSet(state.stopList, change.number, false) };
    case 'rate-record':
      return { ...state, rate: withRate(state.rate, change.number, change.at) };
    case 'slowdown-record':
      return { ...state, slowDown: new Map(state.slowDown).set(change.number, change.at) };
    case 'counters':
      return { ...state, counters: change.counters };
    case 'allow-add':
    case 'allow-remove':
      if (state.allowlist === 'unreadable') return state;
      return {
        ...state,
        allowlist: withSet(state.allowlist, change.number, change.type === 'allow-add'),
      };
    case 'reminder-add':
    case 'reminder-remove':
    case 'reminder-remove-all':
    case 'reminder-handed':
      return { ...state, reminders: applyReminderChange(state.reminders, change) };
  }
}

/** Pure fold of every StateChange; sets keep exactly one entry per number (Requirement 3.1). */
export function applyChanges(state: GatewayState, changes: readonly StateChange[]): GatewayState {
  return changes.reduce(applyChange, state);
}

/** Requirement 1.7: ascending receivedAt, ties by seq. Does not mutate the input. */
export function orderInbound(messages: readonly InboundMessage[]): InboundMessage[] {
  return [...messages].sort((a, b) => a.receivedAt - b.receivedAt || a.seq - b.seq);
}

// ---------------------------------------------------------------- async wrapper

const ANSWER_TIMEOUT_MS = 25_000;

type StartTimer = NonNullable<PipelineDeps['startTimer']>;

const defaultStartTimer: StartTimer = (ms, fire) => {
  const handle = setTimeout(fire, ms);
  return () => clearTimeout(handle);
};

/** Stands in for a router that threw: a non-blank QUESTION in `en`, evaluated with no AI (Requirement 6.15). */
const ROUTER_FAILED: RoutedCommand = {
  command: 'QUESTION',
  argument: '?',
  language: DEFAULT_LANGUAGE,
  argumentMissing: false,
};

/**
 * Runs the checks once with the real router. If the router throws, runs them
 * again with ROUTER_FAILED and no AI, so the reply is the `en` Try_Later_Text
 * and the router is still called only once (Requirement 6.1, 6.15).
 */
function evaluateSafely(
  msg: InboundMessage,
  state: GatewayState,
  ctx: PipelineContext,
  route: (input: string) => RoutedCommand,
  aiAvailable: boolean,
  split: (text: string) => string[],
): EvalStep {
  try {
    return evaluateInbound(msg, state, ctx, route, aiAvailable, split);
  } catch {
    return evaluateInbound(msg, state, ctx, () => ROUTER_FAILED, false, split);
  }
}

/**
 * Splits the Reply_Text; if the splitter throws, uses the Try_Later_Text split
 * by splitSms, then the literal Try_Later_Text as one part (Requirement 6.15).
 */
function completeSafely(
  pending: PendingReply,
  text: string,
  state: GatewayState,
  split: (text: string) => string[],
): GatewayDecision {
  const tryLater = FIXED_TEXTS[pending.language].tryLater;
  try {
    return completeReply(pending, text, state, split);
  } catch {
    try {
      return completeReply(pending, tryLater, state, splitSms);
    } catch {
      return completeReply(pending, tryLater, state, () => [tryLater]);
    }
  }
}

/** Calls the Answer_Service once with only the argument and the Language (Requirement 6.9). */
function callAnswer(deps: PipelineDeps, answer: AnswerDeps, req: AnswerRequest): Promise<string> {
  const { argument, language } = req;
  if (req.kind === 'scam') return (deps.checkScam ?? checkScam)(answer, argument, language);
  return (deps.answerQuestion ?? answerQuestion)(answer, argument, language);
}

/**
 * Races the Answer_Service against the backstop timer. The first result wins:
 * a timeout, rejection or throw gives the Try_Later_Text, and a late answer is
 * ignored (Requirement 6.13, 6.14). Never rejects.
 */
function answerWithBackstop(
  deps: PipelineDeps,
  answer: AnswerDeps,
  req: AnswerRequest,
): Promise<string> {
  const tryLater = FIXED_TEXTS[req.language].tryLater;
  return new Promise<string>((resolve) => {
    let done = false;
    let cancel: (() => void) | null = null;
    const finish = (text: string): void => {
      if (done) return;
      done = true;
      cancel?.();
      resolve(text);
    };
    const giveUp = (): void => finish(tryLater);
    try {
      cancel = (deps.startTimer ?? defaultStartTimer)(deps.answerTimeoutMs ?? ANSWER_TIMEOUT_MS, giveUp);
      if (done) cancel();
      callAnswer(deps, answer, req).then(
        (text) => finish(typeof text === 'string' ? text : tryLater),
        giveUp,
      );
    } catch {
      giveUp();
    }
  });
}

/** Last resort when even the fallback checks throw: no parts, no changes. */
function failedDecision(msg: InboundMessage, state: GatewayState): GatewayDecision {
  let sender: SenderIdentity = { kind: 'automated', masked: '' };
  try {
    sender = normalizeSender(msg.sender, state.settings.defaultCountryCode);
  } catch {
    // keep the placeholder sender
  }
  return {
    messageId: msg.id,
    receivedAt: msg.receivedAt,
    sender,
    command: null,
    language: DEFAULT_LANGUAGE,
    outcome: 'send-failed',
    parts: [],
    changes: [],
  };
}

async function runUnsafe(
  msg: InboundMessage,
  state: GatewayState,
  ctx: PipelineContext,
  deps: PipelineDeps,
): Promise<GatewayDecision> {
  const route = deps.route ?? routeCommand;
  const split = deps.split ?? splitSms;
  const step = evaluateSafely(msg, state, ctx, route, deps.answer !== null, split);
  if (step.kind === 'final') return step.decision;
  if (step.kind === 'reply') return completeSafely(step.pending, step.text, state, split);
  const text =
    deps.answer === null
      ? FIXED_TEXTS[step.request.language].tryLater
      : await answerWithBackstop(deps, deps.answer, step.request);
  return completeSafely(step.pending, text, state, split);
}

/**
 * Async wrapper: evaluate → (answer with a 25 s backstop) → complete.
 * Never rejects (Requirement 6.13–6.15, 16.18).
 */
export async function runGatewayPipeline(
  msg: InboundMessage,
  state: GatewayState,
  ctx: PipelineContext,
  deps: PipelineDeps,
): Promise<GatewayDecision> {
  try {
    return await runUnsafe(msg, state, ctx, deps);
  } catch {
    return failedDecision(msg, state);
  }
}

// ---------------------------------------------------------------- send finalization

function finalWith(
  outcome: Outcome,
  partsSent: number,
  counters: DayCounters,
  today: string,
): FinalOutcome {
  const next = recordFinal(counters, today, outcome, partsSent);
  return { outcome, partsSent, changes: [{ type: 'counters', counters: next }] };
}

/**
 * Final_Outcome and counters after the Sms_Sender report (design, "Send
 * finalization"; Requirement 3.8, 3.9, 8.4, 8.5, 8.10, 13.12). `report` is null
 * when the decision has no parts.
 */
export function finalizeSend(
  decision: GatewayDecision,
  report: SendReport | null,
  counters: DayCounters,
  today: string,
): FinalOutcome {
  if (report === null) return finalWith(decision.outcome, 0, counters, today);
  if (report.status !== 'done') {
    const released = releaseParts(counters, today, decision.parts.length);
    return finalWith('ignored-stopped', 0, released, today);
  }
  const sent = report.results.filter((r) => r === 'sent').length;
  const allSent = sent === report.results.length && sent === decision.parts.length;
  if (allSent) return finalWith(decision.outcome, sent, counters, today);
  return finalWith('send-failed', sent, counters, today);
}
