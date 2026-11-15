// Accessibility checks (Requirements 14.8, 14.9, 16.1, 16.2, 16.5, 16.6, 16.8).
// Runs in a real browser against the production build on port 3100 (no Gemini
// key), because jsdom computes no layout or colors and axe skips the contrast
// rule there (design C10). Every check is a named `test.step` with a 10-second
// limit, like the Smoke_Test.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { EXAMPLE_MESSAGES } from '../src/ui/examples';
import { KEYPAD_KEYS, keyAccessibleName } from '../src/ui/keypadInput';
import { NO_KEY_URL } from '../playwright.config';

const STEP_LIMIT = { timeout: 10_000 } as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const STOP_BANNER = 'STOP is on. Send START to get replies again.';
const NO_REPLIES_HINT = 'No replies left in this session. Press New session to keep testing.';

test.use({ baseURL: NO_KEY_URL });

function phone(page: Page): Locator {
  return page.getByRole('region', { name: 'Phone' });
}

function repliesLeft(page: Page): Locator {
  return phone(page).locator('.replies-left__count');
}

function sendButton(page: Page): Locator {
  return phone(page).getByRole('button', { name: 'Send', exact: true });
}

/** Fills the Compose_Field from an example message (sends nothing, 2.3). */
async function chooseExample(page: Page, text: string): Promise<void> {
  await page.getByRole('region', { name: 'Try an example' }).getByRole('button', { name: text, exact: true }).click();
}

/** Sends an example message and waits until every part is shown and SENDING has ended. */
async function sendExample(page: Page, text: string, idleState: 'ALIVE' | 'SLEEPING' = 'ALIVE'): Promise<void> {
  await chooseExample(page, text);
  await sendButton(page).click();
  await expect(phone(page)).toHaveAttribute('data-state', idleState);
}

/** Fails on any violation of a rule tagged WCAG 2.1 level A or AA (16.8). */
async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    targets: v.nodes.map((n) => n.target.join(' ')),
  }));
  expect(summary).toEqual([]);
}

test('axe finds no WCAG 2.1 A or AA violation in each Ouija_Simulator state', async ({ page }) => {
  await page.goto('/');

  await test.step('initial state', async () => {
    await expect(repliesLeft(page)).toHaveText('Replies left: 5 of 5');
    await expectNoAxeViolations(page);
  }, STEP_LIMIT);

  await test.step('after one Simulated_Reply', async () => {
    await sendExample(page, 'HELP');
    await expect(phone(page).locator('[data-bubble-kind="part"]')).toHaveCount(1);
    await expectNoAxeViolations(page);
  }, STEP_LIMIT);

  await test.step('while STOP is on', async () => {
    await sendExample(page, 'STOP', 'SLEEPING');
    await expect(page.getByText(STOP_BANNER)).toBeVisible();
    await expectNoAxeViolations(page);
  }, STEP_LIMIT);

  await test.step('after New session', async () => {
    await phone(page).getByRole('button', { name: 'New session', exact: true }).click();
    await expect(page.getByText(STOP_BANNER)).toHaveCount(0);
    await expect(repliesLeft(page)).toHaveText('Replies left: 5 of 5');
    await expectNoAxeViolations(page);
  }, STEP_LIMIT);
});

test('axe finds no violation while Replies_Left is 0 with the hint', async ({ page }) => {
  await page.goto('/');
  for (let left = 4; left >= 0; left -= 1) {
    await test.step(`HELP leaves ${String(left)} replies`, async () => {
      await sendExample(page, 'HELP');
      await expect(repliesLeft(page)).toHaveText(`Replies left: ${String(left)} of 5`);
    }, STEP_LIMIT);
  }
  await test.step('Replies_Left 0 with the New session hint', async () => {
    await expect(phone(page).locator('.replies-left__hint')).toHaveText(NO_REPLIES_HINT);
    await expectNoAxeViolations(page);
  }, STEP_LIMIT);
});

test('axe finds no violation on the Crypt_Dashboard', async ({ page }) => {
  await test.step('/crypt', async () => {
    await page.goto('/crypt');
    await expect(page.getByText('Demo data', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
  }, STEP_LIMIT);
});

/** Accessible-name-like label of the focused element, plus its outline. */
async function focusedInfo(page: Page): Promise<{ label: string; outlineWidth: number; outlineStyle: string }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return { label: '', outlineWidth: 0, outlineStyle: 'none' };
    const style = getComputedStyle(el);
    return {
      label: el.getAttribute('aria-label') ?? el.textContent.trim(),
      outlineWidth: parseFloat(style.outlineWidth),
      outlineStyle: style.outlineStyle,
    };
  });
}

