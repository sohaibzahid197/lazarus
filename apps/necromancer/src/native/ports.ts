// Typed ports over the four TurboModules (necromancer-sms-gateway design, "JS glue").
// Every native payload is decoded here, at the trust boundary. Decoders never throw:
// malformed fields are dropped or replaced with safe defaults, and the one log line
// they write names the problem and, at most, a Masked_Sender (Requirement 14.6).
// No log line ever holds an SMS body, a full number or any character of the
// Gemini_Api_Key (Requirement 16.14).
//
// The TurboModule specs call `TurboModuleRegistry.getEnforcing` when they load, so
// they are required only inside `createLivePorts()`. Tests can import the decoders
// and the `GatewayPorts` type without mocking native modules.
import {
  COMMANDS,
  OUTCOMES,
  decodePendingStopRecord,
  decodeStoredState,
  maskSender,
  serializeChanges,
  type ActivityEntry,
  type CanonicalNumber,
  type Command,
  type DecodedState,
  type DeviceStatus,
  type InboundMessage,
  type Outcome,
  type PartResult,
  type PendingStopRecord,
  type SendReport,
  type ServiceStatus,
  type StateChange,
} from '@lazarus/brain';
import type { Spec as GatewaySpec } from './specs/NativeGateway';
import type { Spec as StoreSpec } from './specs/NativeStore';
import type { Spec as DeviceSpec } from './specs/NativeDevice';
import type { Spec as KeyStoreSpec } from './specs/NativeKeyStore';

/** Receives one line; callers must never pass a body, a full number or a key. */
export type LogFn = (line: string) => void;
export type Unsubscribe = () => void;

/** Decoded `readKey()` result. The key exists only on 'present'; never log this value. */
export type KeyStatus =
  | { readonly status: 'present'; readonly key: string }
  | { readonly status: 'absent' }
  | { readonly status: 'unreadable' };

export type SetupMarkStep = 'autostart' | 'recents';
export interface SetupMarks {
  readonly autostart: boolean;
  readonly recents: boolean;
}

export interface GatewayPort {
  startService(): Promise<void>;
  pauseService(): Promise<void>;
  resumeService(): Promise<void>;
  getServiceStatus(): Promise<ServiceStatus>;
  attachLoop(): void;
  /** Oldest valid Inbound_Message, or null when the queue is empty. */
  takeNextInbound(): Promise<InboundMessage | null>;
  /** Resolves on the next `onInboundAvailable` (or at once if one arrived since the last wait). */
  waitForInbound(): Promise<void>;
  completeInbound(id: string): Promise<void>;
  sendParts(sendId: string, number: CanonicalNumber, parts: readonly string[]): Promise<SendReport>;
  cancelPendingSends(number: CanonicalNumber): Promise<number>;
  /** Valid records only; rejected rows stay in storage (design, "Pending_Stop_Record wire format"). */
  takePendingStops(): Promise<PendingStopRecord[]>;
  updateNotification(stateWord: string, repliedToday: number): void;
  onInboundAvailable(listener: () => void): Unsubscribe;
  onSendState(listener: (sending: boolean) => void): Unsubscribe;
  onServiceStatus(listener: (status: ServiceStatus) => void): Unsubscribe;
}

export interface StorePort {
  /**
   * Rejects when the Stop_List cannot be read (Requirement 3.11).
   * `today` is `localDayKey(...)` for the counters reset.
   */
  loadState(today: string): Promise<DecodedState>;
  commit(changes: readonly StateChange[]): Promise<void>;
  saveSettings(raw: string): Promise<void>;
  appendActivity(entry: ActivityEntry): Promise<void>;
  applyPendingStop(
    id: number,
    changes: readonly StateChange[],
    entry: ActivityEntry,
  ): Promise<boolean>;
  savePendingStop(sender: string, receivedAt: number): Promise<void>;
  loadActivity(): Promise<ActivityEntry[]>;
  clearActivity(): Promise<void>;
  getSetupMarks(): Promise<SetupMarks>;
  setSetupMark(step: SetupMarkStep, done: boolean): Promise<void>;
}

export interface DevicePort {
  /** null when the payload is not an object ("phone status unreadable" banner). */
  getDeviceStatus(): Promise<DeviceStatus | null>;
  isRestrictedSettingsBlocked(): Promise<boolean>;
  openAppInfo(): Promise<void>;
  openAutostart(): Promise<boolean>;
  requestIgnoreBatteryOptimisation(): Promise<boolean>;
  openAirplaneSettings(): Promise<void>;
  openMobileNetworkSettings(): Promise<void>;
  onDeviceStatus(listener: (status: DeviceStatus | null) => void): Unsubscribe;
}

