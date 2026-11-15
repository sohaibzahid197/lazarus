import 'server-only';

export type BodyRead = { readonly ok: true; readonly text: string } | { readonly ok: false };

const TOO_LARGE: BodyRead = { ok: false };

function declaredTooLarge(req: Request, maxBytes: number): boolean {
  const header = req.headers.get('content-length');
  if (header === null) return false;
  const declared = Number(header.trim());
  return Number.isFinite(declared) && declared > maxBytes;
}

/**
 * Reads the request body as UTF-8, never holding more than `maxBytes + chunk`
 * bytes (7.8). Rejects at once when `content-length` is larger than
 * `maxBytes`; otherwise stops and cancels the reader as soon as more than
 * `maxBytes` bytes have arrived, so a missing or false `content-length`
 * cannot get a large body parsed.
 */
export async function readCappedBody(req: Request, maxBytes: number): Promise<BodyRead> {
  if (declaredTooLarge(req, maxBytes)) return TOO_LARGE;
  if (req.body === null) return { ok: true, text: '' };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return TOO_LARGE;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder('utf-8').decode(bytes) };
}
