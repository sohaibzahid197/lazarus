// Resolve hook for running brain's TypeScript sources under Node's type stripping.
// Brain imports use NodeNext-style `./x.js` suffixes; when that file does not exist,
// retry the sibling `./x.ts`. Same mapping as Metro's `resolveRequest`.
// Usage: node --import ./scripts/ts-resolve.mjs ./scripts/export-stop-aliases.ts --out <file>
import { register } from 'node:module';
import { isMainThread } from 'node:worker_threads';

if (isMainThread) register(import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!relative || !specifier.endsWith('.js') || error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
  }
}
