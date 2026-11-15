/**
 * Settings_Screen (necromancer-sms-gateway design, "Settings_Screen" and D7).
 *
 * - Per_Number_Limit, Rate_Window, Daily_Send_Cap, Default_Country_Code and
 *   Own_Number are checked with brain's `validateSettingsField`; a rejected
 *   value keeps the old one and shows the allowed range (5.10, 5.11).
 * - Allowlist adds go through `addToAllowlist` with duplicate, invalid and
 *   full messages (4.4, 4.5, 4.10); entries can be removed (4.6).
 * - Allowlist, Stop_List and Own_Number are shown only as `maskNumber`
 *   output (4.7, 14.5). The Stop_List is read-only (15.6).
 * - A failed write shows "Change not saved" and keeps the old value (15.7).
 * - After every successful write the change is published on `settingsSync`,
 *   so the running loop uses it for the next message (15.9).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  ALLOWLIST_MAX,
  addToAllowlist,
  isCanonicalNumber,
  localDayKey,
  maskNumber,
  serializeSettings,
  validateSettingsField,
  type CanonicalNumber,
  type GatewaySettings,
  type SettingsField,
  type StateChange,
} from '@lazarus/brain';
import type { GatewayPorts } from '../../native/ports';
import { settingsSync as sharedSettingsSync, type SettingsSync } from '../../gateway/settingsSync';
import { colors, radius, spacing, typography } from '../theme';

export const NOT_SAVED_MESSAGE = 'Change not saved';
export const SAVED_MESSAGE = 'Saved';
export const ALLOWLIST_ADDED_MESSAGE = 'Added to the list';
export const ALLOWLIST_REMOVED_MESSAGE = 'Removed from the list';
export const ALLOWLIST_DUPLICATE_MESSAGE = 'Already on the list';
export const ALLOWLIST_INVALID_MESSAGE = 'Not a phone number. Enter a phone number of 7 to 15 digits.';
export const ALLOWLIST_FULL_MESSAGE = `The list is full (${ALLOWLIST_MAX} numbers)`;
export const ALLOWLIST_UNREADABLE_NOTICE =
  'The allowlist could not be loaded, so it cannot be changed now. Restart the app to try again.';
export const LOAD_FAILED_MESSAGE = 'Settings could not be loaded, so they cannot be changed now. Go back and try again.';
export const LOADING_MESSAGE = 'Loading settings…';
export const STOP_LIST_EMPTY = 'No number has texted STOP.';
export const ALLOWLIST_EMPTY = 'No numbers on the list yet.';
export const OWN_NUMBER_NOT_SET = 'Not set';

export const FIELD_LABELS: Readonly<Record<SettingsField, string>> = {
  perNumberLimit: 'Replies per number',
  rateWindowMinutes: 'Time window in minutes',
  dailySendCap: 'Daily SMS part cap',
  defaultCountryCode: 'Default country code',
  ownNumber: 'This phone number',
};
export const ALLOWLIST_MODE_LABEL = 'Allowlist mode';
export const ALLOWLIST_INPUT_LABEL = 'Number to allow';

const INTEGER_FIELDS = ['perNumberLimit', 'rateWindowMinutes', 'dailySendCap'] as const;
type IntegerField = (typeof INTEGER_FIELDS)[number];

/** The message for a rejected field, built from the range brain returned (5.11). */
export function rangeMessage(field: SettingsField, range: string): string {
  return (INTEGER_FIELDS as readonly string[]).includes(field) ? `Enter a number from ${range}` : `Enter ${range}`;
}

export type SettingsFeedback = {
  /** `saved`: written and published; `rejected`: failed a check; `not-saved`: the write failed. */
  readonly kind: 'saved' | 'rejected' | 'not-saved';
  readonly text: string;
};

const saved = (text: string): SettingsFeedback => ({ kind: 'saved', text });
const rejected = (text: string): SettingsFeedback => ({ kind: 'rejected', text });
const NOT_SAVED: SettingsFeedback = { kind: 'not-saved', text: NOT_SAVED_MESSAGE };

