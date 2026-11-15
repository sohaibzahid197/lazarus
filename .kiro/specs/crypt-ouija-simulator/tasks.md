# Implementation Plan: Crypt and Ouija Simulator

## Overview

Build `apps/crypt` (`@lazarus/crypt`) in this order, each layer on top of the previous one:

1. Workspace setup: root `package.json` workspaces and scripts, the Next.js App Router scaffold, `next.config.ts` (`transpilePackages`, webpack `extensionAlias`), ESLint, Vitest (unit and bundle projects) and Playwright configs.
2. Pure modules with property tests: protocol types, T9 step/decoder/encoder, compose and direction helpers, server foundation (Simulator_Number, env, AI setup, message ids, client IP, capped body), Snapshot_Parser and Snapshot_Printer, Ip_Rate_Limiter, Replies_Left, sanitize and response building, request parsing, `handleMessage`, `handleDeliver` and `createOuijaHandler`.
3. The route `POST /api/ouija`.
4. The client session: reducer, outbox, reminder pump, `postOuija`, `useOuijaSession`.
5. The UI (Phone_Mock and its parts, theme), then the Crypt_Dashboard.
6. Source guards, the client-bundle scan and the Playwright smoke, accessibility and privacy specs.

Code is TypeScript in strict mode with no `any`. Tests use Vitest (`vitest --run`, never watch mode) and fast-check 4.10.2 (the brain's version). Every property runs at least 100 cases through `CRYPT_PBT_OPTIONS`, is one `it(...)` in its own file whose name starts with `Feature: crypt-ouija-simulator, Property N: <title>`, and carries the tag comment `// Feature: crypt-ouija-simulator, Property N: <title>`. Handler tests call `createOuijaHandler` directly with a fixed `now`, the brain's `createMockClient`, a fresh limiter cell and a fixed test key; no test uses the network, the real clock or a real Gemini key. Only `.env.example` holds the variable names; no key is committed.

The four "Requirement notes" of the design are applied as the design chose: only free-text fields are masked (C4); bubbles get `lang="ur"` when the text has a U+0600–U+06FF character and `dir` from the first strong character; axe runs in Playwright and the client-bundle scan is a separate Vitest project run by `npm run test:bundle`; the `build` script is `npm run lint && next build --webpack`.

Optional marking: test sub-tasks marked `*` may be skipped for a faster MVP. The properties that Requirement 18.1 names (those validating Requirements 4, 8, 10, 17 and 19), the STOP property (Property 20), the example and component tests that Requirement 18 names, the source guards, the bundle scan and the Playwright specs stay required.

## Tasks

- [x] 1. Set up the `apps/crypt` workspace
  - [x] 1.1 Scaffold the Next.js app and wire it into the monorepo
    - `apps/crypt/package.json`: name `@lazarus/crypt`, `private`, `type: module`; dependencies `next` (16.x), `react`, `react-dom`, `@lazarus/brain` (workspace), `server-only`; devDependencies `typescript`, `@types/react`, `@types/react-dom`, `@types/node`, `vitest`, `fast-check` 4.10.2, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@playwright/test`, `@axe-core/playwright`, `eslint`, `typescript-eslint`, `@next/eslint-plugin-next`
    - Scripts exactly as the design table: `dev` (`next dev --webpack`), `build` (`npm run lint && next build --webpack`), `start`, `test` (`vitest --run`), `test:bundle`, `typecheck` (`tsc --noEmit`), `lint` (`eslint .`), `e2e` (`npm run test:bundle && playwright test`)
    - `tsconfig.json` with `strict: true`, `noImplicitAny`, `noUncheckedIndexedAccess`, Next.js plugin, no `paths`
    - `next.config.ts`: `transpilePackages: ['@lazarus/brain']`, `poweredByHeader: false`, `webpack(cfg)` sets `cfg.resolve.extensionAlias = { '.js': ['.ts', '.js'] }`; no `env` key and no `NEXT_PUBLIC_` variable
    - Placeholder `src/app/layout.tsx` (`<html lang="en">`) and `src/app/page.tsx` so `next build --webpack` succeeds with and without `GEMINI_API_KEY`
    - Root `package.json`: `workspaces` becomes `["packages/*", "apps/crypt"]`; `test`, `typecheck` and `lint` run the brain script `&&` the crypt script
    - `.gitignore` covers `apps/crypt/.next`, `apps/crypt/test-results`, `apps/crypt/playwright-report`; confirm the root `.env.example` lists `GEMINI_API_KEY=` and `GEMINI_MODEL=` with empty values
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.8, 9.5_

  - [x] 1.2 Configure ESLint
    - `eslint.config.mjs` (flat): `typescript-eslint` strict-type-checked, `@typescript-eslint/no-explicit-any: error`, the `no-unsafe-*` rules
    - `no-restricted-imports`: any `@lazarus/brain/*` except `@lazarus/brain/gemini`, any relative path into `packages/`; `@lazarus/brain/gemini` allowed only in `src/server/ai.ts`; `src/server/*` forbidden from `src/ui/**`, `src/session/**`, `src/t9/**`, `src/protocol/**`
    - `no-restricted-properties` forbids `process.env` outside `src/server/env.ts`
    - `npm run lint` exits 0 on the scaffold
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.8_

  - [x] 1.3 Configure Vitest and Playwright
    - `vitest.config.ts`: `include: ['src/**/*.test.ts', 'src/**/*.test.tsx']`, `environmentMatchGlobs` (or per-file `// @vitest-environment jsdom`) so `*.test.tsx` runs in jsdom; `resolve.alias` maps `server-only` to `src/test/serverOnlyStub.ts`; `resolve.extensionAlias`-equivalent so brain `.js` imports resolve to `.ts`
    - `vitest.bundle.config.ts`: `include: ['bundle/**/*.bundle.test.ts']` only
    - `playwright.config.ts`: two `webServer` entries running `next start` on port 3100 with no `GEMINI_API_KEY` and on port 3101 with `GEMINI_API_KEY=$CRYPT_TEST_KEY` (a fixed fake value set in the config, not a real key); `testDir: 'e2e'`; 10-second expect timeout
    - `src/test/pbt.ts` exports `CRYPT_PBT_OPTIONS = { numRuns: 100 }` and `TEST_KEY` (a fixed fake 39-character key string); `src/test/serverOnlyStub.ts` is empty
    - `src/test/setup.test.ts` checks `CRYPT_PBT_OPTIONS.numRuns >= 100`, so `npm test` exits 0 with a test present
    - _Requirements: 1.4, 18.1, 18.2, 18.3_

- [x] 2. Define the shared protocol
  - [x] 2.1 Create the `src/protocol` modules
    - `snapshot.types.ts` (`SnapshotReminder`, `SnapshotCounters`, `SessionSnapshot`), `wire.types.ts` (`SimulatorRequest`, `ResponsePart`, `SimulatorResponse`, `ErrorCode`, `ErrorBody`), `limits.ts` (`MAX_BODY_UNITS = 480`, `MAX_REQUEST_BYTES = 16_384`)
    - `emptySnapshot(nowMs)` using `zeroCounters(localDayKey(nowMs, 300))`
    - `isSimulatorResponse(value: unknown)`: field types, `kind`, 0 to 4 parts with string `text` and integer `units`/`limit`, `repliesLeft` an integer from 0 to `DEFAULT_SETTINGS.perNumberLimit`; no snapshot re-validation
    - No import from `src/server`
    - _Requirements: 6.7, 8.1, 8.5_

  - [x] 2.2 Write unit tests for the protocol helpers
    - File `src/protocol/protocol.unit.test.ts`: `emptySnapshot` shape and day key; `isSimulatorResponse` accepts the design example and rejects 5 parts, a non-integer `repliesLeft`, `repliesLeft` 6, a missing `snapshot`
    - _Requirements: 6.7, 8.5_

- [x] 3. Implement T9
  - [x] 3.1 Create `src/t9/keymap.ts` and `src/t9/t9.step.ts`
    - `KEY_MAP`, `T9Key`, `DigitKey`, `isT9Text`; `KeyEvent`, `T9Mode`, `T9Group`, `T9State`, `MULTI_TAP_TIMEOUT_MS = 1_000`, `INITIAL_T9_STATE` (Lower_Case Letter_Mode)
    - `stepT9` with the five ordered rules of the design; `flushT9`; `pendingOf`; `charOf` (`(presses − 1) mod len`, case applied to letters only)
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 4.2, 4.3, 4.4_

  - [x] 3.2 Create `src/t9/t9.decode.ts`
    - `decodeT9(events, start)`: `bad-time` when any `at` is not a safe non-negative integer or times decrease; otherwise fold `stepT9` and return `committed`, `mode`, `pendingOf` with no flush
    - _Requirements: 4.1, 4.5, 4.6_

  - [x] 3.3 Create `src/t9/t9.encode.ts`
    - `encodeT9(text)`: `too-long` above 200 characters, `not-t9-text` for any character outside the Key_Map; clock from 0, `*` on case change, `+1,000` before a same-key character with no `*` in between, in-group presses 100 ms apart
    - _Requirements: 4.7, 4.8_

  - [x] 3.4 Create T9 test support
    - `src/test/arbitraries/t9.ts`: `t9ModeArb`, `keyEventsArb` (0 to 300 events, gaps that hit 0, 999, 1,000 and large values, non-decreasing times), `badTimeEventsArb`, `t9TextArb` (0 to 200 characters), `nonT9TextArb` (Urdu, emoji, newline or symbol inserted at a random position)
    - `src/test/t9.reference.ts`: independent reference decoder written as an explicit group list (about 30 lines), not using `stepT9`
    - _Requirements: 4.1, 18.1_

  - [x] 3.5 Write property test for the decoder model
    - File `src/t9/t9.model.property.test.ts`
    - **Property 1: T9_Decoder matches the multi-tap model**
    - **Validates: Requirements 3.2, 4.1, 4.2, 4.3, 4.4, 4.5, 4.10**

  - [x] 3.6 Write property test for bad press times
    - File `src/t9/t9.badtime.property.test.ts`
    - **Property 2: T9_Decoder rejects bad press times**
    - **Validates: Requirements 4.6**

  - [x] 3.7 Write property test for the prefix rule
    - File `src/t9/t9.prefix.property.test.ts`
    - **Property 3: Committed text only grows**
    - **Validates: Requirements 4.11**

  - [x] 3.8 Write property test for the group count
    - File `src/t9/t9.count.property.test.ts`
    - **Property 4: One character per group**
    - **Validates: Requirements 4.12**

  - [x] 3.9 Write property test for encoder timing
    - File `src/t9/t9.encode.timing.property.test.ts`
    - **Property 5: T9_Encoder output follows the timing rules**
    - **Validates: Requirements 4.7**

  - [x] 3.10 Write property test for encoder rejection
    - File `src/t9/t9.encode.reject.property.test.ts`
    - **Property 6: T9_Encoder rejects non-T9 text**
    - **Validates: Requirements 4.8**

  - [x] 3.11 Write property test for the T9 round trip
    - File `src/t9/t9.roundtrip.property.test.ts`
    - **Property 7: T9 round trip**
    - **Validates: Requirements 4.9**

  - [x] 3.12 Write unit tests for T9 examples
    - File `src/t9/t9.unit.test.ts`: `*` then `4 4`, `3 3`, `5 5 5`, `7` gives `HEL` plus pending `P`; 5 presses of `2` show `a`; 3 presses of `0` show a space; `*` in Number_Mode applies on return to Letter_Mode; `#` then `2 2` appends `22`; `encodeT9` of 201 characters is `too-long`
    - _Requirements: 3.2, 3.4, 3.5, 3.6, 4.4, 4.7_

- [x] 4. Implement the compose and direction helpers
  - [x] 4.1 Create `src/ui/compose.ts` and `src/ui/direction.ts`
    - `truncateCompose` (480 units, 479 when unit 480 is a high surrogate), `clearLast` (pending first, else last code point), `switchInputMode` (commit pending only), `composeUnits` (text plus pending), `isMessageBody` (1 to `MAX_BODY_UNITS` units with a non-whitespace character)
    - `hasUrdu` (`/[\u0600-\u06FF]/`) and `textDirection` (first strong character: Arabic-script ranges → `rtl`, Latin → `ltr`, none → `ltr`)
    - _Requirements: 2.6, 3.8, 3.12, 5.1, 5.3, 5.4, 5.5, 11.4, 16.7_

  - [x] 4.2 Write property test for compose truncation
    - File `src/ui/compose.truncate.property.test.ts`
    - **Property 8: Compose truncation keeps the text or a safe prefix**
    - **Validates: Requirements 5.1, 5.4**

  - [x] 4.3 Write property test for Clear
    - File `src/ui/compose.clear.property.test.ts`
    - **Property 9: Clear removes exactly one thing**
    - **Validates: Requirements 3.8**

  - [x] 4.4 Write property test for Input_Mode switching
    - File `src/ui/compose.switch.property.test.ts`
    - **Property 10: Switching Input_Mode commits the Pending_Character only**
    - **Validates: Requirements 5.3**

  - [x] 4.5 Write property test for text direction
    - File `src/ui/direction.property.test.ts`
    - **Property 11: Text direction follows the first strong character**
    - **Validates: Requirements 5.5, 11.4, 16.7**

- [x] 5. Checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run typecheck` from the repo root and `npm run lint` in `apps/crypt`. Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement the server foundation modules
  - [x] 6.1 Create the small server-only modules
    - Each file starts with `import 'server-only';`
    - `simulatorNumber.ts`: `SIMULATOR_NUMBER = '+999666000000666'` checked with `isCanonicalNumber` at load
    - `env.ts`: `readGeminiEnv(source = process.env)` reading only `GEMINI_API_KEY` (raw value when it has a non-whitespace character, else `null`) and `GEMINI_MODEL` (trimmed, else `undefined`)
    - `messageId.ts`: `letters(n)` (base 26, `a`..`z`, `letters(0) = 'a'`) and `messageIdFor(serverTime, receiveCount)`
    - `clientIp.ts`: `clientIpFrom(headers)` (first `x-forwarded-for` entry trimmed, or `unknown`)
    - `body.ts`: `readCappedBody(req, maxBytes)` rejecting on a large `content-length` and cancelling the reader once more than `maxBytes` arrive; UTF-8 decode
    - _Requirements: 1.6, 1.7, 7.8, 7.14, 9.2, 9.3, 10.12, 17.1_

  - [x] 6.2 Create `src/server/ai.ts`
    - `getAiSetup()` lazy module-level singleton: with a key, one `createGeminiClient({ env: { GEMINI_API_KEY, GEMINI_MODEL } })` and one `createMemoryCache()`, `answer = { client, cache, clock: Date.now, secrets: [apiKey] }`; without a key, `answer: null`, `secrets: []`, no client; no `log` option
    - Export a `createAiSetup(env, factories)` used by the singleton so tests can inject fake factories
    - _Requirements: 1.3, 7.11, 9.1, 9.2, 9.3_

  - [x] 6.3 Write unit tests for the server foundation
    - File `src/server/foundation.unit.test.ts`: `readGeminiEnv` for missing, empty, whitespace and set values (model `undefined` when empty); `createAiSetup` creates one client and one cache and reuses them, and none without a key; `clientIpFrom` missing → `unknown`, `a, b` → `a`; `readCappedBody` rejects a 16,385-byte stream with no `content-length` and a false small `content-length`; `messageIdFor` contains no digit and `r:` + id is at most 20 characters for times up to 2^53 − 1
    - _Requirements: 1.7, 7.8, 9.1, 9.2, 9.3, 10.12_

- [x] 7. Implement the Snapshot_Parser and Snapshot_Printer
  - [x] 7.1 Create `src/server/snapshot.parse.ts`
    - `parseSnapshot(value, serverTime, number)` with exact key sets at each level and every rule of 8.4 (times and counts safe non-negative integers, counts ≤ 1,000,000, `dayKey` `^\d{4}-\d{2}-\d{2}$`, `dueAt ≤ serverTime + REMINDER_HORIZON_MS`, `createdAt ≤ dueAt` and `≤ serverTime`); past-due Reminders accepted
    - Builds the Gateway_State of the design table (`stopList`, empty `allowlist`, `rate`, `slowDown`, `counters`, `DEFAULT_SETTINGS`, `reminders` with `number` and `handedAt: null`)
    - _Requirements: 7.1, 8.2, 8.4, 8.8_

  - [x] 7.2 Create `src/server/snapshot.print.ts`
    - `printSnapshot(state, number)` per the design; throws on an `unreadable` reminder store or a non-null `handedAt`
    - _Requirements: 8.1, 8.2, 8.7_

  - [x] 7.3 Create snapshot arbitraries
    - `src/test/arbitraries/snapshot.ts`: `serverTimeArb`, `snapshotArb(serverTime)` built from valid parts (past-due Reminders, counters for another day, 0 to 120 times, 0 to 5 Reminders with unique ids and slots), `snapshotViolationArb(serverTime)` producing exactly one 8.4 violation each
    - _Requirements: 8.4, 18.1_

  - [x] 7.4 Write property test for the snapshot round trip
    - File `src/server/snapshot.roundtrip.property.test.ts`
    - **Property 12: Session_Snapshot round trip**
    - **Validates: Requirements 8.2, 8.3, 8.8**

  - [x] 7.5 Write unit tests for snapshot edge cases
    - File `src/server/snapshot.unit.test.ts`: an extra key in `counters` is `unknown-field`; a Due_Time exactly at the horizon is accepted and 1 ms later is not; an empty snapshot parses to empty maps; `printSnapshot` throws on `handedAt` set
    - _Requirements: 8.4, 8.8_

- [x] 8. Implement the Ip_Rate_Limiter
  - [x] 8.1 Create `src/server/ipLimiter.ts` and `src/server/ipLimiter.store.ts`
    - `IP_LIMIT = 30`, `IP_WINDOW_MS = 600_000`, `IP_MAX_CLIENTS = 10_000`, `IpState`, `IpCheck`
    - `checkIp(state, ip, now)`: prune, reject with clamped `retryAfterSec`, evict by oldest newest-time then string order, append and accept; no mutation of the input map
    - `limiterCell` with `get()` / `set()` over a module-level `IpState`
    - _Requirements: 10.2, 10.3, 10.8, 10.9, 10.10, 10.12_

  - [x] 8.2 Create limiter arbitraries
    - `src/test/arbitraries/ip.ts`: `ipRequestsArb` (0 to 500 requests with non-decreasing times from 1 to 50 Client_Ips, including `unknown`, with bursts inside one window and gaps longer than 600,000 ms)
    - _Requirements: 10.10, 10.11, 18.1_

  - [x] 8.3 Write property test for the window cap
    - File `src/server/ipLimiter.cap.property.test.ts`
    - **Property 26: At most 30 accepted per window**
    - **Validates: Requirements 10.3, 10.10**

  - [x] 8.4 Write property test for Client_Ip isolation
    - File `src/server/ipLimiter.isolation.property.test.ts`
    - **Property 27: Client_Ips do not affect each other**
    - **Validates: Requirements 10.11**

  - [x] 8.5 Write property test for bounded state
    - File `src/server/ipLimiter.bounded.property.test.ts`
    - **Property 28: Limiter state stays bounded**
    - **Validates: Requirements 10.8**

  - [x] 8.6 Write unit tests for eviction
    - File `src/server/ipLimiter.unit.test.ts`: 10,000 stored Client_Ips plus a new one drops the one with the oldest newest-time, ties by string order; the 31st request in a window is rejected with `retryAfterSec` from 1 to 600
    - _Requirements: 10.3, 10.9_

- [x] 9. Implement Replies_Left, sanitizing and response building
  - [x] 9.1 Create `src/server/repliesLeft.ts`
    - `repliesLeft(state, number, serverTime)` with the Glossary formula, using only `DEFAULT_SETTINGS`, `countInWindow`, `countersFor` and `localDayKey`; the only literals are `300` and `60_000`
    - _Requirements: 19.6, 19.13_

  - [x] 9.2 Create `src/server/sanitize.ts`
    - `sanitizeText(text, secrets)` = `maskPhoneNumbers(redactSecrets(text, secrets))`
    - `sanitizeSnapshot(s, secrets)` sanitizes Reminder_Texts only and clamps to 140 code units (139 when the 140th is a high surrogate); day key, ids and enums untouched (design C4)
    - _Requirements: 9.6, 17.2_

  - [x] 9.3 Create `src/server/response.build.ts`
    - `buildParts(texts, secrets)`: sanitize first, then `detectEncoding(joinSms(...))`, `getPartLimits`, `countCodeUnits` on the sanitized text
    - `json(status, body, headers?)` with `content-type: application/json` and `cache-control: no-store`, never `Set-Cookie`; `errorResponse(code)` with only `{ error }`
    - _Requirements: 1.11, 7.4, 7.5, 7.13, 17.3_

  - [x] 9.4 Write unit tests for sanitize and build
    - File `src/server/sanitize.unit.test.ts`: `+923001234567` in a part becomes masked with the last 3 digits kept; the key becomes `[redacted]`; a Reminder_Text grown past 140 by a short secret is clamped without a lone surrogate; `buildParts` limits 160/70 for 1 part and 153/67 for 2 parts
    - _Requirements: 7.4, 9.6, 17.2, 17.3_

- [x] 10. Implement request parsing, the handlers and the check order
  - [x] 10.1 Create `src/server/request.parse.ts`
    - `parseRequest(raw)`: `invalid-json`, `invalid-type` (unknown type or extra top-level field), `invalid-body`, `invalid-reminder-id` (not a string of 1 to 64 characters); snapshot left `unknown`
    - `isMessageBody(value: unknown)` using `MAX_BODY_UNITS`
    - _Requirements: 6.2, 7.7_

  - [x] 10.2 Create `src/server/brainFns.ts` and `src/server/handle.message.ts`
    - `BrainFns` (the brain functions the handlers call) and `REAL_BRAIN`; `HandleCtx`
    - `handleMessage(body, state, ctx)`: the 7 steps of the design (`messageIdFor`, `runGatewayPipeline` with `{ paused: false, today }`, `applyChanges`, `finalizeSend` with an all-`sent` `done` report or `null` for 0 parts, `applyChanges`, `buildParts`, `sanitizeSnapshot(printSnapshot(...))`, `repliesLeft`)
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 9.4, 12.1, 12.2, 12.4, 12.6, 12.7, 13.1, 19.6_

  - [x] 10.3 Create `src/server/handle.deliver.ts`
    - `handleDeliver(reminderId, state, ctx)`: not found and `wait` → 0 parts, `deliveryOutcome: null`, unchanged snapshot; `final` → apply `reminder-remove`, 0 parts, the outcome; `send` → apply, `finalizeDelivery` with all parts sent, apply, parts and `reminder-sent`; `command: null`, `language` from the Reminder, `outcome: null`
    - _Requirements: 12.3, 13.4, 13.5, 13.6, 19.6_

  - [x] 10.4 Create `src/server/handler.ts`
    - `createOuijaHandler(deps)` with `POST` and `notAllowed()`; Server_Time read once before the limiter; checks in the order 405, 413, 429, 400 shape, 400 snapshot, then the handler; limiter state set only on accept
    - 429 body: `slowDown` from `GATEWAY_TEXTS[detectLanguage(body)].slowDown` (sanitized) for a valid `message`, none for `deliver`, English otherwise; `Retry-After` header
    - One `try/catch` mapping any throw after the limiter to `errorResponse('internal')`; no `console` call
    - _Requirements: 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 10.1, 10.2, 10.3, 10.4, 10.5, 17.6_

  - [x] 10.5 Create handler test support
    - `src/test/handlerHarness.ts`: `makeHandler({ now, aiReply?, aiError?, withKey?, brain? })` using `createMockClient`, `createMemoryCache`, a fresh limiter cell, `SIMULATOR_NUMBER` and `TEST_KEY`; `post(handler, body, { ip?, method? })`; `collectStrings(json)` for privacy checks
    - `src/test/arbitraries/request.ts`: `messageBodyArb` (English, Urdu, Roman Urdu, every Command, the 5 phone-number forms, `TEST_KEY`), `aiReplyArb` (text repeating the Simulator_Number, its digits or the key), `invalidRequestArb`
    - _Requirements: 17.4, 18.3_

- [x] 11. Test the handler against the brain
  - [x] 11.1 Write property test for invalid snapshots
    - File `src/server/handler.badsnapshot.property.test.ts`: `parseSnapshot` returns an error for each violation and the handler answers 400 `invalid-snapshot` with 0 pipeline calls
    - **Property 13: Invalid snapshots are rejected**
    - **Validates: Requirements 8.4**

  - [x] 11.2 Write property test for invalid requests
    - File `src/server/handler.badrequest.property.test.ts`
    - **Property 14: Invalid requests get a bare 400**
    - **Validates: Requirements 6.2, 7.7, 7.13**

  - [x] 11.3 Write property test for printer validity across sessions
    - File `src/server/handler.printer.property.test.ts`
    - **Property 15: Printed snapshots are always accepted and number-free**
    - **Validates: Requirements 8.1, 8.7, 13.1**

  - [x] 11.4 Write property test for the check order
    - File `src/server/handler.order.property.test.ts`
    - **Property 16: Checks run in the fixed order**
    - **Validates: Requirements 7.12, 10.1**

  - [x] 11.5 Write property test for message handling
    - File `src/server/handler.message.model.property.test.ts`
    - **Property 17: Message handling equals the brain composition**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.5, 12.4, 12.6, 12.7**

  - [x] 11.6 Write property test for deliver handling
    - File `src/server/handler.deliver.model.property.test.ts`
    - **Property 18: Deliver handling equals the brain composition**
    - **Validates: Requirements 13.4, 13.5, 13.6**

  - [x] 11.7 Write property test for determinism
    - File `src/server/handler.determinism.property.test.ts`
    - **Property 19: Responses are deterministic**
    - **Validates: Requirements 7.14**

  - [x] 11.8 Write property test for STOP
    - File `src/server/handler.stop.property.test.ts`
    - **Property 20: STOP always wins in the simulator**
    - **Validates: Requirements 12.1, 12.2, 12.3**

  - [x] 11.9 Write property test for part metadata
    - File `src/server/handler.parts.property.test.ts`
    - **Property 21: Part metadata matches the returned text**
    - **Validates: Requirements 7.4, 7.5, 17.3**

  - [x] 11.10 Write the success privacy property test
    - File `src/server/handler.privacy.property.test.ts`; spies on every `console` method
    - **Property 22: No number or key in successful responses**
    - **Validates: Requirements 1.11, 7.11, 9.5, 9.6, 17.1, 17.2, 17.4**

  - [x] 11.11 Write the error privacy property test
    - File `src/server/handler.privacy.errors.property.test.ts`; includes a throwing `brain.runGatewayPipeline` and a throwing sanitizer for the 500 case
    - **Property 23: No number, key or body in error responses**
    - **Validates: Requirements 7.10, 9.5, 17.5**

  - [x] 11.12 Write property test for the per-IP Slow_Down_Text
    - File `src/server/handler.slowdown.property.test.ts`
    - **Property 24: Per-IP Slow_Down_Text speaks the message Language**
    - **Validates: Requirements 10.3, 10.4**

  - [x] 11.13 Write property test for limiter recording
    - File `src/server/handler.limiter.property.test.ts`
    - **Property 25: The limiter records exactly the requests that reach it**
    - **Validates: Requirements 10.2**

  - [x] 11.14 Write property test for Replies_Left
    - File `src/server/handler.repliesleft.property.test.ts`; reference uses `checkRate` and `countersFor`
    - **Property 29: Replies_Left equals the brain formula**
    - **Validates: Requirements 19.6, 19.13**

  - [x] 11.15 Write property test for the reset view
    - File `src/server/handler.reset.property.test.ts`
    - **Property 30: New session restores a clean server view**
    - **Validates: Requirements 8.5, 19.14**

  - [x] 11.16 Write the command walk example test
    - File `src/server/handler.walk.unit.test.ts`: HELP, STOP, a QUESTION, START, `REMIND in 1 minute drink water`, LIST, CANCEL 1, chaining snapshots; Outcomes `replied`, `stopped`, `ignored-stopped`, `started`, `replied`, `replied`, `replied`; matching Commands; `en` each; 0 parts for STOP and the QUESTION after STOP; 0 mock AI calls for that QUESTION
    - _Requirements: 18.4_

  - [x] 11.17 Write the Try_Later_Text example tests
    - File `src/server/handler.trylater.unit.test.ts`: a QUESTION in `en`, `ur` and `roman-ur` gets the Try_Later_Text in that Language with status 200, once with no key and once with a mock quota error
    - _Requirements: 9.3, 9.4, 18.5_

  - [x] 11.18 Write the status code example tests
    - File `src/server/handler.status.unit.test.ts`: invalid JSON 400; 481-unit body 400; 16,385-byte body 413; GET 405; 31st request from one Client_Ip within 600,000 ms 429 with `Retry-After` 1..600; throwing brain dependency 500 with only `{ error: 'internal' }`
    - _Requirements: 7.8, 7.9, 7.10, 18.6_

  - [x] 11.19 Write the Replies_Left walk example test
    - File `src/server/handler.limit.unit.test.ts`: 5 HELPs give `replied` with Replies_Left 4, 3, 2, 1, 0; the 6th is `rate-limited` with the 1-part English Slow_Down_Text and 0; a 7th from `emptySnapshot` gives the Help_Text and 4
    - _Requirements: 18.10, 19.6_

  - [x] 11.20 Write the `send-capped` example test
    - File `src/server/handler.sendcap.unit.test.ts`: `handed` near `dailySendCap` with Replies_Left > 0 gives `send-capped`, 0 parts and the formula value
    - _Requirements: 19.15_

- [x] 12. Wire the Simulator_Route
  - [x] 12.1 Create `src/app/api/ouija/route.ts`
    - `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30`
    - `productionDeps()`: monotonic `now` (`max(last, Date.now())`), `ai: getAiSetup`, `limiter: limiterCell`, `number: SIMULATOR_NUMBER`
    - `POST = handler.POST`; `GET`, `HEAD`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` = `handler.notAllowed`
    - _Requirements: 1.9, 7.9, 9.1_

  - [x] 12.2 Write unit tests for the route module
    - File `src/app/api/ouija/route.unit.test.ts`: exports `runtime === 'nodejs'`; `GET()` returns 405 with only `error`; `POST` with a HELP request returns 200 and no `Set-Cookie`
    - _Requirements: 1.9, 1.11, 7.9_

- [x] 13. Checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run typecheck` from the repo root and `npm run lint` in `apps/crypt`. Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement the client session
  - [x] 14.1 Create session types and UI texts
    - `src/session/session.types.ts`: `BubbleKind`, `Bubble`, `DripItem`, `Outgoing`, `SessionState`, `Action`
    - `src/ui/texts.ts`: every UI string (connection error, reset notes, `New session started.`, length message, reply-limit note, Replies_Left text and hint, Active_Reminders note, STOP banner, state labels)
    - `src/session/outcomeNotes.ts`: `noteForOutcome` (11.6 texts) and `noteForDelivery` (13.11 texts)
    - _Requirements: 6.5, 6.6, 10.6, 11.6, 12.5, 13.10, 13.11, 19.2, 19.9, 19.10_

  - [x] 14.2 Create `src/session/session.reducer.ts`
    - `initialSession(nowMs)`, `resetSession(state, nowMs, note)`, `sessionReducer` with the action table of the design and the epoch check on every epoch-tagged action
    - `phoneState(s)` (SENDING, ERROR, SLEEPING, ALIVE precedence) and `sendDisabled(s, composeHasBody)`
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8, 10.6, 10.7, 11.2, 11.3, 11.5, 11.6, 11.7, 11.8, 11.9, 13.6, 13.7, 13.8, 13.11, 13.12, 14.2, 19.2, 19.4, 19.7, 19.8, 19.10, 19.12_

  - [x] 14.3 Create `src/session/reminderPump.ts` and `src/session/outbox.ts`
    - `dueReminders` (due on the corrected clock, no future retry or recheck, sorted by `(dueAt, id)`) and `nextWakeDelay` (capped at 2,147,483,647, `null` when none)
    - `nextRequest`: `null` while in flight, a waiting message first, otherwise the first due Reminder
    - _Requirements: 13.2, 13.3, 13.8, 13.9_

  - [x] 14.4 Create `src/session/api.ts`
    - `postOuija(req, signal, env?)` with `credentials: 'omit'`, a 30-second abort timer mapping to `failed`, 429 → `rate-limited` with `slowDown`, 400 `invalid-snapshot` (and any 400 for `deliver`) → `invalid-snapshot`, invalid 200 body or other status → `failed`, reset abort → `aborted`
    - _Requirements: 6.5, 6.6, 6.7, 10.6, 10.7, 13.8, 13.12_

  - [x] 14.5 Create `src/session/useOuijaSession.ts`
    - Request, drip (first item within the same tick, then 700 ms apart), pump and New session effects; one `AbortController` ref tagged with the epoch; `Date.now`, `fetch` and timers injected through an `env` object
    - New session aborts, clears all timers and dispatches `new-session` with no `fetch`
    - _Requirements: 6.1, 6.4, 6.8, 11.1, 11.8, 11.9, 13.2, 13.3, 13.8, 13.9, 19.2, 19.3, 19.4_

  - [x] 14.6 Create session arbitraries
    - `src/test/arbitraries/session.ts`: `sessionStateArb`, `responseArb` (message and deliver, 0 to 4 parts, every Outcome and Delivery_Outcome), `epochActionArb`
    - _Requirements: 18.1_

  - [x] 14.7 Write property test for stale responses
    - File `src/session/reducer.stale.property.test.ts`
    - **Property 31: Stale responses change nothing**
    - **Validates: Requirements 6.8, 19.4**

  - [x] 14.8 Write property test for accepted responses
    - File `src/session/reducer.accept.property.test.ts`
    - **Property 32: An accepted response replaces the session view**
    - **Validates: Requirements 2.7, 6.4, 11.2, 11.3, 11.7, 13.7, 19.8, 19.10**

  - [x] 14.9 Write property test for failed and limited requests
    - File `src/session/reducer.failed.property.test.ts`
    - **Property 33: Failed and limited requests keep the session view**
    - **Validates: Requirements 6.5, 6.7, 10.6, 10.7, 13.8, 19.12**

  - [x] 14.10 Write property test for 0-part notes
    - File `src/session/reducer.notes.property.test.ts`
    - **Property 34: Every 0-part outcome gets its one note**
    - **Validates: Requirements 11.6, 13.11**

  - [x] 14.11 Write property test for drip ordering
    - File `src/session/reducer.drip.property.test.ts`
    - **Property 35: Replies never interleave**
    - **Validates: Requirements 11.8**

  - [x] 14.12 Write property test for the Phone_Mock state
    - File `src/session/phoneState.property.test.ts`
    - **Property 36: Exactly one Phone_Mock state by precedence**
    - **Validates: Requirements 11.5, 14.2, 14.3, 14.4, 14.6**

  - [x] 14.13 Write property test for Session_Reset
    - File `src/session/reducer.reset.property.test.ts`
    - **Property 37: Session_Reset clears everything but the note**
    - **Validates: Requirements 6.6, 11.9, 19.2, 19.5**

  - [x] 14.14 Write property test for the reminder pump
    - File `src/session/reminderPump.property.test.ts`
    - **Property 38: Due Reminders are picked in order and timers stay in range**
    - **Validates: Requirements 13.2, 13.3**

  - [x] 14.15 Write property test for the outbox
    - File `src/session/outbox.property.test.ts`
    - **Property 39: One request at a time, messages first**
    - **Validates: Requirements 13.3, 13.9**

  - [x] 14.16 Write unit tests for `postOuija`
    - File `src/session/api.unit.test.ts` with a mocked `fetch` and fake timers: 30-second timeout → `failed`; 429 with `slowDown`; 400 `invalid-snapshot`; any 400 on `deliver` → `invalid-snapshot`; 200 with a bad body → `failed`; abort → `aborted`; `credentials: 'omit'`
    - _Requirements: 6.5, 6.6, 6.7, 13.12_

- [x] 15. Build the Ouija_Simulator UI
  - [x] 15.1 Create `src/ui/examples.ts` and `src/ui/Examples.tsx`
    - `EXAMPLE_MESSAGES`: the 10 messages of 2.2; `Examples` renders 10 buttons with `lang`/`dir` from `hasUrdu`/`textDirection`; activation calls `setCompose(text)`
    - _Requirements: 2.2, 2.3, 16.7_

  - [x] 15.2 Create `Bubble.tsx`, `PhoneScreen.tsx` and `Announcer.tsx`
    - `Bubble`: text in `<p>` with `white-space: pre-wrap`, `dir = textDirection(text)`, `lang="ur"` when `hasUrdu`, Part_Badge `Part n of N · GSM-7 · 148/153`, Language or `Reminder` label on first parts, notes styled as notes
    - `PhoneScreen`: `<ol>` thread, no live region, scroll newest into view (`block: 'nearest'`, `auto` under reduced motion), STOP banner slot
    - `Announcer`: polite and assertive visually hidden regions announcing each new bubble id once (with badge text or `Reminder` prefix), mode changes and Replies_Left changes with the hint
    - _Requirements: 2.4, 2.5, 2.7, 11.2, 11.3, 11.4, 13.7, 16.4, 16.7, 16.9, 16.11, 19.11_

  - [x] 15.3 Create `Keypad.tsx` and `ComposeField.tsx`
    - `Keypad`: 12 buttons in a 3-column grid with case-aware letters, accessible names (`2, a b c`, `0, space`, `star, change case`, `hash, change letters or numbers`), `onKeyDown` mapping physical `0-9 * #`, Backspace and Enter using the event `timeStamp`
    - `ComposeField`: Keypad_Input read-only `div role="textbox" aria-readonly="true"` with the pending character in `<u>`; Keyboard_Input `<textarea dir="auto">` with `truncateCompose` on change, Enter sends, Shift+Enter inserts a line break, `isComposing` ignored
    - _Requirements: 3.1, 3.3, 3.9, 3.10, 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 5.8, 16.3_

  - [x] 15.4 Create `Heartbeat.tsx`, `RepliesLeft.tsx`, `StopBanner.tsx` and `Header.tsx`
    - `Heartbeat`: `aria-hidden` SVG line plus visible label per state, 600 ms pulse restarted by a `key`, a static mode for the dashboard legend
    - `RepliesLeft`: `Replies left: n of 5` (both from `DEFAULT_SETTINGS.perNumberLimit` and state) and the 0-hint
    - `StopBanner`: `STOP is on. Send START to get replies again.`
    - `Header` (server component): links `Ouija simulator` to `/` and `The Crypt` to `/crypt` with `aria-current="page"` on the current one
    - _Requirements: 12.5, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.9, 15.9, 16.3, 19.7, 19.9_

  - [x] 15.5 Assemble `PhoneMock.tsx`, `OuijaSimulator.tsx`, the page, the layout and the theme
    - `PhoneMock`: frame, Heartbeat, mode indicator `abc`/`ABC`/`123`, StopBanner, PhoneScreen, ComposeField, `n/480` counter, Input_Mode toggle `Keypad`/`Keyboard`, Keypad, Clear, Send (disabled per `sendDisabled`, real `disabled` attribute), always-enabled `New session`, RepliesLeft, Active_Reminders count and note; DOM order equals the tab order of 16.1
    - `OuijaSimulator` (`'use client'`): `useReducer(sessionReducer)`, `useOuijaSession`, local compose/`T9State`/Input_Mode/length message; key press → `stepT9` and a 1,000 ms `flushT9` timer; the 480-unit check before a commit or digit; Send commits the pending character first; New session resets local state in the same batch
    - `src/app/page.tsx` renders `<OuijaSimulator/>`; `src/app/layout.tsx` adds `Header`, the display font via `next/font/google`, and `globals.css`
    - `src/app/globals.css`: Theme_Tokens as CSS variables, radius 14, spacing scale, `:focus-visible` 2 px soul-green outline, 16 px system UI body, ember glow, grid that puts Examples beside the phone at ≥ 768 px, reduced-motion rules
    - _Requirements: 2.1, 2.2, 2.6, 2.8, 3.3, 3.7, 3.11, 3.12, 6.1, 6.2, 6.3, 13.10, 14.1, 14.8, 16.1, 16.2, 16.5, 16.6, 16.10, 19.1, 19.2, 19.5_

  - [x] 15.6 Write unit tests for the example messages
    - File `src/ui/examples.unit.test.ts`: 10 items; `routeCommand` and `detectLanguage` give the Commands and Languages of 2.2; each 1 to 480 units
    - _Requirements: 2.2_

  - [x] 15.7 Write component tests for the keypad
    - File `src/ui/keypad.test.tsx`: `*`, `4 4`, `3 3`, `5 5 5`, `7` shows `HELP`; the pending character is underlined; fake timers commit at 1,000 ms; physical keys map; the mode indicator and its polite announcement; the 480-unit drop shows the length message
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.9, 3.10, 3.11, 3.12, 16.9_

  - [x] 15.8 Write component tests for keyboard input
    - File `src/ui/keyboard.test.tsx`: Enter sends; Shift+Enter inserts a line break; Enter during composition does nothing; Enter on whitespace does nothing; paste over 480 units truncates and shows the length message
    - _Requirements: 5.2, 5.4, 5.6, 5.7, 5.8_

  - [x] 15.9 Write component tests for the send flow
    - File `src/ui/sendFlow.test.tsx` with mocked `fetch` and fake timers: one `fetch`; outgoing bubble; Send disabled while waiting; parts at 0, 700 and 1,400 ms; Part_Badge text; Language label on the first part only; `scrollIntoView` called; each bubble announced once
    - _Requirements: 2.4, 2.5, 2.7, 6.1, 6.3, 11.1, 11.5, 16.4_

  - [x] 15.10 Write component tests for failures
    - File `src/ui/failures.test.tsx`: 30-second timeout note, 429 Slow_Down_Text note and 500 note in the assertive region; error state until the next send; Replies_Left unchanged on 429
    - _Requirements: 6.5, 6.7, 10.6, 14.5, 16.11, 19.12_

  - [x] 15.11 Write component tests for reminders
    - File `src/ui/reminders.test.tsx`: a `deliver` request at the Due_Time; `Reminder` label; a retry 60 s after a 429; held back while a message waits; a 400 on `deliver` resets with `Your demo session was reset.`; Active_Reminders count and note
    - _Requirements: 13.2, 13.3, 13.7, 13.8, 13.9, 13.10, 13.12_

  - [x] 15.12 Write the New session component test
    - File `src/ui/newSession.test.tsx`: with STOP on, 1 Reminder scheduled and a `message` request waiting, pressing `New session` makes 0 `fetch` calls, shows only `New session started.`, removes the STOP banner, shows `Replies left: 5 of 5`, sends no `deliver` when the old Due_Time passes, and adds no bubble when the waiting response arrives
    - _Requirements: 18.11, 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x] 15.13 Write component tests for the Replies_Left hint
    - File `src/ui/repliesLeft.test.tsx`: hint shown at 0 and hidden above 0 in the same render; one polite announcement per change; none when unchanged
    - _Requirements: 19.7, 19.8, 19.9, 19.11_

  - [x] 15.14 Write the storage test
    - File `src/ui/storage.test.tsx`: spies on `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB.open` and `history.pushState`/`replaceState` see no write during a full session
    - _Requirements: 8.6_

