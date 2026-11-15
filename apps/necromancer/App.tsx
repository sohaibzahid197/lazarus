/**
 * Necromancer app shell (necromancer-sms-gateway design, "Screens" and "Navigation").
 *
 * - A small state-based switcher over the four screens; no navigation library.
 * - Start screen from `chooseStartScreen`: Permission_Screen while a permission is
 *   missing (11.1), then Setup_Screen while a Setup_Step is not done, then
 *   Main_Screen (12.13). Chosen within START_TIMEOUT_MS so a first open shows a
 *   screen within 10 s (17.3); an unknown Device_Status falls back to Permission_Screen.
 * - Permission_Screen returns to where it was opened from: Setup_Screen at start (11.9)
 *   and from the permissions step (12.12), Main_Screen from a Main_Screen fix button.
 * - Navigation never stops or pauses the Gateway_Service (12.10). The service is
 *   started only by the Operator from the Main_Screen (9.1) or by the Boot_Receiver.
 * - The UI shares the headless loop's ports and AiHolder (`gateway/runtime`), so a key
 *   saved on the Setup_Screen rebuilds the AI_Client the loop uses (16.15).
 *
 * @format
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GatewayPorts, SetupMarks } from './src/native/ports';
import type { AiHolder } from './src/gateway/ai';
import { getAiHolder, getLivePorts } from './src/gateway/runtime';
import type { GatewayStore } from './src/gateway/store';
import type { PermissionsAdapter } from './src/ui/permissions';
import {
  chooseStartScreen,
  permissionsFromStatus,
  setupStepsDone,
  type StartScreen,
} from './src/ui/startScreen';
import { MainScreen } from './src/ui/screens/MainScreen';
import { PermissionScreen } from './src/ui/screens/PermissionScreen';
import { SettingsScreen } from './src/ui/screens/SettingsScreen';
import { SetupScreen } from './src/ui/screens/SetupScreen';
import { colors, spacing, typography } from './src/ui/theme';

/** Upper bound for choosing the start screen; leaves headroom under the 10 s of 17.3. */
export const START_TIMEOUT_MS = 8_000;
export const LOADING_TEXT = 'Waking the gateway…';

const NO_MARKS: SetupMarks = { autostart: false, recents: false };

// ---------------------------------------------------------------- navigation

export type Route =
  | { readonly screen: 'loading' }
  /** `returnTo` null: shown at start; leaving it opens Setup_Screen and back is not intercepted. */
  | { readonly screen: 'permission'; readonly returnTo: Route | null }
  /** `returnTo` null: shown at start, so hardware back leaves the app. */
  | { readonly screen: 'setup'; readonly returnTo: 'main' | null; readonly initialStep?: 'ai-key' }
  | { readonly screen: 'main' }
  | { readonly screen: 'settings' };

export function startRoute(screen: StartScreen): Route {
  if (screen === 'permission') return { screen: 'permission', returnTo: null };
  if (screen === 'setup') return { screen: 'setup', returnTo: null };
  return { screen: 'main' };
}

/** Route for hardware back, or null to let Android handle it. */
export function backRoute(route: Route): Route | null {
  switch (route.screen) {
    case 'permission':
      return route.returnTo === null ? null : leavePermission(route.returnTo);
    case 'setup':
      return route.returnTo === 'main' ? { screen: 'main' } : null;
    case 'settings':
      return { screen: 'main' };
    default:
      return null;
  }
}

function leavePermission(returnTo: Route | null): Route {
  // At start, all permissions granted means Setup_Screen next (11.9).
  return returnTo ?? { screen: 'setup', returnTo: null };
}

// ---------------------------------------------------------------- start screen

async function readStartScreen(ports: GatewayPorts, ai: AiHolder): Promise<StartScreen> {
  const [status, marks] = await Promise.all([
    ports.device.getDeviceStatus().catch(() => null),
    ports.store.getSetupMarks().catch(() => NO_MARKS),
    ai.refresh().catch(() => undefined),
  ]);
  // The key never reaches the UI; the key step comes from the holder's snapshot.
  const steps = { ...setupStepsDone(status, marks, { status: 'absent' }), 'ai-key': ai.snapshot().status === 'present' };
  return chooseStartScreen(permissionsFromStatus(status), steps);
}

