// Component tests for the T9_Keypad inside the Ouija_Simulator (task 15.7).
// Fake timers drive the 1,000 ms Multi_Tap_Timeout; jsdom stamps events with
// the faked Date.now, so press times follow the fake clock. `fetch` is stubbed
// so no real request can leave the test.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_UNITS } from '../protocol/limits';
import { OuijaSimulator } from './OuijaSimulator';
import { LENGTH_LIMIT_TEXT } from './texts';

const T0 = 1_767_225_600_000;

/** A fetch that records calls and never answers. */
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
  () => new Promise<Response>(() => undefined),
);

function setup() {
  const user = userEvent.setup({ delay: null, advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  render(<OuijaSimulator />);
  return user;
}

function key(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

const KEY_2 = '2, a b c';
const KEY_3 = '3, d e f';
const KEY_4 = '4, g h i';
const KEY_5 = '5, j k l';
const KEY_7 = '7, p q r s';
const STAR = 'star, change case';
const HASH = 'hash, change letters or numbers';

function composeBox(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Message' });
}

function pendingEl(): HTMLElement | null {
  return composeBox().querySelector('u');
}

function modeText(): string {
  const el = document.querySelector('.phone__mode');
  return el?.textContent ?? '';
}

function politeRegion(): HTMLElement {
  return screen.getByTestId('announcer-polite');
}

async function press(user: ReturnType<typeof userEvent.setup>, name: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) await user.click(key(name));
}

async function typeHelp(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await press(user, STAR);
  await press(user, KEY_4, 2);
  await press(user, KEY_3, 2);
  await press(user, KEY_5, 3);
  await press(user, KEY_7);
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  // Testing Library drains pending work with a setTimeout(0) after each event
  // and only advances fake timers when it sees a `jest` global; without this
  // shim every awaited user-event call hangs under Vitest fake timers.
  vi.stubGlobal('jest', {
    advanceTimersByTime: (ms: number) => {
      vi.advanceTimersByTime(ms);
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('T9_Keypad in the Ouija_Simulator', () => {
  it('starts in lower-case Letter_Mode with case-aware key labels and accessible names (3.10, 3.11, 16.3)', async () => {
    const user = setup();
    expect(modeText()).toBe('Keypad mode: abc');
    expect(pendingEl()).toBeNull();
    expect(key(KEY_2).textContent).toBe('2 a b c');
    expect(key(KEY_7).textContent).toBe('7 p q r s');
    expect(key('0, space')).toBeTruthy();
    expect(key('1, period comma question mark exclamation mark apostrophe hyphen').textContent).toBe("1 .,?!'-");
    expect(within(screen.getByRole('group', { name: 'Keypad' })).getAllByRole('button')).toHaveLength(12);

    await press(user, STAR);
    expect(key(KEY_2).textContent).toBe('2 A B C');
  });

  it('types HELP with *, 4 4, 3 3, 5 5 5, 7 and underlines the Pending_Character (3.1, 3.2, 3.3, 3.5)', async () => {
    const user = setup();
    await typeHelp(user);
    expect(composeBox().textContent).toBe('HELP');
    expect(pendingEl()?.textContent).toBe('P');
    expect(screen.getByText('4/480')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wraps after the last Key_Map character and shows a space for 3 presses of 0 (3.2)', async () => {
    const user = setup();
    await press(user, KEY_2, 5);
    expect(pendingEl()?.textContent).toBe('a');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await press(user, '0, space', 3);
    expect(pendingEl()?.textContent).toBe(' ');
  });

  it('commits the Pending_Character when the 1,000 ms Multi_Tap_Timeout fires (3.3)', async () => {
    const user = setup();
    await press(user, KEY_2, 2);
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(pendingEl()?.textContent).toBe('b');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(pendingEl()).toBeNull();
    expect(composeBox().textContent).toBe('b');

    // A press of the same key after the timeout starts a new character.
    await press(user, KEY_2);
    expect(composeBox().textContent).toBe('ba');
    expect(pendingEl()?.textContent).toBe('a');
  });

  it('commits at once when a different key is pressed (3.3)', async () => {
    const user = setup();
    await press(user, KEY_4, 2);
    await press(user, KEY_3);
    expect(composeBox().textContent).toBe('hd');
    expect(pendingEl()?.textContent).toBe('d');
  });

  it('types digits in Number_Mode with no Pending_Character, keeping the case for Letter_Mode (3.4, 3.5, 3.6)', async () => {
    const user = setup();
    await press(user, HASH);
    expect(modeText()).toBe('Keypad mode: 123');
    await press(user, KEY_2, 2);
    expect(composeBox().textContent).toBe('22');
    expect(pendingEl()).toBeNull();

    await press(user, STAR);
    expect(modeText()).toBe('Keypad mode: 123');
    await press(user, HASH);
    expect(modeText()).toBe('Keypad mode: ABC');
    await press(user, KEY_2);
    expect(pendingEl()?.textContent).toBe('A');
  });

  it('announces each mode change politely and keeps focus on the pressed key (3.7, 16.9)', async () => {
    const user = setup();
    expect(politeRegion().textContent).toBe('');
    await press(user, STAR);
    expect(modeText()).toBe('Keypad mode: ABC');
    expect(politeRegion().textContent).toContain('ABC');
    expect(document.activeElement).toBe(key(STAR));

    await press(user, HASH);
    expect(modeText()).toBe('Keypad mode: 123');
    expect(politeRegion().textContent).toContain('123');
    expect(document.activeElement).toBe(key(HASH));
    expect(screen.getByTestId('announcer-polite').getAttribute('aria-live')).toBe('polite');
  });

  it('maps physical keys, Backspace and Enter on a focused key (3.9)', async () => {
    const user = setup();
    key(KEY_2).focus();
    await user.keyboard('*44');
    expect(composeBox().textContent).toBe('H');
    expect(pendingEl()?.textContent).toBe('H');
    expect(modeText()).toBe('Keypad mode: ABC');

    await user.keyboard('{Backspace}');
    expect(composeBox().textContent).toBe('');

    await user.keyboard('444#7');
    expect(composeBox().textContent).toBe('I7');
    expect(modeText()).toBe('Keypad mode: 123');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { type?: string; body?: string };
    expect(body).toMatchObject({ type: 'message', body: 'I7' });
  });

  it('drops a character past 480 code units and shows the length message (3.12)', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: /Keypad/ }));
    const area = screen.getByRole('textbox', { name: 'Message' });
    await user.click(area);
    await user.paste('a'.repeat(MAX_BODY_UNITS));
    await user.click(screen.getByRole('button', { name: /Keyboard/ }));
    expect(screen.queryByText(LENGTH_LIMIT_TEXT)).toBeNull();

    // Number_Mode digit is dropped at once.
    await press(user, HASH);
    await press(user, KEY_2);
    expect(composeBox().textContent).toBe('a'.repeat(MAX_BODY_UNITS));
    expect(screen.getByText(LENGTH_LIMIT_TEXT)).toBeTruthy();

    // A Letter_Mode commit at the timeout is dropped too.
    await press(user, HASH);
    await press(user, KEY_3);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(composeBox().textContent).toBe('a'.repeat(MAX_BODY_UNITS));
    expect(pendingEl()).toBeNull();
    expect(screen.getByText(LENGTH_LIMIT_TEXT)).toBeTruthy();
  });
});