export interface KeyStorePort {
  /** Never rejects: a failed read is 'unreadable' (Requirement 16.20). */
  readKey(): Promise<KeyStatus>;
  saveKey(key: string): Promise<void>;
  deleteKey(): Promise<void>;
}

/** One object Jest can mock (Requirement 18.11). */
export interface GatewayPorts {
  readonly gateway: GatewayPort;
  readonly store: StorePort;
  readonly device: DevicePort;
  readonly keyStore: KeyStorePort;
}

// ---------------------------------------------------------------- helpers

type JsonRecord = Record<string, unknown>;

const PART_RESULTS: readonly PartResult[] = ['sent', 'failed-radio', 'failed-no-service', 'failed-other'];
const SERVICE_STATUSES: readonly ServiceStatus[] = ['running', 'stopped', 'paused'];
const ACTIVITY_COMMANDS: readonly string[] = [...COMMANDS, 'NONE'];
const OUTCOME_LIST: readonly string[] = OUTCOMES;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** " (from ••••567)" when the payload has a string sender, else "". */
function fromPart(raw: unknown): string {
  if (!isRecord(raw) || typeof raw.sender !== 'string') return '';
  return ` (from ${maskSender(raw.sender)})`;
}

function isPartResult(value: unknown): value is PartResult {
  return typeof value === 'string' && (PART_RESULTS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------- decoders

/** Strict: any missing or wrong-typed field drops the whole message (it cannot be processed). */
export function decodeInbound(raw: unknown, log: LogFn): InboundMessage | null {
  if (raw === null || raw === undefined) return null;
  if (isRecord(raw)) {
    const { id, seq, sender, body, receivedAt } = raw;
    const valid =
      typeof id === 'string' &&
      id.length > 0 &&
      typeof seq === 'number' &&
      Number.isSafeInteger(seq) &&
      typeof sender === 'string' &&
      typeof body === 'string' &&
      isTime(receivedAt);
    if (valid) return { id, seq, sender, body, receivedAt };
  }
  log(`ports: dropped malformed inbound${fromPart(raw)}`);
  return null;
}

/** Id of a malformed inbound payload, so the live port can complete (drop) it. */
export function inboundIdOf(raw: unknown): string | null {
  return isRecord(raw) && typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
}

/** Results are fitted to `partCount`: bad or missing entries become 'failed-other'. */
function fitResults(raw: unknown, partCount: number): { results: PartResult[]; bad: boolean } {
  const list = Array.isArray(raw) ? raw : [];
  let bad = !Array.isArray(raw) || list.length !== partCount;
  const results: PartResult[] = [];
  for (let i = 0; i < partCount; i++) {
    const r: unknown = list[i];
    if (isPartResult(r)) results.push(r);
    else {
      results.push('failed-other');
      bad = true;
    }
  }
  return { results, bad };
}

/**
 * Unknown status → 'done' with every part 'failed-other' (never counted as sent).
 * Attempts other than 1 or 2 → 1.
 */
export function decodeSendReport(raw: unknown, partCount: number, log: LogFn): SendReport {
  const status = isRecord(raw) ? raw.status : undefined;
  if (status === 'refused-stopped' || status === 'cancelled') return { status };
  const known = status === 'done';
  const { results, bad } = fitResults(isRecord(raw) ? raw.results : undefined, partCount);
  const attemptsRaw = isRecord(raw) ? raw.attempts : undefined;
  const attempts: 1 | 2 = attemptsRaw === 2 ? 2 : 1;
  if (!known) {
    log('ports: malformed send report, parts counted as failed');
    return { status: 'done', results: results.map(() => 'failed-other'), attempts };
  }
  if (bad || (attemptsRaw !== 1 && attemptsRaw !== 2)) log('ports: send report fields dropped');
  return { status: 'done', results, attempts };
}

/** Not an object → null. A non-boolean field → false, so the Heartbeat shows the fix. */
export function decodeDeviceStatus(raw: unknown, log: LogFn): DeviceStatus | null {
  if (!isRecord(raw)) {
    log('ports: device status unreadable');
    return null;
  }
  const dropped: string[] = [];
  const pick = (field: keyof DeviceStatus): boolean => {
    const v = raw[field];
    if (typeof v === 'boolean') return v;
    dropped.push(field);
    return false;
  };
  const status: DeviceStatus = {
    smsPermission: pick('smsPermission'),
    notificationPermission: pick('notificationPermission'),
    batteryOptimisationIgnored: pick('batteryOptimisationIgnored'),
    inService: pick('inService'),
    airplaneMode: pick('airplaneMode'),
  };
  if (dropped.length > 0) log(`ports: device status fields dropped: ${dropped.join(', ')}`);
  return status;
}

/** 'present' needs a non-empty string key; anything malformed is 'unreadable'. Never logs the key. */
export function decodeKeyRead(raw: unknown, log: LogFn): KeyStatus {
  if (isRecord(raw)) {
    const { status, key } = raw;
    if (status === 'present' && typeof key === 'string' && key.length > 0) {
      return { status: 'present', key };
    }
    if (status === 'absent') return { status: 'absent' };
    if (status === 'unreadable') return { status: 'unreadable' };
  }
  log('ports: key read malformed, treated as unreadable');
  return { status: 'unreadable' };
}

/** `{"autostart":bool,"recents":bool}`; a missing or wrong-typed mark is false. */
export function decodeSetupMarks(raw: unknown, log: LogFn): SetupMarks {
  const parsed = safeJson(raw);
  const rec = isRecord(parsed) ? parsed : {};
  const autostart = rec.autostart === true;
  const recents = rec.recents === true;
  const ok = typeof rec.autostart === 'boolean' && typeof rec.recents === 'boolean';
  if (!ok) log('ports: setup marks fields dropped');
  return { autostart, recents };
}

export function decodeServiceStatus(raw: unknown, log: LogFn): ServiceStatus {
  if (typeof raw === 'string' && (SERVICE_STATUSES as readonly string[]).includes(raw)) {
    return raw as ServiceStatus;
  }
  log('ports: service status unreadable, treated as stopped');
  return 'stopped';
}

/** Invalid rows are skipped (and stay in storage) with one masked line each. */
export function decodePendingStops(raw: unknown, log: LogFn): PendingStopRecord[] {
  const parsed = safeJson(raw);
  if (!Array.isArray(parsed)) {
    log('ports: pending stops unreadable');
    return [];
  }
  const out: PendingStopRecord[] = [];
  for (const item of parsed as unknown[]) {
    const record = decodePendingStopRecord(item);
    if (record !== null) out.push(record);
    else log(`ports: skipped malformed pending stop${fromPart(item)}`);
  }
  return out;
}

function decodeActivityEntry(raw: unknown): ActivityEntry | null {
  if (!isRecord(raw)) return null;
  const { receivedAt, who, command, outcome } = raw;
  if (!isTime(receivedAt) || typeof who !== 'string') return null;
  if (typeof command !== 'string' || !ACTIVITY_COMMANDS.includes(command)) return null;
  if (typeof outcome !== 'string' || !OUTCOME_LIST.includes(outcome)) return null;
  return { receivedAt, who, command: command as Command | 'NONE', outcome: outcome as Outcome };
}

/** Malformed entries are dropped; a non-array payload is an empty log. */
export function decodeActivity(raw: unknown, log: LogFn): ActivityEntry[] {
  const parsed = safeJson(raw);
  if (!Array.isArray(parsed)) {
    log('ports: activity log unreadable');
    return [];
  }
  const out: ActivityEntry[] = [];
  let dropped = 0;
  for (const item of parsed as unknown[]) {
    const entry = decodeActivityEntry(item);
    if (entry === null) dropped++;
    else out.push(entry);
  }
  if (dropped > 0) log(`ports: dropped ${dropped} malformed activity entries`);
  return out;
}

export function decodeCount(raw: unknown): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
}

// ---------------------------------------------------------------- live implementation

interface NativeModules {
  readonly gateway: GatewaySpec;
  readonly store: StoreSpec;
  readonly device: DeviceSpec;
  readonly keyStore: KeyStoreSpec;
}

function loadNativeModules(): NativeModules {
  // Lazy: each spec calls TurboModuleRegistry.getEnforcing when it loads.
  const gateway = require('./specs/NativeGateway') as typeof import('./specs/NativeGateway');
  const store = require('./specs/NativeStore') as typeof import('./specs/NativeStore');
  const device = require('./specs/NativeDevice') as typeof import('./specs/NativeDevice');
  const keyStore = require('./specs/NativeKeyStore') as typeof import('./specs/NativeKeyStore');
  return {
    gateway: gateway.default,
    store: store.default,
    device: device.default,
    keyStore: keyStore.default,
  };
}

/** Wake-up signal that cannot lose an event fired before `wait()` is called. */
function createInboundSignal(): { notify: () => void; wait: () => Promise<void> } {
  let pending = false;
  let waiter: (() => void) | null = null;
  return {
    notify: () => {
      if (waiter === null) {
        pending = true;
        return;
      }
      const resolve = waiter;
      waiter = null;
      resolve();
    },
    wait: () => {
      if (pending) {
        pending = false;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiter = resolve;
      });
    },
  };
}

