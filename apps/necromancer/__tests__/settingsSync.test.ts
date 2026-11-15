// Live settings reload: a saved Settings_Screen change applies to the running loop
// without a service restart (Requirements 15.1, 15.6).
import { DEFAULT_SETTINGS, decodeStoredState, type CanonicalNumber } from '@lazarus/brain';
import { startGatewayLoop, type Clock, type GatewayLoop } from '../src/gateway/loop';
import { createSettingsSync, type SettingsSync } from '../src/gateway/settingsSync';
import { createGatewayStore } from '../src/gateway/store';
import { createMockPorts, inbound, type MockPorts } from './support/mockPorts';

const A = '+923001111111' as CanonicalNumber;
const B = '+923002222222' as CanonicalNumber;
const T0 = Date.UTC(2026, 0, 15, 5, 0, 0);

const clock: Clock = {
  now: () => T0,
  tzOffsetMinutes: () => 300,
  sleep: () => Promise.resolve(),
};

let loop: GatewayLoop | null = null;
afterEach(async () => {
  await loop?.stop();
  loop = null;
});

async function start(): Promise<{ mock: MockPorts; sync: SettingsSync; ui: ReturnType<typeof createGatewayStore> }> {
  const mock = createMockPorts();
  // A readable, empty Allowlist (the mock default has none, which reads as unreadable).
  mock.scripts.loadState.setDefault((today) =>
    decodeStoredState(JSON.stringify({ stopList: [], allowlist: [] }), today),
  );
  const sync = createSettingsSync();
  const ui = createGatewayStore();
  loop = startGatewayLoop(mock.ports, clock, { ui, settingsSync: sync, log: () => undefined });
  await mock.settle(200);
  expect(mock.callsTo('attachLoop')).toHaveLength(1);
  return { mock, sync, ui };
}

async function send(mock: MockPorts, id: string, sender: string, at: number): Promise<string | undefined> {
  mock.pushInbound(inbound(id, sender, 'HELP', at));
  await mock.settle(200);
  const entry = mock.callsTo('appendActivity').at(-1)?.args[0] as { outcome?: string } | undefined;
  return entry?.outcome;
}

describe('settings reload', () => {
  it('applies a new Per_Number_Limit to the next message', async () => {
    const { mock, sync } = await start();
    expect(await send(mock, 'm1', A, T0)).toBe('replied');
    expect(await send(mock, 'm2', A, T0 + 1)).toBe('replied'); // default limit 5
    sync.publish({ settings: { ...DEFAULT_SETTINGS, perNumberLimit: 2 } });
    expect(await send(mock, 'm3', A, T0 + 2)).toBe('rate-limited');
    expect(mock.callsTo('startService')).toHaveLength(0);
  });

  it('applies Allowlist_Mode and saved Allowlist edits, ignoring non-Allowlist changes', async () => {
    const { mock, sync } = await start();
    sync.publish({
      settings: { ...DEFAULT_SETTINGS, allowlistMode: true },
      allowlistChanges: [
        { type: 'allow-add', number: A },
        { type: 'stop-add', number: A },
      ],
    });
    expect(await send(mock, 'm1', B, T0)).toBe('ignored-not-allowed');
    expect(await send(mock, 'm2', A, T0 + 1)).toBe('replied'); // stop-add was not applied
    sync.publish({ allowlistChanges: [{ type: 'allow-remove', number: A }] });
    expect(await send(mock, 'm3', A, T0 + 2)).toBe('ignored-not-allowed');
  });

  it('updates the cap banner when the Daily_Send_Cap changes', async () => {
    const { mock, sync, ui } = await start();
    expect(await send(mock, 'm1', A, T0)).toBe('replied');
    expect(ui.getSnapshot().banners).not.toContain('cap-reached');
    sync.publish({ settings: { ...DEFAULT_SETTINGS, dailySendCap: 1 } });
    expect(ui.getSnapshot().banners).toContain('cap-reached');
    expect(await send(mock, 'm2', B, T0 + 1)).toBe('send-capped');
  });

  it('keeps a change published while the loop is still loading', async () => {
    const mock = createMockPorts();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mock.scripts.loadState.setDefault(async (today) => {
      await gate;
      return decodeStoredState(JSON.stringify({ stopList: [], allowlist: [] }), today);
    });
    const sync = createSettingsSync();
    loop = startGatewayLoop(mock.ports, clock, { ui: createGatewayStore(), settingsSync: sync, log: () => undefined });
    await mock.settle(20);
    sync.publish({ settings: { ...DEFAULT_SETTINGS, perNumberLimit: 1 } });
    release();
    await mock.settle(200);
    expect(await send(mock, 'm1', A, T0)).toBe('replied');
    expect(await send(mock, 'm2', A, T0 + 1)).toBe('rate-limited');
  });

  it('stops listening after the loop stops', async () => {
    const { mock, sync } = await start();
    await loop?.stop();
    loop = null;
    const before = mock.calls.length;
    sync.publish({ settings: { ...DEFAULT_SETTINGS, dailySendCap: 1 } });
    expect(mock.calls.length).toBe(before);
  });
});
