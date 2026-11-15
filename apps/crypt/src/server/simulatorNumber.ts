import 'server-only';
import { isCanonicalNumber, type CanonicalNumber } from '@lazarus/brain';

// Design C2: country code 999 is unassigned, so this number reaches no real
// person. 15 digits, so no 13-digit epoch time or counter can contain it.
const RAW_SIMULATOR_NUMBER = '+999666000000666';

function checkedNumber(raw: string): CanonicalNumber {
  if (!isCanonicalNumber(raw)) {
    throw new Error('SIMULATOR_NUMBER is not a canonical number');
  }
  return raw;
}

/** The fixed fictional sender of every Simulator_Session (17.1). Server-only. */
export const SIMULATOR_NUMBER: CanonicalNumber = checkedNumber(RAW_SIMULATOR_NUMBER);
