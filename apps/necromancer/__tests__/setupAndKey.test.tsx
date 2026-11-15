/**
 * Start screen, Setup_Screen and AI key UI (Requirements 12.6, 12.13, 16.4, 16.5,
 * 16.7 to 16.9, 16.11, 16.19, 16.20, 18.12).
 *
 * @format
 */
import React from 'react';
import ReactTestRenderer, { type ReactTestRenderer as Renderer } from 'react-test-renderer';
import { Alert, Text, TextInput, type AlertButton } from 'react-native';
import { API_KEY_INVALID_MESSAGE, maskApiKey, type DeviceStatus } from '@lazarus/brain';
import App from '../App';
import { createAiHolder, type AiHolder } from '../src/gateway/ai';
import { createGatewayStore, type GatewayStore } from '../src/gateway/store';
import type { KeyStatus } from '../src/native/ports';
import type { PermissionsAdapter } from '../src/ui/permissions';
import { BANNER_TEXT } from '../src/ui/screens/MainScreen';
import {
  KEY_SAVED_TEXT,
  KEY_UNREADABLE_TEXT,
  OPEN_MAIN_LABEL,
  REMOVE_KEY_TITLE,
  SETUP_STEP_TITLES,
  SetupScreen,
} from '../src/ui/screens/SetupScreen';
import {
  SETUP_STEPS,
  chooseStartScreen,
  type SetupStepId,
  type SetupStepMarks,
  type StartPermissions,
} from '../src/ui/startScreen';
import { HEALTHY_DEVICE, MOCK_KEY, createMockPorts, type MockPorts } from './support/mockPorts';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const SETUP_TITLE = 'Set up this phone';
const MAIN_TITLE = 'Necromancer';
const KEY_INPUT_LABEL = 'Gemini API key';
// Valid for the Api_Key_Validator but not shaped like a real Gemini key (source guard).
const NEW_KEY = 'TestNewKey_abcdefghijklmnopqrstuvwxyz-WXYZ';

let mounted: Renderer[] = [];
afterEach(async () => {
  for (const r of mounted) {
    await ReactTestRenderer.act(async () => {
      r.unmount();
    });
  }
  mounted = [];
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------- helpers

/** A key store that remembers saves and deletes, like the Api_Key_Store. */
function withKeyStore(mock: MockPorts, initial: KeyStatus): { current: () => KeyStatus } {
  let stored = initial;
  mock.scripts.readKey.setDefault(() => stored);
  mock.scripts.saveKey.setDefault((key: string) => {
    stored = { status: 'present', key };
  });
  mock.scripts.deleteKey.setDefault(() => {
    stored = { status: 'absent' };
  });
  return { current: () => stored };
}

async function mount(node: React.JSX.Element): Promise<Renderer> {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(node);
  });
  if (r === undefined) throw new Error('render failed');
  mounted.push(r);
  return r;
}

async function renderSetup(mock: MockPorts, ai: AiHolder = createAiHolder(mock.ports.keyStore, () => 0)): Promise<Renderer> {
  const r = await mount(
    <SetupScreen ports={mock.ports} ai={ai} onOpenPermissions={() => undefined} onDone={() => undefined} />,
  );
  await settle();
  return r;
}

function grantedPermissions(): PermissionsAdapter {
  return {
    required: () => ['receiveSms', 'sendSms', 'postNotifications'],
    check: () => Promise.resolve(true),
    request: () => Promise.resolve({}),
  };
}

async function renderApp(mock: MockPorts, store: GatewayStore = createGatewayStore()): Promise<Renderer> {
  return mount(
    <App
      ports={mock.ports}
      ai={createAiHolder(mock.ports.keyStore, () => 0)}
      store={store}
      permissions={grantedPermissions()}
    />,
  );
}

function texts(r: Renderer): string[] {
  return r.root.findAllByType(Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
}

async function settle(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await ReactTestRenderer.act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function waitFor(cond: () => boolean, turns = 200): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (cond()) return;
    await settle(1);
  }
  throw new Error('waitFor: condition not met');
}

function buttons(r: Renderer, match: (label: string) => boolean): ReactTestRenderer.ReactTestInstance[] {
  return r.root.findAll(
    (n) => typeof n.props.accessibilityLabel === 'string' && match(n.props.accessibilityLabel) && typeof n.props.onPress === 'function',
  );
}

async function press(r: Renderer, match: string | ((label: string) => boolean)): Promise<void> {
  const test = typeof match === 'string' ? (l: string) => l === match : match;
  const found = buttons(r, test);
  if (found.length === 0) throw new Error('button not found');
  await ReactTestRenderer.act(async () => {
    found[0].props.onPress();
  });
  await settle();
}

function stepLabel(r: Renderer, id: SetupStepId): string {
  const index = SETUP_STEPS.indexOf(id);
  const prefix = `Step ${index + 1}: ${SETUP_STEP_TITLES[id]}, `;
  const found = buttons(r, (l) => l.startsWith(prefix));
  if (found.length !== 1) throw new Error(`step ${id} not found`);
  return found[0].props.accessibilityLabel;
}

