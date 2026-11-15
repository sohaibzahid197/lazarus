// Recording `GatewayPorts` mock for Jest (Requirement 18.11).
// Every async method reads its result from a `Script`: queued steps (values or
// rejections) are used first, then a default that behaves like a healthy phone.
// Every call is appended to `calls` in order, with its arguments as given. The log
// lives only in test memory, so it may hold bodies; it is never written anywhere.
import {
  STOP_MARKER,
  decodeStoredState,
  type DecodedState,
  type DeviceStatus,
  type InboundMessage,
  type PendingStopRecord,
  type SendReport,
  type ServiceStatus,
} from '@lazarus/brain';
import type {
  DevicePort,
  GatewayPort,
  GatewayPorts,
  KeyStatus,
  KeyStorePort,
  StorePort,
  Unsubscribe,
} from '../../src/native/ports';

// ---------------------------------------------------------------- scripts

export type Step<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

/** Results for one method: queued steps first, then the default. */
export class Script<T, A extends readonly unknown[]> {
  private readonly queue: Step<T>[] = [];

  constructor(private fallback: (...args: A) => T | Promise<T>) {}

  /** Queue one resolved value per argument, used in order. */
  resolve(...values: T[]): this {
    for (const value of values) this.queue.push({ ok: true, value });
    return this;
  }

  /** Queue `times` rejections with `error`. */
  reject(error: Error | string = 'scripted failure', times = 1): this {
    const err = typeof error === 'string' ? new Error(error) : error;
    for (let i = 0; i < times; i++) this.queue.push({ ok: false, error: err });
    return this;
  }

  /** Replace the default used once the queue is empty. */
  setDefault(fallback: (...args: A) => T | Promise<T>): this {
    this.fallback = fallback;
    return this;
  }

  /** Every call rejects from now on (until `setDefault`). */
  alwaysReject(error: Error | string = 'scripted failure'): this {
    const err = typeof error === 'string' ? new Error(error) : error;
    return this.setDefault(() => Promise.reject(err));
  }

  get queued(): number {
    return this.queue.length;
  }

  next(args: A): Promise<T> {
    const step = this.queue.shift();
    if (step === undefined) return Promise.resolve(this.fallback(...args));
    return step.ok ? Promise.resolve(step.value) : Promise.reject(step.error);
  }
}

type AllMethods = GatewayPort & StorePort & DevicePort & KeyStorePort;

