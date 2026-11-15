// Gateway_Module core types (necromancer-sms-gateway design, "Core types").
// No type here other than InboundMessage carries the SMS body text
// (Requirement 14.7): GatewayDecision never holds it, and no StateChange holds it
// except `reminder-add`, whose Reminder carries the Reminder_Text taken from a
// REMIND body (sms-reminders design, "Reminder_Store_Model").
import { DELIVERY_OUTCOMES } from './reminder.types.js';
import type {
  DeliveryOutcome,
  Reminder,
  ReminderId,
  ReminderState,
} from './reminder.types.js';
import type { Command, Language } from './router.types.js';

/** E.164-style number, validated by isCanonicalNumber: /^\+[1-9]\d{6,14}$/. */
export type CanonicalNumber = string & { readonly __brand: 'CanonicalNumber' };

export type SenderIdentity =
  | { readonly kind: 'phone'; readonly number: CanonicalNumber }
  | { readonly kind: 'automated'; readonly masked: string };

/** Every Final_Outcome an Inbound_Message can end with (Requirement 7.4). */
export const OUTCOMES = [
  'replied',
  'stopped',
  'started',
  'ignored-stopped',
  'ignored-not-allowed',
  'ignored-automated',
  'ignored-own-number',
  'ignored-paused',
  'rate-limited',
  'send-capped',
  'send-failed',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface InboundMessage {
  readonly id: string; // native row id, opaque
  readonly seq: number; // creation order from the Sms_Receiver
  readonly sender: string; // Sender_Address exactly as Android reported it
  readonly body: string; // kept in memory only
  readonly receivedAt: number; // ms since epoch, phone clock
}

export interface GatewaySettings {
  readonly allowlistMode: boolean;
  readonly perNumberLimit: number; // 1..60
  readonly rateWindowMinutes: number; // 1..1440
  readonly dailySendCap: number; // 1..2000
  readonly defaultCountryCode: string; // /^[1-9]\d{0,2}$/
  readonly ownNumber: CanonicalNumber | null;
}

export interface DayCounters {
  readonly dayKey: string; // 'YYYY-MM-DD' in local time
  readonly received: number; // all Inbound_Messages
  readonly repliesSent: number; // outcomes replied + started (Requirement 13.12)
  readonly replied: number; // outcome replied only (notification, Requirement 9.2)
  readonly partsSent: number; // parts reported 'sent'
  readonly ignored: number; // outcomes starting with 'ignored-'
  readonly handed: number; // parts reserved for the Sms_Sender (Daily_Send_Cap basis)
}

export interface GatewayState {
  readonly stopList: ReadonlySet<CanonicalNumber>;
  readonly allowlist: ReadonlySet<CanonicalNumber> | 'unreadable';
  readonly rate: ReadonlyMap<CanonicalNumber, readonly number[]>; // accepted receive times
  readonly slowDown: ReadonlyMap<CanonicalNumber, number>; // receive time of last Slow_Down_Text
  readonly counters: DayCounters;
  readonly settings: GatewaySettings;
  readonly reminders: ReminderState; // Reminder_Store (sms-reminders Requirement 12.7)
}

export interface PipelineContext {
  readonly paused: boolean;
  readonly today: string; // localDayKey(receivedAt, tzOffsetMinutes) computed by the glue
}

export type StateChange =
  | { readonly type: 'stop-add'; readonly number: CanonicalNumber }
  | { readonly type: 'stop-remove'; readonly number: CanonicalNumber }
  | { readonly type: 'rate-record'; readonly number: CanonicalNumber; readonly at: number }
  | { readonly type: 'slowdown-record'; readonly number: CanonicalNumber; readonly at: number }
  | { readonly type: 'counters'; readonly counters: DayCounters }
  | { readonly type: 'allow-add'; readonly number: CanonicalNumber }
  | { readonly type: 'allow-remove'; readonly number: CanonicalNumber }
  /** The only StateChange carrying body-derived text (the Reminder_Text). */
  | { readonly type: 'reminder-add'; readonly reminder: Reminder }
  | { readonly type: 'reminder-remove'; readonly id: ReminderId }
  | { readonly type: 'reminder-remove-all'; readonly number: CanonicalNumber }
  | { readonly type: 'reminder-handed'; readonly id: ReminderId; readonly at: number };

export interface GatewayDecision {
  readonly messageId: string;
  readonly receivedAt: number;
  readonly sender: SenderIdentity;
  readonly command: Command | null; // null when the router was not called
  readonly language: Language;
  readonly outcome: Outcome; // provisional when parts.length > 0
  readonly parts: readonly string[]; // 0..4
  readonly changes: readonly StateChange[];
}

export type PartResult = 'sent' | 'failed-radio' | 'failed-no-service' | 'failed-other';

export type SendReport =
  | { readonly status: 'done'; readonly results: readonly PartResult[]; readonly attempts: 1 | 2 }
  | { readonly status: 'refused-stopped' }
  | { readonly status: 'cancelled' }; // removed from the hold queue after STOP (Requirement 3.9)

export interface FinalOutcome {
  readonly outcome: Outcome;
  readonly partsSent: number;
  readonly changes: readonly StateChange[]; // counters update (and handed release on refuse/cancel)
}

export interface ActivityEntry {
  readonly receivedAt: number;
  readonly who: string; // maskNumber(...) or maskSender(...)
  readonly command: Command | 'NONE'; // 'NONE' when the router did not run
  readonly outcome: ActivityOutcome;
}

/**
 * Every outcome an Activity_Entry can hold: Final_Outcomes, Delivery_Outcomes and
 * `reminders-failed` (reminder processing failed, sms-reminders Requirement 11.15).
 */
export const ACTIVITY_OUTCOMES = [...OUTCOMES, ...DELIVERY_OUTCOMES, 'reminders-failed'] as const;
export type ActivityOutcome = Outcome | DeliveryOutcome | 'reminders-failed';

/** Sleep reasons in priority order (Requirement 13.3). */
export const SLEEP_REASONS = [
  'paused-by-operator',
  'no-sms-permission',
  'no-notification-permission',
  'service-stopped',
  'airplane-mode',
  'no-signal',
  'battery-optimised',
] as const;
export type SleepReason = (typeof SLEEP_REASONS)[number];

export interface DeviceStatus {
  readonly smsPermission: boolean; // RECEIVE_SMS and SEND_SMS
  readonly notificationPermission: boolean;
  readonly batteryOptimisationIgnored: boolean;
  readonly inService: boolean;
  readonly airplaneMode: boolean;
}

export type ServiceStatus = 'running' | 'stopped' | 'paused';

/** A reason exists if and only if the state is SLEEPING (Requirement 13.4). */
export type Heartbeat =
  | { readonly state: 'ALIVE' }
  | { readonly state: 'SENDING' }
  | { readonly state: 'SLEEPING'; readonly reason: SleepReason };
