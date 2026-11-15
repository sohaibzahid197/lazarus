import 'server-only';
import {
  applyChanges,
  decideDelivery,
  finalizeDelivery,
  finalizeSend,
  runGatewayPipeline,
  type CanonicalNumber,
} from '@lazarus/brain';
import type { AiSetup } from './ai';

// The brain functions the Simulator_Route handlers call. Injectable so tests can
// pass a throwing function for the 500 case (Requirements 7.10, 18.6).

export interface BrainFns {
  readonly runGatewayPipeline: typeof runGatewayPipeline;
  readonly applyChanges: typeof applyChanges;
  readonly finalizeSend: typeof finalizeSend;
  readonly decideDelivery: typeof decideDelivery;
  readonly finalizeDelivery: typeof finalizeDelivery;
}

export const REAL_BRAIN: BrainFns = {
  runGatewayPipeline,
  applyChanges,
  finalizeSend,
  decideDelivery,
  finalizeDelivery,
};

/** Per-request context shared by `handleMessage` and `handleDeliver`. */
export interface HandleCtx {
  readonly serverTime: number; // read once per request (7.1, 7.2)
  readonly number: CanonicalNumber; // the Simulator_Number
  readonly ai: AiSetup;
  readonly brain: BrainFns;
}