function stepDone(r: Renderer, id: SetupStepId): boolean {
  return stepLabel(r, id).endsWith(', done');
}

function keyInput(r: Renderer): ReactTestRenderer.ReactTestInstance {
  return r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === KEY_INPUT_LABEL);
}

async function typeKey(r: Renderer, value: string): Promise<void> {
  await ReactTestRenderer.act(async () => {
    keyInput(r).props.onChangeText(value);
  });
}

async function openKeyStep(r: Renderer): Promise<void> {
  await press(r, (l) => l.startsWith(`Step ${SETUP_STEPS.indexOf('ai-key') + 1}: `));
}

/** Captures the remove-key dialog instead of showing a system dialog. */
function captureAlerts(): { title: string; buttons: readonly AlertButton[] }[] {
  const seen: { title: string; buttons: readonly AlertButton[] }[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, _message, btns) => {
    seen.push({ title: title ?? '', buttons: btns ?? [] });
  });
  return seen;
}

async function tapAlert(button: AlertButton | undefined): Promise<void> {
  if (button === undefined) throw new Error('dialog button missing');
  await ReactTestRenderer.act(async () => {
    button.onPress?.();
  });
  await settle();
}

// ---------------------------------------------------------------- chooseStartScreen

describe('chooseStartScreen (12.13)', () => {
  const PERMS = ['receiveSms', 'sendSms', 'postNotifications'] as const;

  it('follows Permission_Screen, then Setup_Screen, then Main_Screen for every combination', () => {
    for (let p = 0; p < 1 << PERMS.length; p++) {
      const perms = Object.fromEntries(PERMS.map((k, i) => [k, (p & (1 << i)) !== 0])) as unknown as StartPermissions;
      const allGranted = PERMS.every((k) => perms[k]);
      for (let s = 0; s < 1 << SETUP_STEPS.length; s++) {
        const steps = Object.fromEntries(SETUP_STEPS.map((id, i) => [id, (s & (1 << i)) !== 0])) as unknown as SetupStepMarks;
        const allDone = SETUP_STEPS.every((id) => steps[id]);
        const expected = !allGranted ? 'permission' : !allDone ? 'setup' : 'main';
        expect(chooseStartScreen(perms, steps)).toBe(expected);
      }
    }
  });
});

// ---------------------------------------------------------------- done marks

