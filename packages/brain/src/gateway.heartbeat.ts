// Heartbeat_Model (necromancer-sms-gateway design, "Heartbeat_Model").
// Pure: the state is derived only from its three inputs (Requirement 13).
import { SLEEP_REASONS } from './gateway.types.js';
import type { DeviceStatus, Heartbeat, ServiceStatus, SleepReason } from './gateway.types.js';

type ReasonCheck = (device: DeviceStatus, service: ServiceStatus) => boolean;

/** When each Sleep_Reason applies (Requirement 13.13, 13.14). */
const APPLIES: Readonly<Record<SleepReason, ReasonCheck>> = {
  'paused-by-operator': (_d, s) => s === 'paused',
  'no-sms-permission': (d) => !d.smsPermission,
  'no-notification-permission': (d) => !d.notificationPermission,
  'service-stopped': (_d, s) => s === 'stopped',
  'airplane-mode': (d) => d.airplaneMode,
  'no-signal': (d) => !d.airplaneMode && !d.inService,
  'battery-optimised': (d) => !d.batteryOptimisationIgnored,
};

/**
 * SLEEPING with the first applying reason in SLEEP_REASONS order, even while
 * sending (13.3); otherwise SENDING when sending (13.2), else ALIVE (13.1).
 */
export function deriveHeartbeat(
  device: DeviceStatus,
  service: ServiceStatus,
  sending: boolean,
): Heartbeat {
  const reason = SLEEP_REASONS.find((r) => APPLIES[r](device, service));
  if (reason !== undefined) return { state: 'SLEEPING', reason };
  return sending ? { state: 'SENDING' } : { state: 'ALIVE' };
}
