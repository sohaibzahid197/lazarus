/**
 * Main_Screen (necromancer-sms-gateway design, "Main_Screen" and "Heartbeat").
 *
 * - Heartbeat from brain's `deriveHeartbeat` (13.11); while SLEEPING, one
 *   sentence of at most 120 characters and one fix button per Sleep_Reason
 *   (13.7, 9.7, 9.9).
 * - 4 day counters: received, replies sent, parts sent, ignored (13.12).
 * - Banners: cap reached (5.9), AI key missing with a button to the AI key
 *   Setup_Step (16.19), Stop_List unreadable (3.11) or not saved (3.12),
 *   Allowlist unreadable (4.9), settings reset (15.5, dismissible), phone
 *   status unreadable after 5 s (13.15), reminders not saved (sms-reminders
 *   10.14), reminders can arrive late with an "Allow exact alarms" button,
 *   re-checked on every return to the foreground (sms-reminders 11.9).
 * - Reminder count row: the total of Active_Reminders, or the "could not be
 *   loaded" message in its place (sms-reminders 12.7, 13.6, 13.7).
 * - Activity_Log newest first with local time, masked `who`, Command and
 *   Outcome (14.4, 14.5); clear with a confirmation dialog (14.9 to 14.11).
 * - Start / pause / resume by service status (9.1, 9.5, 9.8), and buttons
 *   to Setup (12.10) and Settings.
 *
 * Privacy: the only per-sender text shown is the already masked `who`. The
 * reminder row shows a count only: no number and no Reminder_Text (13.2).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  deriveHeartbeat,
  type ActivityEntry,
  type DayCounters,
  type DeviceStatus,
  type Heartbeat as HeartbeatValue,
  type ServiceStatus,
  type SleepReason,
} from '@lazarus/brain';
import type { GatewayPorts, LogFn } from '../../native/ports';
import { showExactAlarmStatus } from '../../gateway/loopSupport';
import {
  DEVICE_STATUS_TIMEOUT_MS,
  gatewayStore,
  useGatewayStore,
  type Banner,
  type GatewayStore,
} from '../../gateway/store';
import { Heartbeat } from '../Heartbeat';
import { colors, radius, spacing, typography } from '../theme';

export const MAX_SLEEP_SENTENCE_LENGTH = 120;

/** One plain sentence per Sleep_Reason: the cause and the fix (13.7). */
export const SLEEP_SENTENCES: Readonly<Record<SleepReason, string>> = {
  'paused-by-operator': 'You paused the gateway, so no replies are sent. Tap Resume to start answering again.',
  'no-sms-permission': 'The SMS permission is missing, so messages cannot be read or answered. Tap to allow it.',
  'no-notification-permission':
    'The notification permission is missing, so Android may stop the gateway. Tap to allow it.',
  'service-stopped': 'The gateway is not running, so no replies are sent. Tap Start to run it again.',
  'airplane-mode': 'Airplane mode is on, so no SMS can come in or go out. Tap to turn it off.',
  'no-signal': 'The phone has no mobile signal, so no SMS can be sent. Tap to check the mobile network.',
  'battery-optimised': 'Battery saver may stop the gateway. Tap and choose No restrictions for this app.',
};

/** What the fix button does for each Sleep_Reason (13.7). */
export type SleepFixAction =
  | 'resume-service'
  | 'open-permissions'
  | 'start-service'
  | 'open-airplane-settings'
  | 'open-mobile-network-settings'
  | 'request-ignore-battery-optimisation';

export const SLEEP_FIXES: Readonly<Record<SleepReason, { readonly label: string; readonly action: SleepFixAction }>> = {
  'paused-by-operator': { label: 'Resume', action: 'resume-service' },
  'no-sms-permission': { label: 'Allow SMS', action: 'open-permissions' },
  'no-notification-permission': { label: 'Allow notifications', action: 'open-permissions' },
  'service-stopped': { label: 'Start', action: 'start-service' },
  'airplane-mode': { label: 'Open airplane mode settings', action: 'open-airplane-settings' },
  'no-signal': { label: 'Open mobile network settings', action: 'open-mobile-network-settings' },
  'battery-optimised': { label: 'Remove battery limits', action: 'request-ignore-battery-optimisation' },
};

