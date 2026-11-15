// Process-wide gateway runtime (necromancer-sms-gateway design, "JS glue").
// The headless `LazarusGateway` task and the UI (Setup_Screen key step, App.tsx) run in
// the same JS runtime, so they share one set of live ports and one AiHolder: a key saved
// on the Setup_Screen rebuilds the AI_Client the Gateway_Loop is using (Requirement 16.15).
// Nothing here imports React.
import { createLivePorts, type GatewayPorts, type LogFn } from '../native/ports';
import { createAiHolder, type AiHolder } from './ai';

const defaultLog: LogFn = (line) => console.warn(line);

let livePorts: GatewayPorts | null = null;
const holders = new WeakMap<GatewayPorts, AiHolder>();

/** Live ports over the real TurboModules, built on first use. */
export function getLivePorts(): GatewayPorts {
  if (livePorts === null) livePorts = createLivePorts(defaultLog);
  return livePorts;
}

/** One AiHolder per ports object; the live ports get the app-wide holder. */
export function getAiHolder(ports: GatewayPorts): AiHolder {
  let holder = holders.get(ports);
  if (holder === undefined) {
    holder = createAiHolder(ports.keyStore, () => Date.now());
    holders.set(ports, holder);
  }
  return holder;
}