function liveGateway(native: GatewaySpec, log: LogFn): GatewayPort {
  const signal = createInboundSignal();
  native.onInboundAvailable(() => signal.notify());
  const takeNextInbound = async (): Promise<InboundMessage | null> => {
    for (;;) {
      const raw: unknown = await native.takeNextInbound();
      if (raw === null || raw === undefined) return null;
      const msg = decodeInbound(raw, log);
      if (msg !== null) return msg;
      const id = inboundIdOf(raw);
      if (id === null) return null;
      await native.completeInbound(id); // drop the malformed row and try the next one
    }
  };
  return {
    startService: () => native.startService(),
    pauseService: () => native.pauseService(),
    resumeService: () => native.resumeService(),
    getServiceStatus: async () => decodeServiceStatus(await native.getServiceStatus(), log),
    attachLoop: () => native.attachLoop(),
    takeNextInbound,
    waitForInbound: () => signal.wait(),
    completeInbound: (id) => native.completeInbound(id),
    sendParts: async (sendId, number, parts) =>
      decodeSendReport(await native.sendParts(sendId, number, [...parts]), parts.length, log),
    cancelPendingSends: async (number) => decodeCount(await native.cancelPendingSends(number)),
    takePendingStops: async () => decodePendingStops(await native.takePendingStops(), log),
    updateNotification: (stateWord, repliedToday) =>
      native.updateNotification(stateWord, repliedToday),
    onInboundAvailable: (listener) => {
      const sub = native.onInboundAvailable(() => listener());
      return () => sub.remove();
    },
    onSendState: (listener) => {
      const sub = native.onSendState((sending: unknown) => listener(sending === true));
      return () => sub.remove();
    },
    onServiceStatus: (listener) => {
      const sub = native.onServiceStatus((s: unknown) => listener(decodeServiceStatus(s, log)));
      return () => sub.remove();
    },
  };
}

