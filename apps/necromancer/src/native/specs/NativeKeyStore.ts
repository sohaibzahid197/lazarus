import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * `status` is 'present' | 'absent' | 'unreadable'; `key` is set only when present.
 * The key crosses only as this promise result: this module has no event emitters,
 * so the key is never part of an event payload. Never log a KeyRead.
 */
export type KeyRead = { status: string; key: string | null };

export interface Spec extends TurboModule {
  readKey(): Promise<KeyRead>;
  /** Replaces unreadable data too (Requirement 16.21). */
  saveKey(key: string): Promise<void>;
  deleteKey(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeKeyStore');
