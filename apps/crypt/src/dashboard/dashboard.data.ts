import 'server-only';
import {
  GATEWAY_TEXTS,
  isCanonicalNumber,
  maskNumber,
  type CanonicalNumber,
} from '@lazarus/brain';

// Crypt_Dashboard content (Requirement 15). Every value is a constant, so the
// page is the same with or without GEMINI_API_KEY (15.8).

/** Visible explanation, at most 200 words, naming the 3 steps in order (15.1). */
export const EXPLANATION: readonly string[] = [
  'Lazarus turns an old Android phone into a free SMS helper.',
  'First, the old phone receives an SMS from anyone, even from a button phone with no internet.',
  'Second, the phone runs the brain: it reads the command, finds the language of the message and writes a short reply.',
  'Third, the phone sends the reply back by SMS, in 1 to 4 parts, in English, Urdu or Roman Urdu.',
  'The sender needs no app, no data and no account.',
];

export interface CommandInfo {
  readonly command: string;
  readonly description: string;
}

/** Commands with one-line descriptions of at most 20 words each (15.2). */
export const COMMANDS: readonly CommandInfo[] = [
  { command: 'HELP', description: 'Get a short list of the commands.' },
  { command: 'STOP', description: 'Stop all texts to your number. No more replies until you send START.' },
  { command: 'START', description: 'Get replies again after STOP.' },
  { command: 'SCAM <text>', description: 'Paste a message you got to check it for common scam signs.' },
  { command: 'REMIND <time> <text>', description: 'Set a reminder. Lazarus texts you the text at that time.' },
  { command: 'LIST', description: 'See your active reminders.' },
  { command: 'CANCEL', description: 'Cancel a reminder by its number from LIST.' },
  { command: 'Any question', description: 'Ask anything in plain words and get a short answer by SMS.' },
];

export interface DemoCounter {
  readonly name: string;
  readonly value: number;
}

export interface DemoCounters {
  readonly received: DemoCounter;
  readonly repliesSent: DemoCounter;
  readonly partsSent: DemoCounter;
  readonly ignored: DemoCounter;
}

/** Visible label shown in the counters section (15.3). */
export const DEMO_DATA_LABEL = 'Demo data';

/**
 * Fixed example counters (15.3, 15.4): integers 0..999,999, replies ≤ received,
 * replies ≤ parts ≤ 4 × replies, ignored ≤ received.
 */
export const DEMO_COUNTERS: DemoCounters = {
  received: { name: 'Messages received', value: 128 },
  repliesSent: { name: 'Replies sent', value: 117 },
  partsSent: { name: 'SMS parts sent', value: 203 },
  ignored: { name: 'Ignored messages', value: 6 },
};

function checkedNumber(raw: string): CanonicalNumber {
  if (!isCanonicalNumber(raw)) {
    throw new Error('SAMPLE_NUMBER is not a canonical number');
  }
  return raw;
}

/** Fictional sender (country code 999 is unassigned). Never rendered unmasked. */
export const SAMPLE_NUMBER: CanonicalNumber = checkedNumber('+999666000000137');

const SAMPLE_SENDER = maskNumber(SAMPLE_NUMBER);

export interface SampleMessage {
  readonly direction: 'incoming' | 'outgoing';
  /** Masked_Number of the sender for incoming messages; null for gateway replies. */
  readonly from: string | null;
  readonly text: string;
}

const incoming = (text: string): SampleMessage => ({ direction: 'incoming', from: SAMPLE_SENDER, text });
const outgoing = (text: string): SampleMessage => ({ direction: 'outgoing', from: null, text });

/**
 * Sample_Conversation (15.5), in time order. Replies are the brain's own fixed
 * texts, so the sample invents no facts. STOP gets no reply, as on the gateway.
 */
export const SAMPLE_CONVERSATION: readonly SampleMessage[] = [
  incoming('HELP'),
  outgoing(GATEWAY_TEXTS.en.help),
  incoming('STOP'),
  incoming('START'),
  outgoing(GATEWAY_TEXTS.en.welcomeBack),
  incoming('مدد'),
  outgoing(GATEWAY_TEXTS.ur.help),
];

export type LegendState = 'ALIVE' | 'SENDING' | 'SLEEPING';

export interface HeartbeatLegendItem {
  readonly state: LegendState;
  readonly label: string;
  readonly look: string;
  readonly meaning: string;
}

/** Heartbeat legend (15.6): label, look and a meaning of at most 20 words. */
export const HEARTBEAT_LEGEND: readonly HeartbeatLegendItem[] = [
  {
    state: 'ALIVE',
    label: 'Alive',
    look: 'Green heartbeat line',
    meaning: 'The phone is ready. The line pulses once for each SMS part.',
  },
  {
    state: 'SENDING',
    label: 'Sending…',
    look: 'Ember glow',
    meaning: 'A message is on its way, or reply parts are still being sent.',
  },
  {
    state: 'SLEEPING',
    label: 'Sleeping: STOP is on',
    look: 'Grey flat line',
    meaning: 'This number sent STOP, so Lazarus stays quiet until it sends START.',
  },
];
