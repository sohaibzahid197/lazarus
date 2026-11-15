# Implementation Plan: Necromancer SMS Gateway

## Overview

Build the gateway in three layers, in this order:

1. The pure Gateway_Module in `packages/brain/src/gateway.*.ts`: types, Fixed_Gateway_Texts, numbers, Rate_Limiter, day counters, Heartbeat_Model, Settings, API key, Activity_Log, Gateway_Pipeline, Stop_Alias_List and the export script, Pending_Stop_Records, the state wire format, the React Native Gemini REST variant (`gemini.core.ts` / `gemini.native.ts`, Node behaviour unchanged) and the package exports. Tests use Vitest and fast-check; each property runs at least 100 iterations, is named with its requirement numbers (for example `Req 3.10: STOP always wins`) and carries the tag comment `// Feature: necromancer-sms-gateway, Property N: <title>`. Each brain task ends with `vitest --run` passing in `packages/brain`, plus `tsc --noEmit` and lint at checkpoints.
2. The Kotlin Native_Module and build config in `apps/necromancer/android`: SDK levels, manifest, generated `stop_aliases.json`, SQLite NativeStore, ApiKeyStore, SmsReceiver and InboxQueue, the paused path, GatewayService, SendQueue/SmsSender, boot and watchdog receivers, Device_Status and settings intents. Kotlin JVM unit tests cover the pure helpers.
3. The JS glue and UI in `apps/necromancer/src`: typed ports and decoders, the gateway loop, the paused task, the AI client factory, the four screens and the design tokens. Jest tests run with the Native_Module mocked. The app contains no gateway decision logic of its own (Req 17.7).

All TypeScript is strict mode with no `any`. No API key is committed; the app reads the Gemini_Api_Key only from the native Api_Key_Store at runtime.

Optional marking: test sub-tasks marked `*` may be skipped for a faster MVP. Test sub-tasks that Requirement 18 names explicitly, and the safety-critical properties (STOP always wins, rate limit invariant, Daily_Send_Cap, privacy, exactly one Outcome, Pending_Stop_Record handling, secret handling), stay required.

## Tasks

- [x] 1. Set up gateway types, fixed texts and shared arbitraries
  - [x] 1.1 Create `gateway.types.ts`
    - `CanonicalNumber` (branded), `SenderIdentity`, `InboundMessage`, `GatewaySettings`, `DayCounters`, `GatewayState`, `PipelineContext`, `StateChange`, `GatewayDecision`, `PartResult`, `SendReport`, `FinalOutcome`, `ActivityEntry`
    - `OUTCOMES` (11 values) and `Outcome`; `SLEEP_REASONS` in priority order and `SleepReason`; `DeviceStatus`, `ServiceStatus`, `Heartbeat` (reason only on SLEEPING)
    - No body field in `GatewayDecision` or `StateChange`
    - _Requirements: 7.4, 13.3, 13.4, 14.7_

  - [x] 1.2 Create `gateway.texts.ts`
    - `GatewayTexts` and `GATEWAY_TEXTS` for `en`, `ur`, `roman-ur`: help, slowDown, welcomeBack, notAvailable, usage for SCAM, REMIND, TRANSLATE
    - Use the keywords `ALIAS_TABLE` recognises in each Language; no newlines; `en` and `roman-ur` GSM-7
    - _Requirements: 3.13, 5.3, 6.4, 6.5, 6.6, 6.7, 6.11_

  - [x] 1.3 Create `gateway.arbitraries.ts`
    - `canonicalNumber`, `countryCode`, `formattedNumber(cc)` (separators, `00`, national `0`), `automatedAddress`, `body(language)` from router aliases and free text, `gatewayState`, `settings`, `deviceStatus`, `sendReport`, `apiKey`, `pendingStopRecord`, `stopAliasBody`
    - Export `GATEWAY_PBT_OPTIONS` with `numRuns: 100`; reuse `router.arbitraries.ts` and `answer.arbitraries.ts`
    - _Requirements: 18.1, 18.2_

  - [x] 1.4 Write unit tests for `GATEWAY_TEXTS`
    - File `gateway.texts.unit.test.ts`; exhaustive over 3 Languages × every text: no newline, `en`/`roman-ur` GSM-7, `ur` Urdu script, `splitSms` gives 1 part (the `ur` Help_Text at most 2)
    - Each usage hint's example routes to its own Command through `routeCommand`
    - _Requirements: 6.11, 18.1_

- [x] 2. Implement number normalizing, printing and masking
  - [x] 2.1 Create `gateway.number.ts`
    - `normalizeSender` (5-step algorithm from the design; `92` when the Default_Country_Code is absent or invalid), `printNumber`, `maskNumber`, `maskSender`, `isCanonicalNumber`, `isValidCountryCode`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.9, 2.11, 2.12, 2.13_

  - [x] 2.2 Write property test for the normalizer reference rules
    - File `gateway.number.rules.property.test.ts`
    - **Property 1: Normalizer matches the reference rules**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.11, 2.12**

  - [x] 2.3 Write property test for normalizer idempotence
    - File `gateway.number.idempotent.property.test.ts`; test name contains `Req 2.6`
    - **Property 2: Normalizing a Canonical_Number is idempotent**
    - **Validates: Requirements 2.6**

  - [x] 2.4 Write property test for the print/normalize round trip
    - File `gateway.number.roundtrip.property.test.ts`; test name contains `Req 2.8`
    - **Property 3: Print then normalize round trip**
    - **Validates: Requirements 2.7, 2.8**

  - [x] 2.5 Write property test for the masked number invariant
    - File `gateway.number.mask.property.test.ts`; test name contains `Req 2.10`
    - **Property 4: Masked number invariant**
    - **Validates: Requirements 2.9, 2.10**

  - [x] 2.6 Write property test for the masked sender shape
    - File `gateway.number.masksender.property.test.ts`
    - **Property 5: Masked sender shape**
    - **Validates: Requirements 2.13, 7.6, 14.2**

  - [x] 2.7 Write unit tests for number functions
    - File `gateway.number.unit.test.ts`: `+92 300 1234567`, `0092…`, `03001234567` with `92`, `923001234567`, `JAZZ`, `8888`, empty, a 16-digit number, a misplaced `+`, an invalid country code falling back to `92`; `maskSender` for empty, 1 to 3 characters and a long ID
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.11, 2.12, 2.13_

