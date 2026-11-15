import type { DeviceStatus } from '@lazarus/brain';
import {
  SETUP_STEPS,
  chooseStartScreen,
  permissionsFromStatus,
  setupStepsDone,
  type SetupStepMarks,
  type StartPermissions,
} from '../src/ui/startScreen';

const allPerms: StartPermissions = { receiveSms: true, sendSms: true, postNotifications: true };
const allDone = Object.fromEntries(SETUP_STEPS.map((id) => [id, true])) as SetupStepMarks;

const okStatus: DeviceStatus = {
  smsPermission: true,
  notificationPermission: true,
  batteryOptimisationIgnored: true,
  inService: true,
  airplaneMode: false,
};

describe('chooseStartScreen', () => {
  it('shows the Permission_Screen while any permission is missing, even if steps are not done', () => {
    for (const key of ['receiveSms', 'sendSms', 'postNotifications'] as const) {
      const perms = { ...allPerms, [key]: false };
      expect(chooseStartScreen(perms, allDone)).toBe('permission');
      expect(chooseStartScreen(perms, { ...allDone, battery: false })).toBe('permission');
    }
  });

  it('shows the Setup_Screen when permissions are granted and any step is not done', () => {
    for (const id of SETUP_STEPS) {
      expect(chooseStartScreen(allPerms, { ...allDone, [id]: false })).toBe('setup');
    }
  });

  it('shows the Main_Screen when everything is granted and done', () => {
    expect(chooseStartScreen(allPerms, allDone)).toBe('main');
  });
});

describe('setupStepsDone', () => {
  const marks = { autostart: true, recents: true };

  it('marks all 6 steps done from live status, key and manual marks', () => {
    expect(setupStepsDone(okStatus, marks, { status: 'present', key: 'k' })).toEqual(allDone);
  });

  it('marks live steps not done when revoked, key unreadable or status null', () => {
    const steps = setupStepsDone(
      { ...okStatus, notificationPermission: false, batteryOptimisationIgnored: false },
      { autostart: false, recents: true },
      { status: 'unreadable' },
    );
    expect(steps).toEqual({
      'restricted-settings': true,
      permissions: false,
      'ai-key': false,
      autostart: false,
      battery: false,
      recents: true,
    });
    const none = setupStepsDone(null, marks, { status: 'absent' });
    expect(none['restricted-settings'] || none.permissions || none.battery || none['ai-key']).toBe(false);
  });

  it('maps Device_Status to the 3 permissions', () => {
    expect(permissionsFromStatus({ ...okStatus, smsPermission: false })).toEqual({
      receiveSms: false,
      sendSms: false,
      postNotifications: true,
    });
    expect(permissionsFromStatus(null).postNotifications).toBe(false);
  });
});
