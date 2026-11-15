// Live settings reload for the running gateway loop (Requirement 15.1, 15.6).
//
// The Settings_Screen and the `LazarusGateway` headless task run in the same JS
// runtime (the Gateway_Service hosts its task in the app's shared ReactHost), so a
// module-level channel is enough. After the Settings_Screen has saved a change
// (`store.saveSettings` or a `store.commit` of allow-add / allow-remove resolved),
// it calls `settingsSync.publish(...)`; the loop applies the update to its
// in-memory Gateway_State, so the next message uses it without a service restart.
// Publish only after the write succeeded, so memory never gets ahead of storage.
import type { GatewaySettings, StateChange } from '@lazarus/brain';

export interface SettingsUpdate {
  /** The full saved Gateway_Settings, replacing the loop's copy. */
  readonly settings?: GatewaySettings;
  /** Saved Allowlist edits; any other change type is ignored. */
  readonly allowlistChanges?: readonly StateChange[];
}

export type SettingsListener = (update: SettingsUpdate) => void;

export interface SettingsSync {
  publish(update: SettingsUpdate): void;
  subscribe(listener: SettingsListener): () => void;
}

export function createSettingsSync(): SettingsSync {
  const listeners = new Set<SettingsListener>();
  return {
    publish(update) {
      for (const listener of [...listeners]) listener(update);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app-wide channel shared by the Settings_Screen and the gateway loop. */
export const settingsSync: SettingsSync = createSettingsSync();

/** Keeps only Allowlist edits, so a published update can never touch the Stop_List or counters. */
export function allowlistOnly(changes: readonly StateChange[]): StateChange[] {
  return changes.filter((c) => c.type === 'allow-add' || c.type === 'allow-remove');
}
