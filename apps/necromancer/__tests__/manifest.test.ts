/**
 * Static checks on the Android manifest and backup rules.
 * Requirements 16.22 (no backup of app data), 17.4 (required permissions),
 * 17.5 (forbidden permissions never declared); sms-reminders 11.8 (SCHEDULE_EXACT_ALARM
 * declared, USE_EXACT_ALARM never), 12.9 (reminder table covered by the `database` exclusion).
 */
type Fs = {
  readFileSync: (path: string, encoding: 'utf8') => string;
  existsSync: (path: string) => boolean;
};
type Path = { join: (...parts: string[]) => string };
/** Jest runs on Node; the app tsconfig has no Node types (`require` comes from RN's globals). */
declare const __dirname: string;
const fs = require('node:fs') as Fs;
const path = require('node:path') as Path;

const MAIN = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
const manifest = fs.readFileSync(path.join(MAIN, 'AndroidManifest.xml'), 'utf8');
const extractionRules = fs.readFileSync(
  path.join(MAIN, 'res', 'xml', 'data_extraction_rules.xml'),
  'utf8',
);

/** XML with comments stripped, so commented-out tags never count. */
function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/** Every opening (or self-closing) tag with the given element name. */
function tags(xml: string, name: string): string[] {
  return stripComments(xml).match(new RegExp(`<${name}\\b[^>]*>`, 'g')) ?? [];
}

function attr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.:]/g, '\\$&');
  return new RegExp(`\\s${escaped}="([^"]*)"`).exec(tag)?.[1];
}

/** The element with the given android:name, or undefined. */
function byName(xml: string, element: string, name: string): string | undefined {
  return tags(xml, element).find(t => attr(t, 'android:name') === name);
}

const P = 'android.permission.';
const declared = tags(manifest, 'uses-permission')
  .filter(t => attr(t, 'tools:node') !== 'remove')
  .map(t => attr(t, 'android:name'));

describe('permissions', () => {
  const required = [
    'RECEIVE_SMS',
    'SEND_SMS',
    'POST_NOTIFICATIONS',
    'RECEIVE_BOOT_COMPLETED',
    'FOREGROUND_SERVICE',
    'FOREGROUND_SERVICE_SPECIAL_USE',
    'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    'WAKE_LOCK',
    'INTERNET',
    'SCHEDULE_EXACT_ALARM',
  ];
  const forbidden = [
    'READ_SMS',
    'WRITE_SMS',
    'READ_CONTACTS',
    'ACCESS_FINE_LOCATION',
    'ACCESS_COARSE_LOCATION',
    'USE_EXACT_ALARM',
  ];

  test.each(required)('%s is declared', perm => {
    expect(declared).toContain(P + perm);
  });

  test('the declared permission set is exactly the required set', () => {
    expect([...declared].sort()).toEqual(required.map(p => P + p).sort());
  });

  test.each(forbidden)('%s is only present as tools:node="remove"', perm => {
    expect(declared).not.toContain(P + perm);
    const removal = byName(manifest, 'uses-permission', P + perm);
    expect(removal && attr(removal, 'tools:node')).toBe('remove');
  });
});

describe('gateway service', () => {
  test('uses the specialUse foreground service type with a subtype', () => {
    const service = byName(manifest, 'service', '.gateway.GatewayService');
    expect(service).toBeDefined();
    expect(attr(service ?? '', 'android:foregroundServiceType')).toBe('specialUse');
    expect(attr(service ?? '', 'android:exported')).toBe('false');
    const subtype = byName(manifest, 'property', 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE');
    expect(subtype).toBeDefined();
    expect((attr(subtype ?? '', 'android:value') ?? '').trim()).not.toBe('');
  });
});

describe('receivers', () => {
  test('SmsReceiver requires BROADCAST_SMS', () => {
    const receiver = byName(manifest, 'receiver', '.gateway.SmsReceiver');
    expect(receiver).toBeDefined();
    expect(attr(receiver ?? '', 'android:permission')).toBe(P + 'BROADCAST_SMS');
  });

  test('SendResultReceiver is not exported', () => {
    const receiver = byName(manifest, 'receiver', '.gateway.SendResultReceiver');
    expect(receiver).toBeDefined();
    expect(attr(receiver ?? '', 'android:exported')).toBe('false');
  });
});

describe('reminder receivers', () => {
  const JAVA = path.join(MAIN, 'java', 'dev', 'lazarus', 'necromancer', 'reminder');

  /** The full <receiver>...</receiver> (or self-closing) element for a name. */
  function receiverBlock(name: string): string | undefined {
    const xml = stripComments(manifest);
    const re = /<receiver\b[^>]*?(?:\/>|>[\s\S]*?<\/receiver>)/g;
    return xml.match(re)?.find(b => attr(b, 'android:name') === name);
  }

  function actions(block: string): (string | undefined)[] {
    return tags(block, 'action').map(t => attr(t, 'android:name'));
  }

  test.each(['ReminderAlarmReceiver', 'ReminderEventsReceiver'])(
    '%s class file exists',
    cls => {
      expect(fs.existsSync(path.join(JAVA, `${cls}.kt`))).toBe(true);
    },
  );

  test('ReminderAlarmReceiver is not exported and has no intent-filter', () => {
    const block = receiverBlock('.reminder.ReminderAlarmReceiver');
    expect(block).toBeDefined();
    expect(attr(block ?? '', 'android:exported')).toBe('false');
    expect(tags(block ?? '', 'intent-filter')).toHaveLength(0);
  });

  test('ReminderEventsReceiver is exported for the three system broadcasts only', () => {
    const block = receiverBlock('.reminder.ReminderEventsReceiver');
    expect(block).toBeDefined();
    expect(attr(block ?? '', 'android:exported')).toBe('true');
    expect([...actions(block ?? '')].sort()).toEqual(
      [
        'android.intent.action.TIME_SET',
        'android.intent.action.TIMEZONE_CHANGED',
        'android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED',
      ].sort(),
    );
  });

  test('BootReceiver still handles BOOT_COMPLETED and MY_PACKAGE_REPLACED', () => {
    const block = receiverBlock('.gateway.BootReceiver');
    expect(block).toBeDefined();
    expect(attr(block ?? '', 'android:exported')).toBe('true');
    expect([...actions(block ?? '')].sort()).toEqual(
      ['android.intent.action.BOOT_COMPLETED', 'android.intent.action.MY_PACKAGE_REPLACED'].sort(),
    );
  });
});

describe('backup', () => {
  const app = tags(manifest, 'application')[0] ?? '';

  test('Auto Backup is off and extraction rules are set', () => {
    expect(attr(app, 'android:allowBackup')).toBe('false');
    expect(attr(app, 'android:fullBackupContent')).toBe('false');
    expect(attr(app, 'android:dataExtractionRules')).toBe('@xml/data_extraction_rules');
  });

  test.each(['cloud-backup', 'device-transfer'])('%s excludes all app data', section => {
    const body = new RegExp(`<${section}>([\\s\\S]*?)</${section}>`).exec(
      stripComments(extractionRules),
    )?.[1];
    expect(body).toBeDefined();
    const domains = tags(body ?? '', 'exclude').map(t => attr(t, 'domain'));
    expect(domains).toEqual(expect.arrayContaining(['sharedpref', 'database', 'file', 'root']));
  });
});