/** Banner texts. `cap-reached` follows 5.9; the rest follow the design error table. */
export const BANNER_TEXT: Readonly<Record<Banner, string>> = {
  'stop-list-unreadable': 'Stop list could not be loaded, replies are paused.',
  'stop-list-save-failed': 'The stop list could not be saved. Replies still respect it until the app restarts.',
  'allowlist-unreadable': 'The allowlist could not be loaded. Only STOP and START are handled for now.',
  'settings-reset': 'Settings could not be read, so they were reset to defaults.',
  'cap-reached': 'The daily send cap is reached. Sending resumes at 00:00 local time tomorrow.',
  'ai-key-missing': 'The AI key is missing, so questions get a busy reply.',
  'phone-status-unreadable': 'The phone status could not be read.',
  'reminders-unreadable': 'Reminders could not be loaded.',
  'reminders-save-failed': 'Reminders could not be saved.',
  'reminders-may-be-late': 'Reminders can arrive late. Allow exact alarms to send them on time.',
};

const ERROR_BANNERS: readonly Banner[] = [
  'stop-list-unreadable',
  'stop-list-save-failed',
  'allowlist-unreadable',
  'phone-status-unreadable',
  'reminders-unreadable',
  'reminders-save-failed',
];
/**
 * Shown in the reminder count row instead of the banner list, so the message
 * stands in place of the count and is not repeated (sms-reminders 13.7).
 */
const ROW_BANNERS: readonly Banner[] = ['reminders-unreadable'];
export const REMINDER_ROW_TEXT = {
  label: 'Reminders waiting',
  loading: 'Loading reminders…',
} as const;

export const COUNTER_LABELS = {
  received: 'Messages received',
  repliesSent: 'Replies sent',
  partsSent: 'SMS parts sent',
  ignored: 'Messages ignored',
} as const;

type CounterKey = keyof typeof COUNTER_LABELS;
const COUNTER_KEYS: readonly CounterKey[] = ['received', 'repliesSent', 'partsSent', 'ignored'];

/**
 * Used only until the first Device_Status arrives: assume the phone is fine,
 * so the heartbeat follows the service status and the 5 s banner explains
 * a missing report (13.15).
 */
const ASSUMED_DEVICE: DeviceStatus = {
  smsPermission: true,
  notificationPermission: true,
  batteryOptimisationIgnored: true,
  inService: true,
  airplaneMode: false,
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local HH:mm (14.4). */
export function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export type MainScreenProps = {
  readonly ports: GatewayPorts;
  readonly store?: GatewayStore;
  readonly onOpenSetup: (step?: 'ai-key') => void;
  readonly onOpenSettings: () => void;
  readonly onOpenPermissions: () => void;
  /** Receive time formatter; defaults to local HH:mm. */
  readonly formatTime?: (ms: number) => string;
};

const ignore = (): undefined => undefined;
/** The exact alarm check logs only a fixed line; the screen has no log sink. */
const dropLog: LogFn = () => undefined;

// ---------------------------------------------------------------- effects

/** Asks for the Device_Status on mount and on foreground; 5 s timeout (13.11, 13.15). */
function useDeviceStatus(ports: GatewayPorts, store: GatewayStore): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    let live = true;
    const report = (status: DeviceStatus | null): void => {
      if (!live) return;
      if (status === null) {
        store.markDeviceStatusUnreadable();
        return;
      }
      clearTimer();
      store.setDeviceStatus(status);
    };
    const ask = (): void => {
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        if (live) store.markDeviceStatusUnreadable();
      }, DEVICE_STATUS_TIMEOUT_MS);
      ports.device.getDeviceStatus().then(report, ignore);
    };
    const unsubscribe = ports.device.onDeviceStatus(report);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') ask();
    });
    ask();
    return () => {
      live = false;
      clearTimer();
      unsubscribe();
      sub.remove();
    };
  }, [ports, store, clearTimer]);
}

