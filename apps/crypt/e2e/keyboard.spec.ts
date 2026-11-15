// Physical keyboard typing in the Message box (Requirement 5; live bug fix).
// Focusing the Message box always switches to Keyboard_Input, so typing works
// even when the page starts in Keypad_Input. The T9 keypad still works by click.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { GATEWAY_TEXTS } from '@lazarus/brain';
import { NO_KEY_URL } from '../playwright.config';

const STEP_LIMIT = { timeout: 10_000 } as const;

test.use({ baseURL: NO_KEY_URL });

function phone(page: Page): Locator {
  return page.getByRole('region', { name: 'Phone' });
}

function messageBox(page: Page): Locator {
  return phone(page).getByRole('textbox', { name: 'Message' });
}

function modeButton(page: Page, mode: 'Keypad' | 'Keyboard'): Locator {
  return phone(page).getByRole('button', { name: new RegExp(`^Input: ${mode}`) });
}

function keypadKey(page: Page, name: string): Locator {
  return page.getByRole('group', { name: 'Keypad' }).getByRole('button', { name, exact: true });
}

test('clicking the Message box in Keypad mode lets the real keyboard type and send', async ({ page }) => {
  await page.goto('/');

  await test.step('starts in Keypad mode', async () => {
    await expect(modeButton(page, 'Keypad')).toBeVisible();
  }, STEP_LIMIT);

  await test.step('click the box and type HELP', async () => {
    await messageBox(page).click();
    await page.keyboard.type('HELP');
    await expect(messageBox(page)).toHaveValue('HELP');
    await expect(messageBox(page)).toBeFocused();
    await expect(modeButton(page, 'Keyboard')).toBeVisible();
    await expect(phone(page).locator('.compose__counter')).toHaveText('4/480');
  }, STEP_LIMIT);

  await test.step('Enter sends it and the Help_Text comes back', async () => {
    await page.keyboard.press('Enter');
    await expect(messageBox(page)).toHaveValue('');
    const first = phone(page).locator('[data-bubble-kind="part"]').first();
    await expect(first.locator('.bubble__text')).toHaveText(GATEWAY_TEXTS.en.help);
  }, STEP_LIMIT);
});

test('Tab into the Message box also allows typing', async ({ page }) => {
  await page.goto('/');
  await test.step('focus by keyboard and type', async () => {
    await phone(page).getByRole('list', { name: 'Messages' }).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.type('hi there');
    await expect(messageBox(page)).toHaveValue('hi there');
    await expect(messageBox(page)).toBeFocused();
  }, STEP_LIMIT);
});

test('the T9 keypad still works by click, before and after keyboard typing', async ({ page }) => {
  await page.goto('/');

  await test.step('T9 press, then clicking the box keeps the Pending_Character', async () => {
    await keypadKey(page, '4, g h i').click();
    await keypadKey(page, '4, g h i').click();
    await expect(messageBox(page)).toHaveText('h');
    await messageBox(page).click();
    // The Pending_Character is committed, and typing continues after it.
    await page.keyboard.type('i');
    await expect(messageBox(page)).toHaveValue('hi');
  }, STEP_LIMIT);

  await test.step('a keypad click switches back to Keypad mode and appends', async () => {
    await keypadKey(page, '0, space').click();
    await expect(modeButton(page, 'Keypad')).toBeVisible();
    await keypadKey(page, '2, a b c').click();
    await expect(messageBox(page)).toHaveText('hi a');
    await expect(phone(page).locator('.compose__pending')).toHaveText('a');
  }, STEP_LIMIT);

  await test.step('clicking the box again goes back to typing', async () => {
    await messageBox(page).click();
    await page.keyboard.type('!');
    await expect(messageBox(page)).toHaveValue('hi a!');
  }, STEP_LIMIT);
});