- [x] 3. Implement the Rate_Limiter and day counters
  - [x] 3.1 Create `gateway.rate.ts`
    - `checkRate(times, t, limit, windowMs)` counting `t − windowMs < τ ≤ t`; `slowDownDue(last, t, windowMs)`; `pruneRate` dropping times older than 24 hours
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.10_

  - [x] 3.2 Write property test for the sliding-window model
    - File `gateway.rate.model.property.test.ts`
    - **Property 11: Rate_Limiter matches the sliding-window model**
    - **Validates: Requirements 5.1, 5.2**

  - [x] 3.3 Write boundary unit tests for the Rate_Limiter
    - File `gateway.rate.unit.test.ts`: message number `limit` accepted, `limit + 1` rejected inside one window, accepted again at the first receive time outside the oldest accepted message's window; pruning keeps records relevant to a 1440-minute window
    - _Requirements: 5.1, 5.2, 5.10, 18.8_

  - [x] 3.4 Create `gateway.counters.ts`
    - `localDayKey(ms, tzOffsetMinutes)`, `countersFor(c, today)` (zero counters on a new day), `reserveParts`, `releaseParts`, `recordFinal` (received, repliesSent for `replied` + `started`, replied, partsSent, ignored for `ignored-*`)
    - _Requirements: 5.8, 5.13, 9.2, 13.12_

  - [x] 3.5 Write property test for day counters
    - File `gateway.counters.property.test.ts`
    - **Property 26: Day counters match a naive count**
    - **Validates: Requirements 13.12, 5.13**

- [x] 4. Implement the Heartbeat_Model
  - [x] 4.1 Create `gateway.heartbeat.ts`
    - `deriveHeartbeat(device, service, sending)` with the priority order of `SLEEP_REASONS`; `no-signal` only when airplane mode is off and not in service
    - _Requirements: 13.1, 13.2, 13.3, 13.13, 13.14_

  - [x] 4.2 Write property test for the heartbeat invariant
    - File `gateway.heartbeat.invariant.property.test.ts`; test name contains `Req 13.4`
    - **Property 24: Heartbeat invariant**
    - **Validates: Requirements 13.4**

  - [x] 4.3 Write property test for the heartbeat priority table
    - File `gateway.heartbeat.priority.property.test.ts`
    - **Property 25: Heartbeat matches the priority table**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.13, 13.14**

  - [x] 4.4 Write unit tests for each Sleep_Reason
    - File `gateway.heartbeat.unit.test.ts`: one example per Sleep_Reason (7), plus ALIVE, SENDING and SLEEPING while sending
    - _Requirements: 13.1, 13.2, 13.3, 18.4_

- [x] 5. Implement Settings, Allowlist, API key and Activity_Log helpers
  - [x] 5.1 Create `gateway.settings.ts`
    - `DEFAULT_SETTINGS`, `serializeSettings` (`{"v":1,...}`), `parseSettings` (`ok` / `missing` / `invalid`, exact key set), `validateSettingsField` (integer ranges 1–60, 1–1440, 1–2000; country code; Own_Number through `normalizeSender`), `addToAllowlist` (`added` / `duplicate` / `invalid` / `full`), `ALLOWLIST_MAX` = 500
    - _Requirements: 4.4, 4.5, 4.10, 5.10, 5.11, 15.3, 15.4, 15.5_

  - [x] 5.2 Write property test for the Settings round trip
    - File `gateway.settings.roundtrip.property.test.ts`; test name contains `Req 15.4`
    - **Property 30: Settings round trip**
    - **Validates: Requirements 15.4**

  - [x] 5.3 Write property test for invalid Settings
    - File `gateway.settings.invalid.property.test.ts`
    - **Property 31: Invalid settings fall back to defaults**
    - **Validates: Requirements 15.3, 15.5**

  - [x] 5.4 Write property test for Allowlist adds
    - File `gateway.allowlist.property.test.ts`
    - **Property 10: Allowlist add keeps one canonical entry**
    - **Validates: Requirements 4.4, 4.5, 4.10**

  - [x] 5.5 Create `gateway.key.ts`
    - `validateApiKey` (trim, `/^[A-Za-z0-9_-]{30,64}$/`), `maskApiKey` (`••••` + last 4), `API_KEY_INVALID_MESSAGE` (fixed text that never echoes the input)
    - _Requirements: 16.3, 16.4, 16.12_

  - [x] 5.6 Write property test for the Masked_Key invariant
    - File `gateway.key.mask.property.test.ts`; test name contains `Req 16.13`
    - **Property 33: Masked key invariant**
    - **Validates: Requirements 16.12, 16.13**

  - [x] 5.7 Write property test for the API key validator
    - File `gateway.key.validate.property.test.ts`
    - **Property 32: API key validator rule**
    - **Validates: Requirements 16.3**

  - [x] 5.8 Write boundary unit tests for the API key validator
    - File `gateway.key.unit.test.ts`: trimmed 30 and 64 accepted, 29 and 65 rejected, empty, whitespace only, a value with `!`, a valid key padded with spaces accepted; `API_KEY_INVALID_MESSAGE` contains no character of the input
    - _Requirements: 16.3, 16.4, 18.10_

  - [x] 5.9 Create `gateway.activity.ts`
    - `buildActivityEntry(decision, outcome)` with `who` from `maskNumber` or `maskSender` and `command` `'NONE'` when the router did not run; `trimActivityLog` (newest first, at most 200); `ACTIVITY_LOG_MAX`
    - _Requirements: 7.6, 14.1, 14.2, 14.3, 14.4_

  - [x] 5.10 Write property test for Activity_Log trimming
    - File `gateway.activity.trim.property.test.ts`
    - **Property 27: Activity_Log keeps the newest 200**
    - **Validates: Requirements 14.3, 14.4**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the Stop_Alias_List and export script
  - [x] 7.1 Create `stopAliases.ts` and update `router.ts`
    - `STOP_ALIAS_LIST` computed from `ALIAS_TABLE`, `KEYWORD_TRAILING_PUNCTUATION` (`.,!?:;`), `STOP_MARKER`, `stopKeywordCheck` (trim, first token, strip trailing punctuation, lowercase; no `normalizeMessage`), `StopAliasAsset`, `stopAliasAsset()`
    - Build `TRAILING_PUNCT` in `router.ts` from `KEYWORD_TRAILING_PUNCTUATION`; existing router tests must still pass
    - _Requirements: 9.13, 17.7_

  - [x] 7.2 Write property test for the Stop_Keyword_Check
    - File `stopAliases.property.test.ts`
    - **Property 36: Stop_Keyword_Check is sound and covers plain STOP forms**
    - **Validates: Requirements 9.13, 17.7**

  - [x] 7.3 Write unit tests for the Stop_Alias_List
    - File `stopAliases.unit.test.ts`: `STOP_ALIAS_LIST` deep-equals the `ALIAS_TABLE` keys that map to STOP; `stopAliasAsset()` shape; `STOP`, `stop!`, `Band.`, `بند`, `  STOP please` pass; `STOPPED`, `!!! stop`, `please stop`, empty and fullwidth `ＳＴＯＰ` fail
    - _Requirements: 9.13, 17.7, 18.13_

  - [x] 7.4 Create `scripts/export-stop-aliases.ts` and `scripts/ts-resolve.mjs`
    - The script writes `stopAliasAsset()` as UTF-8 JSON to the `--out` path; `ts-resolve.mjs` maps relative `.js` specifiers to sibling `.ts` files
    - Add the `export:stop-aliases` script to `packages/brain/package.json`
    - _Requirements: 9.13, 17.7_

  - [x] 7.5 Write a test for the export script
    - File `stopAliases.script.test.ts`: run the script into a temp file and compare with `stopAliasAsset()`
    - _Requirements: 17.7_

