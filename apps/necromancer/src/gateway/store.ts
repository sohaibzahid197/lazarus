// UI store for the Main_Screen (necromancer-sms-gateway design, "UI store",
// "Main_Screen", "Heartbeat"). A small observable store read with React's
// `useSyncExternalStore`. Every change makes a new snapshot object; a call
// that changes nothing keeps the old snapshot, so React skips the render.
//
// Privacy (Requirements 14.1, 14.2): no phone number or message body enters
// this store. The only per-sender field is the masked `who` of an
// ActivityEntry, which brain's `buildActivityEntry` already masked.
import { useSyncExternalStore } from 'react';
import { ACTIVITY_LOG_MAX, trimActivityLog } from '@lazarus/brain';
import type { ActivityEntry, DayCounters, DeviceStatus, ServiceStatus } from '@lazarus/brain';

/** Requirement 13.15: how long the Main_Screen waits for a Device_Status. */
export const DEVICE_STATUS_TIMEOUT_MS = 5_000;

/** Main_Screen banners (design, "Main_Screen" and "Error handling"). */
export const BANNERS = [
  'stop-list-unreadable', // 3.11: Stop_List read failed, replies paused
  'stop-list-save-failed', // 3.12, 9.16: Stop_List write failed after retries
  'allowlist-unreadable', // 4.9: Allowlist read failed
  'settings-reset', // 15.5: settings unparseable, defaults used (dismissible)
  'cap-reached', // 5.9: Daily_Send_Cap reached
  'ai-key-missing', // 16.19: no or unreadable Gemini_Api_Key
  'phone-status-unreadable', // 13.15: no Device_Status within 5 s
  'reminders-unreadable', // sms-reminders 12.7, 13.7: Reminder_Store read failed
  'reminders-save-failed', // sms-reminders 10.14: reminder removal not saved after retries
  'reminders-may-be-late', // sms-reminders 11.9: no Exact_Alarm_Access on API 31+
] as const;
export type Banner = (typeof BANNERS)[number];

export interface GatewaySnapshot {
  /** Last reported Device_Status; null until the first report. */
  readonly deviceStatus: DeviceStatus | null;
  readonly serviceStatus: ServiceStatus;
  /** True while a multipart SMS is with the Sms_Sender (Requirement 13.2). */
  readonly sending: boolean;
  /** Null until the counters are loaded. */
  readonly counters: DayCounters | null;
  /** Active banners in BANNERS order. */
  readonly banners: readonly Banner[];
  /** Newest first, at most ACTIVITY_LOG_MAX entries (Requirements 14.3, 14.4). */
  readonly activity: readonly ActivityEntry[];
  /** Increases by 1 per received Inbound_Message; drives the extra pulse (13.6). */
  readonly inboundPulse: number;
  /**
   * Total Active_Reminders across all numbers (sms-reminders 13.6); null until
   * loaded or while the Reminder_Store is unreadable (13.7). Only a count: no
   * number or Reminder_Text enters this store (13.2, 13.3).
   */
  readonly reminderCount: number | null;
}

export interface GatewayStore {
  getSnapshot(): GatewaySnapshot;
  subscribe(listener: () => void): () => void;
  /** A Device_Status arrived: store it and clear 'phone-status-unreadable' (13.11, 13.15). */
  setDeviceStatus(status: DeviceStatus): void;
  /** No Device_Status within 5 s: keep the last one and show the banner (13.15). */
  markDeviceStatusUnreadable(): void;
  setServiceStatus(status: ServiceStatus): void;
  setSending(sending: boolean): void;
  setCounters(counters: DayCounters): void;
  setBanner(banner: Banner, on: boolean): void;
  /** Replaces the list, e.g. after reading the Activity_Log from storage. */
  setActivity(entries: readonly ActivityEntry[]): void;
  /** Adds one entry with brain's `trimActivityLog` (newest first, max 200). */
  addActivity(entry: ActivityEntry): void;
  clearActivity(): void;
  /** Mirrors `onInboundAvailable` for the Heartbeat's extra pulse (13.6). */
  pulseInbound(): void;
  /** Whole number from 0 upward, or null when the Reminder_Store is unreadable (13.6, 13.7). */
  setReminderCount(count: number | null): void;
}

const INITIAL: GatewaySnapshot = {
  deviceStatus: null,
  serviceStatus: 'stopped',
  sending: false,
  counters: null,
  banners: [],
  activity: [],
  inboundPulse: 0,
  reminderCount: null,
};

