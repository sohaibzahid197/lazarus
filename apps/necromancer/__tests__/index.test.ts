// Entry point registrations (Requirements 9.6, 9.12): the app component plus the two
// headless tasks the Kotlin services run by name.
import { AppRegistry } from 'react-native';

jest.mock('../App', () => ({ __esModule: true, default: () => null }));
jest.mock('../src/gateway/headless', () => ({
  GATEWAY_TASK_NAME: 'LazarusGateway',
  lazarusGateway: jest.fn(async () => undefined),
}));
jest.mock('../src/gateway/pausedTask', () => ({
  __esModule: true,
  PAUSED_TASK_NAME: 'LazarusPausedInbox',
  default: jest.fn(async () => undefined),
}));

describe('index.js', () => {
  it('registers the component and both headless tasks', () => {
    const component = jest.spyOn(AppRegistry, 'registerComponent').mockImplementation(() => 'x');
    const headless = jest
      .spyOn(AppRegistry, 'registerHeadlessTask')
      .mockImplementation(() => undefined);

    require('../index');

    const { name } = require('../app.json') as { name: string };
    const App = require('../App').default;
    const { lazarusGateway } = require('../src/gateway/headless');
    const lazarusPausedInbox = require('../src/gateway/pausedTask').default;

    expect(component).toHaveBeenCalledTimes(1);
    expect(component.mock.calls[0][0]).toBe(name);
    expect(component.mock.calls[0][1]()).toBe(App);

    const tasks = new Map(headless.mock.calls.map(([taskName, provider]) => [taskName, provider()]));
    expect([...tasks.keys()].sort()).toEqual(['LazarusGateway', 'LazarusPausedInbox']);
    expect(tasks.get('LazarusGateway')).toBe(lazarusGateway);
    expect(tasks.get('LazarusPausedInbox')).toBe(lazarusPausedInbox);
    expect(typeof tasks.get('LazarusGateway')).toBe('function');
    expect(typeof tasks.get('LazarusPausedInbox')).toBe('function');
  });
});
