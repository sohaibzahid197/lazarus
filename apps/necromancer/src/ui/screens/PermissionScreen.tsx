/**
 * Permission_Screen (Requirements 11.2 to 11.10).
 *
 * - One explanation per permission, each at most 300 characters (11.2).
 * - Privacy statement above the continue button (11.3).
 * - Nothing is requested before the Operator taps the button; then only the
 *   missing permissions are requested (11.4).
 * - Denied but askable permissions are listed with an ask-again button (11.5).
 * - `never_ask_again` shows an App info button (11.6).
 * - Restricted_Settings shows 4 numbered steps and an App info button (11.7).
 * - Re-checks on `AppState` 'active' (11.8, 11.10) and calls `onDone` once all
 *   are granted (11.9).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GatewayPorts } from '../../native/ports';
import {
  allGranted,
  askAgainPermissions,
  createAndroidPermissions,
  initialStatuses,
  looksRestricted,
  mergeChecked,
  mergeRequested,
  missingPermissions,
  smsGranted,
  type PermissionId,
  type PermissionStatus,
  type PermissionStatuses,
  type PermissionsAdapter,
} from '../permissions';
import { colors, radius, spacing, typography } from '../theme';

export const MAX_EXPLANATION_LENGTH = 300;

export const PERMISSION_NAMES: Readonly<Record<PermissionId, string>> = {
  receiveSms: 'Receive SMS (RECEIVE_SMS)',
  sendSms: 'Send SMS (SEND_SMS)',
  postNotifications: 'Notifications (POST_NOTIFICATIONS)',
};

export const RECEIVE_SMS_EXPLANATION =
  'Receive SMS (RECEIVE_SMS) lets this phone read the questions people text to it, so the gateway can answer them. Your messages stay in the phone inbox.';

export const SEND_SMS_EXPLANATION =
  'Send SMS (SEND_SMS) lets the gateway text the answer back to the person who asked. It only replies to messages it gets. Normal SMS charges from your plan may apply.';

export const POST_NOTIFICATIONS_EXPLANATION =
  'Notifications (POST_NOTIFICATIONS) let the gateway show a small notice while it runs, so Android keeps it working and you can see that it is awake.';

export const PERMISSION_EXPLANATIONS: Readonly<Record<PermissionId, string>> = {
  receiveSms: RECEIVE_SMS_EXPLANATION,
  sendSms: SEND_SMS_EXPLANATION,
  postNotifications: POST_NOTIFICATIONS_EXPLANATION,
};

export const PRIVACY_STATEMENT =
  'Your privacy: message bodies are not uploaded anywhere, except the question text sent to the AI service to get an answer. Message bodies are not stored in the Activity log. Phone numbers are masked, so only the last 3 digits show.';

export const RESTRICTED_STEPS: readonly string[] = [
  'Open App info.',
  'Tap the menu (three dots) at the top right.',
  'Tap "Allow restricted settings".',
  'Come back to Necromancer.',
];

export const RESTRICTED_INTRO =
  'Android blocked the SMS permissions for this app. Please follow these steps, then tap Ask again:';

export const NEVER_ASK_AGAIN_TEXT =
  'Android will not ask again for some permissions. Please turn them on in App info, then come back.';

const STATUS_TEXT: Readonly<Record<PermissionStatus, string>> = {
  granted: 'Allowed',
  'not-asked': 'Not allowed yet',
  denied: 'Not allowed yet',
  never_ask_again: 'Missing: turn it on in App info',
};

export type PermissionScreenProps = {
  readonly ports: GatewayPorts;
  /** Called once when every required permission is granted. */
  readonly onDone: () => void;
  /** Defaults to the live `PermissionsAndroid` adapter. */
  readonly permissions?: PermissionsAdapter;
  /** Clock for the Restricted_Settings heuristic. */
  readonly now?: () => number;
};

type PermissionModel = {
  readonly required: readonly PermissionId[];
  readonly statuses: PermissionStatuses;
  readonly asked: boolean;
  readonly restricted: boolean;
  readonly requestMissing: () => void;
};

async function checkAll(adapter: PermissionsAdapter, ids: readonly PermissionId[]): Promise<Partial<Record<PermissionId, boolean>>> {
  const out: Partial<Record<PermissionId, boolean>> = {};
  for (const id of ids) {
    try {
      out[id] = await adapter.check(id);
    } catch {
      out[id] = false;
    }
  }
  return out;
}

async function nativeBlocked(ports: GatewayPorts): Promise<boolean> {
  try {
    return await ports.device.isRestrictedSettingsBlocked();
  } catch {
    return false;
  }
}

