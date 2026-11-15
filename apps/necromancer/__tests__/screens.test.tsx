// Permission_Screen, Main_Screen and Settings_Screen rendering tests
// (Requirements 11.2, 11.3, 11.4, 11.6, 11.7, 13.7, 13.9, 13.10, 14.5, 14.9,
// 14.11, 4.5, 4.10, 5.11).
import React from 'react';
import ReactTestRenderer, { type ReactTestInstance, type ReactTestRenderer as Renderer } from 'react-test-renderer';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Text,
  TextInput,
  type AlertButton,
  type EmitterSubscription,
} from 'react-native';
import {
  DEFAULT_SETTINGS,
  SLEEP_REASONS,
  decodeStoredState,
  maskNumber,
  serializeSettings,
  type ActivityEntry,
  type CanonicalNumber,
  type DeviceStatus,
  type ServiceStatus,
  type SleepReason,
} from '@lazarus/brain';
import { createGatewayStore, type GatewayStore } from '../src/gateway/store';
import { createSettingsSync } from '../src/gateway/settingsSync';
import {
  PERMISSION_IDS,
  type PermissionId,
  type PermissionsAdapter,
  type RequestResult,
} from '../src/ui/permissions';
import {
  MAX_EXPLANATION_LENGTH,
  NEVER_ASK_AGAIN_TEXT,
  PERMISSION_EXPLANATIONS,
  PERMISSION_NAMES,
  PRIVACY_STATEMENT,
  PermissionScreen,
  RESTRICTED_STEPS,
} from '../src/ui/screens/PermissionScreen';
import {
  BANNER_TEXT,
  MAX_SLEEP_SENTENCE_LENGTH,
  MainScreen,
  SLEEP_FIXES,
  SLEEP_SENTENCES,
  type SleepFixAction,
} from '../src/ui/screens/MainScreen';
import {
  ALLOWLIST_FULL_MESSAGE,
  ALLOWLIST_INPUT_LABEL,
  ALLOWLIST_INVALID_MESSAGE,
  FIELD_LABELS,
  SettingsScreen,
  rangeMessage,
} from '../src/ui/screens/SettingsScreen';
import { HEALTHY_DEVICE, MOCK_TODAY, createMockPorts, type MockPorts } from './support/mockPorts';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

// ---------------------------------------------------------------- helpers

let mounted: Renderer[] = [];

async function mount(element: React.JSX.Element): Promise<Renderer> {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(element);
  });
  if (r === undefined) throw new Error('render failed');
  mounted.push(r);
  return r;
}

function textOf(node: ReactTestInstance): string {
  return [node.props.children]
    .flat()
    .filter((c): c is string | number => typeof c === 'string' || typeof c === 'number')
    .join('');
}

function texts(r: Renderer): string[] {
  return r.root.findAllByType(Text).map(textOf);
}

/** Every visible string plus every accessibility label and input value. */
function everythingShown(r: Renderer): string {
  const labels = r.root
    .findAll((n) => typeof n.props.accessibilityLabel === 'string')
    .map((n) => String(n.props.accessibilityLabel));
  const values = r.root.findAllByType(TextInput).map((n) => String(n.props.value ?? ''));
  return [...texts(r), ...labels, ...values].join('\n');
}

function buttons(r: Renderer, label: string): ReactTestInstance[] {
  return r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
}

async function press(r: Renderer, label: string): Promise<void> {
  const found = buttons(r, label);
  if (found.length === 0) throw new Error(`no button "${label}"`);
  await ReactTestRenderer.act(async () => {
    found[0].props.onPress();
  });
}

async function type(r: Renderer, label: string, value: string): Promise<void> {
  const input = r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === label);
  await ReactTestRenderer.act(async () => {
    input.props.onChangeText(value);
  });
}

/** Every run of 4 consecutive digits taken from a phone number. */
function digitWindows(number: string): string[] {
  const digits = number.replace(/\D/g, '');
  const out: string[] = [];
  for (let i = 0; i + 4 <= digits.length; i++) out.push(digits.slice(i, i + 4));
  return out;
}

