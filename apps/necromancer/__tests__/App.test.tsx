/**
 * App shell: start screen choice and navigation (Requirements 11.1, 12.10, 12.12, 12.13, 17.3).
 *
 * @format
 */
import React from 'react';
import ReactTestRenderer, { type ReactTestRenderer as Renderer } from 'react-test-renderer';
import { Text } from 'react-native';
import App, { backRoute, type Route } from '../App';
import { createAiHolder } from '../src/gateway/ai';
import { createGatewayStore } from '../src/gateway/store';
import type { PermissionId, PermissionsAdapter } from '../src/ui/permissions';
import { HEALTHY_DEVICE, createMockPorts, type MockPorts } from './support/mockPorts';

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

const MAIN_TITLE = 'Necromancer';
const PERMISSION_TITLE = 'Necromancer needs your permission';
const SETUP_TITLE = 'Set up this phone';

let mounted: Renderer[] = [];

afterEach(async () => {
  for (const r of mounted) {
    await ReactTestRenderer.act(async () => {
      r.unmount();
    });
  }
  mounted = [];
});

function permissionsFor(granted: boolean): PermissionsAdapter {
  return {
    required: () => ['receiveSms', 'sendSms', 'postNotifications'],
    check: (_id: PermissionId) => Promise.resolve(granted),
    request: () => Promise.resolve({}),
  };
}

async function render(mock: MockPorts, granted: boolean): Promise<Renderer> {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <App
        ports={mock.ports}
        ai={createAiHolder(mock.ports.keyStore, () => 0)}
        store={createGatewayStore()}
        permissions={permissionsFor(granted)}
      />,
    );
  });
  if (r === undefined) throw new Error('render failed');
  mounted.push(r);
  return r;
}

function texts(r: Renderer): string[] {
  return r.root.findAllByType(Text).map((n) => [n.props.children].flat().join(''));
}

async function waitFor(cond: () => boolean, turns = 200): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (cond()) return;
    await ReactTestRenderer.act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error('waitFor: condition not met');
}

async function press(r: Renderer, label: string): Promise<void> {
  const found = r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
  if (found.length === 0) throw new Error(`no button "${label}"`);
  await ReactTestRenderer.act(async () => {
    found[0].props.onPress();
  });
}

describe('App start screen', () => {
  it('shows the Permission_Screen when a permission is missing (11.1)', async () => {
    const mock = createMockPorts();
    mock.scripts.getDeviceStatus.setDefault(() => ({ ...HEALTHY_DEVICE, smsPermission: false }));
    mock.scripts.getSetupMarks.setDefault(() => ({ autostart: true, recents: true }));
    const r = await render(mock, false);
    await waitFor(() => texts(r).includes(PERMISSION_TITLE));
    expect(texts(r)).not.toContain(MAIN_TITLE);
  });

  it('falls back to the Permission_Screen when the Device_Status cannot be read', async () => {
    const mock = createMockPorts();
    mock.scripts.getDeviceStatus.alwaysReject('device down');
    const r = await render(mock, false);
    await waitFor(() => texts(r).includes(PERMISSION_TITLE));
  });

  it('shows the Main_Screen when all permissions are granted and all steps done (12.13)', async () => {
    const mock = createMockPorts();
    mock.scripts.getSetupMarks.setDefault(() => ({ autostart: true, recents: true }));
    const r = await render(mock, true);
    await waitFor(() => texts(r).includes(MAIN_TITLE));
  });

  it('shows the Setup_Screen when a step is not done (12.13)', async () => {
    const mock = createMockPorts();
    const r = await render(mock, true);
    await waitFor(() => texts(r).includes(SETUP_TITLE));
  });
});

describe('App navigation', () => {
  it('opens the Setup_Screen from the Main_Screen without pausing or stopping the service (12.10)', async () => {
    const mock = createMockPorts();
    mock.scripts.getSetupMarks.setDefault(() => ({ autostart: true, recents: true }));
    const r = await render(mock, true);
    await waitFor(() => texts(r).includes(MAIN_TITLE));
    await press(r, 'Setup');
    await waitFor(() => texts(r).includes(SETUP_TITLE));
    expect(mock.callsTo('pauseService')).toHaveLength(0);
    expect(mock.names().filter((m) => /stop|pause/i.test(m) && m !== 'takePendingStops')).toEqual([]);
  });

  it('returns from the Permission_Screen to where it was opened (12.12)', () => {
    const setup: Route = { screen: 'setup', returnTo: 'main' };
    expect(backRoute({ screen: 'permission', returnTo: setup })).toBe(setup);
    expect(backRoute({ screen: 'permission', returnTo: null })).toBeNull();
    expect(backRoute({ screen: 'settings' })).toEqual({ screen: 'main' });
  });
});
