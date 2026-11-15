// Unit tests for the Crypt_Dashboard constants and rendered markup
// (Requirements 15.1, 15.2, 15.4, 15.5, 15.6, 15.7, 15.8, 15.10, 16.7).
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskNumber } from '@lazarus/brain';
import { Dashboard } from './Dashboard';
import {
  COMMANDS,
  DEMO_COUNTERS,
  EXPLANATION,
  HEARTBEAT_LEGEND,
  SAMPLE_CONVERSATION,
  SAMPLE_NUMBER,
} from './dashboard.data';

const words = (text: string): number => text.split(/\s+/).filter((w) => w.length > 0).length;

/** A run of 7+ digits, counting digits separated only by spaces or hyphens as one run (15.10). */
const SEVEN_DIGIT_RUN = /\d(?:[\s-]*\d){6,}/;

describe('dashboard data', () => {
  it('explanation has at most 200 words and names the 3 steps in order', () => {
    const text = EXPLANATION.join(' ');
    expect(words(text)).toBeLessThanOrEqual(200);
    const receive = text.indexOf('receives an SMS');
    const brain = text.indexOf('runs the brain');
    const send = text.indexOf('sends the reply');
    expect(receive).toBeGreaterThanOrEqual(0);
    expect(brain).toBeGreaterThan(receive);
    expect(send).toBeGreaterThan(brain);
  });

  it('lists every command with a description of at most 20 words', () => {
    expect(COMMANDS.map((c) => c.command)).toEqual([
      'HELP',
      'STOP',
      'START',
      'SCAM <text>',
      'REMIND <time> <text>',
      'LIST',
      'CANCEL',
      'Any question',
    ]);
    for (const c of COMMANDS) {
      expect(words(c.description)).toBeGreaterThan(0);
      expect(words(c.description)).toBeLessThanOrEqual(20);
    }
  });

  it('demo counters meet the 15.4 rules', () => {
    const received = DEMO_COUNTERS.received.value;
    const replies = DEMO_COUNTERS.repliesSent.value;
    const parts = DEMO_COUNTERS.partsSent.value;
    const ignored = DEMO_COUNTERS.ignored.value;
    for (const v of [received, replies, parts, ignored]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(999_999);
    }
    expect(replies).toBeLessThanOrEqual(received);
    expect(parts).toBeGreaterThanOrEqual(replies);
    expect(parts).toBeLessThanOrEqual(4 * replies);
    expect(ignored).toBeLessThanOrEqual(received);
  });

  it('sample conversation has 4 to 8 messages with masked senders only', () => {
    expect(SAMPLE_CONVERSATION.length).toBeGreaterThanOrEqual(4);
    expect(SAMPLE_CONVERSATION.length).toBeLessThanOrEqual(8);
    const masked = maskNumber(SAMPLE_NUMBER);
    const lastThree = SAMPLE_NUMBER.slice(-3);
    expect(masked.replace(/\D/g, '')).toBe(lastThree);
    for (const m of SAMPLE_CONVERSATION) {
      expect(['incoming', 'outgoing']).toContain(m.direction);
      if (m.direction === 'incoming') {
        expect(m.from).toBe(masked);
      } else {
        expect(m.from).toBeNull();
      }
    }
  });

  it('heartbeat legend covers the 3 states with their labels and short meanings', () => {
    expect(HEARTBEAT_LEGEND.map((i) => [i.state, i.label])).toEqual([
      ['ALIVE', 'Alive'],
      ['SENDING', 'Sending…'],
      ['SLEEPING', 'Sleeping: STOP is on'],
    ]);
    for (const item of HEARTBEAT_LEGEND) {
      expect(words(item.meaning)).toBeGreaterThan(0);
      expect(words(item.meaning)).toBeLessThanOrEqual(20);
    }
  });
});

describe('Dashboard markup', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const html = renderToStaticMarkup(<Dashboard />);

  it('has no 7-digit run and no full sample number', () => {
    expect(html).not.toMatch(SEVEN_DIGIT_RUN);
    expect(html).not.toContain(SAMPLE_NUMBER);
    expect(html).not.toContain(SAMPLE_NUMBER.slice(1));
    expect(html).toContain(maskNumber(SAMPLE_NUMBER));
  });

  it('is read-only: no form, input, textarea or editable element', () => {
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/<input\b/i);
    expect(html).not.toMatch(/<textarea\b/i);
    expect(html).not.toMatch(/contenteditable/i);
  });

  it('shows the Demo data label and the 3 heartbeat labels', () => {
    expect(html).toContain('Demo data');
    for (const item of HEARTBEAT_LEGEND) {
      expect(html).toContain(item.label);
    }
  });

  it('marks Urdu sample messages with lang="ur" and dir="rtl"', () => {
    const urdu = SAMPLE_CONVERSATION.filter((m) => /[\u0600-\u06FF]/.test(m.text));
    expect(urdu.length).toBeGreaterThan(0);
    const urduParagraphs = html.match(/<p[^>]*lang="ur"[^>]*>/g) ?? [];
    expect(urduParagraphs.length).toBe(urdu.length);
    for (const tag of urduParagraphs) {
      expect(tag).toContain('dir="rtl"');
    }
  });

  it('renders the same with or without GEMINI_API_KEY', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.resetModules();
    const without = await import('./Dashboard');
    const htmlWithout = renderToStaticMarkup(<without.Dashboard />);

    vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real-0000000000000000000000');
    vi.resetModules();
    const withKey = await import('./Dashboard');
    const htmlWith = renderToStaticMarkup(<withKey.Dashboard />);

    expect(htmlWith).toBe(htmlWithout);
    expect(htmlWith).toBe(html);
    expect(htmlWith).not.toContain('test-key-not-real');
  });
});
