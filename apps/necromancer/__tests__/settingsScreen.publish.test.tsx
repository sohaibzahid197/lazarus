// Settings_Screen publishes saved changes to the running loop (Requirements 15.1, 15.7, 15.9, 4.4).
import React from 'react';
import ReactTestRenderer, { type ReactTestRenderer as Renderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { DEFAULT_SETTINGS, decodeStoredState, serializeSettings } from '@lazarus/brain';
import { createSettingsSync, type SettingsUpdate } from '../src/gateway/settingsSync';
import {
  ALLOWLIST_ADDED_MESSAGE,
  ALLOWLIST_DUPLICATE_MESSAGE,
  ALLOWLIST_INPUT_LABEL,
  FIELD_LABELS,
  NOT_SAVED_MESSAGE,
  SAVED_MESSAGE,
  SettingsScreen,
} from '../src/ui/screens/SettingsScreen';
import { MOCK_TODAY, createMockPorts, type MockPorts } from './support/mockPorts';

const NUMBER_INPUT = '03001234567';
const CANONICAL = '+923001234567';

let mounted: Renderer[] = [];

async function render(mock: MockPorts): Promise<{ r: Renderer; published: SettingsUpdate[] }> {
  const sync = createSettingsSync();
  const published: SettingsUpdate[] = [];
  sync.subscribe((u) => published.push(u));
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <SettingsScreen ports={mock.ports} onBack={() => undefined} today={MOCK_TODAY} settingsSync={sync} />,
    );
  });
  if (r === undefined) throw new Error('render failed');
  mounted.push(r);
  return { r, published };
}

function input(r: Renderer, label: string): ReactTestRenderer.ReactTestInstance {
  return r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === label);
}

function pressable(r: Renderer, label: string): ReactTestRenderer.ReactTestInstance {
  const found = r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
  if (found.length === 0) throw new Error(`no button "${label}"`);
  return found[0];
}

async function type(r: Renderer, label: string, text: string): Promise<void> {
  await ReactTestRenderer.act(async () => {
    input(r, label).props.onChangeText(text);
  });
}

async function press(r: Renderer, label: string): Promise<void> {
  await ReactTestRenderer.act(async () => {
    pressable(r, label).props.onPress();
  });
}

function allText(r: Renderer): string {
  return r.root
    .findAllByType(Text)
    .map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''))
    .join('\n');
}

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.forEach((r) => r.unmount());
  });
  mounted = [];
});

describe('SettingsScreen publish', () => {
  const limit = FIELD_LABELS.perNumberLimit;

  it('saves a valid field, then publishes the new settings', async () => {
    const mock = createMockPorts();
    const { r, published } = await render(mock);
    await type(r, limit, '10');
    await press(r, `Save ${limit}`);
    const next = { ...DEFAULT_SETTINGS, perNumberLimit: 10 };
    expect(mock.callsTo('saveSettings').map((c) => c.args)).toEqual([[serializeSettings(next)]]);
    expect(published).toEqual([{ settings: next }]);
    expect(allText(r)).toContain(SAVED_MESSAGE);
  });

  it('publishes nothing and shows "Change not saved" when the save rejects', async () => {
    const mock = createMockPorts();
    mock.scripts.saveSettings.reject('disk full');
    const { r, published } = await render(mock);
    await type(r, limit, '10');
    await press(r, `Save ${limit}`);
    expect(mock.callsTo('saveSettings')).toHaveLength(1);
    expect(published).toEqual([]);
    expect(allText(r)).toContain(NOT_SAVED_MESSAGE);
    expect(input(r, limit).props.value).toBe(String(DEFAULT_SETTINGS.perNumberLimit));
  });

  it('commits an allowlist add, then publishes the allowlist change', async () => {
    const mock = createMockPorts();
    mock.scripts.loadState.resolve(decodeStoredState(JSON.stringify({ stopList: [], allowlist: [] }), MOCK_TODAY));
    const { r, published } = await render(mock);
    await type(r, ALLOWLIST_INPUT_LABEL, NUMBER_INPUT);
    await press(r, `Add ${ALLOWLIST_INPUT_LABEL}`);
    const change = { type: 'allow-add', number: CANONICAL };
    expect(mock.callsTo('commit').map((c) => c.args)).toEqual([[[change]]]);
    expect(published).toEqual([{ allowlistChanges: [change] }]);
    expect(allText(r)).toContain(ALLOWLIST_ADDED_MESSAGE);
    expect(allText(r)).not.toContain('3001234567');
  });

  it('does not commit or publish a duplicate allowlist entry', async () => {
    const mock = createMockPorts();
    mock.scripts.loadState.resolve(
      decodeStoredState(JSON.stringify({ stopList: [], allowlist: [CANONICAL] }), MOCK_TODAY),
    );
    const { r, published } = await render(mock);
    await type(r, ALLOWLIST_INPUT_LABEL, NUMBER_INPUT);
    await press(r, `Add ${ALLOWLIST_INPUT_LABEL}`);
    expect(mock.callsTo('commit')).toEqual([]);
    expect(published).toEqual([]);
    expect(allText(r)).toContain(ALLOWLIST_DUPLICATE_MESSAGE);
  });
});