function expectNoDigitsOf(shown: string, number: string): void {
  for (const w of digitWindows(number)) expect(shown).not.toContain(w);
}

let loopSpy: jest.SpyInstance;

function setReducedMotion(on: boolean): void {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(on);
}

beforeEach(() => {
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove: () => undefined } as unknown as EmitterSubscription);
  setReducedMotion(true);
  loopSpy = jest.spyOn(Animated, 'loop');
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.forEach((r) => r.unmount());
  });
  mounted = [];
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------- Permission_Screen

type FakePermissions = {
  readonly adapter: PermissionsAdapter;
  readonly requests: PermissionId[][];
};

function fakePermissions(
  granted: Partial<Record<PermissionId, boolean>>,
  answers: Partial<Record<PermissionId, RequestResult>> = {},
): FakePermissions {
  const requests: PermissionId[][] = [];
  const adapter: PermissionsAdapter = {
    required: () => PERMISSION_IDS,
    check: async (id) => granted[id] === true,
    request: async (ids) => {
      requests.push([...ids]);
      const out: Partial<Record<PermissionId, RequestResult>> = {};
      for (const id of ids) out[id] = answers[id] ?? 'denied';
      return out;
    },
  };
  return { adapter, requests };
}

/** A clock that moves 1 s per read, so no answer looks like a Restricted_Settings block. */
function slowClock(): () => number {
  let t = 0;
  return () => {
    t += 1_000;
    return t;
  };
}

function renderPermissions(mock: MockPorts, fake: FakePermissions): Promise<Renderer> {
  return mount(
    <PermissionScreen ports={mock.ports} onDone={() => undefined} permissions={fake.adapter} now={slowClock()} />,
  );
}

