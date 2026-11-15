/**
 * Static checks on the Android manifest and backup rules.
 * Requirements 16.22 (no backup of app data), 17.4 (required permissions),
 * 17.5 (forbidden permissions never declared).
 */
type Fs = { readFileSync: (path: string, encoding: 'utf8') => string };
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
  ];
  const forbidden = [
    'READ_SMS',
    'WRITE_SMS',
    'READ_CONTACTS',
    'ACCESS_FINE_LOCATION',
    'ACCESS_COARSE_LOCATION',
  ];

  test.each(required)('%s is declared', perm => {
    expect(declared).toContain(P + perm);
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
