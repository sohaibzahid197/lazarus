// Headless task `LazarusGateway` (Requirement 9.6). Kotlin `GatewayService` runs it with
// no timeout; it resolves only when the Gateway_Loop ends. `startGatewayLoop` keeps at
// most one loop per process, so a second run joins the running loop (Requirement 9.1).
import { startGatewayLoop, systemClock } from './loop';
import { getAiHolder, getLivePorts } from './runtime';

export const GATEWAY_TASK_NAME = 'LazarusGateway';

/** Registered as `LazarusGateway`. Async so a native load failure rejects, not throws. */
export async function lazarusGateway(): Promise<void> {
  const ports = getLivePorts();
  await startGatewayLoop(ports, systemClock, { ai: getAiHolder(ports) }).finished;
}
