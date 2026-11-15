// Component tests for Keyboard_Input in the Ouija_Simulator (task 15.8).
// fetch is stubbed with a request that never answers (it rejects on abort),
// so no real request happens and a sent message stays "waiting".
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorRequest } from '../protocol/wire.types';
import { OuijaSimulator } from './OuijaSimulator';
import { LENGTH_LIMIT_TEXT } from './texts';

interface FetchStub {
  readonly requests: SimulatorRequest[];
}

function stubFetch(): FetchStub {
  const requests: SimulatorRequest[] = [];
  const fetchFn = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(JSON.parse(typeof init?.body === 'string' ? init.body : '') as SimulatorRequest);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  };
  vi.stubGlobal('fetch', vi.fn(fetchFn));
  return { requests };
}

/** Renders the simulator and switches it to Keyboard_Input. */
async function renderKeyboard() {
  const user = userEvent.setup();
  render(<OuijaSimulator />);
  await user.click(screen.getByRole('button', { name: /Keypad/ }));
  const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
  return { user, field };
}

let stub: FetchStub;

beforeEach(() => {
  stub = stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Keyboard_Input', () => {
  it('switching Input_Mode shows a textarea and commits the Pending_Character (5.3)', async () => {
    const user = userEvent.setup();
    render(<OuijaSimulator />);
    await user.click(screen.getByRole('button', { name: '2, a b c' }));
    await user.click(screen.getByRole('button', { name: /Keypad/ }));
    const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' });
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.value).toBe('a');
    expect(screen.getByRole('button', { name: /Keyboard/ })).toBeTruthy();
  });

  it('Enter sends the Message_Body without inserting a line break (5.2)', async () => {
    const { user, field } = await renderKeyboard();
    await user.type(field, 'hello{Enter}');
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]).toMatchObject({ type: 'message', body: 'hello' });
    expect(field.value).toBe('');
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('Shift+Enter inserts a line break and sends nothing (5.6)', async () => {
    const { user, field } = await renderKeyboard();
    await user.type(field, 'a{Shift>}{Enter}{/Shift}b');
    expect(field.value).toBe('a\nb');
    expect(stub.requests).toHaveLength(0);
  });

  it('Enter during an IME composition sends nothing (5.7)', async () => {
    const { user, field } = await renderKeyboard();
    await user.type(field, 'kya');
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(stub.requests).toHaveLength(0);
    expect(field.value).toBe('kya');
  });

  it('Enter on an empty or whitespace-only field sends nothing and keeps the text (5.8)', async () => {
    const { user, field } = await renderKeyboard();
    await user.type(field, '{Enter}');
    expect(field.value).toBe('');
    await user.type(field, '   {Enter}');
    expect(field.value).toBe('   ');
    expect(stub.requests).toHaveLength(0);
  });

  it('Enter while a message is waiting sends no second request and keeps the text (5.8, 6.3)', async () => {
    const { user, field } = await renderKeyboard();
    await user.type(field, 'first{Enter}');
    await user.type(field, 'second{Enter}');
    expect(stub.requests).toHaveLength(1);
    expect(field.value).toBe('second');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(true);
  });

  it('a paste over 480 code units is truncated and shows the length message (5.4)', async () => {
    const { user, field } = await renderKeyboard();
    await user.click(field);
    await user.paste('x'.repeat(500));
    expect(field.value).toBe('x'.repeat(480));
    expect(screen.getByText('480/480')).toBeTruthy();
    expect(screen.getByText(LENGTH_LIMIT_TEXT)).toBeTruthy();
    await user.type(field, '{Backspace}');
    expect(screen.queryByText(LENGTH_LIMIT_TEXT)).toBeNull();
  });

  it('a paste that ends mid surrogate pair keeps 479 code units (5.4)', async () => {
    const { user, field } = await renderKeyboard();
    await user.click(field);
    await user.paste(`${'x'.repeat(479)}😀`);
    expect(field.value).toBe('x'.repeat(479));
    expect(screen.getByText(LENGTH_LIMIT_TEXT)).toBeTruthy();
  });

  it('Urdu text gets lang="ur" with dir="auto" in the field, and rtl in the sent bubble (5.5, 16.7)', async () => {
    const { user, field } = await renderKeyboard();
    await user.type(field, 'مدد');
    expect(field.getAttribute('dir')).toBe('auto');
    expect(field.getAttribute('lang')).toBe('ur');
    await user.type(field, '{Enter}');
    expect(stub.requests[0]).toMatchObject({ type: 'message', body: 'مدد' });
    const bubble = screen.getByText('مدد');
    expect(bubble.closest('[dir="rtl"]')).not.toBeNull();
    expect(bubble.closest('[lang="ur"]')).not.toBeNull();
  });
});
