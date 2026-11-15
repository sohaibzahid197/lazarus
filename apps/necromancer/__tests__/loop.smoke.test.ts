// Smoke test for the gateway loop (task 22.5). Detailed call-order tests live in loop.test.ts.
import { createGatewayStore } from '../src/gateway/store';
import { startGatewayLoop, type Clock } from '../src/gateway/loop';
import { createMockPorts, inbound } from './support/mockPorts';

const PK_OFFSET = 300; // UTC+5

function fakeClock(): Clock {
  return {
    now: () => Date.UTC(2026, 0, 15, 6, 0, 0),
    tzOffsetMinutes: () => PK_OFFSET,
    sleep: () => Promise.resolve(),
  };
}

describe('startGatewayLoop smoke', () => {
  it('answers HELP and records the activity, and a second start returns the same loop', async () => {
    const mock = createMockPorts();
    const ui = createGatewayStore();
    const logs: string[] = [];
    const loop = startGatewayLoop(mock.ports, fakeClock(), { ui, log: (l) => logs.push(l) });
    expect(startGatewayLoop(mock.ports, fakeClock())).toBe(loop);

    const at = Date.UTC(2026, 0, 15, 5, 0, 0);
    mock.pushInbound(inbound('m1', '+923001234567', 'HELP', at));
    await mock.settle(200);

    expect(mock.names(['loadState', 'readKey', 'takePendingStops', 'attachLoop'])).toEqual([
      'loadState',
      'readKey',
      'takePendingStops',
      'attachLoop',
    ]);
    expect(mock.callsTo('completeInbound')[0]?.args).toEqual(['m1']);
    expect(mock.callsTo('sendParts')).toHaveLength(1);
    expect(ui.getSnapshot().activity[0]?.outcome).toBe('replied');
    expect(mock.callsTo('updateNotification').at(-1)?.args).toEqual(['ALIVE', 1]);
    for (const line of logs) expect(line).not.toMatch(/\d{4}/);

    await loop.stop();
    expect(startGatewayLoop(mock.ports, fakeClock(), { ui })).not.toBe(loop);
    await startGatewayLoop(mock.ports).stop();
  });
});