function useServiceStatus(ports: GatewayPorts, store: GatewayStore): void {
  useEffect(() => {
    let live = true;
    const set = (status: ServiceStatus): void => {
      if (live) store.setServiceStatus(status);
    };
    const unsubscribe = ports.gateway.onServiceStatus(set);
    ports.gateway.getServiceStatus().then(set, ignore);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [ports, store]);
}

/** Checks Exact_Alarm_Access on mount and each time the app is active again (sms-reminders 11.9). */
function useExactAlarmStatus(ports: GatewayPorts, store: GatewayStore): void {
  useEffect(() => {
    const check = (): void => {
      showExactAlarmStatus(ports.reminders, store, dropLog).catch(ignore);
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    check();
    return () => sub.remove();
  }, [ports, store]);
}
function useActivityLoad(ports: GatewayPorts, store: GatewayStore): void {
  useEffect(() => {
    let live = true;
    ports.store.loadActivity().then((entries) => {
      if (live) store.setActivity(entries);
    }, ignore);
    return () => {
      live = false;
    };
  }, [ports, store]);
}

// ---------------------------------------------------------------- view parts

function ActionButton({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function SleepNotice({ reason, onFix }: { reason: SleepReason; onFix: () => void }): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.body}>{SLEEP_SENTENCES[reason]}</Text>
      <ActionButton label={SLEEP_FIXES[reason].label} onPress={onFix} />
    </View>
  );
}

function BannerCard({ banner, children }: { banner: Banner; children?: React.ReactNode }): React.JSX.Element {
  const error = ERROR_BANNERS.includes(banner);
  return (
    <View accessibilityRole="alert" style={styles.card}>
      <Text style={[styles.label, error ? styles.error : styles.warn]}>{BANNER_TEXT[banner]}</Text>
      {children}
    </View>
  );
}

function Banners(props: {
  banners: readonly Banner[];
  onOpenAiKey: () => void;
  onDismissReset: () => void;
  onAllowExactAlarms: () => void;
}): React.JSX.Element {
  return (
    <>
      {props.banners
        .filter((b) => !ROW_BANNERS.includes(b))
        .map((b) => (
          <BannerCard key={b} banner={b}>
            {b === 'ai-key-missing' ? <ActionButton label="Add AI key" onPress={props.onOpenAiKey} /> : null}
            {b === 'settings-reset' ? <ActionButton label="Dismiss" onPress={props.onDismissReset} /> : null}
            {b === 'reminders-may-be-late' ? (
              <ActionButton label="Allow exact alarms" onPress={props.onAllowExactAlarms} />
            ) : null}
          </BannerCard>
        ))}
    </>
  );
}
/** Count only, never a number or Reminder_Text (sms-reminders 13.2, 13.6, 13.7). */
function ReminderRow({ count, unreadable }: { count: number | null; unreadable: boolean }): React.JSX.Element {
  if (unreadable) {
    return (
      <View accessibilityRole="alert" style={styles.card}>
        <Text style={[styles.label, styles.error]}>{BANNER_TEXT['reminders-unreadable']}</Text>
      </View>
    );
  }
  if (count === null) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>{REMINDER_ROW_TEXT.loading}</Text>
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={`${REMINDER_ROW_TEXT.label}: ${count}`}
      style={styles.card}
    >
      <Text style={styles.counterValue}>{count}</Text>
      <Text style={styles.muted}>{REMINDER_ROW_TEXT.label}</Text>
    </View>
  );
}

