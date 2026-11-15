import 'server-only';

import type { IpState } from './ipLimiter';

/** Read and replace access to the Ip_Rate_Limiter state of this server instance. */
export interface LimiterCell {
  get(): IpState;
  set(s: IpState): void;
}

// Kept in module memory: one state per server instance (see Known limitations).
let state: IpState = new Map<string, readonly number[]>();

export const limiterCell: LimiterCell = {
  get(): IpState {
    return state;
  },
  set(s: IpState): void {
    state = s;
  },
};
