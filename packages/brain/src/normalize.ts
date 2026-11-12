/** NFKC, trim, collapse every whitespace run to one space. Idempotent. */
export function normalizeMessage(input: string): string {
  return input.normalize('NFKC').replace(/\s+/g, ' ').trim();
}