describe('Setup_Screen done marks (12.6)', () => {
  it('marks all 6 steps done from a healthy status, a readable key and both manual marks', async () => {
    const mock = createMockPorts();
    mock.scripts.getSetupMarks.setDefault(() => ({ autostart: true, recents: true }));
    const r = await renderSetup(mock);
    for (const id of SETUP_STEPS) expect(stepDone(r, id)).toBe(true);
    expect(buttons(r, (l) => l === OPEN_MAIN_LABEL)).toHaveLength(1);
  });

  it('marks each step from its own source when things are missing', async () => {
    const mock = createMockPorts();
    const status: DeviceStatus = { ...HEALTHY_DEVICE, notificationPermission: false, batteryOptimisationIgnored: false };
    mock.scripts.getDeviceStatus.setDefault(() => status);
    mock.scripts.getSetupMarks.setDefault(() => ({ autostart: false, recents: true }));
    withKeyStore(mock, { status: 'absent' });
    const r = await renderSetup(mock);
    const marks = Object.fromEntries(SETUP_STEPS.map((id) => [id, stepDone(r, id)]));
    expect(marks).toEqual({
      'restricted-settings': true,
      permissions: false,
      'ai-key': false,
      autostart: false,
      battery: false,
      recents: true,
    });
    expect(buttons(r, (l) => l === OPEN_MAIN_LABEL)).toHaveLength(0);
  });

  it('marks the SMS-based steps not done when SMS permission is revoked', async () => {
    const mock = createMockPorts();
    mock.scripts.getSetupMarks.setDefault(() => ({ autostart: true, recents: true }));
    const r = await renderSetup(mock);
    expect(stepDone(r, 'restricted-settings')).toBe(true);
    await ReactTestRenderer.act(async () => {
      mock.emitDeviceStatus({ ...HEALTHY_DEVICE, smsPermission: false });
    });
    expect(stepDone(r, 'restricted-settings')).toBe(false);
    expect(stepDone(r, 'permissions')).toBe(false);
    expect(buttons(r, (l) => l === OPEN_MAIN_LABEL)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- key save

describe('Setup_Screen AI key save (16.4, 16.5, 16.11)', () => {
  it('clears the Key_Input_Field after a save and shows "key saved" with the Masked_Key only', async () => {
    const mock = createMockPorts();
    const keys = withKeyStore(mock, { status: 'absent' });
    const r = await renderSetup(mock);
    await openKeyStep(r);
    expect(texts(r)).not.toContain(KEY_SAVED_TEXT);

    await typeKey(r, `  ${NEW_KEY}  `);
    await press(r, 'Save key');

    expect(mock.callsTo('saveKey').map((c) => c.args)).toEqual([[NEW_KEY]]);
    expect(keys.current()).toEqual({ status: 'present', key: NEW_KEY });
    expect(keyInput(r).props.value).toBe('');
    expect(texts(r)).toContain(KEY_SAVED_TEXT);
    expect(texts(r)).toContain(maskApiKey(NEW_KEY));
    expect(texts(r).some((t) => t.includes(NEW_KEY.slice(0, 8)))).toBe(false);
    expect(stepDone(r, 'ai-key')).toBe(true);
  });

  it.each(['', '   ', 'short', 'has a space in the middle of the key 123456'])(
    'shows the fixed invalid-key message with no save call for %j',
    async (value) => {
      const mock = createMockPorts();
      withKeyStore(mock, { status: 'absent' });
      const r = await renderSetup(mock);
      await openKeyStep(r);
      await typeKey(r, value);
      await press(r, 'Save key');
      expect(mock.callsTo('saveKey')).toEqual([]);
      expect(texts(r)).toContain(API_KEY_INVALID_MESSAGE);
      expect(stepDone(r, 'ai-key')).toBe(false);
    },
  );
});

// ---------------------------------------------------------------- key remove

describe('Setup_Screen remove key (16.7 to 16.9)', () => {
  async function renderWithKey(): Promise<{ r: Renderer; mock: MockPorts; keys: { current: () => KeyStatus } }> {
    const mock = createMockPorts();
    const keys = withKeyStore(mock, { status: 'present', key: MOCK_KEY });
    const r = await renderSetup(mock);
    await openKeyStep(r);
    expect(texts(r)).toContain(KEY_SAVED_TEXT);
    expect(texts(r)).toContain(maskApiKey(MOCK_KEY));
    return { r, mock, keys };
  }

  it('shows a confirmation dialog with confirm and cancel actions', async () => {
    const alerts = captureAlerts();
    const { r, mock } = await renderWithKey();
    await press(r, 'Remove key');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe(REMOVE_KEY_TITLE);
    expect(alerts[0].buttons.map((b) => b.style)).toEqual(['cancel', 'destructive']);
    expect(mock.callsTo('deleteKey')).toEqual([]);
  });

  it('deletes the key on confirm and marks the AI key step not done', async () => {
    const alerts = captureAlerts();
    const { r, mock, keys } = await renderWithKey();
    await press(r, 'Remove key');
    await tapAlert(alerts[0].buttons.find((b) => b.style === 'destructive'));
    expect(mock.callsTo('deleteKey')).toHaveLength(1);
    expect(keys.current()).toEqual({ status: 'absent' });
    expect(texts(r)).not.toContain(KEY_SAVED_TEXT);
    expect(stepDone(r, 'ai-key')).toBe(false);
  });

  it('leaves the key unchanged on cancel', async () => {
    const alerts = captureAlerts();
    const { r, mock, keys } = await renderWithKey();
    await press(r, 'Remove key');
    await tapAlert(alerts[0].buttons.find((b) => b.style === 'cancel'));
    expect(mock.callsTo('deleteKey')).toEqual([]);
    expect(keys.current()).toEqual({ status: 'present', key: MOCK_KEY });
    expect(texts(r)).toContain(KEY_SAVED_TEXT);
    expect(stepDone(r, 'ai-key')).toBe(true);
  });
});

// ---------------------------------------------------------------- missing / unreadable key

describe('missing or unreadable key (16.19, 16.20)', () => {
  it('shows the missing-key banner on the Main_Screen and opens the AI key step', async () => {
    const mock = createMockPorts();
    mock.scripts.getSetupMarks.setDefault(() => ({ autostart: true, recents: true }));
    const store = createGatewayStore();
    store.setBanner('ai-key-missing', true);
    const r = await renderApp(mock, store);
    await waitFor(() => texts(r).includes(MAIN_TITLE));
    expect(texts(r)).toContain(BANNER_TEXT['ai-key-missing']);
    await press(r, 'Add AI key');
    await waitFor(() => texts(r).includes(SETUP_TITLE));
    expect(() => keyInput(r)).not.toThrow();
  });

  it('renders the Setup_Screen with the paste-again message when readKey is unreadable', async () => {
    const mock = createMockPorts();
    mock.scripts.getSetupMarks.setDefault(() => ({ autostart: true, recents: true }));
    withKeyStore(mock, { status: 'unreadable' });
    const r = await renderSetup(mock);
    expect(texts(r)).toContain(KEY_UNREADABLE_TEXT);
    expect(stepDone(r, 'ai-key')).toBe(false);
    expect(texts(r)).not.toContain(KEY_SAVED_TEXT);
  });

  it('starts the app on the Setup_Screen without crashing when readKey is unreadable', async () => {
    const mock = createMockPorts();
    mock.scripts.getSetupMarks.setDefault(() => ({ autostart: true, recents: true }));
    withKeyStore(mock, { status: 'unreadable' });
    const r = await renderApp(mock);
    await waitFor(() => texts(r).includes(SETUP_TITLE));
    expect(texts(r)).toContain(KEY_UNREADABLE_TEXT);
  });
});
