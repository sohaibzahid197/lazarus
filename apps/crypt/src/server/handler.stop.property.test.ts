// Feature: crypt-ouija-simulator, Property 20: STOP always wins in the simulator
import fc from 'fast-check';
import { STOP_ALIAS_LIST, routeCommand } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot, SnapshotReminder } from '../protocol/snapshot.types';
import type { SimulatorResponse } from '../protocol/wire.types';
import { aiReplyArb, messageBodyArb } from '../test/arbitraries/request';
import { remindersArb, snapshotAtArb } from '../test/arbitraries/snapshot';
import { makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';

/** A body the Command_Router routes to STOP: any alias, any case, optional punctuation or extra words. */
const stopBodyArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('', ' ', '\n'),
    fc.constantFrom(...STOP_ALIAS_LIST),
    fc.constantFrom<'lower' | 'upper' | 'title'>('lower', 'upper', 'title'),
    fc.constantFrom('', '!', '.', ' please', ' now 03001234567'),
  )
  .map(([lead, alias, form, tail]) => {
    const word =
      form === 'upper' ? alias.toUpperCase() : form === 'title' ? alias.charAt(0).toUpperCase() + alias.slice(1) : alias;
    return `${lead}${word}${tail}`;
  })
  .filter((body) => routeCommand(body).command === 'STOP');

/** A valid Message_Body that routes to neither STOP nor START. */
const otherBodyArb: fc.Arbitrary<string> = messageBodyArb.filter((body) => {
  const command = routeCommand(body).command;
  return command !== 'STOP' && command !== 'START';
});

type Scenario =
  | { readonly kind: 'stop'; readonly serverTime: number; readonly snapshot: SessionSnapshot; readonly body: string }
  | { readonly kind: 'ignored'; readonly serverTime: number; readonly snapshot: SessionSnapshot; readonly body: string }
  | { readonly kind: 'deliver'; readonly serverTime: number; readonly snapshot: SessionSnapshot; readonly reminderId: string };

/** Makes one Reminder due at or before the Server_Time, keeping createdAt ≤ dueAt. */
function makeDue(r: SnapshotReminder, serverTime: number): SnapshotReminder {
  const dueAt = Math.min(r.dueAt, serverTime);
  return { ...r, dueAt, createdAt: Math.min(r.createdAt, dueAt) };
}

const stopScenarioArb: fc.Arbitrary<Scenario> = fc
  .tuple(snapshotAtArb, stopBodyArb)
  .map(([{ serverTime, snapshot }, body]): Scenario => ({ kind: 'stop', serverTime, snapshot, body }));

const ignoredScenarioArb: fc.Arbitrary<Scenario> = fc
  .tuple(snapshotAtArb, otherBodyArb)
  .map(([{ serverTime, snapshot }, body]): Scenario => ({
    kind: 'ignored',
    serverTime,
    snapshot: { ...snapshot, stopped: true },
    body,
  }));

const deliverScenarioArb: fc.Arbitrary<Scenario> = snapshotAtArb.chain(({ serverTime, snapshot }) =>
  fc.tuple(remindersArb(serverTime, 1), fc.nat()).map(([reminders, pick]): Scenario => {
    const i = pick % reminders.length;
    const due = reminders.map((r, j) => (j === i ? makeDue(r, serverTime) : r));
    const target = due[i];
    if (target === undefined) throw new Error('no reminder picked');
    return { kind: 'deliver', serverTime, snapshot: { ...snapshot, stopped: true, reminders: due }, reminderId: target.id };
  }),
);

const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(stopScenarioArb, ignoredScenarioArb, deliverScenarioArb);

function ids(s: SessionSnapshot): string[] {
  return s.reminders.map((r) => r.id).sort();
}

describe('STOP always wins in the simulator', () => {
  /**
   * **Validates: Requirements 12.1, 12.2, 12.3**
   */
  it('Feature: crypt-ouija-simulator, Property 20: STOP always wins in the simulator', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, aiReplyArb, fc.boolean(), async (sc, aiReply, withKey) => {
        const h = makeHandler({ now: sc.serverTime, aiReply, withKey });
        const request =
          sc.kind === 'deliver'
            ? { type: 'deliver', reminderId: sc.reminderId, snapshot: sc.snapshot }
            : { type: 'message', body: sc.body, snapshot: sc.snapshot };
        const res = await post(h.handler, request);
        expect(res.status).toBe(200);
        const got = res.json as SimulatorResponse;

        // Nothing is sent to a stopped number, in every case.
        expect(got.parts).toHaveLength(0);
        expect(got.snapshot.stopped).toBe(true);

        if (sc.kind === 'stop') {
          // 12.1: STOP gives `stopped` and clears every Reminder, even when already stopped.
          expect(got.command).toBe('STOP');
          expect(got.outcome).toBe('stopped');
          expect(got.snapshot.reminders).toHaveLength(0);
        } else if (sc.kind === 'ignored') {
          // 12.2: ignored, no Reminder added, no AI call.
          expect(got.outcome).toBe('ignored-stopped');
          expect(ids(got.snapshot)).toEqual(ids(sc.snapshot));
          expect(h.client?.calls.length ?? 0).toBe(0);
        } else {
          // 12.3: a due Reminder for a stopped number is removed, not delivered.
          expect(got.kind).toBe('deliver');
          expect(got.deliveryOutcome).toBe('reminder-stopped');
          expect(ids(got.snapshot)).toEqual(ids(sc.snapshot).filter((id) => id !== sc.reminderId));
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
