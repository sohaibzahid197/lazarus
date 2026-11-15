// POST /api/ouija: the Simulator_Route (Requirements 1.9, 7.9, 9.1).
// All checks and brain calls live in src/server/handler.ts; this file only
// wires the production dependencies and the route segment config.
import { getAiSetup } from '../../../server/ai';
import { createOuijaHandler, type OuijaDeps } from '../../../server/handler';
import { limiterCell } from '../../../server/ipLimiter.store';
import { SIMULATOR_NUMBER } from '../../../server/simulatorNumber';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Server_Time never goes backwards within one instance, so snapshot times stay ≤ Server_Time. */
function monotonicNow(): () => number {
  let last = 0;
  return () => {
    last = Math.max(last, Date.now());
    return last;
  };
}

function productionDeps(): OuijaDeps {
  return {
    now: monotonicNow(),
    ai: getAiSetup,
    limiter: limiterCell,
    number: SIMULATOR_NUMBER,
  };
}

const handler = createOuijaHandler(productionDeps());

export function POST(req: Request): Promise<Response> {
  return handler.POST(req);
}

/** Every other method gets 405 without reading the body (7.9). */
function notAllowed(): Response {
  return handler.notAllowed();
}

export const GET = notAllowed;
export const HEAD = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = notAllowed;
