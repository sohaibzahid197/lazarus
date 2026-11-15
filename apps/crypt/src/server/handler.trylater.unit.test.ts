// Try_Later_Text examples for the Simulator_Route (Requirements 9.3, 9.4, 18.5).
// A QUESTION and a SCAM in English, Urdu script and Roman Urdu get the
// Try_Later_Text in that Language with HTTP status 200, once with no
// Gemini_Api_Key and once for each AI error kind of the mock AiClient.
import {
  AI_ERROR_KINDS,
  detectLanguage,
  FIXED_TEXTS,
  routeCommand,
  type AiErrorKind,
  type Command,
  type Language,
} from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import { isSimulatorResponse } from '../protocol/response.check';
import { makeHandler, post, type HarnessOptions } from '../test/handlerHarness';

const SERVER_TIME = Date.UTC(2026, 0, 1, 9, 0, 0);

interface Example {
  readonly language: Language;
  readonly command: Extract<Command, 'QUESTION' | 'SCAM'>;
  readonly body: string;
}

const EXAMPLES: readonly Example[] = [
  { language: 'en', command: 'QUESTION', body: 'How can I keep tomatoes fresh longer?' },
  { language: 'en', command: 'SCAM', body: 'SCAM You won a prize, send your PIN to claim it' },
  { language: 'ur', command: 'QUESTION', body: 'ٹماٹر زیادہ دیر تازہ کیسے رکھوں؟' },
  { language: 'ur', command: 'SCAM', body: 'دھوکہ آپ نے انعام جیتا ہے، اپنا پن بھیجیں' },
  { language: 'roman-ur', command: 'QUESTION', body: 'tamatar zyada dair taza kaise rakhun?' },
  { language: 'roman-ur', command: 'SCAM', body: 'dhoka aap ne inaam jeeta hai, apna pin bhejein' },
];

interface Mode {
  readonly name: string;
  readonly options: Omit<HarnessOptions, 'now'>;
  /** Whether the mock AiClient is expected to be called. */
  readonly callsAi: boolean;
}

const MODES: readonly Mode[] = [
  { name: 'no GEMINI_API_KEY', options: { withKey: false }, callsAi: false },
  ...AI_ERROR_KINDS.map(
    (kind: AiErrorKind): Mode => ({ name: `AI error ${kind}`, options: { aiError: kind }, callsAi: true }),
  ),
];

describe('Simulator_Route Try_Later_Text', () => {
  it('example bodies route to the intended Command and Language', () => {
    for (const ex of EXAMPLES) {
      expect(routeCommand(ex.body).command, ex.body).toBe(ex.command);
      expect(detectLanguage(ex.body), ex.body).toBe(ex.language);
    }
  });

  for (const mode of MODES) {
    describe(mode.name, () => {
      it.each(EXAMPLES)('$command in $language gets the Try_Later_Text', async (ex) => {
        const h = makeHandler({ now: SERVER_TIME, ...mode.options });
        const res = await post(h.handler, { type: 'message', body: ex.body, snapshot: emptySnapshot(SERVER_TIME) });

        expect(res.status).toBe(200);
        expect(isSimulatorResponse(res.json)).toBe(true);
        if (!isSimulatorResponse(res.json)) return;
        const r = res.json;
        const tryLater = FIXED_TEXTS[ex.language].tryLater;

        expect(r.kind).toBe('message');
        expect(r.command).toBe(ex.command);
        expect(r.language).toBe(ex.language);
        expect(r.outcome).toBe('replied');
        expect(r.parts.map((p) => p.text)).toStrictEqual([tryLater]);
        expect(r.encoding).toBe(ex.language === 'ur' ? 'UCS-2' : 'GSM-7');
        expect(r.repliesLeft).toBe(4);
        expect(r.serverTime).toBe(SERVER_TIME);

        if (mode.callsAi) {
          expect(h.client?.calls.length ?? 0).toBeGreaterThanOrEqual(1);
        } else {
          // No key: no AiClient exists and no request goes to Gemini (9.3).
          expect(h.client).toBeNull();
          expect(h.ai.answer).toBeNull();
        }
      });
    });
  }
});