test('Tab order follows Requirement 16.1 with a visible focus outline', async ({ page }) => {
  // Order of 16.1, plus the focusable Phone_Screen thread (`Messages`) before
  // the Compose_Field: it has tabIndex 0 so keyboard users can scroll a long
  // thread (axe rule scrollable-region-focusable, decision of task 15.5).
  const expected = [
    'Ouija simulator',
    'The Crypt',
    'Messages',
    'Message',
    'Input: Keypad',
    ...KEYPAD_KEYS.map(keyAccessibleName),
    'Clear',
    'Send',
    'New session',
    ...EXAMPLE_MESSAGES,
  ];

  await page.goto('/');
  // A Message_Body in the Compose_Field enables the Send_Key, so it is a tab stop.
  await chooseExample(page, 'HELP');
  await expect(sendButton(page)).toBeEnabled();

  await test.step('Tab walks every control in order', async () => {
    await page.getByRole('link', { name: 'Ouija simulator' }).focus();
    const seen: string[] = [(await focusedInfo(page)).label];
    for (let i = 1; i < expected.length; i += 1) {
      await page.keyboard.press('Tab');
      const info = await focusedInfo(page);
      seen.push(info.label);
      expect(info.outlineStyle, `outline style on ${info.label}`).not.toBe('none');
      expect(info.outlineWidth, `outline width on ${info.label}`).toBeGreaterThanOrEqual(2);
    }
    expect(seen).toEqual(expected);
  }, STEP_LIMIT);

  await test.step('Shift+Tab walks back in reverse order', async () => {
    const seen: string[] = [];
    for (let i = expected.length - 2; i >= 0; i -= 1) {
      await page.keyboard.press('Shift+Tab');
      const info = await focusedInfo(page);
      seen.push(info.label);
      expect(info.outlineWidth, `outline width on ${info.label}`).toBeGreaterThanOrEqual(2);
    }
    expect(seen).toEqual(expected.slice(0, -1).reverse());
  }, STEP_LIMIT);

  await test.step('Enter and Space activate a focused control', async () => {
    await phone(page).getByRole('button', { name: 'Clear', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(phone(page).locator('.compose__counter')).toHaveText('3/480');
    await page.keyboard.press('Space');
    await expect(phone(page).locator('.compose__counter')).toHaveText('2/480');
  }, STEP_LIMIT);
});

test('text is at least 16 px and every graphic or control is labelled', async ({ page }) => {
  for (const path of ['/', '/crypt']) {
    await test.step(`${path}: font sizes and labels`, async () => {
      await page.goto(path);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
          const hasText = Array.from(el.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
          );
          if (hasText && parseFloat(getComputedStyle(el).fontSize) < 16) {
            out.push(`small text: ${el.tagName} ${el.textContent.trim().slice(0, 40)}`);
          }
        }
        for (const svg of Array.from(document.querySelectorAll('svg'))) {
          const hidden = svg.closest('[aria-hidden="true"]') !== null;
          if (!hidden && !svg.getAttribute('aria-label')) out.push('unlabelled svg');
        }
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'))) {
          const name = el.getAttribute('aria-label') ?? el.innerText.trim();
          if (name === '') out.push(`unnamed control: ${el.outerHTML.slice(0, 60)}`);
        }
        return out;
      });
      expect(problems).toEqual([]);
    }, STEP_LIMIT);
  }
});

/** Longest computed animation or transition duration on the page, in ms, with the culprit. */
async function longestMotion(page: Page): Promise<{ ms: number; where: string }> {
  return page.evaluate(() => {
    const toMs = (value: string): number =>
      Math.max(
        0,
        ...value.split(',').map((v) => {
          const t = v.trim();
          return t.endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000;
        }),
      );
    let best = { ms: 0, where: '' };
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const style = getComputedStyle(el);
      const animated = style.animationName !== 'none' ? toMs(style.animationDuration) : 0;
      const ms = Math.max(animated, toMs(style.transitionDuration));
      if (ms > best.ms) best = { ms, where: `${el.tagName}.${el.getAttribute('class') ?? ''}` };
    }
    return best;
  });
}

/** Holds every Simulator_Request until `release` is called, so SENDING lasts. */
async function holdRequests(page: Page): Promise<() => void> {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/ouija', async (route) => {
    await gate;
    await route.continue();
  });
  return () => {
    release();
  };
}

test('the ember glow and pulse animate by default', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const release = await holdRequests(page);
  await test.step('SENDING has an animated ember glow', async () => {
    await chooseExample(page, 'HELP');
    await sendButton(page).click();
    await expect(phone(page)).toHaveAttribute('data-state', 'SENDING');
    await expect(phone(page)).toHaveCSS('animation-name', 'ember-glow');
  }, STEP_LIMIT);
  release();
  await test.step('an added part pulses the heartbeat line', async () => {
    await expect(page.locator('.heartbeat__line--pulse')).toHaveCSS('animation-name', 'heartbeat-pulse');
  }, STEP_LIMIT);
});

test('reduced motion stops every animation and keeps the state labels', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await test.step('ALIVE: label shown, nothing moves', async () => {
    await expect(phone(page).locator('.heartbeat__label')).toHaveText('Alive');
    expect(await longestMotion(page)).toEqual({ ms: 0, where: '' });
  }, STEP_LIMIT);

  const release = await holdRequests(page);
  await test.step('SENDING: label shown, no glow animation', async () => {
    await chooseExample(page, 'HELP');
    await sendButton(page).click();
    await expect(phone(page)).toHaveAttribute('data-state', 'SENDING');
    await expect(phone(page).locator('.heartbeat__label')).toHaveText('Sending…');
    expect(await longestMotion(page)).toEqual({ ms: 0, where: '' });
  }, STEP_LIMIT);
  release();

  await test.step('after a part: no pulse, ALIVE label back', async () => {
    await expect(phone(page).locator('[data-bubble-kind="part"]')).toHaveCount(1);
    expect(await longestMotion(page)).toEqual({ ms: 0, where: '' });
    await expect(phone(page)).toHaveAttribute('data-state', 'ALIVE');
    await expect(phone(page).locator('.heartbeat__label')).toHaveText('Alive');
  }, STEP_LIMIT);
});
