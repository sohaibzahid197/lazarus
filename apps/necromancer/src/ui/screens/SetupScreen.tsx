/**
 * Setup_Screen (Requirements 12.1 to 12.14, 16.3 to 16.11, 16.20).
 *
 * - The 6 Setup_Steps in `SETUP_STEPS` order, each with a "what breaks if skipped"
 *   line of at most 120 characters, shown without a tap (12.1, 12.8).
 * - Done marks are live: Device_Status (mount, `onDeviceStatus`, `AppState` 'active')
 *   and the AiHolder snapshot; Autostart and recents are persisted manual marks (12.6, 12.7).
 * - Fallback instructions appear after a failed intent and stay visible (12.3, 12.5, 12.11).
 * - The Main_Screen button shows only when every step is done (12.9).
 * - AI key step: Key_Input_Field held only in component state, validated with
 *   `validateApiKey`, cleared on a successful save and on unmount; "key saved" with
 *   the Masked_Key; remove-key confirmation; "paste the key again" when unreadable.
 *   The entered value is never logged or put into an accessibility label (16.10, 16.14).
 */
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type ScrollViewInstance,
  type TextInputInstance,
} from 'react-native';
import { API_KEY_INVALID_MESSAGE, validateApiKey, type DeviceStatus } from '@lazarus/brain';
import type { AiHolder, AiSnapshot } from '../../gateway/ai';
import type { GatewayPorts, SetupMarkStep, SetupMarks } from '../../native/ports';
import { SETUP_STEPS, allSetupStepsDone, setupStepsDone, type SetupStepId, type SetupStepMarks } from '../startScreen';
import { colors, radius, spacing, typography } from '../theme';
import { RESTRICTED_STEPS } from './PermissionScreen';

export const MAX_SETUP_EXPLANATION_LENGTH = 120;

export const SETUP_STEP_TITLES: Readonly<Record<SetupStepId, string>> = {
  'restricted-settings': 'Allow restricted settings',
  permissions: 'Grant SMS and notification permissions',
  'ai-key': 'Save your Gemini API key',
  autostart: 'Turn on Autostart',
  battery: 'Set battery to "No restrictions"',
  recents: 'Lock Necromancer in recent apps',
};

export const RESTRICTED_SETTINGS_EXPLANATION =
  'Without it, Android blocks the SMS permissions and the gateway cannot read or answer texts.';
export const PERMISSIONS_EXPLANATION =
  'Without SMS and notification permissions, the gateway cannot get questions, send replies or keep running.';
export const AI_KEY_EXPLANATION =
  'Without a key, people who ask a question get a "try later" reply instead of an answer.';
export const AUTOSTART_EXPLANATION =
  'Without Autostart, HyperOS stops the gateway after a reboot or when it closes the app.';
export const BATTERY_EXPLANATION =
  'Without "No restrictions", HyperOS puts the gateway to sleep and texts wait unanswered.';
export const RECENTS_EXPLANATION =
  'Without the lock, clearing recent apps can kill the gateway until you open it again.';

export const SETUP_EXPLANATIONS: Readonly<Record<SetupStepId, string>> = {
  'restricted-settings': RESTRICTED_SETTINGS_EXPLANATION,
  permissions: PERMISSIONS_EXPLANATION,
  'ai-key': AI_KEY_EXPLANATION,
  autostart: AUTOSTART_EXPLANATION,
  battery: BATTERY_EXPLANATION,
  recents: RECENTS_EXPLANATION,
};

export const RESTRICTED_SETTINGS_INSTRUCTIONS: readonly string[] = RESTRICTED_STEPS;
export const AUTOSTART_INSTRUCTIONS: readonly string[] = [
  'In App info, tap Autostart and turn it on.',
  'Or open the Security app, tap App manager, tap Necromancer, then turn on Autostart.',
];
export const BATTERY_INSTRUCTIONS: readonly string[] = [
  'In App info, tap Battery saver.',
  'Choose "No restrictions".',
];
export const RECENTS_INSTRUCTIONS: readonly string[] = [
  'Open recent apps.',
  'Long-press Necromancer.',
  'Tap the lock icon.',
];

