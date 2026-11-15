import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** JSON; decoded by decodeStoredState. */
  loadState(): Promise<string>;
  /** Applies serialized changes in one SQLite transaction. */
  commit(changesJson: string): Promise<void>;
  saveSettings(raw: string): Promise<void>;
  /** Insert + trim to 200 entries in one transaction. */
  appendActivity(entryJson: string): Promise<void>;
  /**
   * One transaction: DELETE pending_stop row `id` (must delete 1 row, else roll back
   * and resolve false), apply changes, insert + trim activity. Rejects on any SQLite
   * error; the row then stays (Requirement 9.16).
   */
  applyPendingStop(
    id: number,
    changesJson: string,
    entryJson: string,
  ): Promise<boolean>;
  /**
   * Paused_Path_Task only: STOP routed but its commit failed after retries.
   * Stores sender, marker and receivedAt; never the body (Requirements 9.13, 14.13).
   */
  savePendingStop(sender: string, receivedAt: number): Promise<void>;
  loadActivity(): Promise<string>;
  clearActivity(): Promise<void>;
  /** {"autostart":bool,"recents":bool} */
  getSetupMarks(): Promise<string>;
  setSetupMark(step: string, done: boolean): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeStore');