function liveStore(native: StoreSpec, log: LogFn): StorePort {
  return {
    loadState: async (today) => decodeStoredState(await native.loadState(), today),
    commit: (changes) => native.commit(serializeChanges(changes)),
    saveSettings: (raw) => native.saveSettings(raw),
    appendActivity: (entry) => native.appendActivity(JSON.stringify(entry)),
    applyPendingStop: async (id, changes, entry) =>
      (await native.applyPendingStop(id, serializeChanges(changes), JSON.stringify(entry))) === true,
    savePendingStop: (sender, receivedAt) => native.savePendingStop(sender, receivedAt),
    loadActivity: async () => decodeActivity(await native.loadActivity(), log),
    clearActivity: () => native.clearActivity(),
    getSetupMarks: async () => decodeSetupMarks(await native.getSetupMarks(), log),
    setSetupMark: (step, done) => native.setSetupMark(step, done),
  };
}

function liveDevice(native: DeviceSpec, log: LogFn): DevicePort {
  return {
    getDeviceStatus: async () => decodeDeviceStatus(await native.getDeviceStatus(), log),
    isRestrictedSettingsBlocked: async () => (await native.isRestrictedSettingsBlocked()) === true,
    openAppInfo: () => native.openAppInfo(),
    openAutostart: async () => (await native.openAutostart()) === true,
    requestIgnoreBatteryOptimisation: async () =>
      (await native.requestIgnoreBatteryOptimisation()) === true,
    openAirplaneSettings: () => native.openAirplaneSettings(),
    openMobileNetworkSettings: () => native.openMobileNetworkSettings(),
    onDeviceStatus: (listener) => {
      const sub = native.onDeviceStatus((s: unknown) => listener(decodeDeviceStatus(s, log)));
      return () => sub.remove();
    },
  };
}

function liveKeyStore(native: KeyStoreSpec, log: LogFn): KeyStorePort {
  return {
    readKey: async () => {
      try {
        return decodeKeyRead(await native.readKey(), log);
      } catch {
        log('ports: key read failed, treated as unreadable'); // no error text: it could echo the key
        return { status: 'unreadable' };
      }
    },
    saveKey: (key) => native.saveKey(key),
    deleteKey: () => native.deleteKey(),
  };
}

const defaultLog: LogFn = (line) => console.warn(line);

/** Builds the ports over the real TurboModules. Call once, from app code only. */
export function createLivePorts(log: LogFn = defaultLog): GatewayPorts {
  const native = loadNativeModules();
  return {
    gateway: liveGateway(native.gateway, log),
    store: liveStore(native.store, log),
    device: liveDevice(native.device, log),
    keyStore: liveKeyStore(native.keyStore, log),
  };
}
