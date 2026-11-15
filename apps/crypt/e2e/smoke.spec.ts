// Smoke_Test (Requirements 1.10, 2.1, 15.7, 18.7, 18.8, 18.9, 18.12, 18.13).
// Runs against the production build on port 3100, started with no Gemini key,
// so no AI call can happen: QUESTION and SCAM get the Try_Later_Text.
// Every check is a named `test.step` with a 10-second limit, so a failure
// names the check and the run exits non-zero (18.13).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXED_TEXTS, GATEWAY_TEXTS } from '@lazarus/brain';
import { NO_KEY_URL } from '../playwright.config';

const STEP_LIMIT = { timeout: 10_000 } as const;
const STOP_BANNER = 'STOP is on. Send START to get replies again.';
const NEW_SESSION_NOTE = 'New session started.';
/** 7 or more digits, counting digits separated only by spaces or hyphens as one run. */
const SEVEN_DIGIT_RUN = /\d(?:[\s-]*\d){6}/;

test.use({ baseURL: NO_KEY_URL });

function phone(page: Page): Locator {
  return page.getByRole('region', { name: 'Phone' });
}

function keypadKey(page: Page, key: string): Locator {
  const keypad = page.getByRole('group', { name: 'Keypad' });
  const name = key === '*' ? 'star, change case' : key === '#' ? 'hash, change letters or numbers' : new RegExp(`^${key},`);
  return keypad.getByRole('button', { name, exact: typeof name === 'string' });
}

/** Presses keys in order; repeated keys run fast, well inside the 1,000 ms Multi_Tap_Timeout. */
async function pressKeys(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await keypadKey(page, key).click();
}

/** The visible Replies_Left_Indicator (the Announcer repeats its text off-screen). */
function repliesLeft(page: Page): Locator {
  return phone(page).locator('.replies-left__count');
}

function sendButton(page: Page): Locator {
  return phone(page).getByRole('button', { name: 'Send', exact: true });
}

function partBubbles(page: Page): Locator {
  return phone(page).locator('[data-bubble-kind="part"]');
}

async function sendByKeyboard(page: Page, body: string): Promise<void> {
  await phone(page).getByRole('button', { name: /^Input: Keypad/ }).click();
  const field = phone(page).getByRole('textbox', { name: 'Message' });
  await field.fill(body);
  await field.press('Enter');
}

test('Ouija_Simulator smoke on the no-key server', async ({ page }) => {
  await test.step('open / and see the Phone_Mock', async () => {
    await page.goto('/');
    await expect(phone(page)).toBeVisible();
    await expect(repliesLeft(page)).toHaveText('Replies left: 5 of 5');
  }, STEP_LIMIT);

  await test.step('T9 HELP gets the English Help_Text with a GSM-7 badge', async () => {
    await pressKeys(page, ['*', '4', '4', '3', '3', '5', '5', '5', '7']);
    await expect(phone(page).getByRole('textbox', { name: 'Message' })).toHaveText('HELP');
    await sendButton(page).click();
    const first = partBubbles(page).first();
    await expect(first.locator('.bubble__text')).toHaveText(GATEWAY_TEXTS.en.help);
    await expect(first.locator('.bubble__label')).toHaveText('English');
    await expect(first.locator('.bubble__badge')).toContainText('GSM-7');
    await expect(first.locator('.bubble__badge')).toContainText('Part 1 of 1');
    await expect(repliesLeft(page)).toHaveText('Replies left: 4 of 5');
  }, STEP_LIMIT);

  await test.step('a QUESTION gets the English Try_Later_Text with no key', async () => {
    await page.getByRole('button', { name: 'How can I keep tomatoes fresh longer?' }).click();
    await expect(sendButton(page)).toBeEnabled();
    await sendButton(page).click();
    await expect(partBubbles(page).nth(1).locator('.bubble__text')).toHaveText(FIXED_TEXTS.en.tryLater);
  }, STEP_LIMIT);
});

test('Urdu by keyboard gets an Urdu reply with a UCS-2 badge', async ({ page }) => {
  await page.goto('/');
  await test.step('send مدد by keyboard and see the Urdu label and UCS-2 badge', async () => {
    await sendByKeyboard(page, 'مدد');
    const first = partBubbles(page).first();
    await expect(first.locator('.bubble__label')).toHaveText('Urdu');
    await expect(first.locator('.bubble__badge')).toContainText('UCS-2');
    await expect(first.locator('.bubble__text')).toHaveAttribute('lang', 'ur');
  }, STEP_LIMIT);
});

test('STOP banner, then New session clears it', async ({ page }) => {
  await page.goto('/');
  await test.step('STOP shows the STOP banner', async () => {
    await sendByKeyboard(page, 'STOP');
    await expect(page.getByText(STOP_BANNER)).toBeVisible();
  }, STEP_LIMIT);

  await test.step('New session removes the banner and resets the counts', async () => {
    await phone(page).getByRole('button', { name: 'New session', exact: true }).click();
    await expect(page.getByText(STOP_BANNER)).toHaveCount(0);
    const thread = phone(page).getByRole('list', { name: 'Messages' });
    await expect(thread.getByRole('listitem')).toHaveCount(1);
    await expect(thread).toHaveText(NEW_SESSION_NOTE);
    await expect(repliesLeft(page)).toHaveText('Replies left: 5 of 5');
  }, STEP_LIMIT);
});

test('Crypt_Dashboard is read-only demo data with no number', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/')) apiRequests.push(req.url());
  });

  await test.step('/crypt shows Demo data and no 7-digit run', async () => {
    await page.goto('/crypt');
    await expect(page.getByText('Demo data', { exact: true })).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(SEVEN_DIGIT_RUN);
  }, STEP_LIMIT);

  await test.step('/crypt makes no /api/ request', async () => {
    await page.waitForLoadState('networkidle');
    expect(apiRequests).toEqual([]);
  }, STEP_LIMIT);
});

test('pages answer 200 with no cookie', async ({ request }) => {
  for (const path of ['/', '/crypt']) {
    await test.step(`GET ${path} is 200 with no Set-Cookie`, async () => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
      expect(res.headers()['set-cookie']).toBeUndefined();
    }, STEP_LIMIT);
  }
});

test('no horizontal scroll from 320 to 1920 px', async ({ page }) => {
  for (const width of [320, 768, 1920]) {
    await test.step(`no horizontal scroll at ${String(width)} px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(sendButton(page)).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }, STEP_LIMIT);
  }
});
