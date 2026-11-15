// Served-output privacy check (Requirements 17.8, 9.5, 1.11, 17.1, 17.2).
// Runs against the production build on port 3101, started with the fixed fake
// CRYPT_TEST_KEY. That key is not a real Gemini key: a QUESTION makes the
// server's Gemini call fail, which must give the Try_Later_Text and never a leak.
// Every check is a named `test.step`, so a failure names the check.
import { expect, test, type APIResponse, type Locator, type Page, type Response } from '@playwright/test';
import { FIXED_TEXTS } from '@lazarus/brain';
import { CRYPT_TEST_KEY, TEST_KEY_URL } from '../playwright.config';

const STEP_LIMIT = { timeout: 10_000 } as const;
/** A QUESTION waits for the failing Gemini call; the brain's backstop is 25 s. */
const AI_STEP_LIMIT = { timeout: 30_000 } as const;
/**
 * The Simulator_Number of design C2. It lives in a server-only module that a
 * Node test cannot import, so it is repeated here, as in the bundle scan.
 */
const SIMULATOR_NUMBER = '+999666000000666';
const SIMULATOR_DIGITS = '999666000000666';
const NEEDLES: readonly { readonly label: string; readonly value: string }[] = [
  { label: 'test key', value: CRYPT_TEST_KEY },
  { label: 'Simulator_Number', value: SIMULATOR_NUMBER },
  { label: 'Simulator_Number digits', value: SIMULATOR_DIGITS },
];

test.use({ baseURL: TEST_KEY_URL });

/** Labels of every needle found in `text`; empty when clean. */
function leaksIn(text: string): string[] {
  return NEEDLES.filter((n) => text.includes(n.value)).map((n) => n.label);
}

function headersText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

async function expectCleanApiResponse(res: APIResponse, what: string): Promise<void> {
  const body = await res.text();
  expect(leaksIn(body), `${what} body`).toEqual([]);
  expect(leaksIn(headersText(res.headers())), `${what} headers`).toEqual([]);
  expect(res.headers()['set-cookie'], `${what} Set-Cookie`).toBeUndefined();
}

function phone(page: Page): Locator {
  return page.getByRole('region', { name: 'Phone' });
}

function partBubbles(page: Page): Locator {
  return phone(page).locator('[data-bubble-kind="part"]');
}

/** Sends one Message_Body by keyboard and waits until the reply has finished dripping in. */
async function sendAndSettle(page: Page, body: string, timeout: number): Promise<void> {
  const field = phone(page).getByRole('textbox', { name: 'Message' });
  await field.fill(body);
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/ouija', { timeout });
  await field.press('Enter');
  await answered;
  await expect(phone(page).getByText('Sending…', { exact: true })).toHaveCount(0, { timeout });
}

test('served HTML and headers of / and /crypt hold no key or number', async ({ request }) => {
  for (const path of ['/', '/crypt']) {
    await test.step(`GET ${path} is clean`, async () => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      await expectCleanApiResponse(res, `GET ${path}`);
    }, STEP_LIMIT);
  }
});

test('every response of a simulator session holds no key or number', async ({ page }) => {
  const captured: Promise<string[]>[] = [];
  page.on('response', (res: Response) => {
    if (!res.url().startsWith(TEST_KEY_URL)) return;
    captured.push(
      (async () => {
        const where = new URL(res.url()).pathname;
        const found: string[] = [];
        const headers = await res.allHeaders();
        for (const label of leaksIn(headersText(headers))) found.push(`${where} headers: ${label}`);
        if (headers['set-cookie'] !== undefined) found.push(`${where} headers: Set-Cookie`);
        // Redirects and aborted requests have no body to read.
        const body = await res.body().catch(() => null);
        if (body !== null) {
          for (const label of leaksIn(body.toString('utf8'))) found.push(`${where} body: ${label}`);
        }
        return found;
      })(),
    );
  });

  await test.step('open / and switch to Keyboard_Input', async () => {
    await page.goto('/');
    await expect(phone(page)).toBeVisible();
    await phone(page).getByRole('button', { name: /^Input: Keypad/ }).click();
  }, STEP_LIMIT);

  for (const body of ['HELP', 'REMIND in 1 minute drink water', 'LIST', 'STOP', 'START']) {
    await test.step(`send ${body}`, async () => {
      await sendAndSettle(page, body, STEP_LIMIT.timeout);
    }, STEP_LIMIT);
  }

  await test.step('a QUESTION with the fake key gets the Try_Later_Text', async () => {
    await sendAndSettle(page, 'How can I keep tomatoes fresh longer?', AI_STEP_LIMIT.timeout);
    await expect(partBubbles(page).last().locator('.bubble__text')).toHaveText(FIXED_TEXTS.en.tryLater);
  }, AI_STEP_LIMIT);

  await test.step('open /crypt', async () => {
    await page.goto('/crypt');
    await expect(page.getByText('Demo data', { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
  }, STEP_LIMIT);

  await test.step('no captured response leaks the key or the number', async () => {
    const leaks = (await Promise.all(captured)).flat();
    expect(captured.length).toBeGreaterThan(0);
    expect(leaks).toEqual([]);
  }, STEP_LIMIT);
});

test('the Simulator_Route masks and redacts text the visitor sends', async ({ request }) => {
  const now = Date.now();
  const dayKey = new Date(now + 300 * 60_000).toISOString().slice(0, 10);
  const snapshot = {
    stopped: false,
    receiveTimes: [],
    slowDownAt: null,
    counters: { dayKey, received: 0, repliesSent: 0, replied: 0, partsSent: 0, ignored: 0, handed: 0 },
    reminders: [],
  };

  await test.step('REMIND with the key and the number comes back clean', async () => {
    const body = `REMIND in 1 minute call ${SIMULATOR_NUMBER} key ${CRYPT_TEST_KEY}`.slice(0, 480);
    const res = await request.post('/api/ouija', { data: { type: 'message', body, snapshot } });
    expect(res.status()).toBe(200);
    await expectCleanApiResponse(res, 'REMIND response');
  }, STEP_LIMIT);

  await test.step('error responses come back clean', async () => {
    const bad = await request.post('/api/ouija', {
      data: { type: 'message', body: `${SIMULATOR_NUMBER} ${CRYPT_TEST_KEY}`, snapshot: { stopped: 'no' } },
    });
    expect(bad.status()).toBe(400);
    await expectCleanApiResponse(bad, '400 response');

    const notAllowed = await request.get('/api/ouija');
    expect(notAllowed.status()).toBe(405);
    await expectCleanApiResponse(notAllowed, '405 response');
  }, STEP_LIMIT);
});