export type SettingsScreenProps = {
  readonly ports: GatewayPorts;
  readonly onBack: () => void;
  /** Day key for `loadState`; defaults to today in local time. */
  readonly today?: string;
  /** Defaults to the app-wide channel the gateway loop listens on. */
  readonly settingsSync?: SettingsSync;
};

// ---------------------------------------------------------------- model

type SettingsData = {
  readonly settings: GatewaySettings;
  readonly allowlist: ReadonlySet<CanonicalNumber> | 'unreadable';
  readonly stopList: readonly CanonicalNumber[];
};

type LoadState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'ready'; readonly data: SettingsData };

type SettingsModel = {
  readonly load: LoadState;
  readonly busy: boolean;
  readonly saveField: (field: SettingsField, input: string) => Promise<SettingsFeedback | null>;
  readonly setAllowlistMode: (on: boolean) => Promise<SettingsFeedback | null>;
  readonly addAllowed: (input: string) => Promise<SettingsFeedback | null>;
  readonly removeAllowed: (number: CanonicalNumber) => Promise<SettingsFeedback | null>;
};

function todayKey(): string {
  return localDayKey(Date.now(), -new Date().getTimezoneOffset());
}

function withIntegerField(s: GatewaySettings, field: IntegerField, value: number): GatewaySettings {
  if (field === 'perNumberLimit') return { ...s, perNumberLimit: value };
  if (field === 'rateWindowMinutes') return { ...s, rateWindowMinutes: value };
  return { ...s, dailySendCap: value };
}

/** The new Settings with one validated value, or null if the value has the wrong type. */
function withField(s: GatewaySettings, field: SettingsField, value: number | string | null): GatewaySettings | null {
  if (field === 'ownNumber') {
    if (value === null) return { ...s, ownNumber: null };
    return typeof value === 'string' && isCanonicalNumber(value) ? { ...s, ownNumber: value } : null;
  }
  if (field === 'defaultCountryCode') return typeof value === 'string' ? { ...s, defaultCountryCode: value } : null;
  return typeof value === 'number' ? withIntegerField(s, field, value) : null;
}

function withAllowlist(
  list: ReadonlySet<CanonicalNumber>,
  change: { readonly type: 'allow-add' | 'allow-remove'; readonly number: CanonicalNumber },
): ReadonlySet<CanonicalNumber> {
  const next = new Set(list);
  if (change.type === 'allow-add') next.add(change.number);
  else next.delete(change.number);
  return next;
}

function useLive(): React.MutableRefObject<boolean> {
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  return live;
}