export const KEY_SAVED_TEXT = 'key saved';
export const KEY_UNREADABLE_TEXT = 'The saved key could not be read. Paste the key again and tap Save.';
export const KEY_WRITE_FAILED_TEXT = 'The key could not be saved. Please try again.';
export const KEY_REMOVE_FAILED_TEXT = 'The key could not be removed. Please try again.';
export const REMOVE_KEY_TITLE = 'Remove the AI key?';
export const REMOVE_KEY_MESSAGE = 'Questions will get a "try later" reply until you save a key again.';
export const OPEN_MAIN_LABEL = 'Open main screen';

export type SetupScreenProps = {
  readonly ports: GatewayPorts;
  readonly ai: AiHolder;
  readonly onOpenPermissions: () => void;
  readonly onDone: () => void;
  /** Opens with this step expanded and scrolled into view (Main_Screen key banner, 16.19). */
  readonly initialStep?: 'ai-key';
};

type FallbackStep = 'restricted-settings' | 'autostart' | 'battery';
type Fallbacks = Readonly<Record<FallbackStep, boolean>>;
const NO_FALLBACKS: Fallbacks = { 'restricted-settings': false, autostart: false, battery: false };
const NO_MARKS: SetupMarks = { autostart: false, recents: false };

// ---------------------------------------------------------------- state hooks

function useLive(): React.MutableRefObject<boolean> {
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  return live;
}

