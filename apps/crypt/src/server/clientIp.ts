import 'server-only';

/**
 * The Client_Ip: the first `x-forwarded-for` entry, trimmed, or `unknown`
 * when the header is absent or its first entry is empty (10.12).
 * Vercel overwrites this header with the real client address.
 */
export function clientIpFrom(headers: Headers): string {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first === undefined || first === '' ? 'unknown' : first;
}