function useSettingsLoad(ports: GatewayPorts, today: string, live: React.MutableRefObject<boolean>) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const data = useRef<SettingsData | null>(null);
  const update = useCallback(
    (next: SettingsData) => {
      data.current = next;
      if (live.current) setLoad({ kind: 'ready', data: next });
    },
    [live],
  );
  useEffect(() => {
    let cancelled = false;
    ports.store.loadState(today).then(
      (decoded) => {
        if (cancelled) return;
        if (decoded.status !== 'ok') return setLoad({ kind: 'failed' });
        const { settings, allowlist, stopList } = decoded.state;
        update({ settings, allowlist, stopList: [...stopList].sort() });
      },
      () => {
        if (!cancelled) setLoad({ kind: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ports, today, update]);
  return { load, data, update };
}

function useSettingsModel(ports: GatewayPorts, today: string, sync: SettingsSync): SettingsModel {
  const live = useLive();
  const { load, data, update } = useSettingsLoad(ports, today, live);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  // One write at a time, so every write starts from the last persisted data.
  const exclusive = useCallback(
    async (task: (current: SettingsData) => Promise<SettingsFeedback | null>): Promise<SettingsFeedback | null> => {
      const current = data.current;
      if (current === null || running.current) return null;
      running.current = true;
      setBusy(true);
      try {
        return await task(current);
      } finally {
        running.current = false;
        if (live.current) setBusy(false);
      }
    },
    [data, live],
  );

  const persistSettings = useCallback(
    async (current: SettingsData, next: GatewaySettings): Promise<boolean> => {
      try {
        await ports.store.saveSettings(serializeSettings(next));
      } catch {
        return false;
      }
      update({ ...current, settings: next });
      sync.publish({ settings: next });
      return true;
    },
    [ports, sync, update],
  );

  const commitAllowlist = useCallback(
    async (
      current: SettingsData,
      list: ReadonlySet<CanonicalNumber>,
      change: { readonly type: 'allow-add' | 'allow-remove'; readonly number: CanonicalNumber },
    ): Promise<boolean> => {
      const stateChange: StateChange = change;
      try {
        await ports.store.commit([stateChange]);
      } catch {
        return false;
      }
      update({ ...current, allowlist: withAllowlist(list, change) });
      sync.publish({ allowlistChanges: [stateChange] });
      return true;
    },
    [ports, sync, update],
  );

  const saveField = useCallback(
    (field: SettingsField, input: string) =>
      exclusive(async (current) => {
        const result = validateSettingsField(field, input, current.settings.defaultCountryCode);
        if (!result.ok) return rejected(rangeMessage(field, result.range));
        const next = withField(current.settings, field, result.value);
        if (next === null) return NOT_SAVED;
        return (await persistSettings(current, next)) ? saved(SAVED_MESSAGE) : NOT_SAVED;
      }),
    [exclusive, persistSettings],
  );

  const setAllowlistMode = useCallback(
    (on: boolean) =>
      exclusive(async (current) => {
        const next = { ...current.settings, allowlistMode: on };
        return (await persistSettings(current, next)) ? saved(SAVED_MESSAGE) : NOT_SAVED;
      }),
    [exclusive, persistSettings],
  );

  const addAllowed = useCallback(
    (input: string) =>
      exclusive(async (current) => {
        const list = current.allowlist;
        if (list === 'unreadable') return null;
        const result = addToAllowlist(list, input, current.settings.defaultCountryCode);
        if (result.status === 'invalid') return rejected(ALLOWLIST_INVALID_MESSAGE);
        if (result.status === 'duplicate') return rejected(ALLOWLIST_DUPLICATE_MESSAGE);
        if (result.status === 'full') return rejected(ALLOWLIST_FULL_MESSAGE);
        const ok = await commitAllowlist(current, list, { type: 'allow-add', number: result.number });
        return ok ? saved(ALLOWLIST_ADDED_MESSAGE) : NOT_SAVED;
      }),
    [commitAllowlist, exclusive],
  );

  const removeAllowed = useCallback(
    (number: CanonicalNumber) =>
      exclusive(async (current) => {
        const list = current.allowlist;
        if (list === 'unreadable' || !list.has(number)) return null;
        const ok = await commitAllowlist(current, list, { type: 'allow-remove', number });
        return ok ? saved(ALLOWLIST_REMOVED_MESSAGE) : NOT_SAVED;
      }),
    [commitAllowlist, exclusive],
  );

  return { load, busy, saveField, setAllowlistMode, addAllowed, removeAllowed };
}

// ---------------------------------------------------------------- view parts

function SettingsButton({
  label,
  onPress,
  disabled = false,
  text,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  text?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled ? styles.buttonDisabled : null]}
    >
      <Text style={[styles.buttonText, disabled ? styles.buttonTextDisabled : null]}>{text ?? label}</Text>
    </Pressable>
  );
}

function SettingsMessage({ feedback }: { feedback: SettingsFeedback | null }): React.JSX.Element | null {
  if (feedback === null) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={[styles.body, feedback.kind === 'saved' ? styles.ok : styles.error]}>
      {feedback.text}
    </Text>
  );
}

