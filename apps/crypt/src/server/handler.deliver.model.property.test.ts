// Feature: crypt-ouija-simulator, Property 18: Deliver handling equals the brain composition
import fc from 'fast-check';
import {
  applyChanges,
  decideDelivery,
  finalizeDelivery,
  LATE_WINDOW_MS,
  localDayKey,
  maskPhoneNumbers,
  redactSecrets,
  type DeliveryOutcome,
  type GatewayState,
  type SendReport,
} from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorResponse } from '../protocol/wire.types';
import { remindersArb, snapshotAtArb } from '../test/arbitraries/snapshot';
import { makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { parseSnapshot } from './snapshot.parse';
import { printSnapshot } from './snapshot.print';
import { SIMULATOR_NUMBER } from './simulatorNumber';

type StepKind = 'absent' | 'wait' | 'final' | 'send';

/** Redact then mask, written with the brain exports directly (17.2). */
function clean(text: string, secrets: readonly string[]): string {
  return maskPhoneNumbers(redactSecrets(text, secrets));
}

function cleanSnapshot(s: SessionSnapshot, secrets: readonly string[]): SessionSnapshot {
  return { ...s, reminders: s.reminders.map((r) => ({ ...r, text: clean(r.text, secrets) })) };
}

interface Expected {
  readonly kind: StepKind;
  readonly texts: readonly string[];
  readonly deliveryOutcome: DeliveryOutcome | null;
  readonly snapshot: SessionSnapshot;
}

/** Reference: parse → decideDelivery → apply → (finalizeDelivery, all sent → apply) → print, then sanitize. */
function reference(
  snapshot: SessionSnapshot,
  serverTime: number,
  reminderId: string,
  secrets: readonly string[],
): Expected {
  const parsed = parseSnapshot(snapshot, serverTime, SIMULATOR_NUMBER);
  if (!parsed.ok) throw new Error(`parseSnapshot rejected a valid snapshot: ${parsed.error}`);
  const state = parsed.state;
  const out = (kind: StepKind, s: GatewayState, texts: readonly string[], o: DeliveryOutcome | null): Expected => ({
    kind,
    texts: texts.map((t) => clean(t, secrets)),
    deliveryOutcome: o,
    snapshot: cleanSnapshot(printSnapshot(s, SIMULATOR_NUMBER), secrets),
  });
  const r = state.reminders.status === 'ok' ? state.reminders.reminders.find((x) => x.id === reminderId) : undefined;
  if (r === undefined) return out('absent', state, [], null);
  const today = localDayKey(serverTime, 300);
  const step = decideDelivery(r, state, serverTime, today);
  if (step.kind === 'wait') return out('wait', state, [], null);
  const s1 = applyChanges(state, step.changes);
  if (step.kind === 'final') return out('final', s1, [], step.outcome);
  const report: SendReport = { status: 'done', results: step.parts.map(() => 'sent' as const), attempts: 1 };
  const fin = finalizeDelivery(r, step.parts.length, report, s1.counters, today);
  return out('send', applyChanges(s1, fin.changes), step.parts, fin.outcome);
}

/**
 * Makes `send` and `final` steps common: gives the snapshot at least 1 Reminder,
 * moves one Reminder's Due_Time into the Late_Window just before the Server_Time
 * and usually turns STOP off. The result stays a valid Session_Snapshot
 * (createdAt ≤ dueAt ≤ Server_Time).
 */
function dueNowArb(serverTime: number, snapshot: SessionSnapshot): fc.Arbitrary<SessionSnapshot> {
  return fc
    .record({
      extra: remindersArb(serverTime, 1),
      pick: fc.nat(),
      lag: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: LATE_WINDOW_MS }), fc.constant(LATE_WINDOW_MS + 1)),
      keepStop: fc.integer({ min: 0, max: 4 }),
    })
    .map(({ extra, pick, lag, keepStop }) => {
      const reminders = snapshot.reminders.length > 0 ? snapshot.reminders : extra;
      const i = pick % reminders.length;
      const dueAt = Math.max(0, serverTime - lag);
      return {
        ...snapshot,
        stopped: keepStop === 0 ? snapshot.stopped : false,
        reminders: reminders.map((r, j) => (j === i ? { ...r, dueAt, createdAt: Math.min(r.createdAt, dueAt) } : r)),
      };
    });
}

/** A snapshot, its Server_Time and a Reminder_Id that is usually one of its Reminders. */
const deliverCaseArb = snapshotAtArb.chain(({ serverTime, snapshot: raw }) =>
  fc
    .oneof({ weight: 1, arbitrary: fc.constant(raw) }, { weight: 2, arbitrary: dueNowArb(serverTime, raw) })
    .map((snapshot) => ({ serverTime, snapshot })),
).chain(({ serverTime, snapshot }) => {
  const absentId = fc.string({ minLength: 1, maxLength: 64 }).filter((id) => !snapshot.reminders.some((r) => r.id === id));
  const ids = snapshot.reminders.map((r) => r.id);
  const reminderId =
    ids.length === 0
      ? absentId
      : fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...ids) }, { weight: 1, arbitrary: absentId });
  return fc.record({ serverTime: fc.constant(serverTime), snapshot: fc.constant(snapshot), reminderId, withKey: fc.boolean() });
});

describe('Deliver handling equals the brain composition', () => {
  /**
   * **Validates: Requirements 13.4, 13.5, 13.6**
   */
  it('Feature: crypt-ouija-simulator, Property 18: Deliver handling equals the brain composition', async () => {
    await fc.assert(
      fc.asyncProperty(deliverCaseArb, async ({ serverTime, snapshot, reminderId, withKey }) => {
        const h = makeHandler({ now: serverTime, withKey });
        const res = await post(h.handler, { type: 'deliver', reminderId, snapshot });
        expect(res.status).toBe(200);

        const expected = reference(snapshot, serverTime, reminderId, h.ai.secrets);
        const got = res.json as SimulatorResponse;
        expect(got.kind).toBe('deliver');
        expect(got.command).toBeNull();
        expect(got.outcome).toBeNull();
        expect(got.serverTime).toBe(serverTime);
        expect(got.parts.map((p) => p.text)).toEqual(expected.texts);
        expect(got.deliveryOutcome).toBe(expected.deliveryOutcome);
        expect(got.snapshot).toEqual(expected.snapshot);

        const reminder = snapshot.reminders.find((r) => r.id === reminderId);
        if (expected.kind === 'absent' || expected.kind === 'wait') {
          // 13.5, 13.6: 0 parts, no Delivery_Outcome, unchanged snapshot.
          expect(got.parts).toHaveLength(0);
          expect(got.deliveryOutcome).toBeNull();
          expect(got.snapshot).toEqual(cleanSnapshot(snapshot, h.ai.secrets));
        } else {
          // 13.4: the Reminder is removed on `final` and on `send`.
          expect(got.snapshot.reminders.some((r) => r.id === reminderId)).toBe(false);
          expect(got.snapshot.reminders).toHaveLength(snapshot.reminders.length - 1);
          expect(got.language).toBe(reminder?.language);
          if (expected.kind === 'final') {
            expect(got.parts).toHaveLength(0);
            expect(got.deliveryOutcome).not.toBeNull();
            expect(got.deliveryOutcome).not.toBe('reminder-sent');
          } else {
            expect(got.parts.length).toBeGreaterThanOrEqual(1);
            expect(got.parts.length).toBeLessThanOrEqual(4);
            expect(got.deliveryOutcome).toBe('reminder-sent');
          }
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