- [x] 8. Implement the synchronous Gateway_Pipeline core
  - [x] 8.1 Create `gateway.pipeline.ts` with `evaluateInbound`, `completeReply`, `applyChanges`, `orderInbound`
    - Check order: paused branch, Automated_Sender, Own_Number, router (once), STOP, START (Stop_List removal, Allowlist gate → `started` with 0 parts), Stop_List, Allowlist_Mode (`'unreadable'` → `ignored-not-allowed`), Rate_Limiter with Slow_Down_Text once per window, cap at `handed === cap`, reply-text table, cap on `handed + parts > cap`
    - `aiAvailable === false` → Try_Later_Text for QUESTION/SCAM with an argument
    - `applyChanges` folds every `StateChange`, keeps one Stop_List entry and prunes rate records; `orderInbound` sorts by `(receivedAt, seq)`
    - _Requirements: 1.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.13, 4.1, 4.2, 4.3, 4.8, 4.9, 4.11, 5.1, 5.2, 5.3, 5.4, 5.7, 5.8, 5.12, 6.1, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.5, 9.10, 9.11, 16.18_

  - [x] 8.2 Write property test for STOP in every state
    - File `gateway.pipeline.stopstate.property.test.ts`
    - **Property 7: STOP is recorded in every state**
    - **Validates: Requirements 3.1, 3.2, 9.11**

  - [x] 8.3 Write property test for START handling
    - File `gateway.pipeline.start.property.test.ts`
    - **Property 8: START clears the Stop_List and replies only with Welcome_Back_Text**
    - **Validates: Requirements 3.4, 3.5, 3.13, 4.8, 4.11**

  - [x] 8.4 Write property test for the Allowlist gate
    - File `gateway.pipeline.allowlist.property.test.ts`
    - **Property 9: Allowlist gate**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.9**

  - [x] 8.5 Write property test for Slow_Down_Text frequency
    - File `gateway.pipeline.slowdown.property.test.ts`
    - **Property 14: At most one Slow_Down_Text per window**
    - **Validates: Requirements 5.3, 5.4**

  - [x] 8.6 Write property test for early exits
    - File `gateway.pipeline.earlyexit.property.test.ts`
    - **Property 15: Early exits leave the limiter and counters untouched**
    - **Validates: Requirements 5.7, 7.5, 4.11**

  - [x] 8.7 Write property test for the Daily_Send_Cap
    - File `gateway.pipeline.cap.property.test.ts`
    - **Property 16: The Daily_Send_Cap is never exceeded**
    - **Validates: Requirements 5.8, 5.12**

  - [x] 8.8 Write property test for automated senders and the Own_Number
    - File `gateway.pipeline.loop.property.test.ts`
    - **Property 20: Automated senders and the Own_Number are ignored**
    - **Validates: Requirements 7.1, 7.2**

  - [x] 8.9 Write property test for the paused gateway
    - File `gateway.pipeline.paused.property.test.ts`
    - **Property 23: Paused gateway answers nothing**
    - **Validates: Requirements 9.10**

  - [x] 8.10 Write property test for inbound ordering
    - File `gateway.pipeline.order.property.test.ts`
    - **Property 35: Inbound ordering**
    - **Validates: Requirements 1.7**