const DEVICE_KEYS: readonly (keyof DeviceStatus)[] = [
  'smsPermission',
  'notificationPermission',
  'batteryOptimisationIgnored',
  'inService',
  'airplaneMode',
];

const COUNTER_KEYS: readonly (keyof DayCounters)[] = [
  'dayKey',
  'received',
  'repliesSent',
  'replied',
  'partsSent',
  'ignored',
  'handed',
];

function sameFields<T extends object>(a: T | null, b: T, keys: readonly (keyof T)[]): boolean {
  return a !== null && keys.every((k) => a[k] === b[k]);
}

/** Copies only the DeviceStatus fields, so nothing else rides along. */
function copyDevice(s: DeviceStatus): DeviceStatus {
  return {
    smsPermission: s.smsPermission,
    notificationPermission: s.notificationPermission,
    batteryOptimisationIgnored: s.batteryOptimisationIgnored,
    inService: s.inService,
    airplaneMode: s.airplaneMode,
  };
}

function withBanner(banners: readonly Banner[], banner: Banner, on: boolean): readonly Banner[] {
  if (banners.includes(banner) === on) return banners;
  return BANNERS.filter((b) => (b === banner ? on : banners.includes(b)));
}

/** Newest first by receive time, keeping input order for ties, max 200. */
function orderActivity(entries: readonly ActivityEntry[]): ActivityEntry[] {
  return [...entries].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, ACTIVITY_LOG_MAX);
}

export function createGatewayStore(): GatewayStore {
  let snapshot = INITIAL;
  const listeners = new Set<() => void>();

  const update = (next: GatewaySnapshot): void => {
    if (next === snapshot) return;
    snapshot = next;
    for (const l of [...listeners]) l();
  };
  const patch = (changes: Partial<GatewaySnapshot>): void => update({ ...snapshot, ...changes });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setDeviceStatus(status) {
      const same = sameFields(snapshot.deviceStatus, status, DEVICE_KEYS);
      const banners = withBanner(snapshot.banners, 'phone-status-unreadable', false);
      if (same && banners === snapshot.banners) return;
      patch({ deviceStatus: same ? snapshot.deviceStatus : copyDevice(status), banners });
    },
    markDeviceStatusUnreadable() {
      const banners = withBanner(snapshot.banners, 'phone-status-unreadable', true);
      if (banners !== snapshot.banners) patch({ banners });
    },
    setServiceStatus(serviceStatus) {
      if (serviceStatus !== snapshot.serviceStatus) patch({ serviceStatus });
    },
    setSending(sending) {
      if (sending !== snapshot.sending) patch({ sending });
    },
    setCounters(counters) {
      if (!sameFields(snapshot.counters, counters, COUNTER_KEYS)) patch({ counters: { ...counters } });
    },
    setBanner(banner, on) {
      const banners = withBanner(snapshot.banners, banner, on);
      if (banners !== snapshot.banners) patch({ banners });
    },
    setActivity(entries) {
      if (entries.length === 0 && snapshot.activity.length === 0) return;
      patch({ activity: orderActivity(entries) });
    },
    addActivity(entry) {
      patch({ activity: trimActivityLog(snapshot.activity, entry) });
    },
    clearActivity() {
      if (snapshot.activity.length > 0) patch({ activity: [] });
    },
    pulseInbound() {
      patch({ inboundPulse: snapshot.inboundPulse + 1 });
    },
    setReminderCount(count) {
      const next = count === null || !Number.isSafeInteger(count) || count < 0 ? null : count;
      if (next !== snapshot.reminderCount) patch({ reminderCount: next });
    },
  };
}

/** The app-wide store used by the gateway glue and the screens. */
export const gatewayStore: GatewayStore = createGatewayStore();

const identity = (s: GatewaySnapshot): GatewaySnapshot => s;

/**
 * Reads the store in a component. The selector must return a value that is
 * stable between changes (a snapshot field, or a primitive derived from it),
 * otherwise React re-renders forever.
 */
export function useGatewayStore(): GatewaySnapshot;
export function useGatewayStore<T>(
  selector: (s: GatewaySnapshot) => T,
  store?: GatewayStore,
): T;
export function useGatewayStore<T>(
  selector?: (s: GatewaySnapshot) => T,
  store: GatewayStore = gatewayStore,
): T | GatewaySnapshot {
  const select = selector ?? identity;
  const read = (): T | GatewaySnapshot => select(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, read, read);
}