function usePermissionModel(ports: GatewayPorts, adapter: PermissionsAdapter, now: () => number): PermissionModel {
  const required = useRef(adapter.required()).current;
  const [statuses, setStatuses] = useState<PermissionStatuses>(() => initialStatuses(required));
  const [asked, setAsked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [heuristic, setHeuristic] = useState(false);
  const live = useRef(true);
  const current = useRef(statuses);
  const busy = useRef(false);

  const update = useCallback((next: PermissionStatuses) => {
    current.current = next;
    if (live.current) setStatuses(next);
  }, []);

  const refresh = useCallback(async () => {
    const [granted, isBlocked] = await Promise.all([checkAll(adapter, required), nativeBlocked(ports)]);
    if (!live.current) return;
    update(mergeChecked(current.current, granted));
    setBlocked(isBlocked);
  }, [adapter, ports, required, update]);

  const restrictedNow = (blocked || heuristic) && !smsGranted(statuses);

  const requestMissing = useCallback(() => {
    // After Restricted_Settings is lifted, Android shows the dialog again even for
    // permissions it had marked never_ask_again, so those are asked again too.
    const missing = missingPermissions(current.current, required);
    const ids = restrictedNow ? missing : missing.filter((id) => current.current[id] !== 'never_ask_again');
    if (busy.current || ids.length === 0) return;
    busy.current = true;
    const firstAsk = !asked;
    setAsked(true);
    const started = now();
    adapter
      .request(ids)
      .then((results) => {
        if (looksRestricted(firstAsk, now() - started, results) && live.current) setHeuristic(true);
        update(mergeRequested(current.current, ids, results));
      })
      .catch(() => undefined)
      .then(refresh)
      .finally(() => {
        busy.current = false;
      });
  }, [adapter, asked, now, refresh, required, restrictedNow, update]);

  useEffect(() => {
    live.current = true;
    refresh().catch(() => undefined);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh().catch(() => undefined);
    });
    return () => {
      live.current = false;
      sub.remove();
    };
  }, [refresh]);

  return { required, statuses, asked, restricted: restrictedNow, requestMissing };
}

// ---------------------------------------------------------------- view parts

function ActionButton({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function PermissionCard({ id, status }: { id: PermissionId; status: PermissionStatus }): React.JSX.Element {
  const granted = status === 'granted';
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{PERMISSION_NAMES[id]}</Text>
      <Text style={styles.body}>{PERMISSION_EXPLANATIONS[id]}</Text>
      <Text style={[styles.status, granted ? styles.ok : styles.missing]}>{STATUS_TEXT[status]}</Text>
    </View>
  );
}

function AskAgainList({ ids }: { ids: readonly PermissionId[] }): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.name}>Still needed</Text>
      {ids.map((id) => (
        <View key={id} style={styles.item}>
          <Text style={styles.label}>{PERMISSION_NAMES[id]}</Text>
          <Text style={styles.body}>{PERMISSION_EXPLANATIONS[id]}</Text>
        </View>
      ))}
    </View>
  );
}

function RestrictedSteps({ onAppInfo }: { onAppInfo: () => void }): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.body}>{RESTRICTED_INTRO}</Text>
      {RESTRICTED_STEPS.map((step, i) => (
        <Text key={step} style={styles.body}>{`${i + 1}. ${step}`}</Text>
      ))}
      <ActionButton label="Open App info" onPress={onAppInfo} />
    </View>
  );
}

function NeverAskAgain({ onAppInfo }: { onAppInfo: () => void }): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.body}>{NEVER_ASK_AGAIN_TEXT}</Text>
      <ActionButton label="Open App info" onPress={onAppInfo} />
    </View>
  );
}

function useOnDone(done: boolean, onDone: () => void): void {
  const called = useRef(false);
  useEffect(() => {
    if (!done || called.current) return;
    called.current = true;
    onDone();
  }, [done, onDone]);
}

// ---------------------------------------------------------------- screen

export function PermissionScreen({ ports, onDone, permissions, now = Date.now }: PermissionScreenProps): React.JSX.Element {
  const adapter = useRef(permissions ?? createAndroidPermissions()).current;
  const model = usePermissionModel(ports, adapter, now);
  const { required, statuses, asked, restricted } = model;
  useOnDone(allGranted(statuses, required), onDone);

  const askable = askAgainPermissions(statuses, required);
  const neverAsk = missingPermissions(statuses, required).some((id) => statuses[id] === 'never_ask_again');
  const showAskAgain = asked && askable.length > 0;
  const canRequest = askable.length > 0 || restricted;
  const openAppInfo = (): void => {
    ports.device.openAppInfo().catch(() => undefined);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        Necromancer needs your permission
      </Text>
      {required.map((id) => (
        <PermissionCard key={id} id={id} status={statuses[id]} />
      ))}
      {showAskAgain ? <AskAgainList ids={askable} /> : null}
      {restricted ? <RestrictedSteps onAppInfo={openAppInfo} /> : null}
      {neverAsk && !restricted ? <NeverAskAgain onAppInfo={openAppInfo} /> : null}
      <Text style={styles.privacy}>{PRIVACY_STATEMENT}</Text>
      {canRequest ? <ActionButton label={asked ? 'Ask again' : 'Continue'} onPress={model.requestMissing} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.title, color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius, padding: spacing.lg, gap: spacing.sm },
  item: { gap: spacing.xs },
  name: { ...typography.label, color: colors.text },
  label: { ...typography.label, color: colors.text },
  body: { ...typography.body, color: colors.text },
  status: { ...typography.label },
  ok: { color: colors.soul },
  missing: { color: colors.ember },
  privacy: { ...typography.body, color: colors.muted },
  button: {
    backgroundColor: colors.soul,
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  buttonText: { ...typography.label, color: colors.bg },
});
