/**
 * Small adapter over React Native's `PermissionsAndroid` for the Permission_Screen
 * (Requirements 11.4 to 11.8), plus pure helpers the screen uses. Tests inject
 * their own `PermissionsAdapter`, so no native module is needed there.
 */
import { PermissionsAndroid, Platform, type Permission } from 'react-native';

export type PermissionId = 'receiveSms' | 'sendSms' | 'postNotifications';

/** Every permission the screen can show, in screen order. */
export const PERMISSION_IDS: readonly PermissionId[] = ['receiveSms', 'sendSms', 'postNotifications'];

/** Android's answer to one runtime request. */
export type RequestResult = 'granted' | 'denied' | 'never_ask_again';

/** What the screen shows for one permission. */
export type PermissionStatus = 'granted' | 'not-asked' | RequestResult;

export type PermissionStatuses = Readonly<Record<PermissionId, PermissionStatus>>;

export interface PermissionsAdapter {
  /** Permissions this Android version asks for at runtime. */
  required(): readonly PermissionId[];
  check(id: PermissionId): Promise<boolean>;
  /** Asks Android for exactly `ids`; ids missing from the answer count as 'denied'. */
  request(ids: readonly PermissionId[]): Promise<Partial<Record<PermissionId, RequestResult>>>;
}

/** POST_NOTIFICATIONS is a runtime permission from API 33 (Android 13). */
export const NOTIFICATIONS_MIN_API = 33;

/** A denial faster than this on the first ask, with no dialog, suggests Restricted_Settings. */
export const RESTRICTED_DENIAL_MS = 300;

const ANDROID_NAMES: Readonly<Record<PermissionId, Permission>> = {
  receiveSms: PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  sendSms: PermissionsAndroid.PERMISSIONS.SEND_SMS,
  postNotifications: PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
};

export function requiredForApi(api: number): readonly PermissionId[] {
  return api >= NOTIFICATIONS_MIN_API ? PERMISSION_IDS : ['receiveSms', 'sendSms'];
}

function androidApiLevel(): number {
  return Platform.OS === 'android' && typeof Platform.Version === 'number' ? Platform.Version : 0;
}

function toResult(raw: unknown): RequestResult {
  return raw === 'granted' || raw === 'never_ask_again' ? raw : 'denied';
}

/** The live adapter over `PermissionsAndroid`. */
export function createAndroidPermissions(api: number = androidApiLevel()): PermissionsAdapter {
  return {
    required: () => requiredForApi(api),
    check: (id) => PermissionsAndroid.check(ANDROID_NAMES[id]),
    request: async (ids) => {
      if (ids.length === 0) return {};
      const raw = await PermissionsAndroid.requestMultiple(ids.map((id) => ANDROID_NAMES[id]));
      const out: Partial<Record<PermissionId, RequestResult>> = {};
      for (const id of ids) out[id] = toResult(raw[ANDROID_NAMES[id]]);
      return out;
    },
  };
}

// ---------------------------------------------------------------- pure helpers

/** Permissions not shown as needed (old Android) count as granted. */
export function initialStatuses(required: readonly PermissionId[]): PermissionStatuses {
  return {
    receiveSms: required.includes('receiveSms') ? 'not-asked' : 'granted',
    sendSms: required.includes('sendSms') ? 'not-asked' : 'granted',
    postNotifications: required.includes('postNotifications') ? 'not-asked' : 'granted',
  };
}

/**
 * Merges a fresh `check()` result: granted wins; a permission that is no longer
 * granted keeps its last known denial, or becomes 'not-asked' if it was granted.
 */
export function mergeChecked(prev: PermissionStatuses, granted: Readonly<Partial<Record<PermissionId, boolean>>>): PermissionStatuses {
  const next = { ...prev };
  for (const id of PERMISSION_IDS) {
    const g = granted[id];
    if (g === true) next[id] = 'granted';
    else if (g === false && prev[id] === 'granted') next[id] = 'not-asked';
  }
  return next;
}

/** Applies request answers; an asked id with no answer counts as 'denied'. */
export function mergeRequested(
  prev: PermissionStatuses,
  asked: readonly PermissionId[],
  results: Readonly<Partial<Record<PermissionId, RequestResult>>>,
): PermissionStatuses {
  const next = { ...prev };
  for (const id of asked) next[id] = results[id] ?? 'denied';
  return next;
}

/** Ids still not granted, in screen order: the only ones the screen may request. */
export function missingPermissions(statuses: PermissionStatuses, required: readonly PermissionId[]): PermissionId[] {
  return PERMISSION_IDS.filter((id) => required.includes(id) && statuses[id] !== 'granted');
}

/** Ids Android still lets the app ask for again (Requirement 11.5). */
export function askAgainPermissions(statuses: PermissionStatuses, required: readonly PermissionId[]): PermissionId[] {
  return missingPermissions(statuses, required).filter((id) => statuses[id] !== 'never_ask_again');
}

export function allGranted(statuses: PermissionStatuses, required: readonly PermissionId[]): boolean {
  return missingPermissions(statuses, required).length === 0;
}

export function smsGranted(statuses: PermissionStatuses): boolean {
  return statuses.receiveSms === 'granted' && statuses.sendSms === 'granted';
}

/**
 * JS fallback for Restricted_Settings (design, `RestrictedSettings`): on the first
 * ask, an SMS permission was refused in under 300 ms, too fast for a dialog.
 */
export function looksRestricted(
  firstAsk: boolean,
  elapsedMs: number,
  results: Readonly<Partial<Record<PermissionId, RequestResult>>>,
): boolean {
  if (!firstAsk || elapsedMs >= RESTRICTED_DENIAL_MS) return false;
  const refused = (r: RequestResult | undefined): boolean => r !== undefined && r !== 'granted';
  return refused(results.receiveSms) || refused(results.sendSms);
}
