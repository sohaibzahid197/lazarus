// Test-only arbitraries for the client session properties (Properties 31 to 39, Requirement 18.1).
// Depends only on the session and protocol types, not on the reducer.
import fc from 'fast-check';
import {
  COMMANDS,
  DEFAULT_SETTINGS,
  DELIVERY_OUTCOMES,
  LANGUAGES,
  OUTCOMES,
  countCodeUnits,
  detectEncoding,
  getPartLimits,
  joinSms,
  type Command,
  type DeliveryOutcome,
  type Language,
  type Outcome,
  type SmsEncoding,
} from '@lazarus/brain';
import type { SessionSnapshot } from '../../protocol/snapshot.types';
import type { ResponsePart, SimulatorResponse } from '../../protocol/wire.types';
import type {
  Action,
  Bubble,
  BubbleKind,
  DripItem,
  InFlight,
  LanguageLabel,
  Outgoing,
  PartBadge,
  RequestType,
  SessionState,
} from '../../session/session.types';
import { serverTimeArb, snapshotArb } from './snapshot';

/** Most parts one Simulator_Response holds (7.5). */
export const MAX_ARB_PARTS = 4;
/** Most bubbles or drip items a generated SessionState holds. */
export const MAX_ARB_BUBBLES = 12;
/** Largest epoch a generated SessionState starts at. */
export const MAX_ARB_EPOCH = 1_000;

const DAY_MS = 86_400_000;
/** 2100-01-01T00:00:00Z, the same upper bound as the snapshot arbitraries. */
const MAX_BROWSER_TIME = 4_102_444_800_000;

const LANGUAGE_LABELS: readonly LanguageLabel[] = ['English', 'Urdu', 'Roman Urdu'];
const ENCODINGS: readonly SmsEncoding[] = ['GSM-7', 'UCS-2'];
const REQUEST_TYPES: readonly RequestType[] = ['message', 'deliver'];

// Single BMP code points, so lengths in characters equal code units.
const URDU_CHARS = 'آابپتٹثجچحخدڈذرڑزژسشصضطظعغفقکگلمنوہھءیے ؟۔'.split('');

/** A browser clock time in milliseconds. */
export const browserNowArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_BROWSER_TIME });

/** A clock offset: 0, small skew, or up to a day either way. */
export const clockOffsetArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: -5_000, max: 5_000 }),
  fc.integer({ min: -DAY_MS, max: DAY_MS }),
);

const languageArb: fc.Arbitrary<Language> = fc.constantFrom(...LANGUAGES);
const commandArb: fc.Arbitrary<Command> = fc.constantFrom(...COMMANDS);
const repliesLeftArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: DEFAULT_SETTINGS.perNumberLimit });

/** Text of one part before the `(n/N) ` prefix: GSM-7 ASCII, Urdu script or any code points. */
const partBodyArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz ABC.,?!0123456789'.split('')), minLength: 1, maxLength: 140 }),
  fc.string({ unit: fc.constantFrom(...URDU_CHARS), minLength: 1, maxLength: 60 }),
  fc.string({ minLength: 1, maxLength: 60 }),
);

/**
 * `min` to `max` part texts, with `(n/N) ` prefixes only when there are 2 or more
 * (7.5), and their metadata computed with the brain the way the server does
 * (7.4, 17.3).
 */
export function partsArb(
  min: number,
  max: number,
): fc.Arbitrary<{ readonly parts: readonly ResponsePart[]; readonly encoding: SmsEncoding }> {
  return fc.array(partBodyArb, { minLength: min, maxLength: max }).map((bodies) => {
    const total = bodies.length;
    const texts = total < 2 ? bodies : bodies.map((b, i) => `(${String(i + 1)}/${String(total)}) ${b}`);
    const encoding = detectEncoding(joinSms([...texts]));
    const limits = getPartLimits(encoding);
    const limit = total === 1 ? limits.single : limits.multi;
    const parts = texts.map((text): ResponsePart => ({ text, units: countCodeUnits(text, encoding), limit }));
    return { parts, encoding };
  });
}