- [x] 16. Build the Crypt_Dashboard
  - [x] 16.1 Create `src/dashboard/dashboard.data.ts`
    - `import 'server-only'`; `EXPLANATION` (≤ 200 words, three steps in order), `COMMANDS` (HELP, STOP, START, `SCAM <text>`, `REMIND <time> <text>`, LIST, CANCEL, free question, each ≤ 20 words), `DEMO_COUNTERS` meeting the 15.4 rules, `SAMPLE_NUMBER = '+999666000000137'` and `SAMPLE_CONVERSATION` (4 to 8 messages) with senders as `maskNumber(SAMPLE_NUMBER)`, `HEARTBEAT_LEGEND` (one-line meanings ≤ 20 words)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.8_

  - [x] 16.2 Create `src/dashboard/Dashboard.tsx` and `src/app/crypt/page.tsx`
    - Server components only; sections for explanation, commands, Demo_Counters with the `Demo data` label, Sample_Conversation (incoming/outgoing marks, `lang`/`dir` for Urdu), Heartbeat legend using `Heartbeat` in static mode; no form, input or fetch
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7, 15.8, 15.9, 16.7_

  - [x] 16.3 Write unit tests for the dashboard
    - File `src/dashboard/dashboard.unit.test.tsx`: word counts; counter rules; masked numbers keep only the last 3 digits; `renderToString` of `Dashboard` has no 7-digit run (spaces and hyphens joined), no `form`, `input`, `textarea` or `contenteditable`
    - _Requirements: 15.1, 15.2, 15.4, 15.5, 15.7, 15.10_