function Counters({ counters }: { counters: DayCounters | null }): React.JSX.Element {
  return (
    <View style={styles.counters}>
      {COUNTER_KEYS.map((key) => {
        const value = counters?.[key] ?? 0;
        return (
          <View
            key={key}
            accessible
            accessibilityLabel={`${COUNTER_LABELS[key]} today: ${value}`}
            style={styles.counter}
          >
            <Text style={styles.counterValue}>{value}</Text>
            <Text style={styles.muted}>{COUNTER_LABELS[key]}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ActivityRow({ entry, formatTime }: { entry: ActivityEntry; formatTime: (ms: number) => string }): React.JSX.Element {
  const command = entry.command === 'NONE' ? 'no command' : entry.command;
  return (
    <View style={styles.row}>
      <Text style={styles.body}>{`${formatTime(entry.receivedAt)}  ${entry.who}`}</Text>
      <Text style={styles.muted}>{`${command} · ${entry.outcome}`}</Text>
    </View>
  );
}

function ActivityLog(props: {
  entries: readonly ActivityEntry[];
  formatTime: (ms: number) => string;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.label}>
        Activity
      </Text>
      {props.entries.length === 0 ? <Text style={styles.muted}>No activity yet.</Text> : null}
      {props.entries.map((e, i) => (
        <ActivityRow key={`${e.receivedAt}-${i}`} entry={e} formatTime={props.formatTime} />
      ))}
      {props.entries.length > 0 ? <ActionButton label="Clear activity" onPress={props.onClear} /> : null}
    </View>
  );
}

function ServiceControl({ status, ports }: { status: ServiceStatus; ports: GatewayPorts }): React.JSX.Element {
  if (status === 'running') {
    return <ActionButton label="Pause gateway" onPress={() => ports.gateway.pauseService().catch(ignore)} />;
  }
  if (status === 'paused') {
    return <ActionButton label="Resume gateway" onPress={() => ports.gateway.resumeService().catch(ignore)} />;
  }
  return <ActionButton label="Start gateway" onPress={() => ports.gateway.startService().catch(ignore)} />;
}

function runFix(action: SleepFixAction, ports: GatewayPorts, onOpenPermissions: () => void): void {
  switch (action) {
    case 'resume-service':
      ports.gateway.resumeService().catch(ignore);
      return;
    case 'start-service':
      ports.gateway.startService().catch(ignore);
      return;
    case 'open-permissions':
      onOpenPermissions();
      return;
    case 'open-airplane-settings':
      ports.device.openAirplaneSettings().catch(ignore);
      return;
    case 'open-mobile-network-settings':
      ports.device.openMobileNetworkSettings().catch(ignore);
      return;
    case 'request-ignore-battery-optimisation':
      ports.device.requestIgnoreBatteryOptimisation().catch(ignore);
      return;
  }
}

function confirmClear(ports: GatewayPorts, store: GatewayStore): void {
  Alert.alert('Clear activity?', 'This deletes every entry in the activity log.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Clear',
      style: 'destructive',
      onPress: () => {
        ports.store.clearActivity().then(() => store.clearActivity(), ignore);
      },
    },
  ]);
}

// ---------------------------------------------------------------- screen

export function MainScreen({
  ports,
  store = gatewayStore,
  onOpenSetup,
  onOpenSettings,
  onOpenPermissions,
  formatTime = formatLocalTime,
}: MainScreenProps): React.JSX.Element {
  useDeviceStatus(ports, store);
  useServiceStatus(ports, store);
  useActivityLoad(ports, store);
  useExactAlarmStatus(ports, store);
  const snap = useGatewayStore((s) => s, store);
  const heartbeat: HeartbeatValue = deriveHeartbeat(snap.deviceStatus ?? ASSUMED_DEVICE, snap.serviceStatus, snap.sending);
  const reason = heartbeat.state === 'SLEEPING' ? heartbeat.reason : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        Necromancer
      </Text>
      <Heartbeat heartbeat={heartbeat} inboundPulse={snap.inboundPulse} />
      {reason !== null ? (
        <SleepNotice reason={reason} onFix={() => runFix(SLEEP_FIXES[reason].action, ports, onOpenPermissions)} />
      ) : null}
      <Banners
        banners={snap.banners}
        onOpenAiKey={() => onOpenSetup('ai-key')}
        onDismissReset={() => store.setBanner('settings-reset', false)}
        onAllowExactAlarms={() => ports.reminders.openExactAlarmSettings().catch(ignore)}
      />
      <Counters counters={snap.counters} />
      <ReminderRow count={snap.reminderCount} unreadable={snap.banners.includes('reminders-unreadable')} />
      <ServiceControl status={snap.serviceStatus} ports={ports} />
      <ActivityLog entries={snap.activity} formatTime={formatTime} onClear={() => confirmClear(ports, store)} />
      <View style={styles.nav}>
        <ActionButton label="Setup" onPress={() => onOpenSetup()} />
        <ActionButton label="Settings" onPress={onOpenSettings} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.title, color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius, padding: spacing.lg, gap: spacing.sm },
  label: { ...typography.label, color: colors.text },
  body: { ...typography.body, color: colors.text },
  muted: { ...typography.body, color: colors.muted },
  error: { color: colors.blood },
  warn: { color: colors.ember },
  counters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  counter: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.surface,
    borderRadius: radius,
    padding: spacing.md,
    gap: spacing.xs,
  },
  counterValue: { ...typography.display, color: colors.text },
  row: { gap: spacing.xs, paddingVertical: spacing.xs },
  nav: { gap: spacing.sm },
  button: {
    backgroundColor: colors.soul,
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  buttonText: { ...typography.label, color: colors.bg },
});