- [x] 9. Implement the async pipeline and send finalization
  - [x] 9.1 Add `runGatewayPipeline` and `finalizeSend` to `gateway.pipeline.ts`
    - `runGatewayPipeline`: evaluate, call `answerQuestion`/`checkScam` once with only the argument and Language, race against a 25 s `startTimer` backstop (late answers ignored), complete; catch router and splitter errors and fall back to Try_Later_Text, then to the literal single part; never rejects
    - `finalizeSend` per the design table (all sent keeps the Outcome; any failure → `send-failed` counting `sent` parts; `refused-stopped`/`cancelled` → `ignored-stopped` and release handed parts; `null` → 0 parts)
    - _Requirements: 3.8, 3.9, 6.1, 6.2, 6.3, 6.8, 6.9, 6.10, 6.13, 6.14, 6.15, 8.4, 8.5, 8.10, 16.18_

  - [x] 9.2 Write property test for STOP always wins
    - File `gateway.pipeline.stopwins.property.test.ts`; test name contains `Req 3.10`
    - **Property 6: STOP always wins**
    - **Validates: Requirements 3.10, 3.3, 3.1**

  - [x] 9.3 Write property test for the per-window rate invariant
    - File `gateway.pipeline.ratewindow.property.test.ts`; test name contains `Req 5.5`
    - **Property 12: At most Per_Number_Limit accepted per window**
    - **Validates: Requirements 5.5**

  - [x] 9.4 Write property test for per-number independence
    - File `gateway.pipeline.rateindependent.property.test.ts`; test name contains `Req 5.6`
    - **Property 13: Rate limiting is independent per number**
    - **Validates: Requirements 5.6**

  - [x] 9.5 Write property test that the AI never sees sender data
    - File `gateway.pipeline.aiprivacy.property.test.ts`
    - **Property 19: The AI never sees sender data**
    - **Validates: Requirements 6.9**

  - [x] 9.6 Write property test for exactly one valid Outcome
    - File `gateway.pipeline.outcome.property.test.ts`; test name contains `Req 7.4`; Mock_Client scripts include text, error, hang and throw
    - **Property 21: Exactly one valid Outcome**
    - **Validates: Requirements 7.4**

  - [x] 9.7 Write property test for Activity_Entry privacy
    - File `gateway.activity.privacy.property.test.ts`; test name contains `Req 14.8`
    - **Property 28: Activity entries never reveal the number**
    - **Validates: Requirements 14.8, 14.1, 14.2**

  - [x] 9.8 Write property test that bodies never reach stored data
    - File `gateway.pipeline.nobody.property.test.ts`
    - **Property 29: Bodies never reach stored data**
    - **Validates: Requirements 14.7**

  - [x] 9.9 Write property test for the reply source table
    - File `gateway.pipeline.replysource.property.test.ts`
    - **Property 17: Reply source follows the command table**
    - **Validates: Requirements 1.8, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7**

  - [x] 9.10 Write property test for reply part counts
    - File `gateway.pipeline.parts.property.test.ts`
    - **Property 18: Accepted replies have 1 to 4 parts**
    - **Validates: Requirements 6.8, 6.10**

  - [x] 9.11 Write property test for send finalization
    - File `gateway.finalize.property.test.ts`
    - **Property 22: Send finalization accounting**
    - **Validates: Requirements 3.8, 3.9, 8.4, 8.5, 8.10**

  - [x] 9.12 Write property test for the no-key path
    - File `gateway.pipeline.nokey.property.test.ts`
    - **Property 34: No key means busy reply only for AI commands**
    - **Validates: Requirements 16.18**

  - [x] 9.13 Write unit tests for each Outcome
    - File `gateway.pipeline.outcomes.unit.test.ts`: one example per Outcome (11), each asserting the Outcome and the Reply_Part count; `send-failed` and `ignored-stopped` via `finalizeSend` with a recording Sms_Sender double
    - _Requirements: 7.4, 18.3, 18.4_

  - [x] 9.14 Write unit tests for STOP safety and check order
    - File `gateway.pipeline.safety.unit.test.ts`: STOP under Allowlist_Mode for a non-listed sender, over the limit, at the cap and while paused; `refused-stopped` → `ignored-stopped`; START from a non-listed stopped number under Allowlist_Mode; START with `'unreadable'` Allowlist → `stop-remove`, `started`, 0 parts, and HELP in the same state → `ignored-not-allowed`; one test per adjacent pair in the Req 7.3 order
    - _Requirements: 3.2, 3.8, 4.8, 4.9, 4.11, 7.3, 9.11, 18.7_

  - [x] 9.15 Write unit tests for cap boundaries and the no-key path
    - File `gateway.pipeline.cap.unit.test.ts`: parts bringing `handed` exactly to the cap pass, one more part is `send-capped`; no key: QUESTION and SCAM with arguments give Try_Later_Text with 0 Mock_Client calls, HELP, STOP and START unchanged; one test asserting Mock_Client calls contain no Sender_Address, Canonical_Number, Masked_Number or Masked_Sender
    - _Requirements: 5.8, 6.9, 16.18, 18.3, 18.8, 18.9_

  - [x] 9.16 Write unit tests for routing calls and timeouts
    - File `gateway.pipeline.calls.unit.test.ts`: injected router, answer and splitter spies called exactly once with the exact body, argument and Language; hanging Mock_Client with fake timers gives Try_Later_Text at 25 s and a late answer is discarded; a throwing router gives the `en` Try_Later_Text
    - _Requirements: 6.1, 6.2, 6.3, 6.8, 6.13, 6.14, 6.15_

- [x] 10. Implement Pending_Stop_Records
  - [x] 10.1 Create `gateway.pending.ts`
    - `PendingStopRecord`, `decodePendingStopRecord` (exact keys `id`, `sender`, `marker: 'STOP'`, `receivedAt`; anything else → `null`), `orderPendingStops` (receivedAt, then id), `applyPendingStop` (Automated_Sender, Own_Number, STOP only; command STOP, 0 parts)
    - _Requirements: 3.2, 7.1, 7.2, 9.13, 9.15, 14.13_

  - [x] 10.2 Write property test for applying a Pending_Stop_Record
    - File `gateway.pending.apply.property.test.ts`
    - **Property 37: Applying a Pending_Stop_Record**
    - **Validates: Requirements 9.15, 3.2, 7.1, 7.2**

  - [x] 10.3 Write property test for Pending_Stop_Record ordering
    - File `gateway.pending.order.property.test.ts`
    - **Property 38: Pending_Stop_Records are applied in receive-time order**
    - **Validates: Requirements 9.15**

  - [x] 10.4 Write property test for strict decoding
    - File `gateway.pending.decode.property.test.ts`
    - **Property 39: Pending_Stop_Record decoding is strict**
    - **Validates: Requirements 14.13, 9.13**

  - [x] 10.5 Write unit tests for `applyPendingStop`
    - File `gateway.pending.unit.test.ts`: Phone_Number → `stopped`, one `stop-add`, 0 parts; `JAZZ` → `ignored-automated`, Stop_List unchanged; national-format Own_Number → `ignored-own-number`, Stop_List unchanged; Activity_Entry has the record's receive time and Command STOP
    - _Requirements: 9.15, 18.13_

- [x] 11. Implement the state wire format
  - [x] 11.1 Create `gateway.state.ts`
    - `decodeStoredState` (from the `loadState` JSON; `allowlist: null` → `'unreadable'`; drop values failing `isCanonicalNumber`; settings via `parseSettings`; returns the parse status for the reset banner) and `serializeChanges`
    - _Requirements: 3.7, 4.9, 10.6, 15.2, 15.5_

  - [x] 11.2 Write unit tests for the state wire format
    - File `gateway.state.unit.test.ts`: valid payload, unreadable Allowlist, invalid numbers dropped, invalid settings → defaults with `invalid`, `serializeChanges` round trip through `JSON.parse`
    - _Requirements: 3.7, 4.9, 15.5_

- [x] 12. Add the React Native Gemini REST variant
  - [x] 12.1 Extract `gemini.core.ts` from `gemini.entry.ts`
    - Move `mapSdkError`, `createGeminiCore`, `GenaiLike`, `GeminiOptions` into `gemini.core.ts`; `gemini.entry.ts` re-exports them and keeps `createGeminiClient` with the SDK default; existing `gemini.*.test.ts` pass unchanged
    - _Requirements: 16.17_

  - [x] 12.2 Create `gemini.native.ts` and update the brain `package.json` exports
    - `FetchLike`, `createRestGenai(apiKey, fetch, timeoutMs?)` (POST `…/v1beta/models/{model}:generateContent`, key only in the `x-goog-api-key` header, `GeminiHttpError` on non-2xx, abort → timeout), `createGeminiClient` that never reads `process.env`
    - `"./gemini": { "react-native": "./src/gemini.native.ts", "default": "./src/gemini.entry.ts" }`
    - _Requirements: 16.1, 16.14, 16.17, 16.23_

  - [x] 12.3 Write unit tests for `gemini.native.ts`
    - File `gemini.native.unit.test.ts` with a fake `fetch`: URL uses `DEFAULT_GEMINI_MODEL`, header and body shape; 429 → `quota`, 503 → `network`, abort → `timeout`; no `process.env` read; the key never appears in the URL, thrown messages or log lines
    - _Requirements: 16.1, 16.14, 16.17_