- [x] 17. Add source guards
  - [x] 17.1 Write the source guard test
    - File `src/test/sourceGuards.unit.test.ts`: no `process.env` outside `src/server/env.ts`; no import of `@lazarus/brain/` subpaths other than `gemini` and none into `packages/`; `@lazarus/brain/gemini` only in `src/server/ai.ts`; every `src/server` file and `dashboard.data.ts` starts with `import 'server-only'`; `route.ts` exports `runtime = 'nodejs'`; no `NEXT_PUBLIC_` text; `globals.css` and component styles use only Theme_Token colors, radius 14 and the spacing scale; `src/` defines no command alias, language marker or split logic (no `perNumberLimit`/`rateWindowMinutes` literal values)
    - _Requirements: 1.2, 1.3, 1.6, 1.9, 7.6, 9.5, 14.1, 19.6_

- [x] 18. Checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run typecheck` from the repo root, and `npm run lint` and `npm run build` in `apps/crypt`. Ensure all tests pass, ask the user if questions arise.

- [x] 19. Add build-output and browser checks
  - [x] 19.1 Write the client-bundle scan
    - File `bundle/clientBundle.bundle.test.ts` (run by `npm run test:bundle` after a build with the fake test key): reads every file under `.next/static` and the pre-rendered HTML of `/` and `/crypt`; fails on the test key, `+999666000000666`, `999666000000666` or the text `GEMINI_API_KEY`
    - _Requirements: 1.3, 9.5, 17.7_

  - [x] 19.2 Write the Playwright smoke spec
    - File `e2e/smoke.spec.ts` on port 3100 (no key), each check in a named `test.step` with a 10-second limit: T9 `*`, `4 4`, `3 3`, `5 5 5`, `7`, Send → English Help_Text with a GSM-7 badge; `مدد` by keyboard → `Urdu` label with a UCS-2 badge; `/crypt` shows `Demo data` and no 7-digit run; STOP banner, then New session clears it, shows `New session started.` and `Replies left: 5 of 5`; GET `/` and `/crypt` 200 with no `Set-Cookie`; no horizontal scroll at 320, 768 and 1920 px; `/crypt` makes no `/api/` request
    - _Requirements: 1.10, 2.1, 15.7, 18.7, 18.8, 18.9, 18.12, 18.13_

  - [x] 19.3 Write the Playwright accessibility spec
    - File `e2e/a11y.spec.ts` with `@axe-core/playwright` tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`: initial, after one reply, STOP on, Replies_Left 0 with hint (5 HELPs), after New session, and `/crypt`; Tab order walk; focus outline width ≥ 2 px; reduced-motion run checks computed `animation-duration` and `transition-duration` are 0
    - _Requirements: 14.8, 14.9, 16.1, 16.2, 16.5, 16.6, 16.8_

  - [x] 19.4 Write the Playwright privacy spec
    - File `e2e/privacy.spec.ts` on port 3101 (fake test key): `/` and `/crypt` HTML and headers contain neither the test key nor the Simulator_Number with or without `+`
    - _Requirements: 17.8_