type SettingsTextFieldProps = {
  readonly label: string;
  readonly buttonText: string;
  /** Text shown in the input when it opens, and again after a failed write. */
  readonly initialDraft: string;
  /** Clear the input after a successful save (phone numbers are not shown in full after saving, 14.5). */
  readonly clearOnSave?: boolean;
  readonly keyboardType: 'number-pad' | 'phone-pad';
  readonly hint?: string;
  readonly disabled: boolean;
  readonly onSave: (input: string) => Promise<SettingsFeedback | null>;
};

function SettingsTextField(props: SettingsTextFieldProps): React.JSX.Element {
  const { label, buttonText, initialDraft, clearOnSave = false, keyboardType, hint, disabled, onSave } = props;
  const [draft, setDraft] = useState(initialDraft);
  const [feedback, setFeedback] = useState<SettingsFeedback | null>(null);
  const live = useLive();
  const save = (): void => {
    onSave(draft)
      .then((result) => {
        if (!live.current || result === null) return;
        setFeedback(result);
        if (result.kind === 'not-saved') setDraft(initialDraft);
        if (result.kind === 'saved' && clearOnSave) setDraft('');
      })
      .catch(() => undefined);
  };
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      {hint !== undefined ? <Text style={styles.muted}>{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        value={draft}
        onChangeText={setDraft}
        keyboardType={keyboardType}
        autoCorrect={false}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        editable={!disabled}
        style={styles.input}
        placeholderTextColor={colors.muted}
      />
      <SettingsButton label={`${buttonText} ${label}`} text={buttonText} onPress={save} disabled={disabled} />
      <SettingsMessage feedback={feedback} />
    </View>
  );
}

function SettingsModeSwitch({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => Promise<SettingsFeedback | null>;
}): React.JSX.Element {
  const [feedback, setFeedback] = useState<SettingsFeedback | null>(null);
  const live = useLive();
  const change = (value: boolean): void => {
    onChange(value)
      .then((result) => {
        if (live.current && result !== null) setFeedback(result);
      })
      .catch(() => undefined);
  };
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={[styles.label, styles.grow]}>{ALLOWLIST_MODE_LABEL}</Text>
        <Switch
          accessibilityRole="switch"
          accessibilityLabel={ALLOWLIST_MODE_LABEL}
          accessibilityState={{ checked: on, disabled }}
          value={on}
          disabled={disabled}
          onValueChange={change}
          trackColor={{ false: colors.muted, true: colors.soul }}
          thumbColor={colors.text}
        />
      </View>
      <Text style={styles.muted}>{on ? 'Only numbers on the list get answers.' : 'Every number gets answers.'}</Text>
      <SettingsMessage feedback={feedback} />
    </View>
  );
}

function SettingsAllowlist({
  list,
  disabled,
  onAdd,
  onRemove,
}: {
  list: ReadonlySet<CanonicalNumber> | 'unreadable';
  disabled: boolean;
  onAdd: (input: string) => Promise<SettingsFeedback | null>;
  onRemove: (number: CanonicalNumber) => Promise<SettingsFeedback | null>;
}): React.JSX.Element {
  const [feedback, setFeedback] = useState<SettingsFeedback | null>(null);
  const live = useLive();
  if (list === 'unreadable') {
    return (
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.label}>Allowlist</Text>
        <Text style={[styles.body, styles.error]}>{ALLOWLIST_UNREADABLE_NOTICE}</Text>
      </View>
    );
  }
  const remove = (number: CanonicalNumber): void => {
    onRemove(number)
      .then((result) => {
        if (live.current && result !== null) setFeedback(result);
      })
      .catch(() => undefined);
  };
  const entries = [...list].sort();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.label}>{`Allowlist (${entries.length} of ${ALLOWLIST_MAX})`}</Text>
      <SettingsTextField
        label={ALLOWLIST_INPUT_LABEL}
        buttonText="Add"
        initialDraft=""
        clearOnSave
        keyboardType="phone-pad"
        disabled={disabled}
        onSave={onAdd}
      />
      <View style={styles.card}>
        {entries.length === 0 ? <Text style={styles.muted}>{ALLOWLIST_EMPTY}</Text> : null}
        {entries.map((number) => (
          <View key={number} style={styles.row}>
            <Text style={[styles.body, styles.grow]}>{maskNumber(number)}</Text>
            <SettingsButton
              label={`Remove ${maskNumber(number)}`}
              text="Remove"
              onPress={() => remove(number)}
              disabled={disabled}
            />
          </View>
        ))}
        <SettingsMessage feedback={feedback} />
      </View>
    </View>
  );
}

