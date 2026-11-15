// Heartbeat rendering tests (Requirements 13.5, 13.6, 13.8, 13.9, 13.10).
import React from 'react';
import ReactTestRenderer, { type ReactTestRenderer as Renderer } from 'react-test-renderer';
import { AccessibilityInfo, Animated, Text, type EmitterSubscription } from 'react-native';
import type { Heartbeat as HeartbeatValue } from '@lazarus/brain';
import { Heartbeat, STATE_COLOR } from '../src/ui/Heartbeat';
import { colors, fontMin } from '../src/ui/theme';

const ALIVE: HeartbeatValue = { state: 'ALIVE' };
const SENDING: HeartbeatValue = { state: 'SENDING' };
const SLEEPING: HeartbeatValue = { state: 'SLEEPING', reason: 'airplane-mode' };

let removeListener: jest.Mock;
let loopSpy: jest.SpyInstance;
let mounted: Renderer[] = [];

function setReducedMotion(on: boolean): void {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(on);
}

async function render(heartbeat: HeartbeatValue, inboundPulse = 0): Promise<Renderer> {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<Heartbeat heartbeat={heartbeat} inboundPulse={inboundPulse} />);
  });
  if (r === undefined) throw new Error('render failed');
  mounted.push(r);
  return r;
}

function stateWord(r: Renderer): string {
  return r.root.findAllByType(Text).map((t) => String(t.props.children)).join(' ');
}

beforeEach(() => {
  removeListener = jest.fn();
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove: removeListener } as unknown as EmitterSubscription);
  loopSpy = jest.spyOn(Animated, 'loop');
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.forEach((r) => r.unmount());
  });
  mounted = [];
  jest.restoreAllMocks();
});

describe('Heartbeat', () => {
  it.each([ALIVE, SENDING, SLEEPING])('shows the state word $state as text and in the root label', async (hb) => {
    setReducedMotion(false);
    const r = await render(hb);
    expect(stateWord(r)).toBe(hb.state);
    expect(r.root.findAll((n) => n.props.accessibilityLabel === `Heartbeat: ${hb.state}`).length).toBeGreaterThan(0);
  });

  it('uses soul, ember and muted for the three states', () => {
    expect(STATE_COLOR).toEqual({ ALIVE: colors.soul, SENDING: colors.ember, SLEEPING: colors.muted });
  });

  it('starts a pulse loop for ALIVE when reduced motion is off', async () => {
    setReducedMotion(false);
    await render(ALIVE);
    expect(loopSpy).toHaveBeenCalled();
  });

  it('starts a glow loop for SENDING when reduced motion is off', async () => {
    setReducedMotion(false);
    await render(SENDING);
    expect(loopSpy).toHaveBeenCalled();
  });

  it('never loops while SLEEPING', async () => {
    setReducedMotion(false);
    await render(SLEEPING);
    expect(loopSpy).not.toHaveBeenCalled();
  });

  it.each([ALIVE, SENDING, SLEEPING])('has no loop with reduced motion on ($state) and still shows the word', async (hb) => {
    setReducedMotion(true);
    const r = await render(hb);
    expect(loopSpy).not.toHaveBeenCalled();
    expect(stateWord(r)).toBe(hb.state);
  });

  it('runs one extra pulse per inbound increment only with motion on', async () => {
    setReducedMotion(false);
    const seqSpy = jest.spyOn(Animated, 'sequence');
    const r = await render(ALIVE, 0);
    const before = seqSpy.mock.calls.length;
    await ReactTestRenderer.act(async () => {
      r.update(<Heartbeat heartbeat={ALIVE} inboundPulse={1} />);
    });
    expect(seqSpy.mock.calls.length).toBe(before + 1);
  });

  it('runs no extra pulse with reduced motion on', async () => {
    setReducedMotion(true);
    const seqSpy = jest.spyOn(Animated, 'sequence');
    const r = await render(ALIVE, 0);
    await ReactTestRenderer.act(async () => {
      r.update(<Heartbeat heartbeat={ALIVE} inboundPulse={1} />);
    });
    expect(seqSpy).not.toHaveBeenCalled();
  });

  it('keeps every text at least the minimum font size', async () => {
    setReducedMotion(false);
    const r = await render(ALIVE);
    for (const t of r.root.findAllByType(Text)) {
      const flat = [t.props.style].flat(Infinity) as Array<{ fontSize?: number } | undefined>;
      const size = flat.reduce<number | undefined>((acc, s) => s?.fontSize ?? acc, undefined);
      expect(size).toBeGreaterThanOrEqual(fontMin);
    }
  });

  it('removes the reduced motion listener on unmount', async () => {
    setReducedMotion(false);
    const r = await render(ALIVE);
    await ReactTestRenderer.act(async () => {
      r.unmount();
    });
    mounted = mounted.filter((m) => m !== r);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