/** Parts for a message Outcome: replies get 1 to 4, `rate-limited` 0 or 1 (the Slow_Down_Text), the rest 0. */
function partsForOutcome(outcome: Outcome): ReturnType<typeof partsArb> {
  if (outcome === 'replied' || outcome === 'started') return partsArb(1, MAX_ARB_PARTS);
  if (outcome === 'rate-limited') return partsArb(0, 1);
  return partsArb(0, 0);
}

/** Parts for a delivery: `reminder-sent` gets 1 to 4, any other outcome and none (not found, wait) get 0. */
function partsForDelivery(outcome: DeliveryOutcome | null): ReturnType<typeof partsArb> {
  return outcome === 'reminder-sent' ? partsArb(1, MAX_ARB_PARTS) : partsArb(0, 0);
}

/** A Server_Time with a valid Session_Snapshot at it. */
function timedSnapshotArb(): fc.Arbitrary<{ readonly serverTime: number; readonly snapshot: SessionSnapshot }> {
  return serverTimeArb.chain((serverTime) => snapshotArb(serverTime).map((snapshot) => ({ serverTime, snapshot })));
}

/** A valid 200 Simulator_Response to a `message` request, for every Outcome. */
export const messageResponseArb: fc.Arbitrary<SimulatorResponse> = fc
  .record({
    outcome: fc.constantFrom(...OUTCOMES),
    command: commandArb,
    language: languageArb,
    repliesLeft: repliesLeftArb,
    timed: timedSnapshotArb(),
  })
  .chain(({ outcome, command, language, repliesLeft, timed }) =>
    partsForOutcome(outcome).map(
      ({ parts, encoding }): SimulatorResponse => ({
        kind: 'message',
        parts,
        encoding,
        command,
        language,
        outcome,
        deliveryOutcome: null,
        snapshot: timed.snapshot,
        repliesLeft,
        serverTime: timed.serverTime,
      }),
    ),
  );

/** A valid 200 Simulator_Response to a `deliver` request, for every Delivery_Outcome and for none. */
export const deliverResponseArb: fc.Arbitrary<SimulatorResponse> = fc
  .record({
    deliveryOutcome: fc.option(fc.constantFrom(...DELIVERY_OUTCOMES), { nil: null }),
    language: languageArb,
    repliesLeft: repliesLeftArb,
    timed: timedSnapshotArb(),
  })
  .chain(({ deliveryOutcome, language, repliesLeft, timed }) =>
    partsForDelivery(deliveryOutcome).map(
      ({ parts, encoding }): SimulatorResponse => ({
        kind: 'deliver',
        parts,
        encoding,
        command: null,
        language,
        outcome: null,
        deliveryOutcome,
        snapshot: timed.snapshot,
        repliesLeft,
        serverTime: timed.serverTime,
      }),
    ),
  );

/** A valid 200 Simulator_Response of either kind. */
export const responseArb: fc.Arbitrary<SimulatorResponse> = fc.oneof(messageResponseArb, deliverResponseArb);

// ---------------------------------------------------------------------------
// SessionState
// ---------------------------------------------------------------------------

const badgeArb: fc.Arbitrary<PartBadge> = fc
  .record({
    total: fc.integer({ min: 1, max: MAX_ARB_PARTS }),
    n: fc.integer({ min: 1, max: MAX_ARB_PARTS }),
    encoding: fc.constantFrom(...ENCODINGS),
    units: fc.integer({ min: 1, max: 160 }),
  })
  .map(({ total, n, encoding, units }) => {
    const limits = getPartLimits(encoding);
    return { n: Math.min(n, total), total, encoding, units, limit: total === 1 ? limits.single : limits.multi };
  });

