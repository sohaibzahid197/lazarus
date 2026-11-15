// Smoke tests for the `LazarusPausedInbox` task (Requirements 9.10, 9.11, 9.12).
// Full paused-path coverage lives in pausedPath.test.ts (task 22.9).
import { createGatewayStore } from '../src/gateway/store';
import { createPausedTask } from '../src/gateway/pausedTask';
import { createMockPorts } from './support/mockPorts';

const SENDER = '+923001234567';
const AT = Date.UTC(2026, 0, 15, 6, 0, 0);

function setup() {
  const mock = createMockPorts();
  const ui = createGatewayStore();
  const logs: string[] = [];
  const task = createPausedTask(mock.ports, {
    tzOffsetMinutes: () => 300,
    ui,
    log: (line) => logs.push(line),
  });
  return { mock, ui, logs, task };
}

describe('pausedTask', () => {
  it('records ignored-paused for HELP and never starts the service', async () => {
    const { mock, ui, task } = setup();
    await task({ sender: SENDER, body: 'HELP', receivedAt: AT });
    const entries = mock.callsTo('appendActivity').map((c) => c.args[0]);
    expect(entries).toEqual([
      expect.objectContaining({ outcome: 'ignored-paused', command: 'HELP', receivedAt: AT }),
    ]);
    const commits = mock.callsTo('commit').flatMap((c) => c.args[0] as { type: string }[]);
    expect(commits.every((ch) => ch.type === 'counters')).toBe(true);
    expect(mock.callsTo('savePendingStop')).toHaveLength(0);
    expect(mock.callsTo('startService')).toHaveLength(0);
    expect(mock.callsTo('resumeService')).toHaveLength(0);
    expect(mock.callsTo('readKey')).toHaveLength(0);
    expect(ui.getSnapshot().counters?.ignored).toBe(1);
  });

  it('commits a STOP and logs stopped', async () => {
    const { mock, task } = setup();
    await task({ sender: SENDER, body: 'STOP', receivedAt: AT });
    const changes = mock.callsTo('commit').flatMap((c) => c.args[0] as { type: string }[]);
    expect(changes).toContainEqual({ type: 'stop-add', number: SENDER });
    expect(mock.callsTo('appendActivity').map((c) => c.args[0])).toEqual([
      expect.objectContaining({ outcome: 'stopped', command: 'STOP' }),
    ]);
    expect(mock.callsTo('savePendingStop')).toHaveLength(0);
  });

  it('keeps a STOP as a pending stop when the state cannot be loaded', async () => {
    const { mock, logs, task } = setup();
    mock.scripts.loadState.reject('stop list unreadable');
    await task({ sender: SENDER, body: 'STOP please call me', receivedAt: AT });
    expect(mock.callsTo('savePendingStop').map((c) => c.args)).toEqual([[SENDER, AT]]);
    expect(logs.join('\n')).not.toContain('1234567');
    expect(logs.join('\n')).not.toContain('call me');
  });

  it('drops malformed args with a masked log line', async () => {
    const { mock, logs, task } = setup();
    await task({ sender: SENDER, body: 42, receivedAt: AT });
    expect(mock.calls).toHaveLength(0);
    expect(logs).toEqual([expect.stringContaining('567')]);
    expect(logs[0]).not.toContain('1234567');
  });
});