function SettingsStopList({ entries }: { entries: readonly CanonicalNumber[] }): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.label}>Stop list</Text>
      <Text style={styles.muted}>These numbers texted STOP. They get no SMS until they text START.</Text>
      {entries.length === 0 ? <Text style={styles.muted}>{STOP_LIST_EMPTY}</Text> : null}
      {entries.map((number) => (
        <Text key={number} style={styles.body}>
          {maskNumber(number)}
        </Text>
      ))}
    </View>
  );
}

function SettingsForm({ data, model }: { data: SettingsData; model: SettingsModel }): React.JSX.Element {
  const { settings } = data;
  const own = settings.ownNumber;
  return (
    <>
      <SettingsModeSwitch on={settings.allowlistMode} disabled={model.busy} onChange={model.setAllowlistMode} />
      {INTEGER_FIELDS.map((field) => (
        <SettingsTextField
          key={field}
          label={FIELD_LABELS[field]}
          buttonText="Save"
          initialDraft={String(settings[field])}
          keyboardType="number-pad"
          disabled={model.busy}
          onSave={(input) => model.saveField(field, input)}
        />
      ))}
      <SettingsTextField
        label={FIELD_LABELS.defaultCountryCode}
        buttonText="Save"
        initialDraft={settings.defaultCountryCode}
        keyboardType="number-pad"
        disabled={model.busy}
        onSave={(input) => model.saveField('defaultCountryCode', input)}
      />
      <SettingsTextField
        label={FIELD_LABELS.ownNumber}
        buttonText="Save"
        initialDraft=""
        clearOnSave
        keyboardType="phone-pad"
        hint={`Now: ${own === null ? OWN_NUMBER_NOT_SET : maskNumber(own)}. Save an empty box to clear it.`}
        disabled={model.busy}
        onSave={(input) => model.saveField('ownNumber', input)}
      />
      <SettingsAllowlist
        list={data.allowlist}
        disabled={model.busy}
        onAdd={model.addAllowed}
        onRemove={model.removeAllowed}
      />
      <SettingsStopList entries={data.stopList} />
    </>
  );
}

// ---------------------------------------------------------------- screen

export function SettingsScreen({ ports, onBack, today, settingsSync }: SettingsScreenProps): React.JSX.Element {
  const day = useRef(today ?? todayKey()).current;
  const sync = settingsSync ?? sharedSettingsSync;
  const model = useSettingsModel(ports, day, sync);
  const { load } = model;
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        Settings
      </Text>
      {load.kind === 'loading' ? <Text style={styles.muted}>{LOADING_MESSAGE}</Text> : null}
      {load.kind === 'failed' ? <Text style={[styles.body, styles.error]}>{LOAD_FAILED_MESSAGE}</Text> : null}
      {load.kind === 'ready' ? <SettingsForm data={load.data} model={model} /> : null}
      <SettingsButton label="Back" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.sm },
  title: { ...typography.title, color: colors.text },
  card: { backgroundColor: colors.surface, borderRadius: radius, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1 },
  label: { ...typography.label, color: colors.text },
  body: { ...typography.body, color: colors.text },
  muted: { ...typography.body, color: colors.muted },
  ok: { color: colors.soul },
  error: { color: colors.blood },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.muted,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  button: {
    backgroundColor: colors.soul,
    borderRadius: radius,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  // Muted text on surface keeps 4.5:1 contrast while disabled.
  buttonDisabled: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.muted },
  buttonText: { ...typography.label, color: colors.bg },
  buttonTextDisabled: { color: colors.muted },
});