/** One bubble without its id: outgoing text, a part with a badge, or a note. */
export const dripItemArb: fc.Arbitrary<DripItem> = fc.oneof(
  fc.record({ kind: fc.constant<BubbleKind>('outgoing'), text: partBodyArb }),
  fc.record(
    {
      kind: fc.constant<BubbleKind>('part'),
      text: partBodyArb,
      badge: badgeArb,
      languageLabel: fc.constantFrom(...LANGUAGE_LABELS),
    },
    { requiredKeys: ['kind', 'text', 'badge'] },
  ),
  fc.record(
    { kind: fc.constant<BubbleKind>('reminder-part'), text: partBodyArb, badge: badgeArb, reminderLabel: fc.constant(true) },
    { requiredKeys: ['kind', 'text', 'badge'] },
  ),
  fc.record(
    { kind: fc.constant<BubbleKind>('note'), text: partBodyArb, urgent: fc.boolean() },
    { requiredKeys: ['kind', 'text'] },
  ),
);

/** 0 to 12 bubbles with strictly increasing ids, and a `nextBubbleId` above all of them. */
const bubblesArb: fc.Arbitrary<{ readonly bubbles: readonly Bubble[]; readonly nextBubbleId: number }> = fc
  .record({
    items: fc.array(dripItemArb, { maxLength: MAX_ARB_BUBBLES }),
    start: fc.nat({ max: 10_000 }),
    gaps: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: MAX_ARB_BUBBLES, maxLength: MAX_ARB_BUBBLES }),
  })
  .map(({ items, start, gaps }) => {
    let id = start;
    const bubbles = items.map((item, i): Bubble => {
      id += gaps[i] ?? 1;
      return { ...item, id };
    });
    return { bubbles, nextBubbleId: id + 1 };
  });

/** A Reminder_Id from the snapshot, or one that is no longer in it. */
function reminderIdIn(snapshot: SessionSnapshot): fc.Arbitrary<string> {
  const ids = snapshot.reminders.map((r) => r.id);
  const gone = fc.stringMatching(/^r:gone-[a-z]{1,6}$/);
  return ids.length > 0 ? fc.oneof(fc.constantFrom(...ids), gone) : gone;
}

/** 0 to 5 Reminder_Id → browser time entries, mostly for Reminders in the snapshot. */
function timesByIdArb(snapshot: SessionSnapshot): fc.Arbitrary<ReadonlyMap<string, number>> {
  return fc
    .array(fc.tuple(reminderIdIn(snapshot), browserNowArb), { maxLength: 5 })
    .map((entries) => new Map(entries));
}

const outgoingArb: fc.Arbitrary<Outgoing> = fc.record({
  type: fc.constant('message' as const),
  body: fc.string({ minLength: 1, maxLength: 480 }).filter((s) => /\S/.test(s)),
});

function inFlightArb(snapshot: SessionSnapshot): fc.Arbitrary<InFlight> {
  return fc.oneof(
    fc.constant<InFlight>({ type: 'message' }),
    reminderIdIn(snapshot).map((reminderId): InFlight => ({ type: 'deliver', reminderId })),
  );
}

/**
 * Any SessionState the reducer can meet: idle or with a request in flight, a
 * waiting message, drip items left, retry and recheck times, STOP on or off,
 * and an error or none.
 */
export const sessionStateArb: fc.Arbitrary<SessionState> = timedSnapshotArb().chain(({ snapshot }) =>
  fc
    .record({
      epoch: fc.nat({ max: MAX_ARB_EPOCH }),
      repliesLeft: repliesLeftArb,
      clockOffset: clockOffsetArb,
      bubbles: bubblesArb,
      drip: fc.array(dripItemArb, { maxLength: MAX_ARB_BUBBLES }),
      inFlight: fc.option(inFlightArb(snapshot), { nil: null }),
      waitingMessage: fc.option(outgoingArb, { nil: null }),
      retryAt: timesByIdArb(snapshot),
      recheckAt: timesByIdArb(snapshot),
      error: fc.option(fc.string({ minLength: 1, maxLength: 80 }), { nil: null }),
    })
    .map(
      (r): SessionState => ({
        epoch: r.epoch,
        snapshot,
        repliesLeft: r.repliesLeft,
        clockOffset: r.clockOffset,
        bubbles: r.bubbles.bubbles,
        nextBubbleId: r.bubbles.nextBubbleId,
        drip: r.drip,
        inFlight: r.inFlight,
        waitingMessage: r.waitingMessage,
        retryAt: r.retryAt,
        recheckAt: r.recheckAt,
        error: r.error,
      }),
    ),
);