/** Device_Status on mount, on every native push and when the app comes back (12.6). */
function useDeviceStatus(ports: GatewayPorts): DeviceStatus | null {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const live = useLive();
  useEffect(() => {
    const read = (): void => {
      ports.device
        .getDeviceStatus()
        .catch(() => null)
        .then((next) => {
          if (live.current) setStatus(next);
        });
    };
    read();
    const unsubscribe = ports.device.onDeviceStatus((next) => {
      if (live.current) setStatus(next);
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      unsubscribe();
      sub.remove();
    };
  }, [ports, live]);
  return status;
}

/** Persisted manual marks for Autostart and recents (12.7). */
function useSetupMarks(ports: GatewayPorts): readonly [SetupMarks, (step: SetupMarkStep) => void] {
  const [marks, setMarks] = useState<SetupMarks>(NO_MARKS);
  const live = useLive();
  const current = useRef(marks);
  const apply = useCallback(
    (next: SetupMarks) => {
      current.current = next;
      if (live.current) setMarks(next);
    },
    [live],
  );
  const reload = useCallback(() => {
    ports.store.getSetupMarks().then(apply, () => undefined);
  }, [ports, apply]);
  useEffect(reload, [reload]);
  const toggle = useCallback(
    (step: SetupMarkStep) => {
      const done = !current.current[step];
      apply({ ...current.current, [step]: done });
      ports.store.setSetupMark(step, done).catch(reload); // show what was really stored
    },
    [ports, apply, reload],
  );
  return [marks, toggle] as const;
}

/** Key status from the AiHolder; re-marked as soon as a save or remove publishes (12.6). */
function useAiSnapshot(ai: AiHolder): AiSnapshot {
  useEffect(() => {
    ai.refresh().catch(() => undefined);
  }, [ai]);
  return useSyncExternalStore(ai.subscribe, ai.snapshot);
}

function stepMarks(status: DeviceStatus | null, marks: SetupMarks, snap: AiSnapshot): SetupStepMarks {
  // The key itself never reaches the UI, so the key step comes from the snapshot status.
  const base = setupStepsDone(status, marks, { status: 'absent' });
  return { ...base, 'ai-key': snap.status === 'present' };
}

// ---------------------------------------------------------------- view parts

function SetupButton({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function SetupInstructions({ lines }: { lines: readonly string[] }): React.JSX.Element {
  return (
    <View style={styles.instructions}>
      {lines.map((line, i) => (
        <Text key={line} style={styles.body}>{`${i + 1}. ${line}`}</Text>
      ))}
    </View>
  );
}

function SetupDoneToggle({ title, done, onToggle }: { title: string; done: boolean; onToggle: () => void }): React.JSX.Element {
  const label = done ? 'Done. Tap to mark not done' : 'Tap when done';
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={`${title}: ${label}`}
      onPress={onToggle}
      style={styles.toggle}
    >
      <Text style={[styles.label, done ? styles.ok : styles.missing]}>{done ? '☑ Done' : '☐ Mark as done'}</Text>
    </Pressable>
  );
}

type SetupStepCardProps = {
  readonly id: SetupStepId;
  readonly index: number;
  readonly done: boolean;
  readonly onPress: () => void;
  readonly onLayout?: (e: LayoutChangeEvent) => void;
  readonly children?: React.ReactNode;
};

function SetupStepCard({ id, index, done, onPress, onLayout, children }: SetupStepCardProps): React.JSX.Element {
  const title = SETUP_STEP_TITLES[id];
  return (
    <View style={styles.card} onLayout={onLayout}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Step ${index + 1}: ${title}, ${done ? 'done' : 'not done'}`}
        onPress={onPress}
        style={styles.header}
      >
        <Text style={styles.name}>{`${index + 1}. ${title}`}</Text>
        <Text style={[styles.status, done ? styles.ok : styles.missing]}>{done ? 'Done' : 'Not done'}</Text>
      </Pressable>
      <Text style={styles.explanation}>{SETUP_EXPLANATIONS[id]}</Text>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- AI key step

type KeyMessage = 'invalid' | 'write-failed' | 'remove-failed' | null;
const KEY_MESSAGE_TEXT: Readonly<Record<Exclude<KeyMessage, null>, string>> = {
  invalid: API_KEY_INVALID_MESSAGE,
  'write-failed': KEY_WRITE_FAILED_TEXT,
  'remove-failed': KEY_REMOVE_FAILED_TEXT,
};

function confirmRemove(onConfirm: () => void): void {
  Alert.alert(REMOVE_KEY_TITLE, REMOVE_KEY_MESSAGE, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: onConfirm },
  ]);
}

function SetupKeySaved({ maskedKey, onRemove }: { maskedKey: string | null; onRemove: () => void }): React.JSX.Element {
  return (
    <View style={styles.item}>
      <Text style={[styles.label, styles.ok]}>{KEY_SAVED_TEXT}</Text>
      <Text style={styles.body}>{maskedKey ?? ''}</Text>
      <SetupButton label="Remove key" onPress={onRemove} />
    </View>
  );
}

/** Key_Input_Field and its controls (12.14, 16.3 to 16.11). */
function SetupKeyEditor({ ai, snap }: { ai: AiHolder; snap: AiSnapshot }): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<KeyMessage>(null);
  const busy = useRef(false);
  const input = useRef<TextInputInstance>(null);
  const live = useLive();
  useEffect(() => {
    const field = input.current;
    return () => field?.clear(); // the draft state goes with the component (16.10)
  }, []);

  const save = (): void => {
    const check = validateApiKey(draft);
    if (!check.ok) {
      setMessage('invalid'); // no save call (16.4)
      return;
    }
    if (busy.current) return;
    busy.current = true;
    ai.save(check.key)
      .then((result) => {
        if (!live.current) return;
        if (result.ok) setDraft('');
        setMessage(result.ok ? null : result.reason === 'invalid' ? 'invalid' : 'write-failed');
      })
      .finally(() => {
        busy.current = false;
      });
  };
  const remove = (): void =>
    confirmRemove(() => {
      ai.remove().then((ok) => {
        if (live.current) setMessage(ok ? null : 'remove-failed');
      });
    });

  return (
    <View style={styles.item}>
      {snap.status === 'present' ? <SetupKeySaved maskedKey={snap.maskedKey} onRemove={remove} /> : null}
      <TextInput
        ref={input}
        value={draft}
        onChangeText={setDraft}
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="none"
        importantForAutofill="no"
        contextMenuHidden={false}
        placeholder="Paste your Gemini API key"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Gemini API key"
        style={styles.input}
      />
      {message !== null ? <Text style={[styles.body, styles.error]}>{KEY_MESSAGE_TEXT[message]}</Text> : null}
      <SetupButton label="Save key" onPress={save} />
    </View>
  );
}

// ---------------------------------------------------------------- screen

function useScrollToStep(enabled: boolean): {
  readonly scroll: React.RefObject<ScrollViewInstance | null>;
  readonly onLayout: (e: LayoutChangeEvent) => void;
} {
  const scroll = useRef<ScrollViewInstance>(null);
  const done = useRef(!enabled);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    if (done.current) return;
    done.current = true;
    scroll.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: false });
  }, []);
  return { scroll, onLayout };
}

export function SetupScreen({ ports, ai, onOpenPermissions, onDone, initialStep }: SetupScreenProps): React.JSX.Element {
  const status = useDeviceStatus(ports);
  const [marks, toggleMark] = useSetupMarks(ports);
  const snap = useAiSnapshot(ai);
  const steps = stepMarks(status, marks, snap);
  const [fallbacks, setFallbacks] = useState<Fallbacks>(NO_FALLBACKS);
  const [keyOpen, setKeyOpen] = useState(initialStep === 'ai-key');
  const { scroll, onLayout } = useScrollToStep(initialStep === 'ai-key');
  const live = useLive();

  const showFallback = useCallback(
    (step: FallbackStep) => {
      if (live.current) setFallbacks((prev) => ({ ...prev, [step]: true })); // never hidden again
    },
    [live],
  );
  const openWithFallback = (step: FallbackStep, open: () => Promise<boolean>): void => {
    open()
      .catch(() => false)
      .then((opened) => {
        if (!opened) showFallback(step);
      });
  };

  const press: Readonly<Record<SetupStepId, () => void>> = {
    'restricted-settings': () => {
      showFallback('restricted-settings'); // instructions always shown on tap (12.11)
      ports.device.openAppInfo().catch(() => undefined);
    },
    permissions: onOpenPermissions,
    'ai-key': () => setKeyOpen((open) => !open),
    autostart: () => openWithFallback('autostart', () => ports.device.openAutostart()),
    battery: () => openWithFallback('battery', () => ports.device.requestIgnoreBatteryOptimisation()),
    recents: () => undefined,
  };

  const body = (id: SetupStepId): React.ReactNode => {
    switch (id) {
      case 'restricted-settings':
        return fallbacks[id] ? <SetupInstructions lines={RESTRICTED_SETTINGS_INSTRUCTIONS} /> : null;
      case 'permissions':
        return null;
      case 'ai-key':
        return (
          <>
            {snap.status === 'unreadable' ? <Text style={[styles.body, styles.error]}>{KEY_UNREADABLE_TEXT}</Text> : null}
            {keyOpen ? <SetupKeyEditor ai={ai} snap={snap} /> : null}
          </>
        );
      case 'autostart':
        return (
          <>
            {fallbacks.autostart ? <SetupInstructions lines={AUTOSTART_INSTRUCTIONS} /> : null}
            <SetupDoneToggle title={SETUP_STEP_TITLES.autostart} done={marks.autostart} onToggle={() => toggleMark('autostart')} />
          </>
        );
      case 'battery':
        return fallbacks.battery ? <SetupInstructions lines={BATTERY_INSTRUCTIONS} /> : null;
      case 'recents':
        return (
          <>
            <SetupInstructions lines={RECENTS_INSTRUCTIONS} />
            <SetupDoneToggle title={SETUP_STEP_TITLES.recents} done={marks.recents} onToggle={() => toggleMark('recents')} />
          </>
        );
    }
  };

  return (
    <ScrollView ref={scroll} style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        Set up this phone
      </Text>
      {SETUP_STEPS.map((id, index) => (
        <SetupStepCard
          key={id}
          id={id}
          index={index}
          done={steps[id]}
          onPress={press[id]}
          onLayout={id === 'ai-key' ? onLayout : undefined}
        >
          {body(id)}
        </SetupStepCard>
      ))}
      {allSetupStepsDone(steps) ? <SetupButton label={OPEN_MAIN_LABEL} onPress={onDone} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.title, color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius, padding: spacing.lg, gap: spacing.sm },
  header: { gap: spacing.xs },
  item: { gap: spacing.sm },
  instructions: { gap: spacing.xs },
  name: { ...typography.label, color: colors.text },
  label: { ...typography.label, color: colors.text },
  body: { ...typography.body, color: colors.text },
  explanation: { ...typography.body, color: colors.muted },
  status: { ...typography.label },
  ok: { color: colors.soul },
  missing: { color: colors.ember },
  error: { color: colors.blood },
  toggle: { paddingVertical: spacing.sm },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.muted,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  button: {
    backgroundColor: colors.soul,
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  buttonText: { ...typography.label, color: colors.bg },
});
