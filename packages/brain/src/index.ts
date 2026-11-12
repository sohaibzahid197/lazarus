// @lazarus/brain — shared core logic for the Lazarus project.
//
// The SMS_Splitter (encoding detection, code-unit counting, limits,
// greedy splitting, truncation, prefixing) and the public `splitSms` /
// `joinSms` API are implemented across several modules. This package has no
// dependency on React Native or Next.js: it is pure TypeScript consumed by
// both apps.
//
// Re-export the encoding-detection module so consumers can import from
// `@lazarus/brain`. Internals remain directly importable from their source
// modules for unit and property tests.
export * from './encoding.js';
