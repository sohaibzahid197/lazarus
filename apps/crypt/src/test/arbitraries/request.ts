// Test-only arbitraries for Simulator_Requests and mocked AI replies
// (Requirements 7.7, 17.4, 18.1, 18.3).
import fc from 'fast-check';
import { MAX_BODY_UNITS } from '../../protocol/limits';
import { emptySnapshot } from '../../protocol/emptySnapshot';
import type { ErrorCode } from '../../protocol/wire.types';
import { TEST_KEY } from '../pbt';

/** The Simulator_Number as the privacy checks look for it (design C2). Kept in sync by the sanity test. */
export const SIMULATOR_NUMBER_TEXT = '+999666000000666';
/** The Simulator_Number digits without the `+`. */
export const SIMULATOR_DIGITS = '999666000000666';

/** The 5 phone-number forms of Requirement 17.4. */
export const PHONE_FORMS: readonly string[] = [
  '+923001234567',
  '923001234567',
  '03001234567',
  '0300-1234567',
  '0300 123 4567',
];

/** One message per Command, plus English, Urdu and Roman Urdu questions. */
export const SAMPLE_BODIES: readonly string[] = [
  'HELP',
  'help',
  'STOP',
  'START',
  'SCAM You won a prize, send your PIN to claim it',
  'REMIND in 1 minute drink water',
  'REMIND tomorrow 9am call mother',
  'TRANSLATE good morning',
  'LIST',
  'CANCEL 1',
  'How can I keep tomatoes fresh longer?',
  'مدد',
  'آج موسم کیسا ہے؟',
  'kya aaj barish hogi?',
  'mujhe batao gandum kab boni chahiye',
];

const freeTextArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 60 }),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }),
);

/** Fits a body to 1..480 UTF-16 code units with a non-whitespace character, never ending in a lone high surrogate. */
function fitBody(text: string): string {
  let out = text.length > MAX_BODY_UNITS ? text.slice(0, MAX_BODY_UNITS) : text;
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return /\S/.test(out) ? out : 'HELP';
}

/**
 * A valid Message_Body (1..480 code units, at least 1 non-whitespace
 * character): every Command, the three Languages, the phone-number forms,
 * the fake TEST_KEY, and free text, alone or combined.
 */
export const messageBodyArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.constantFrom(...SAMPLE_BODIES),
    fc.tuple(fc.constantFrom(...SAMPLE_BODIES), fc.constantFrom(...PHONE_FORMS)).map(([b, p]) => `${b} ${p}`),
    fc.constantFrom(...PHONE_FORMS).map((p) => `REMIND in 1 minute call ${p}`),
    fc.constant(`my key is ${TEST_KEY}`),
    fc.constant(`REMIND in 2 minutes ${TEST_KEY}`),
    fc.tuple(freeTextArb, fc.constantFrom(...PHONE_FORMS, TEST_KEY, SIMULATOR_DIGITS)).map(([t, s]) => `${t} ${s}`),
    freeTextArb,
  )
  .map(fitBody);

/**
 * A mocked AI reply that may repeat the Simulator_Number, its digits without
 * the `+`, the fake key or a phone number (17.4).
 */
export const aiReplyArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant('Keep tomatoes in a cool, dry place.'),
  fc.constant(`Call ${SIMULATOR_NUMBER_TEXT} for help.`),
  fc.constant(`Your number is ${SIMULATOR_DIGITS}.`),
  fc.constant(`The key is ${TEST_KEY}.`),
  fc
    .tuple(fc.string({ maxLength: 40 }), fc.constantFrom(SIMULATOR_NUMBER_TEXT, SIMULATOR_DIGITS, TEST_KEY, ...PHONE_FORMS))
    .map(([t, s]) => `${t}${s}${t}`),
  fc.string({ minLength: 1, maxLength: 200 }),
);

/** A raw request body and the 400 error code the handler must answer with. */
export interface InvalidRequest {
  readonly raw: string;
  readonly error: Extract<ErrorCode, 'invalid-json' | 'invalid-type' | 'invalid-body' | 'invalid-reminder-id'>;
}

// A valid snapshot, so only the request shape is wrong.
const SNAPSHOT = emptySnapshot(1_767_225_600_000);

const badBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('   \n\t'),
  fc.constant('a'.repeat(MAX_BODY_UNITS + 1)),
  fc.integer(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 3 }),
);

const badReminderIdArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('r'.repeat(65)),
  fc.integer(),
  fc.constant(null),
);

function withField(base: Record<string, unknown>, name: string, value: unknown): string {
  return JSON.stringify(value === undefined ? base : { ...base, [name]: value });
}

/** A request body that fails the JSON or shape check of Requirement 7.7 in exactly one way. */
export const invalidRequestArb: fc.Arbitrary<InvalidRequest> = fc.oneof(
  fc
    .oneof(fc.constant('{'), fc.constant('not json'), fc.constant(''), fc.constant('{"type":"message",}'))
    .map((raw): InvalidRequest => ({ raw, error: 'invalid-json' })),
  fc
    .oneof(
      fc.constantFrom('null', '[]', '42', '"message"', 'true'),
      fc.string({ maxLength: 10 }).filter((t) => t !== 'message' && t !== 'deliver')
        .map((type) => JSON.stringify({ type, body: 'HELP', snapshot: SNAPSHOT })),
      fc.constant(JSON.stringify({ body: 'HELP', snapshot: SNAPSHOT })),
      fc.constant(JSON.stringify({ type: 'message', body: 'HELP', snapshot: SNAPSHOT, extra: 1 })),
      fc.constant(JSON.stringify({ type: 'deliver', reminderId: 'r:a', snapshot: SNAPSHOT, number: '+1' })),
    )
    .map((raw): InvalidRequest => ({ raw, error: 'invalid-type' })),
  badBodyArb.map(
    (body): InvalidRequest => ({
      raw: withField({ type: 'message', snapshot: SNAPSHOT }, 'body', body),
      error: 'invalid-body',
    }),
  ),
  badReminderIdArb.map(
    (id): InvalidRequest => ({
      raw: withField({ type: 'deliver', snapshot: SNAPSHOT }, 'reminderId', id),
      error: 'invalid-reminder-id',
    }),
  ),
);