- [x] 13. Wire the brain exports
  - [x] 13.1 Update `packages/brain/src/index.ts`
    - Export every Gateway_Module symbol from `gateway.*.ts`, `stopAliases.ts` and `gateway.pending.ts` with the `.js` suffix convention
    - _Requirements: 17.7, 17.10_

  - [x] 13.2 Write an export test for the Gateway_Module
    - File `gateway.exports.test.ts`: import every public function from the package entry; `expectTypeOf` checks for `Outcome` and `SleepReason`
    - _Requirements: 17.6, 17.10_

- [x] 14. Checkpoint - Ensure all brain tests pass
  - Run `vitest --run`, `tsc --noEmit` and lint in `packages/brain`; the suite finishes within 120 s. Ensure all tests pass, ask the user if questions arise.

- [x] 15. Configure the Necromancer build and manifest
  - [x] 15.1 Update `android/build.gradle` and `android/app/build.gradle`
    - `minSdkVersion = 26`, `targetSdkVersion = 35`, `compileSdkVersion` ≥ 35; `react { debuggableVariants = [] }`; `androidx.security:security-crypto:1.1.0`; `testImplementation` JUnit for JVM tests
    - Register the `generateStopAliases` `Exec` task (inputs `aliases.ts`, `stopAliases.ts`; output `build/generated/lazarus/assets/stop_aliases.json`) before `merge*Assets` and add the directory to `sourceSets.main.assets.srcDirs`
    - _Requirements: 17.1, 17.2, 9.13, 17.7_

  - [x] 15.2 Update `package.json`, `metro.config.js` and `jest.config.js`
    - `"@lazarus/brain": "file:../../packages/brain"` and `codegenConfig` for the four specs
    - Metro `watchFolders`, `nodeModulesPaths`, `resolveRequest` mapping `./x.js` to `./x.ts` inside `packages/brain/src`, `react-native` condition
    - Jest `moduleNameMapper` (`@lazarus/brain` → `index.ts`, `@lazarus/brain/gemini` → `gemini.native.ts`, `.js` suffix strip) and `transformIgnorePatterns` for brain sources
    - _Requirements: 16.17, 17.7, 17.10, 18.11_

  - [x] 15.3 Update `AndroidManifest.xml` and add `res/xml/data_extraction_rules.xml`
    - Permissions RECEIVE_SMS, SEND_SMS, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, WAKE_LOCK, INTERNET; none of READ_SMS, WRITE_SMS, READ_CONTACTS or location
    - `allowBackup="false"`, `fullBackupContent="false"`, `dataExtractionRules` excluding `sharedpref`, `database`, `file`, `root` from cloud backup and device transfer
    - `GatewayService` (`specialUse`, `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`), `PausedInboxTaskService`, `SmsReceiver` (exported, `BROADCAST_SMS`), `SendResultReceiver` (not exported), `BootReceiver`, `WatchdogReceiver`, `RestartReceiver`
    - _Requirements: 16.22, 17.4, 17.5_

  - [x] 15.4 Write a Jest test for the manifest
    - File `__tests__/manifest.test.ts`: required permissions present, forbidden permissions absent, `specialUse` type and subtype present, backup exclusions present
    - _Requirements: 16.22, 17.4, 17.5_

- [x] 16. Define TurboModule specs and typed ports
  - [x] 16.1 Create `src/native/specs/NativeGateway.ts`, `NativeStore.ts`, `NativeDevice.ts`, `NativeKeyStore.ts`
    - Codegen specs exactly as in the design, including `takePendingStops`, `applyPendingStop`, `savePendingStop`, `cancelPendingSends` and the event emitters
    - _Requirements: 1.4, 3.8, 3.9, 9.13, 9.15, 16.5, 16.8, 16.15_

  - [x] 16.2 Create `src/native/ports.ts`
    - `GatewayPorts` interface and the live implementation; decoders for `InboundPayload`, `SendReportPayload`, `DeviceStatusPayload`, `KeyRead` and setup marks that drop malformed fields and log only masked values
    - _Requirements: 14.6, 16.14, 16.20_

  - [x] 16.3 Create `__tests__/support/mockPorts.ts`
    - A recording `GatewayPorts` mock with scripted results for every method, including failing `commit`, `applyPendingStop`, `loadState` and `readKey`
    - _Requirements: 18.11_

  - [x] 16.4 Write unit tests for the port decoders
    - File `__tests__/ports.test.ts`: valid payloads pass, wrong types are dropped without throwing, no log line contains a full number
    - _Requirements: 14.6_

- [x] 17. Implement Kotlin storage, the Stop_Keyword_Check and the Api_Key_Store
  - [x] 17.1 Create `LazarusDb` and `StoreModule`
    - Schema version 1 from the design (`stop_list`, `allowlist`, `rate_record`, `slowdown`, `counters`, `kv`, `activity`, `pending_inbox`, `pending_stop` with exactly 3 columns and no body), WAL
    - `loadState`, `commit` (one transaction, `INSERT OR IGNORE` for `stop-add`, rate pruning), `saveSettings`, `appendActivity` (insert + trim to 200), `applyPendingStop` (delete row + changes + activity in one transaction), `savePendingStop`, `loadActivity`, `clearActivity`, setup marks
    - _Requirements: 3.6, 3.7, 4.6, 5.13, 9.16, 9.17, 12.7, 14.1, 14.3, 14.10, 15.1, 15.2_

  - [x] 17.2 Create `LogMask`, `StopKeywordCheck` and `PendingStopStore`
    - `LogMask.tail3`; `StopKeywordCheck` loads `stop_aliases.json` once, requires `v == 1`, no keyword literals, returns false and logs once when the asset is unreadable; `PendingStopStore.insert(sender, receivedAt)` with no body parameter and one masked log line
    - _Requirements: 9.13, 14.13, 14.14, 17.7_

  - [x] 17.3 Write Kotlin JVM tests for `LogMask` and `StopKeywordCheck`
    - Read the generated asset; same answers as the brain `stopKeywordCheck` examples; missing asset → false; `tail3` for empty, 1 to 3 characters, a long number and an alphanumeric ID
    - _Requirements: 9.13, 14.14, 17.7_

  - [x] 17.4 Create `ApiKeyStore`, `EncryptedApiKeyStore` and `KeyStoreModule`
    - EncryptedSharedPreferences file `lazarus_key`, master key alias `_lazarus_key_master_`; `read` → present/absent/unreadable with one log line naming only the exception class; `write` after a failure deletes and recreates the file and alias; `delete`
    - _Requirements: 16.5, 16.6, 16.8, 16.14, 16.15, 16.16, 16.20, 16.21, 16.22_