describe('PermissionScreen', () => {
  it('shows one named explanation of at most 300 characters per permission', async () => {
    const r = await renderPermissions(createMockPorts(), fakePermissions({}));
    const shown = texts(r);
    for (const id of PERMISSION_IDS) {
      const explanation = PERMISSION_EXPLANATIONS[id];
      expect(explanation.length).toBeLessThanOrEqual(MAX_EXPLANATION_LENGTH);
      expect(explanation).toContain(PERMISSION_NAMES[id]);
      expect(shown).toContain(explanation);
    }
  });

  it('shows the privacy statement before the continue button', async () => {
    const r = await renderPermissions(createMockPorts(), fakePermissions({}));
    expect(PRIVACY_STATEMENT).toMatch(/not uploaded anywhere, except the question text sent to the AI service/);
    expect(PRIVACY_STATEMENT).toMatch(/not stored in the Activity log/);
    const all = r.root.findAll(() => true);
    const privacy = all.findIndex((n) => n.type === Text && textOf(n) === PRIVACY_STATEMENT);
    const button = all.findIndex((n) => n.props.accessibilityLabel === 'Continue');
    expect(privacy).toBeGreaterThanOrEqual(0);
    expect(button).toBeGreaterThan(privacy);
  });

  it('requests nothing before the tap, then only the missing permissions', async () => {
    const fake = fakePermissions({ receiveSms: true }, { sendSms: 'granted', postNotifications: 'granted' });
    const r = await renderPermissions(createMockPorts(), fake);
    expect(fake.requests).toEqual([]);
    await press(r, 'Continue');
    expect(fake.requests).toEqual([['sendSms', 'postNotifications']]);
  });

  it('shows an App info button when Android will not ask again', async () => {
    const mock = createMockPorts();
    const fake = fakePermissions({ receiveSms: true, postNotifications: true }, { sendSms: 'never_ask_again' });
    const r = await renderPermissions(mock, fake);
    expect(texts(r)).not.toContain(NEVER_ASK_AGAIN_TEXT);
    await press(r, 'Continue');
    expect(texts(r)).toContain(NEVER_ASK_AGAIN_TEXT);
    expect(texts(r)).toContain('Missing: turn it on in App info');
    await press(r, 'Open App info');
    expect(mock.callsTo('openAppInfo')).toHaveLength(1);
  });

  it('shows the 4 restricted-settings steps in order with an App info button', async () => {
    const mock = createMockPorts();
    mock.scripts.isRestrictedSettingsBlocked.setDefault(() => true);
    const r = await renderPermissions(mock, fakePermissions({}));
    const steps = texts(r).filter((t) => /^\d\. /.test(t));
    expect(steps).toEqual([
      '1. Open App info.',
      '2. Tap the menu (three dots) at the top right.',
      '3. Tap "Allow restricted settings".',
      '4. Come back to Necromancer.',
    ]);
    expect(RESTRICTED_STEPS).toHaveLength(4);
    await press(r, 'Open App info');
    expect(mock.callsTo('openAppInfo')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- Main_Screen

type MainSetup = {
  readonly device?: DeviceStatus;
  readonly service?: ServiceStatus;
  readonly prepare?: (store: GatewayStore) => void;
  readonly activity?: readonly ActivityEntry[];
};

type MainRender = {
  readonly r: Renderer;
  readonly mock: MockPorts;
  readonly store: GatewayStore;
  readonly onOpenPermissions: jest.Mock;
};

async function renderMain(setup: MainSetup = {}): Promise<MainRender> {
  const mock = createMockPorts();
  const device = setup.device ?? HEALTHY_DEVICE;
  const service = setup.service ?? 'running';
  mock.scripts.getDeviceStatus.setDefault(() => device);
  mock.scripts.getServiceStatus.setDefault(() => service);
  const activity = setup.activity ?? [];
  mock.scripts.loadActivity.setDefault(() => [...activity]);
  const store = createGatewayStore();
  setup.prepare?.(store);
  const onOpenPermissions = jest.fn();
  const r = await mount(
    <MainScreen
      ports={mock.ports}
      store={store}
      onOpenSetup={() => undefined}
      onOpenSettings={() => undefined}
      onOpenPermissions={onOpenPermissions}
      formatTime={() => '09:30'}
    />,
  );
  return { r, mock, store, onOpenPermissions };
}

/** Inputs that make `reason` the chosen Sleep_Reason. */
const SLEEP_SETUPS: Readonly<Record<SleepReason, MainSetup>> = {
  'paused-by-operator': { service: 'paused' },
  'no-sms-permission': { device: { ...HEALTHY_DEVICE, smsPermission: false } },
  'no-notification-permission': { device: { ...HEALTHY_DEVICE, notificationPermission: false } },
  'service-stopped': { service: 'stopped' },
  'airplane-mode': { device: { ...HEALTHY_DEVICE, airplaneMode: true } },
  'no-signal': { device: { ...HEALTHY_DEVICE, inService: false } },
  'battery-optimised': { device: { ...HEALTHY_DEVICE, batteryOptimisationIgnored: false } },
};

/** The port call each fix button must make; null means it opens the Permission_Screen. */
const FIX_CALL: Readonly<Record<SleepFixAction, string | null>> = {
  'resume-service': 'resumeService',
  'start-service': 'startService',
  'open-permissions': null,
  'open-airplane-settings': 'openAirplaneSettings',
  'open-mobile-network-settings': 'openMobileNetworkSettings',
  'request-ignore-battery-optimisation': 'requestIgnoreBatteryOptimisation',
};

const CALLER: CanonicalNumber = '+923001234567' as CanonicalNumber;
const OTHER: CanonicalNumber = '+923217654321' as CanonicalNumber;

const ENTRIES: readonly ActivityEntry[] = [
  { receivedAt: 2_000, who: maskNumber(CALLER), command: 'QUESTION', outcome: 'replied' },
  { receivedAt: 1_000, who: maskNumber(OTHER), command: 'STOP', outcome: 'stopped' },
];

describe('MainScreen heartbeat', () => {
  const cases: ReadonlyArray<[string, MainSetup]> = [
    ['ALIVE', {}],
    ['SENDING', { prepare: (s) => s.setSending(true) }],
    ['SLEEPING', { device: { ...HEALTHY_DEVICE, airplaneMode: true } }],
  ];

  it.each(cases)('renders the word %s as text', async (word, setup) => {
    setReducedMotion(false);
    const { r } = await renderMain(setup);
    expect(texts(r)).toContain(word);
  });

  it.each(cases)('starts no Animated.loop with reduced motion on (%s)', async (word, setup) => {
    setReducedMotion(true);
    const { r } = await renderMain(setup);
    expect(loopSpy).not.toHaveBeenCalled();
    expect(texts(r)).toContain(word);
  });
});

describe('MainScreen SLEEPING notice', () => {
  it.each(SLEEP_REASONS)('%s: one sentence of at most 120 characters and the right fix', async (reason) => {
    const { r, mock, onOpenPermissions } = await renderMain(SLEEP_SETUPS[reason]);
    const sentence = SLEEP_SENTENCES[reason];
    expect(sentence.length).toBeLessThanOrEqual(MAX_SLEEP_SENTENCE_LENGTH);
    expect(texts(r)).toContain('SLEEPING');
    const shownSentences = texts(r).filter((t) => (Object.values(SLEEP_SENTENCES) as string[]).includes(t));
    expect(shownSentences).toEqual([sentence]);

    const fix = SLEEP_FIXES[reason];
    expect(buttons(r, fix.label)).toHaveLength(1);
    mock.clearCalls();
    await press(r, fix.label);
    const expected = FIX_CALL[fix.action];
    if (expected === null) {
      expect(onOpenPermissions).toHaveBeenCalledTimes(1);
      expect(mock.calls).toEqual([]);
    } else {
      expect(onOpenPermissions).not.toHaveBeenCalled();
      expect(mock.calls.map((c) => c.method)).toEqual([expected]);
    }
  });
});

describe('MainScreen banners and activity', () => {
  it('shows the cap banner with the 00:00 resume time', async () => {
    const { r } = await renderMain({ prepare: (s) => s.setBanner('cap-reached', true) });
    const text = BANNER_TEXT['cap-reached'];
    expect(text).toMatch(/daily send cap is reached/i);
    expect(text).toMatch(/00:00 local time tomorrow/);
    expect(texts(r)).toContain(text);
  });

  it('shows no cap banner when the cap is not reached', async () => {
    const { r } = await renderMain();
    expect(texts(r)).not.toContain(BANNER_TEXT['cap-reached']);
  });

  it('asks before clearing; cancel keeps every entry', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { r, mock } = await renderMain({ activity: ENTRIES });
    expect(texts(r)).toContain(`09:30  ${maskNumber(CALLER)}`);
    await press(r, 'Clear activity');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(mock.callsTo('clearActivity')).toEqual([]);
    const actions = (alert.mock.calls[0][2] ?? []) as AlertButton[];
    expect(actions.map((a) => a.text)).toEqual(['Cancel', 'Clear']);
    await ReactTestRenderer.act(async () => {
      actions[0].onPress?.();
    });
    expect(mock.callsTo('clearActivity')).toEqual([]);
    expect(texts(r)).toContain(`09:30  ${maskNumber(CALLER)}`);
    expect(texts(r)).toContain(`09:30  ${maskNumber(OTHER)}`);
  });

  it('confirm clears the stored and shown activity', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { r, mock } = await renderMain({ activity: ENTRIES });
    await press(r, 'Clear activity');
    const actions = (alert.mock.calls[0][2] ?? []) as AlertButton[];
    await ReactTestRenderer.act(async () => {
      actions[1].onPress?.();
    });
    expect(mock.callsTo('clearActivity')).toHaveLength(1);
    expect(texts(r)).toContain('No activity yet.');
    expect(texts(r)).not.toContain(`09:30  ${maskNumber(CALLER)}`);
  });

  it('shows no 4 consecutive digits of a sender number', async () => {
    const { r } = await renderMain({ activity: ENTRIES });
    const shown = everythingShown(r);
    expect(shown).toContain(maskNumber(CALLER));
    expectNoDigitsOf(shown, CALLER);
    expectNoDigitsOf(shown, OTHER);
  });
});

// ---------------------------------------------------------------- Settings_Screen

function stateJson(fields: { allowlist?: readonly string[]; stopList?: readonly string[]; ownNumber?: CanonicalNumber }): string {
  return JSON.stringify({
    stopList: fields.stopList ?? [],
    allowlist: fields.allowlist ?? [],
    settings: serializeSettings({ ...DEFAULT_SETTINGS, ownNumber: fields.ownNumber ?? null }),
  });
}

function renderSettings(mock: MockPorts): Promise<Renderer> {
  return mount(
    <SettingsScreen ports={mock.ports} onBack={() => undefined} today={MOCK_TODAY} settingsSync={createSettingsSync()} />,
  );
}

describe('SettingsScreen', () => {
  const badValues: ReadonlyArray<['perNumberLimit' | 'rateWindowMinutes' | 'dailySendCap', string, string]> = [
    ['perNumberLimit', '0', '1 to 60'],
    ['perNumberLimit', '61', '1 to 60'],
    ['rateWindowMinutes', '1441', '1 to 1440'],
    ['dailySendCap', '2001', '1 to 2000'],
    ['dailySendCap', 'ten', '1 to 2000'],
  ];

  it.each(badValues)('rejects %s = "%s" and shows the range %s', async (field, value, range) => {
    const mock = createMockPorts();
    const r = await renderSettings(mock);
    const label = FIELD_LABELS[field];
    await type(r, label, value);
    await press(r, `Save ${label}`);
    expect(texts(r)).toContain(rangeMessage(field, range));
    expect(rangeMessage(field, range)).toBe(`Enter a number from ${range}`);
    expect(mock.callsTo('saveSettings')).toEqual([]);
  });

  it('rejects a value that is not a phone number and leaves the Allowlist unchanged', async () => {
    const mock = createMockPorts();
    mock.scripts.loadState.resolve(decodeStoredState(stateJson({}), MOCK_TODAY));
    const r = await renderSettings(mock);
    await type(r, ALLOWLIST_INPUT_LABEL, 'JAZZ');
    await press(r, `Add ${ALLOWLIST_INPUT_LABEL}`);
    expect(texts(r)).toContain(ALLOWLIST_INVALID_MESSAGE);
    expect(ALLOWLIST_INVALID_MESSAGE).toMatch(/7 to 15 digits/);
    expect(mock.callsTo('commit')).toEqual([]);
  });

  it('rejects an add when the Allowlist holds 500 numbers', async () => {
    const full = Array.from({ length: 500 }, (_, i) => `+9230${String(i).padStart(8, '0')}`);
    const mock = createMockPorts();
    mock.scripts.loadState.resolve(decodeStoredState(stateJson({ allowlist: full }), MOCK_TODAY));
    const r = await renderSettings(mock);
    await type(r, ALLOWLIST_INPUT_LABEL, '03111234567');
    await press(r, `Add ${ALLOWLIST_INPUT_LABEL}`);
    expect(texts(r)).toContain(ALLOWLIST_FULL_MESSAGE);
    expect(ALLOWLIST_FULL_MESSAGE).toMatch(/500/);
    expect(mock.callsTo('commit')).toEqual([]);
  });

  it('shows Allowlist, Stop_List and own number with no 4 consecutive digits', async () => {
    const own = '+923459876543' as CanonicalNumber;
    const mock = createMockPorts();
    mock.scripts.loadState.resolve(
      decodeStoredState(stateJson({ allowlist: [CALLER], stopList: [OTHER], ownNumber: own }), MOCK_TODAY),
    );
    const r = await renderSettings(mock);
    const shown = everythingShown(r);
    expect(shown).toContain(maskNumber(CALLER));
    expect(shown).toContain(maskNumber(OTHER));
    expect(shown).toContain(maskNumber(own));
    expectNoDigitsOf(shown, CALLER);
    expectNoDigitsOf(shown, OTHER);
    expectNoDigitsOf(shown, own);
  });
});
