/**
 * Heartbeat line on the Main_Screen (Requirements 13.5 to 13.10).
 *
 * - ALIVE: a `soul` spike pulses every 1.5 s; each increment of
 *   `inboundPulse` adds one extra pulse.
 * - SENDING: `ember` line with a looping glow on a halo.
 * - SLEEPING: flat `muted` line, no animation.
 * - Reduced_Motion on: no animation at all, static line in the state colour.
 * - The state word is always shown as text.
 *
 * Plain `View`s and `Animated` with the native driver; no SVG.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import type { Heartbeat as HeartbeatValue } from '@lazarus/brain';
import { colors, fontSize, radius, spacing } from './theme';

export const PULSE_PERIOD_MS = 1500;
const PULSE_UP_MS = 250;
const PULSE_DOWN_MS = 350;
const EXTRA_PULSE_MS = 200;
const GLOW_HALF_MS = 750;

type HeartbeatState = HeartbeatValue['state'];

export const STATE_COLOR: Readonly<Record<HeartbeatState, string>> = {
  ALIVE: colors.soul,
  SENDING: colors.ember,
  SLEEPING: colors.muted,
};

export type HeartbeatProps = {
  readonly heartbeat: HeartbeatValue;
  /** Counter from the UI store; each increment means one Inbound_Message. */
  readonly inboundPulse: number;
};

/**
 * Reads Reduced_Motion and follows changes. Starts as `true` so nothing
 * moves before the setting is known.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (on) => {
        if (live) setReduced(on);
      },
      () => undefined,
    );
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on: boolean) => {
      if (live) setReduced(on);
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

function pulseOnce(value: Animated.Value, upMs: number, downMs: number): Animated.CompositeAnimation {
  return Animated.sequence([
    Animated.timing(value, { toValue: 1, duration: upMs, useNativeDriver: true }),
    Animated.timing(value, { toValue: 0, duration: downMs, useNativeDriver: true }),
  ]);
}

/** Runs the ALIVE pulse loop or the SENDING glow loop while `active`. */
function useLoops(state: HeartbeatState, reduced: boolean, pulse: Animated.Value, glow: Animated.Value): void {
  useEffect(() => {
    if (reduced || state === 'SLEEPING') return undefined;
    const loop =
      state === 'ALIVE'
        ? Animated.loop(
            Animated.sequence([
              pulseOnce(pulse, PULSE_UP_MS, PULSE_DOWN_MS),
              Animated.delay(PULSE_PERIOD_MS - PULSE_UP_MS - PULSE_DOWN_MS),
            ]),
          )
        : Animated.loop(pulseOnce(glow, GLOW_HALF_MS, GLOW_HALF_MS));
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
      glow.setValue(0);
    };
  }, [state, reduced, pulse, glow]);
}

/** One extra pulse per increment of `inboundPulse` while ALIVE with motion on. */
function useExtraPulse(inboundPulse: number, enabled: boolean, extra: Animated.Value): void {
  const last = useRef(inboundPulse);
  useEffect(() => {
    const changed = inboundPulse !== last.current;
    last.current = inboundPulse;
    if (!changed || !enabled) return undefined;
    const anim = pulseOnce(extra, EXTRA_PULSE_MS, EXTRA_PULSE_MS);
    anim.start();
    return () => {
      anim.stop();
      extra.setValue(0);
    };
  }, [inboundPulse, enabled, extra]);
}

function Spike({ color, value, label }: { color: string; value: Animated.Value; label: string }): React.JSX.Element {
  const style = {
    opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
    transform: [{ scaleY: value.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }],
  };
  return (
    <Animated.View accessibilityLabel={label} style={[styles.spike, style]}>
      <View style={[styles.segment, styles.segmentUp, { backgroundColor: color }]} />
      <View style={[styles.segment, styles.segmentDown, { backgroundColor: color }]} />
    </Animated.View>
  );
}

export function Heartbeat({ heartbeat, inboundPulse }: HeartbeatProps): React.JSX.Element {
  const { state } = heartbeat;
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  const extra = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const color = STATE_COLOR[state];
  const moving = !reduced && state !== 'SLEEPING';

  useLoops(state, reduced, pulse, glow);
  useExtraPulse(inboundPulse, !reduced && state === 'ALIVE', extra);

  return (
    <View accessible accessibilityRole="summary" accessibilityLabel={`Heartbeat: ${state}`} style={styles.root}>
      <View accessibilityLabel={`${state.toLowerCase()} heartbeat line`} style={styles.track}>
        {moving && state === 'SENDING' ? (
          <Animated.View
            accessibilityLabel="sending glow"
            style={[styles.halo, { backgroundColor: color, opacity: glow }]}
          />
        ) : null}
        <View accessibilityLabel="heartbeat line" style={[styles.line, { backgroundColor: color }]} />
        {moving && state === 'ALIVE' ? (
          <>
            <Spike color={color} value={pulse} label="heartbeat pulse" />
            <Spike color={color} value={extra} label="message pulse" />
          </>
        ) : null}
      </View>
      <Text style={[styles.word, { color }]}>{state}</Text>
    </View>
  );
}

const LINE_HEIGHT = 3;
const TRACK_HEIGHT = 48;
const SEGMENT_LENGTH = 26;

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius,
    backgroundColor: colors.surface,
  },
  track: {
    flex: 1,
    height: TRACK_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  line: {
    alignSelf: 'stretch',
    height: LINE_HEIGHT,
    borderRadius: LINE_HEIGHT,
  },
  halo: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: spacing.md,
    borderRadius: radius,
  },
  spike: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    height: TRACK_HEIGHT,
  },
  segment: {
    width: LINE_HEIGHT,
    height: SEGMENT_LENGTH,
    borderRadius: LINE_HEIGHT,
  },
  segmentUp: { transform: [{ rotate: '20deg' }] },
  segmentDown: { transform: [{ rotate: '-20deg' }] },
  word: {
    fontFamily: 'sans-serif',
    fontSize: fontSize.label,
    fontWeight: '700',
    minWidth: 96,
  },
});