- [x] 18. Implement Kotlin SMS receive and the paused path
  - [x] 18.1 Create `InboxQueue`
    - Process singleton: memory deque plus `pending_inbox`; `takeNext()` by `(receivedAt, seq)`; pending rows loaded first on service start; `seq` from an `AtomicLong` seeded from the table; `complete(id)` drops the body and deletes the row
    - _Requirements: 1.6, 1.7, 10.8, 14.7_

  - [x] 18.2 Create `SmsReceiver`
    - Group PDUs by `originatingAddress` in PDU order, join bodies, stamp `System.currentTimeMillis()`; decode failures log one masked line
    - Branches: paused → `startService(PausedInboxTaskService)` with Intent extras, on throw → `StopKeywordCheck` → `PendingStopStore.insert` or one masked "dropped while paused" line; running with loop attached → memory queue; otherwise → `pending_inbox` row and `startForegroundService`
    - Never touches the SMS inbox; keep grouping and branch selection in pure helpers for JVM tests
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 9.12, 9.13, 9.14_

  - [x] 18.3 Create `PausedInboxTaskService`
    - `HeadlessJsTaskService` running `LazarusPausedInbox`, timeout 15 s, `START_NOT_STICKY`, one task per message, body only in Intent extras
    - _Requirements: 9.10, 9.12_

  - [x] 18.4 Write Kotlin JVM tests for receive helpers
    - PDU grouping for one and two senders and for UCS-2 Urdu bodies; refused-task branch with a fake store and logger writes one `pending_stop` row for `STOP please` and none for `HELP`, and exactly one log line whose address part equals `LogMask.tail3`
    - _Requirements: 1.2, 1.3, 9.13, 9.14, 14.13, 14.14_

- [x] 19. Implement the Kotlin Gateway_Service and SMS sending
  - [x] 19.1 Create `GatewayNotification`, `GatewayService` and `RestartReceiver`
    - Channel `gateway`; text with the state word and replies today only; `setOngoing`, content intent opens `MainActivity`, `deleteIntent` re-posts within 5 s
    - `GatewayService` extends `HeadlessJsTaskService`, calls `startForeground` with `FOREGROUND_SERVICE_TYPE_SPECIAL_USE`, runs `LazarusGateway` (timeout 0, allowed in foreground), returns `START_STICKY`, holds a partial wake lock while processing, schedules `RestartReceiver` 5 s after `onTaskRemoved`/`onDestroy` when not paused
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 9.7_

  - [x] 19.2 Create `SendResultReceiver`, `SendTracker` and `SendQueue`/`SmsSender`
    - FIFO, one multipart send at a time on a `HandlerThread`; read `stop_list` before every attempt → `refused-stopped`; `calculateLength` check → `failed-other`; default SIM `SmsManager.sendMultipartTextMessage`
    - Result-code mapping; 60 s Send_Timeout per part → `failed-no-service`; one retry 30 s after radio or no-service failure; `cancel(number)` resolves queued and retry-waiting items `cancelled`; `onSendState` events
    - _Requirements: 3.8, 3.9, 8.1, 8.2, 8.3, 8.6, 8.7, 8.8, 13.2_

  - [x] 19.3 Write Kotlin JVM tests for sending helpers
    - Result-code mapping; `SendTracker` with a fake clock: timeout at 60 s, one retry at 30 s, no second retry, Stop_List hit before the first attempt and before the retry → `refused-stopped`; `cancel` during the retry wait → `cancelled`
    - _Requirements: 3.8, 3.9, 8.2, 8.3, 8.8_

  - [x] 19.4 Create `GatewayModule`
    - TurboModule for `NativeGateway`: start, pause (persist `paused=1`, stop, remove notification), resume, status, `attachLoop`, `takeNextInbound`, `waitForInbound`, `completeInbound`, `sendParts`, `cancelPendingSends`, `takePendingStops`, `updateNotification`, events
    - _Requirements: 1.4, 1.7, 9.1, 9.2, 9.5, 9.8, 9.15_

- [x] 20. Implement Kotlin boot, Device_Status and settings intents
  - [x] 20.1 Create `BootReceiver` and `WatchdogReceiver`
    - `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED`: not paused → `startForegroundService` and a watchdog alarm in 60 s; paused → nothing; watchdog posts exactly 1 "open Necromancer and check the Setup screen" notification when the service is still not running; the boot decision is a pure helper
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 9.9_

  - [x] 20.2 Write Kotlin JVM tests for the boot decision
    - Paused and not paused for both actions; watchdog fires only when the service is not running and not paused
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 20.3 Create `SettingsIntents`
    - HyperOS Autostart component with `resolveActivity` check and App info fallback; battery optimisation request with two fallbacks; App info; airplane mode; mobile network settings with fallback
    - _Requirements: 11.6, 11.7, 12.2, 12.3, 12.4, 12.5, 12.11, 13.7_

  - [x] 20.4 Create `DeviceStatusMonitor`, `RestrictedSettings` and `DeviceModule`
    - Permission, notification, battery and airplane checks; service state through `TelephonyCallback.ServiceStateListener` (API 31+) or `PhoneStateListener` (26–30), cached; `onDeviceStatus` on change
    - `RestrictedSettings` app-op check on API 33+ inside `try/catch`; `DeviceModule` exposes status, restricted check and the `SettingsIntents` methods
    - _Requirements: 11.7, 11.10, 12.6, 13.11, 13.14_

  - [x] 20.5 Create `LazarusPackage` and register it in `MainApplication`
    - `BaseReactPackage` registering `GatewayModule`, `StoreModule`, `DeviceModule`, `KeyStoreModule`
    - _Requirements: 17.2, 17.3_

- [x] 21. Checkpoint - Ensure the build and tests pass
  - Run `./gradlew assembleDebug` and the JVM tests in `android`, and `jest` in `apps/necromancer`. Ensure all tests pass, ask the user if questions arise.