/** Start screen, or null while it is being chosen. Unknown status → Permission_Screen. */
function useStartScreen(ports: GatewayPorts, ai: AiHolder, timeoutMs: number): StartScreen | null {
  const [screen, setScreen] = useState<StartScreen | null>(null);
  useEffect(() => {
    let live = true;
    const settle = (next: StartScreen): void => {
      if (!live) return;
      live = false;
      clearTimeout(timer);
      setScreen(next);
    };
    const timer = setTimeout(() => settle('permission'), timeoutMs);
    readStartScreen(ports, ai).then(settle, () => settle('permission'));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [ports, ai, timeoutMs]);
  return screen;
}

function useHardwareBack(route: Route, navigate: (next: Route) => void): void {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const next = backRoute(route);
      if (next === null) return false;
      navigate(next);
      return true;
    });
    return () => sub.remove();
  }, [route, navigate]);
}

// ---------------------------------------------------------------- view

export type AppProps = {
  /** Defaults to the live ports shared with the headless Gateway_Loop. */
  readonly ports?: GatewayPorts;
  /** Defaults to the AiHolder shared with the headless Gateway_Loop. */
  readonly ai?: AiHolder;
  /** Defaults to the app-wide gateway store. */
  readonly store?: GatewayStore;
  /** Defaults to the live `PermissionsAndroid` adapter. */
  readonly permissions?: PermissionsAdapter;
  readonly startTimeoutMs?: number;
};

function Loading(): React.JSX.Element {
  return (
    <View style={styles.loading} accessibilityLabel={LOADING_TEXT}>
      <ActivityIndicator color={colors.soul} />
      <Text style={styles.loadingText}>{LOADING_TEXT}</Text>
    </View>
  );
}

type ScreensProps = Required<Pick<AppProps, 'ports' | 'ai' | 'startTimeoutMs'>> &
  Pick<AppProps, 'store' | 'permissions'>;

function Screens({ ports, ai, store, permissions, startTimeoutMs }: ScreensProps): React.JSX.Element {
  const start = useStartScreen(ports, ai, startTimeoutMs);
  const [moved, setMoved] = useState<Route | null>(null);
  const route: Route = moved ?? (start === null ? { screen: 'loading' } : startRoute(start));
  const navigate = useCallback((next: Route) => setMoved(next), []);
  useHardwareBack(route, navigate);

  switch (route.screen) {
    case 'loading':
      return <Loading />;
    case 'permission':
      return (
        <PermissionScreen
          ports={ports}
          permissions={permissions}
          onDone={() => navigate(leavePermission(route.returnTo))}
        />
      );
    case 'setup':
      return (
        <SetupScreen
          ports={ports}
          ai={ai}
          initialStep={route.initialStep}
          onOpenPermissions={() => navigate({ screen: 'permission', returnTo: route })}
          onDone={() => navigate({ screen: 'main' })}
        />
      );
    case 'main':
      return (
        <MainScreen
          ports={ports}
          store={store}
          onOpenSetup={(step) => navigate({ screen: 'setup', returnTo: 'main', initialStep: step })}
          onOpenSettings={() => navigate({ screen: 'settings' })}
          onOpenPermissions={() => navigate({ screen: 'permission', returnTo: route })}
        />
      );
    case 'settings':
      return <SettingsScreen ports={ports} onBack={() => navigate({ screen: 'main' })} />;
  }
}

function SafeArea({ children }: { children: React.ReactNode }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const padding = { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right };
  return <View style={[styles.root, padding]}>{children}</View>;
}

function App({ ports, ai, store, permissions, startTimeoutMs = START_TIMEOUT_MS }: AppProps): React.JSX.Element {
  const [resolvedPorts] = useState<GatewayPorts>(() => ports ?? getLivePorts());
  const [resolvedAi] = useState<AiHolder>(() => ai ?? getAiHolder(resolvedPorts));
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics} style={styles.root}>
      {/* Edge-to-edge: the status bar is drawn over the root's theme background. */}
      <StatusBar barStyle="light-content" />
      <SafeArea>
        <Screens
          ports={resolvedPorts}
          ai={resolvedAi}
          store={store}
          permissions={permissions}
          startTimeoutMs={startTimeoutMs}
        />
      </SafeArea>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loadingText: { ...typography.body, color: colors.muted },
});

export default App;