/** Names of the methods that return a Promise. */
export type AsyncMethod = {
  [K in keyof AllMethods]: AllMethods[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof AllMethods];

export type ArgsOf<K extends AsyncMethod> = AllMethods[K] extends (...args: infer A) => unknown
  ? A
  : never;
export type ResultOf<K extends AsyncMethod> = AllMethods[K] extends (
  ...args: never[]
) => Promise<infer R>
  ? R
  : never;

type Fallback<K extends AsyncMethod> = (...args: ArgsOf<K>) => ResultOf<K> | Promise<ResultOf<K>>;

export type Scripts = { readonly [K in AsyncMethod]: Script<ResultOf<K>, ArgsOf<K>> };

// ---------------------------------------------------------------- call log

export type PortName = keyof GatewayPorts;
export type MethodName = keyof AllMethods;

export interface CallRecord {
  readonly port: PortName;
  readonly method: MethodName;
  readonly args: readonly unknown[];
}

// ---------------------------------------------------------------- defaults

export const MOCK_TODAY = '2026-01-15';
export const MOCK_KEY = 'AIzaMockKey000000000000000000000000000';

/** An empty, readable state (no stops, default settings, not paused). */
export function emptyState(today: string = MOCK_TODAY): DecodedState {
  return decodeStoredState(JSON.stringify({ stopList: [] }), today);
}

export const HEALTHY_DEVICE: DeviceStatus = {
  smsPermission: true,
  notificationPermission: true,
  batteryOptimisationIgnored: true,
  inService: true,
  airplaneMode: false,
};

/** Every part sent on the first attempt. */
export function allSent(partCount: number): SendReport {
  return { status: 'done', results: Array.from({ length: partCount }, () => 'sent'), attempts: 1 };
}

export function inbound(
  id: string,
  sender: string,
  body: string,
  receivedAt = 1_000,
  seq = Number(id.replace(/\D/g, '')) || 0,
): InboundMessage {
  return { id, seq, sender, body, receivedAt };
}

// ---------------------------------------------------------------- mock

export interface MockPorts {
  readonly ports: GatewayPorts;
  readonly scripts: Scripts;
  /** Ordered log of every call on every port. */
  readonly calls: CallRecord[];
  /** Messages `takeNextInbound` hands out (default behaviour), oldest first. */
  readonly inbox: InboundMessage[];
  /** Stored Pending_Stop_Records; removed only when `applyPendingStop` resolves true. */
  readonly pendingStops: PendingStopRecord[];
  /** Method names in call order, optionally only those in `only`. */
  names(only?: readonly MethodName[]): MethodName[];
  callsTo(method: MethodName): CallRecord[];
  clearCalls(): void;
  /** Adds messages to the inbox and fires `onInboundAvailable`, like the Sms_Receiver. */
  pushInbound(...messages: InboundMessage[]): void;
  /** Stores a record as the Sms_Receiver would; returns its id. */
  addPendingStop(sender: string, receivedAt: number): number;
  emitInboundAvailable(): void;
  emitSendState(sending: boolean): void;
  emitServiceStatus(status: ServiceStatus): void;
  emitDeviceStatus(status: DeviceStatus | null): void;
  /** Lets queued promise callbacks run (works with fake timers). */
  settle(rounds?: number): Promise<void>;
}

type Listener<T> = (value: T) => void;

class Listeners<T> {
  private readonly set = new Set<Listener<T>>();
  add(listener: Listener<T>): Unsubscribe {
    this.set.add(listener);
    return () => {
      this.set.delete(listener);
    };
  }
  emit(value: T): void {
    for (const l of [...this.set]) l(value);
  }
  get size(): number {
    return this.set.size;
  }
}

/** Same contract as the live port: an event fired before `waitForInbound` is not lost. */
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

interface MockState {
  readonly inbox: InboundMessage[];
  readonly pendingStops: PendingStopRecord[];
  readonly signal: ReturnType<typeof createInboundSignal>;
  nextStopId: number;
}

function createScripts(s: MockState): Scripts {
  const done = (): void => undefined;
  const script = <K extends AsyncMethod>(_method: K, fallback: Fallback<K>): Script<ResultOf<K>, ArgsOf<K>> =>
    new Script<ResultOf<K>, ArgsOf<K>>(fallback);
  return {
    // gateway
    startService: script('startService', done),
    pauseService: script('pauseService', done),
    resumeService: script('resumeService', done),
    getServiceStatus: script('getServiceStatus', (): ServiceStatus => 'running'),
    takeNextInbound: script('takeNextInbound', () => s.inbox.shift() ?? null),
    waitForInbound: script('waitForInbound', () => s.signal.wait()),
    completeInbound: script('completeInbound', done),
    sendParts: script('sendParts', (_id, _number, parts) => allSent(parts.length)),
    cancelPendingSends: script('cancelPendingSends', () => 0),
    takePendingStops: script('takePendingStops', () => s.pendingStops.map((r) => ({ ...r }))),
    // store
    loadState: script('loadState', (today) => emptyState(today)),
    commit: script('commit', done),
    saveSettings: script('saveSettings', done),
    appendActivity: script('appendActivity', done),
    applyPendingStop: script('applyPendingStop', () => true),
    savePendingStop: script('savePendingStop', done),
    loadActivity: script('loadActivity', () => []),
    clearActivity: script('clearActivity', done),
    getSetupMarks: script('getSetupMarks', () => ({ autostart: false, recents: false })),
    setSetupMark: script('setSetupMark', done),
    // device
    getDeviceStatus: script('getDeviceStatus', (): DeviceStatus | null => HEALTHY_DEVICE),
    isRestrictedSettingsBlocked: script('isRestrictedSettingsBlocked', () => false),
    openAppInfo: script('openAppInfo', done),
    openAutostart: script('openAutostart', () => true),
    requestIgnoreBatteryOptimisation: script('requestIgnoreBatteryOptimisation', () => true),
    openAirplaneSettings: script('openAirplaneSettings', done),
    openMobileNetworkSettings: script('openMobileNetworkSettings', done),
    // keyStore
    readKey: script('readKey', (): KeyStatus => ({ status: 'present', key: MOCK_KEY })),
    saveKey: script('saveKey', done),
    deleteKey: script('deleteKey', done),
  };
}

export function createMockPorts(): MockPorts {
  const state: MockState = {
    inbox: [],
    pendingStops: [],
    signal: createInboundSignal(),
    nextStopId: 1,
  };
  const scripts = createScripts(state);
  const calls: CallRecord[] = [];
  const inboundL = new Listeners<void>();
  const sendStateL = new Listeners<boolean>();
  const serviceL = new Listeners<ServiceStatus>();
  const deviceL = new Listeners<DeviceStatus | null>();

  const record = (port: PortName, method: MethodName, args: readonly unknown[]): void => {
    calls.push({ port, method, args });
  };
  const call = <K extends AsyncMethod>(port: PortName, method: K, args: ArgsOf<K>) => {
    record(port, method, args);
    const script: Script<ResultOf<K>, ArgsOf<K>> = scripts[method];
    return script.next(args);
  };
  const addPendingStop = (sender: string, receivedAt: number): number => {
    const id = state.nextStopId++;
    state.pendingStops.push({ id, sender, marker: STOP_MARKER, receivedAt });
    return id;
  };
  const emitInboundAvailable = (): void => {
    state.signal.notify();
    inboundL.emit();
  };

  const gateway: GatewayPort = {
    startService: () => call('gateway', 'startService', []),
    pauseService: () => call('gateway', 'pauseService', []),
    resumeService: () => call('gateway', 'resumeService', []),
    getServiceStatus: () => call('gateway', 'getServiceStatus', []),
    attachLoop: () => record('gateway', 'attachLoop', []),
    takeNextInbound: () => call('gateway', 'takeNextInbound', []),
    waitForInbound: () => call('gateway', 'waitForInbound', []),
    completeInbound: (id) => call('gateway', 'completeInbound', [id]),
    sendParts: (sendId, number, parts) =>
      call('gateway', 'sendParts', [sendId, number, [...parts]]),
    cancelPendingSends: (number) => call('gateway', 'cancelPendingSends', [number]),
    takePendingStops: () => call('gateway', 'takePendingStops', []),
    updateNotification: (stateWord, repliedToday) =>
      record('gateway', 'updateNotification', [stateWord, repliedToday]),
    onInboundAvailable: (listener) => {
      record('gateway', 'onInboundAvailable', []);
      return inboundL.add(() => listener());
    },
    onSendState: (listener) => {
      record('gateway', 'onSendState', []);
      return sendStateL.add(listener);
    },
    onServiceStatus: (listener) => {
      record('gateway', 'onServiceStatus', []);
      return serviceL.add(listener);
    },
  };

  const store: StorePort = {
    loadState: (today) => call('store', 'loadState', [today]),
    commit: (changes) => call('store', 'commit', [[...changes]]),
    saveSettings: (raw) => call('store', 'saveSettings', [raw]),
    appendActivity: (entry) => call('store', 'appendActivity', [entry]),
    applyPendingStop: async (id, changes, entry) => {
      const applied = await call('store', 'applyPendingStop', [id, [...changes], entry]);
      if (applied) {
        const i = state.pendingStops.findIndex((r) => r.id === id);
        if (i >= 0) state.pendingStops.splice(i, 1);
      }
      return applied;
    },
    savePendingStop: async (sender, receivedAt) => {
      await call('store', 'savePendingStop', [sender, receivedAt]);
      addPendingStop(sender, receivedAt);
    },
    loadActivity: () => call('store', 'loadActivity', []),
    clearActivity: () => call('store', 'clearActivity', []),
    getSetupMarks: () => call('store', 'getSetupMarks', []),
    setSetupMark: (step, done) => call('store', 'setSetupMark', [step, done]),
  };

  const device: DevicePort = {
    getDeviceStatus: () => call('device', 'getDeviceStatus', []),
    isRestrictedSettingsBlocked: () => call('device', 'isRestrictedSettingsBlocked', []),
    openAppInfo: () => call('device', 'openAppInfo', []),
    openAutostart: () => call('device', 'openAutostart', []),
    requestIgnoreBatteryOptimisation: () =>
      call('device', 'requestIgnoreBatteryOptimisation', []),
    openAirplaneSettings: () => call('device', 'openAirplaneSettings', []),
    openMobileNetworkSettings: () => call('device', 'openMobileNetworkSettings', []),
    onDeviceStatus: (listener) => {
      record('device', 'onDeviceStatus', []);
      return deviceL.add(listener);
    },
  };

  const keyStore: KeyStorePort = {
    readKey: () => call('keyStore', 'readKey', []),
    saveKey: (key) => call('keyStore', 'saveKey', [key]),
    deleteKey: () => call('keyStore', 'deleteKey', []),
  };

  return {
    ports: { gateway, store, device, keyStore },
    scripts,
    calls,
    inbox: state.inbox,
    pendingStops: state.pendingStops,
    names: (only) =>
      calls.map((c) => c.method).filter((m) => only === undefined || only.includes(m)),
    callsTo: (method) => calls.filter((c) => c.method === method),
    clearCalls: () => {
      calls.length = 0;
    },
    pushInbound: (...messages) => {
      state.inbox.push(...messages);
      emitInboundAvailable();
    },
    addPendingStop,
    emitInboundAvailable,
    emitSendState: (sending) => sendStateL.emit(sending),
    emitServiceStatus: (status) => serviceL.emit(status),
    emitDeviceStatus: (status) => deviceL.emit(status),
    settle: async (rounds = 50) => {
      for (let i = 0; i < rounds; i++) await Promise.resolve();
    },
  };
}
