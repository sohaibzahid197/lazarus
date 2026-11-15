// Unit tests for the Simulator_Route module (Requirements 1.9, 1.11, 7.9).
// GEMINI_API_KEY is stubbed empty and the modules are reloaded before each
// import, so the route's AI singleton has no key and makes no Gemini call.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySnapshot } from '../../../protocol/emptySnapshot';
import { isSimulatorResponse } from '../../../protocol/response.check';

type RouteModule = typeof import('./route');

async function loadRoute(): Promise<RouteModule> {
  vi.resetModules();
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('GEMINI_MODEL', '');
  const store = await import('../../../server/ipLimiter.store');
  store.limiterCell.set(new Map<string, readonly number[]>());
  return import('./route');
}

let route: RouteModule;

beforeEach(async () => {
  route = await loadRoute();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Simulator_Route module', () => {
  it('declares the Node.js runtime and its segment config', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.maxDuration).toBe(30);
  });

  it('answers GET with 405 and a body holding only `error`', async () => {
    const res = route.GET();
    expect(res.status).toBe(405);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: 'method-not-allowed' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('answers every other non-POST method with 405', () => {
    for (const fn of [route.HEAD, route.PUT, route.PATCH, route.DELETE, route.OPTIONS]) {
      expect(fn().status).toBe(405);
    }
  });

  it('answers a HELP POST with 200, a valid Simulator_Response and no Set-Cookie', async () => {
    const req = new Request('http://localhost/api/ouija', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' },
      body: JSON.stringify({ type: 'message', body: 'HELP', snapshot: emptySnapshot(Date.now()) }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    const body: unknown = await res.json();
    expect(isSimulatorResponse(body)).toBe(true);
    if (!isSimulatorResponse(body)) return;
    expect(body.command).toBe('HELP');
    expect(body.outcome).toBe('replied');
    expect(body.parts.length).toBeGreaterThan(0);
  });
});