// ---------------------------------------------------------------------------
// Epoch-tagged actions
// ---------------------------------------------------------------------------

/** The actions that carry an epoch (design C6). */
export type EpochAction = Extract<Action, { readonly epoch: number }>;

/** An epoch other than `epoch`: an older one (the usual stale case) or a newer one. */
export function staleEpochArb(epoch: number): fc.Arbitrary<number> {
  const newer = fc.integer({ min: epoch + 1, max: epoch + MAX_ARB_EPOCH });
  return epoch > 0 ? fc.oneof(fc.integer({ min: 0, max: epoch - 1 }), newer) : newer;
}

/** A Reminder_Id for a `deliver` action: from the snapshot when there is one, else any brain-style id. */
function actionReminderIdArb(snapshot: SessionSnapshot | undefined): fc.Arbitrary<string> {
  return snapshot === undefined ? fc.stringMatching(/^r:m[a-z]{1,8}-[a-z]{1,2}$/) : reminderIdIn(snapshot);
}

/**
 * One `response`, `rate-limited`, `failed` or `invalid-snapshot` action tagged
 * with an epoch drawn from `epochArb`. A `response` action's `request` matches
 * the response kind. Pass the state's snapshot to draw Reminder_Ids from it.
 */
export function epochActionArb(
  epochArb: fc.Arbitrary<number>,
  snapshot?: SessionSnapshot,
): fc.Arbitrary<EpochAction> {
  const reminderId = actionReminderIdArb(snapshot);
  const response = fc
    .record({ epoch: epochArb, response: responseArb, browserNow: browserNowArb })
    .map((r): EpochAction => ({ type: 'response', request: r.response.kind, ...r }));
  const rateLimited = fc
    .record({
      epoch: epochArb,
      request: fc.constantFrom(...REQUEST_TYPES),
      slowDown: fc.option(partBodyArb, { nil: null }),
      reminderId,
      browserNow: browserNowArb,
    })
    .map((r): EpochAction =>
      r.request === 'message'
        ? { type: 'rate-limited', epoch: r.epoch, request: 'message', slowDown: r.slowDown, browserNow: r.browserNow }
        : { type: 'rate-limited', epoch: r.epoch, request: 'deliver', slowDown: null, reminderId: r.reminderId, browserNow: r.browserNow },
    );
  const failed = fc
    .record({ epoch: epochArb, request: fc.constantFrom(...REQUEST_TYPES), reminderId, browserNow: browserNowArb })
    .map((r): EpochAction =>
      r.request === 'message'
        ? { type: 'failed', epoch: r.epoch, request: 'message', browserNow: r.browserNow }
        : { type: 'failed', epoch: r.epoch, request: 'deliver', reminderId: r.reminderId, browserNow: r.browserNow },
    );
  const invalid = fc
    .record({ epoch: epochArb, nowMs: browserNowArb })
    .map((r): EpochAction => ({ type: 'invalid-snapshot', ...r }));
  return fc.oneof(response, rateLimited, failed, invalid);
}

/** A SessionState with an epoch-tagged action whose epoch differs from the state's (Property 31). */
export const staleActionArb: fc.Arbitrary<{ readonly state: SessionState; readonly action: EpochAction }> =
  sessionStateArb.chain((state) =>
    epochActionArb(staleEpochArb(state.epoch), state.snapshot).map((action) => ({ state, action })),
  );

/** A SessionState with an epoch-tagged action carrying the state's own epoch. */
export const currentActionArb: fc.Arbitrary<{ readonly state: SessionState; readonly action: EpochAction }> =
  sessionStateArb.chain((state) =>
    epochActionArb(fc.constant(state.epoch), state.snapshot).map((action) => ({ state, action })),
  );
