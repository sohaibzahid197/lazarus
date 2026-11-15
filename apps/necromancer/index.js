/**
 * @format
 */
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { GATEWAY_TASK_NAME, lazarusGateway } from './src/gateway/headless';
import lazarusPausedInbox, { PAUSED_TASK_NAME } from './src/gateway/pausedTask';

AppRegistry.registerComponent(appName, () => App);
// Kotlin GatewayService runs the Gateway_Loop (Requirement 9.6).
AppRegistry.registerHeadlessTask(GATEWAY_TASK_NAME, () => lazarusGateway);
// Kotlin PausedInboxTaskService runs one task per paused Inbound_Message (Requirement 9.12).
AppRegistry.registerHeadlessTask(PAUSED_TASK_NAME, () => lazarusPausedInbox);
