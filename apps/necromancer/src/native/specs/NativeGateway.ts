import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/** One Inbound_Message handed from the native InboxQueue to the JS loop. */
export type InboundPayload = {
  id: string;
  seq: number;
  sender: string;
  body: string;
  receivedAt: number;
};

/** Result of one sendParts call; `status` and `results` are decoded by ports.ts. */
export type SendReportPayload = {
  status: string;
  results: string[];
  attempts: number;
};

export interface Spec extends TurboModule {
  startService(): Promise<void>;
  /** Persists paused=1, stops the service, removes the notification. */
  pauseService(): Promise<void>;
  /** Persists paused=0, starts the service. */
  resumeService(): Promise<void>;
  /** 'running' | 'stopped' | 'paused' */
  getServiceStatus(): Promise<string>;
  /** JS loop is ready; the receiver may now queue in memory. */
  attachLoop(): void;
  takeNextInbound(): Promise<InboundPayload | null>;
  completeInbound(id: string): Promise<void>;
  /** Native side re-checks the Stop_List before every attempt (Requirement 3.8). */
  sendParts(
    sendId: string,
    number: string,
    parts: string[],
  ): Promise<SendReportPayload>;
  /** Removes queued and retry-waiting sends for the number; resolves the count (Requirement 3.9). */
  cancelPendingSends(number: string): Promise<number>;
  /** JSON array of pending_stop rows, decoded by decodePendingStopRecord. */
  takePendingStops(): Promise<string>;
  updateNotification(stateWord: string, repliedToday: number): void;
  readonly onInboundAvailable: CodegenTypes.EventEmitter<void>;
  readonly onSendState: CodegenTypes.EventEmitter<boolean>;
  readonly onServiceStatus: CodegenTypes.EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeGateway');