- [x] 22. Implement the JS gateway glue
  - [x] 22.1 Create `src/gateway/commitQueue.ts`
    - One promise chain for all writes; batches with `stop-add`/`stop-remove` retry 3 times at 1 s, then raise the "Stop list could not be saved" banner
    - _Requirements: 3.6, 3.12_

  - [x] 22.2 Create `src/gateway/ai.ts`
    - Read the key through the `KeyStore` port, build `createGeminiClient({ env: { GEMINI_API_KEY: key } })` from `@lazarus/brain/gemini` with no model, plus `createMemoryCache`; hold only the client and the Masked_Key; rebuild on save or remove; `null` when absent or unreadable; never log the key
    - _Requirements: 16.1, 16.6, 16.8, 16.14, 16.15, 16.17, 16.18, 16.20_

  - [x] 22.3 Create `src/gateway/pendingStops.ts`
    - `applyPendingStops(ports, state)`: `takePendingStops` → `decodePendingStopRecord` → `orderPendingStops` → `applyPendingStop` → `store.applyPendingStop` with 3 retries at 1 s; on final failure keep the row and the in-memory `stop-add`
    - _Requirements: 9.15, 9.16, 3.12_

  - [x] 22.4 Create `src/gateway/store.ts`
    - Observable UI store for heartbeat inputs, counters, banners, activity list and inbound pulses, read with `useSyncExternalStore`
    - _Requirements: 5.9, 13.6, 13.11, 13.12_

  - [x] 22.5 Create `src/gateway/loop.ts`
    - `startGatewayLoop(ports, clock)` per the design outline: singleton guard, load state until the Stop_List is readable (SLEEPING `service-stopped`, retry every 30 s), read key, apply pending stops, `attachLoop`, drain in order, pipeline, commit, `completeInbound`, `cancelPendingSends` after `stopped`, refuse `sendParts` for numbers in the in-memory Stop_List, finalize, append activity (failures logged masked, processing continues), update notification
    - _Requirements: 1.6, 1.7, 3.6, 3.7, 3.9, 3.11, 3.12, 6.12, 8.10, 9.2, 9.15, 14.1, 14.7, 14.12, 15.2, 15.8_

  - [x] 22.6 Create `src/gateway/pausedTask.ts`
    - `LazarusPausedInbox`: load state, apply pending stops, `runGatewayPipeline` with `paused: true` and `answer: null`, commit a STOP (on final failure `savePendingStop(sender, receivedAt)`), append the Activity_Entry, end; never starts the Gateway_Service
    - _Requirements: 9.10, 9.11, 9.12, 9.13, 9.15_

  - [x] 22.7 Update `index.js`
    - `registerComponent`, `registerHeadlessTask('LazarusGateway')` for the loop, `registerHeadlessTask('LazarusPausedInbox')` for the paused task
    - _Requirements: 9.6, 9.12_

  - [x] 22.8 Write Jest tests for the loop glue
    - File `__tests__/loop.test.ts`: call order `loadState` → `readKey` → `takePendingStops`/`applyPendingStop` → `attachLoop` → `takeNextInbound`; commit before the next take; `completeInbound` after commit; `cancelPendingSends` after `stopped`; 3 retries then banner; `loadState` rejection holds the queue; `appendActivity` rejection keeps processing; `unreadable` key does not crash
    - _Requirements: 3.6, 3.9, 3.11, 3.12, 14.12, 16.20_

  - [x] 22.9 Write Jest tests for the paused path and Pending_Stop_Records
    - File `__tests__/pausedPath.test.ts`: a paused `STOP please call me` whose commit fails stores exactly `sender`, `marker: 'STOP'`, `receivedAt` and none of the body text; a persisted record is applied before a live message and before a Pending_Inbox message; the record is deleted after success and kept after 4 failures; a paused HELP records `ignored-paused`, no `savePendingStop`, no service start, no AI call
    - _Requirements: 9.10, 9.12, 9.13, 9.15, 9.16, 14.13, 18.14_

  - [x] 22.10 Write source guard tests
    - File `__tests__/sourceGuards.test.ts`: `apps/necromancer/src` contains no `process.env`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `: any` or `as any`; no file under `apps/necromancer` matches the API key pattern; no Kotlin file under `android/app/src` contains `"band"` or `"بند"`
    - _Requirements: 16.1, 16.2, 16.24, 17.6, 17.7, 17.11_

- [x] 23. Implement the UI
  - [x] 23.1 Create `src/ui/theme.ts`
    - Exactly the design tokens: colours, radius 14, spacing 4/8/12/16/24/32, minimum font 16
    - _Requirements: 17.8, 17.9_

  - [x] 23.2 Write Jest tests for the theme
    - File `__tests__/theme.test.ts`: WCAG contrast ≥ 4.5:1 for every text/background pair used, font sizes ≥ 16, radius 14, spacing in the allowed set
    - _Requirements: 17.8, 17.9_

  - [x] 23.3 Create `src/ui/startScreen.ts`
    - `chooseStartScreen(perms, setupMarks)`: Permission_Screen while any permission is missing, then Setup_Screen while any step is not done, then Main_Screen
    - _Requirements: 11.1, 12.13_

  - [x] 23.4 Create `src/ui/Heartbeat.tsx`
    - ALIVE pulse every 1.5 s in `soul`, one extra pulse per inbound event, SENDING `ember` glow, SLEEPING flat `muted` line; Reduced_Motion via `AccessibilityInfo` with no loops; state word always as text; native driver
    - _Requirements: 13.5, 13.6, 13.7, 13.8, 13.9, 13.10_

  - [x] 23.5 Create `src/ui/screens/PermissionScreen.tsx`
    - Three explanations (≤ 300 characters each), privacy statement above the continue button, request only missing permissions after the tap, ask-again list, App info button for `never_ask_again`, 4 restricted-settings steps, re-check on `AppState` `active`
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_

  - [x] 23.6 Create `src/ui/screens/SetupScreen.tsx`
    - 6 Setup_Steps in order with ≤ 120-character explanations, live done marks from Device_Status and the key store, persisted manual marks for Autostart and recent apps, fallback instructions after a failed intent that stay visible, Main_Screen button only when all done
    - AI key step: Key_Input_Field (no autocorrect, suggestions or capitalisation; value in component state, cleared on save and unmount), `validateApiKey`, `API_KEY_INVALID_MESSAGE`, "key saved" with `maskApiKey`, remove-key confirmation, "paste the key again" when unreadable
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.11, 12.12, 12.14, 16.3, 16.4, 16.5, 16.7, 16.8, 16.9, 16.10, 16.11, 16.20_

  - [x] 23.7 Create `src/ui/screens/MainScreen.tsx`
    - Heartbeat with `deriveHeartbeat`, one SLEEPING sentence and fix button per Sleep_Reason, 4 day counters, banners (cap reached, AI key missing with a button to the AI key step, Stop_List or Allowlist unreadable, settings reset, phone status unreadable after 5 s), Activity_Log newest first with local time and masked `who`, clear with confirmation, start/pause/resume, Setup and Settings buttons
    - _Requirements: 3.11, 3.12, 4.9, 5.9, 9.1, 9.5, 9.7, 9.8, 9.9, 12.10, 13.7, 13.11, 13.12, 13.15, 14.4, 14.5, 14.9, 14.10, 14.11, 15.5, 16.19_

  - [x] 23.8 Create `src/ui/screens/SettingsScreen.tsx`
    - Edit fields through `validateSettingsField` with range messages, Allowlist add through `addToAllowlist` with duplicate, invalid and full messages, Allowlist and Stop_List shown through `maskNumber`, Stop_List read-only, "Change not saved" on failure
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.10, 5.10, 5.11, 14.5, 15.1, 15.6, 15.7_

  - [x] 23.9 Update `App.tsx`
    - State-based screen switcher using `chooseStartScreen`; Permission_Screen opened from the permissions step returns to Setup_Screen; opening Setup_Screen does not stop the Gateway_Service
    - _Requirements: 11.1, 11.9, 12.10, 12.12, 12.13, 17.3_

  - [x] 23.10 Write Jest tests for start screen, setup and key UI
    - File `__tests__/setupAndKey.test.tsx`: `chooseStartScreen` for each combination; 6 Setup_Step done marks from mocked status; Key_Input_Field cleared after save and the Masked_Key shown; invalid key shows the fixed message with no save call; remove-key confirm and cancel; missing-key banner on Main_Screen; `readKey` unreadable renders without crashing
    - _Requirements: 12.6, 12.13, 16.4, 16.5, 16.7, 16.8, 16.9, 16.11, 16.19, 16.20, 18.12_

  - [x] 23.11 Write Jest tests for Permission, Main and Settings screens
    - File `__tests__/screens.test.tsx`: explanation lengths and privacy text placement; only missing permissions requested; `never_ask_again` App info button; restricted steps; each heartbeat word rendered; reduced motion with no `Animated.loop`; SLEEPING sentence ≤ 120 characters and correct fix action; cap banner; activity clear dialog; no rendered text with 4+ consecutive digits of a mocked number; Settings range and Allowlist messages
    - _Requirements: 11.2, 11.3, 11.4, 11.6, 11.7, 13.7, 13.9, 13.10, 14.5, 14.9, 14.11, 4.5, 4.10, 5.11_

