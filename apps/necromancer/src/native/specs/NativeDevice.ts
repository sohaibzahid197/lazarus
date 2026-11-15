import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type DeviceStatusPayload = {
  smsPermission: boolean;
  notificationPermission: boolean;
  batteryOptimisationIgnored: boolean;
  inService: boolean;
  airplaneMode: boolean;
};

export interface Spec extends TurboModule {
  getDeviceStatus(): Promise<DeviceStatusPayload>;
  isRestrictedSettingsBlocked(): Promise<boolean>;
  openAppInfo(): Promise<void>;
  /** false → App info was opened instead. */
  openAutostart(): Promise<boolean>;
  /** false → battery settings were opened instead. */
  requestIgnoreBatteryOptimisation(): Promise<boolean>;
  openAirplaneSettings(): Promise<void>;
  openMobileNetworkSettings(): Promise<void>;
  readonly onDeviceStatus: CodegenTypes.EventEmitter<DeviceStatusPayload>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeDevice');
