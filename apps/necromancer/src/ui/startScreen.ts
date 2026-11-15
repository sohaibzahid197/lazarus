// Start screen choice and Setup_Step done marks (necromancer-sms-gateway design, "Screens").
// Pure functions: no React, no native calls. SetupScreen reuses `setupStepsDone`.
import type { DeviceStatus } from '@lazarus/brain';
import type { KeyStatus, SetupMarks } from '../native/ports';

export type StartScreen = 'permission' | 'setup' | 'main';

/** The 3 runtime permissions the gateway needs (Requirement 11.1). */
export interface StartPermissions {
  readonly receiveSms: boolean;
  readonly sendSms: boolean;
  readonly postNotifications: boolean;
}

/** The 6 Setup_Steps in screen order (Requirement 12.1). */
export const SETUP_STEPS = [
  'restricted-settings',
  'permissions',
  'ai-key',
  'autostart',
  'battery',
  'recents',
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number];

export type SetupStepMarks = Readonly<Record<SetupStepId, boolean>>;

/** Device_Status reports RECEIVE_SMS and SEND_SMS together as `smsPermission`. */
export function permissionsFromStatus(status: DeviceStatus | null): StartPermissions {
  const sms = status?.smsPermission === true;
  return {
    receiveSms: sms,
    sendSms: sms,
    postNotifications: status?.notificationPermission === true,
  };
}

export function allPermissionsGranted(perms: StartPermissions): boolean {
  return perms.receiveSms && perms.sendSms && perms.postNotifications;
}

/**
 * Done marks per Requirement 12.6 and 12.7. Live steps come from Device_Status and the
 * key store; an unreadable status (null) or key marks those steps not done.
 * Autostart and recents are the Operator's persisted manual marks.
 */
export function setupStepsDone(
  status: DeviceStatus | null,
  marks: SetupMarks,
  keyStatus: KeyStatus,
): SetupStepMarks {
  const sms = status?.smsPermission === true;
  const notifications = status?.notificationPermission === true;
  return {
    'restricted-settings': sms,
    permissions: sms && notifications,
    'ai-key': keyStatus.status === 'present',
    autostart: marks.autostart,
    battery: status?.batteryOptimisationIgnored === true,
    recents: marks.recents,
  };
}

export function allSetupStepsDone(steps: SetupStepMarks): boolean {
  return SETUP_STEPS.every((id) => steps[id]);
}

/**
 * Permission_Screen while any permission is missing (11.1), then Setup_Screen while
 * any Setup_Step is not done, then Main_Screen (12.13).
 */
export function chooseStartScreen(perms: StartPermissions, setupMarks: SetupStepMarks): StartScreen {
  if (!allPermissionsGranted(perms)) return 'permission';
  if (!allSetupStepsDone(setupMarks)) return 'setup';
  return 'main';
}