- [x] 24. Write the Necromancer README
  - [x] 24.1 Update `apps/necromancer/README.md`
    - Debug build (`cd android && ./gradlew assembleDebug`) and sideload (`adb install -r app/build/outputs/apk/debug/app-debug.apk`); HyperOS setup (restricted settings, permissions, AI key, Autostart, battery "No restrictions", lock in recents)
    - "Known limitations" section with the three limitations, including the 60-second Send_Timeout and 30-second retry wait delaying later replies beyond 30 seconds
    - _Requirements: 17.2, 17.12_

  - [x] 24.2 Write a Jest test for the README and the stop alias asset
    - File `__tests__/docs.test.ts`: README has a `Known limitations` heading and mentions the 60-second Send_Timeout, the 30-second retry wait, the fallback STOP detection and unlogged paused messages; running the export script into a temp file equals `stopAliasAsset()`
    - _Requirements: 17.7, 17.12_

- [x] 25. Final checkpoint - Ensure all tests pass
  - Run `vitest --run` in `packages/brain`, `jest` in `apps/necromancer`, `tsc --noEmit` in both, the Kotlin JVM tests and `./gradlew assembleDebug`. Ensure all tests pass, ask the user if questions arise.

- [~] 26. Manual on-device checklist (Xiaomi, Android 15, HyperOS)
  - Install the debug APK with `adb install -r`; first open shows Permission_Screen or Setup_Screen within 10 s (Req 17.3)
  - Permission and setup flow, including restricted settings, Autostart, battery and AI key steps
  - Urdu multipart receive and multipart send order; screen off for 1 hour; swipe away from recents
  - Reboot with and without pause; airplane mode heartbeat
  - STOP then a message (no reply), START (Welcome_Back_Text), rate limit with one Slow_Down_Text, missing key busy reply
  - STOP while paused, then resume: no reply and the number is on the Stop_List
  - _Requirements: 9.6, 10.1, 10.2, 13.14, 17.2, 17.3_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Requirement 18 tests and the safety-critical properties are not marked optional.
- Each task references specific requirements for traceability.
- Every property test uses at least 100 runs and the tag comment `// Feature: necromancer-sms-gateway, Property N: <title>`; Requirement 18.2 properties carry the requirement number in the test name.
- Each property test has its own file so tasks in the same wave never write the same file.
- The brain suite runs with the existing `test.setup.ts` guard: no global `fetch` and no `GEMINI_*` reads outside `gemini.*.test.ts`.
- The generated `stop_aliases.json` lives only under `android/app/build/generated/` and is never committed.
- Task 26 is a manual check on the target phone and is not part of the dependency graph.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "12.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "12.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "3.1", "3.4", "4.1", "5.1", "5.5", "5.9", "12.3"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "3.2", "3.3", "3.5", "4.2", "4.3", "4.4", "5.2", "5.3", "5.4", "5.6", "5.7", "5.8", "5.10", "7.1", "11.1"] },
    { "id": 4, "tasks": ["7.2", "7.3", "7.4", "8.1", "11.2"] },
    { "id": 5, "tasks": ["7.5", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "9.1"] },
    { "id": 6, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9", "9.10", "9.11", "9.12", "9.13", "9.14", "9.15", "9.16", "10.1"] },
    { "id": 7, "tasks": ["10.2", "10.3", "10.4", "10.5", "13.1"] },
    { "id": 8, "tasks": ["13.2", "15.1", "15.2", "15.3", "16.1"] },
    { "id": 9, "tasks": ["15.4", "16.2", "17.1", "17.2", "17.4", "18.1", "20.3"] },
    { "id": 10, "tasks": ["16.3", "16.4", "17.3", "18.3", "19.1", "19.2", "20.4", "22.1", "22.2", "22.4", "23.1", "23.3"] },
    { "id": 11, "tasks": ["18.2", "19.3", "19.4", "20.1", "22.3", "23.2", "23.4"] },
    { "id": 12, "tasks": ["18.4", "20.2", "20.5", "22.5", "22.6", "23.5", "23.6", "23.7", "23.8"] },
    { "id": 13, "tasks": ["22.7", "22.8", "22.9", "22.10", "23.9"] },
    { "id": 14, "tasks": ["23.10", "23.11", "24.1"] },
    { "id": 15, "tasks": ["24.2"] }
  ]
}
```
