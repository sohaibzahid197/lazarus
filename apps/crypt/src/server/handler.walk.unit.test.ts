// Command walk example test (Requirement 18.4): HELP, STOP, a QUESTION, START,
// REMIND, LIST and CANCEL 1 through the Simulator_Route, each request carrying
// the Session_Snapshot the previous response returned.
import {
  GATEWAY_TEXTS,
  REMINDER_TEXTS,
  formatWhen,
  routeCommand,
  splitSms,
  type Command,
  type Outcome,
} from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import { isSimulatorResponse } from '../protocol/response.check';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorResponse } from '../protocol/wire.types';
import { makeHandler, post, type Harness } from '../test/handlerHarness';

/** 2026-01-15 11:00 Pakistan_Time, so `in 1 minute` stays on the same day. */
const START_TIME = Date.UTC(2026, 0, 15, 6, 0, 0);
/** Server_Time advances this much between requests. */
const STEP_MS = 1_000;
const QUESTION = 'How can I keep tomatoes fresh longer?';

interface WalkStep {
  readonly body: string;
  readonly command: Command;
  readonly outcome: Outcome;
}

const WALK: readonly WalkStep[] = [
  { body: 'HELP', command: 'HELP', outcome: 'replied' },
  { body: 'STOP', command: 'STOP', outcome: 'stopped' },
  { body: QUESTION, command: 'QUESTION', outcome: 'ignored-stopped' },
  { body: 'START', command: 'START', outcome: 'started' },
  { body: 'REMIND in 1 minute drink water', command: 'REMIND', outcome: 'replied' },
  { body: 'LIST', command: 'LIST', outcome: 'replied' },
  { body: 'CANCEL 1', command: 'CANCEL', outcome: 'replied' },
];

/** A clock the test advances by hand. */
function steppingClock(start: number): { now: () => number; advance: () => void } {
  let t = start;
  return {
    now: () => t,
    advance: () => {
      t += STEP_MS;
    },
  };
}

async function send(h: Harness, body: string, snapshot: SessionSnapshot): Promise<SimulatorResponse> {
  const res = await post(h.handler, { type: 'message', body, snapshot });
  expect(res.status).toBe(200);
  if (!isSimulatorResponse(res.json)) throw new Error(`not a Simulator_Response for ${body}`);
  return res.json;
}

function texts(r: SimulatorResponse): string[] {
  return r.parts.map((p) => p.text);
}

describe('command walk through the Simulator_Route', () => {
  it('the walk bodies route to the expected Commands', () => {
    for (const step of WALK) expect(routeCommand(step.body).command).toBe(step.command);
  });

  it('HELP, STOP, QUESTION, START, REMIND, LIST, CANCEL 1 give the expected Outcomes and replies', async () => {
    const clock = steppingClock(START_TIME);
    const h = makeHandler({ now: clock.now });
    let snapshot = emptySnapshot(clock.now());
    const responses: SimulatorResponse[] = [];

    for (const step of WALK) {
      const r = await send(h, step.body, snapshot);
      expect(r.kind).toBe('message');
      expect(r.command).toBe(step.command);
      expect(r.outcome).toBe(step.outcome);
      expect(r.language).toBe('en');
      expect(r.deliveryOutcome).toBeNull();
      responses.push(r);
      snapshot = r.snapshot;
      if (step.command === 'QUESTION') expect(h.client?.calls.length).toBe(0);
      clock.advance();
    }

    const [help, stop, question, start, remind, list, cancel] = responses;
    if (!help || !stop || !question || !start || !remind || !list || !cancel) throw new Error('missing response');
    const en = GATEWAY_TEXTS.en;
    const rt = REMINDER_TEXTS.en;

    expect(texts(help)).toEqual(splitSms(en.help));
    expect(help.snapshot.stopped).toBe(false);

    expect(stop.parts).toHaveLength(0);
    expect(stop.snapshot.stopped).toBe(true);

    expect(question.parts).toHaveLength(0);
    expect(question.snapshot.stopped).toBe(true);

    expect(texts(start)).toEqual(splitSms(en.welcomeBack));
    expect(start.snapshot.stopped).toBe(false);

    expect(remind.snapshot.reminders).toHaveLength(1);
    const reminder = remind.snapshot.reminders[0];
    if (reminder === undefined) throw new Error('no reminder');
    expect(reminder.slot).toBe(1);
    expect(reminder.text).toBe('drink water');
    expect(reminder.language).toBe('en');
    expect(reminder.dueAt).toBe(remind.serverTime + 60_000);
    expect(texts(remind)).toEqual(splitSms(rt.set(1, formatWhen(reminder.dueAt, 'en'))));

    const listText = texts(list).join(' ');
    expect(listText.startsWith(rt.listLead)).toBe(true);
    expect(listText).toContain('drink water');
    expect(list.snapshot.reminders).toEqual(remind.snapshot.reminders);

    expect(texts(cancel)).toEqual(splitSms(rt.cancelled(1)));
    expect(cancel.snapshot.reminders).toHaveLength(0);

    // No AI call in the whole walk: the only QUESTION came while STOP was on.
    expect(h.client?.calls.length).toBe(0);
  });
});