- [x] 20. Final checkpoint - Ensure all tests pass
  - Run `npm test`, `npm run typecheck` and `npm run lint` from the repo root, and `npm run build` and `npm run e2e` in `apps/crypt` (run `npx playwright install chromium` once first). Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Properties for Requirements 4, 8, 10, 17 and 19, Property 20 (STOP), the Requirement 18 example and component tests, the source guards, the bundle scan and the Playwright specs are not optional.
- Each task references specific requirements for traceability.
- Every property test uses `CRYPT_PBT_OPTIONS` (at least 100 runs) and the `Feature: crypt-ouija-simulator, Property N: <title>` name and tag; fast-check reports the counterexample and seed, and tests do not catch that output.
- Each property and unit test has its own file, and arbitraries are split per domain under `src/test/arbitraries/` instead of the single file the design names, so tasks in the same wave never write the same file.
- Run Vitest only with `--run`. `next dev` and `next start` are long-running; Playwright starts `next start` itself through `webServer`, and `npm run dev` is run by hand.
- Vitest aliases `server-only` to an empty stub, because the real package throws outside the React server condition; the source guard and `next build` still enforce it.
- The Playwright test key and `TEST_KEY` are fixed fake strings, never a real Gemini key. The real key lives only in an untracked `.env`.
- Deployment to Vercel is done by hand and is not part of this plan.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "6.1", "8.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3", "6.2", "7.1", "8.2", "9.1", "9.2"] },
    { "id": 4, "tasks": ["3.4", "4.1", "6.3", "7.2", "8.3", "8.4", "8.5", "9.3", "10.1"] },
    { "id": 5, "tasks": ["3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "3.12", "4.2", "4.3", "4.4", "4.5", "7.3", "8.6", "9.4", "10.2"] },
    { "id": 6, "tasks": ["7.4", "7.5", "10.3"] },
    { "id": 7, "tasks": ["10.4"] },
    { "id": 8, "tasks": ["10.5", "12.1"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8", "11.9", "11.10", "11.11", "11.12", "11.13", "11.14", "11.15", "11.16", "11.17", "11.18", "11.19", "11.20", "12.2"] },
    { "id": 10, "tasks": ["14.1", "16.1"] },
    { "id": 11, "tasks": ["14.2", "14.3", "14.4", "14.6"] },
    { "id": 12, "tasks": ["14.5", "14.7", "14.8", "14.9", "14.10", "14.11", "14.12", "14.13", "14.14", "14.15", "14.16"] },
    { "id": 13, "tasks": ["15.1", "15.2", "15.3", "15.4"] },
    { "id": 14, "tasks": ["15.5", "16.2"] },
    { "id": 15, "tasks": ["15.6", "15.7", "15.8", "15.9", "15.10", "15.11", "15.12", "15.13", "15.14", "16.3", "17.1"] },
    { "id": 16, "tasks": ["19.1"] },
    { "id": 17, "tasks": ["19.2", "19.3", "19.4"] }
  ]
}
```
