# Implementation Plan: AI Answer Service

## Overview

Implement the Answer_Service in `packages/brain/src/` bottom-up: AI client types and mock, fixed texts and constants, pure helpers (text shortening, redaction, cache key, cache, topic classifier, prompt builder, scam parser and printer), the call policy, then the `answerQuestion` and `checkScam` orchestration, the Gemini adapter as a separate entry point built on the official `@google/genai` SDK (pinned to an exact version, injected through a `GenaiLike` factory), and finally the package exports, `.env.example`, `.gitignore` and repository checks. All code is TypeScript strict mode with no `any`. The service reuses `Language`, `detectLanguage`, `normalizeMessage`, `splitSms`, `joinSms`, `detectEncoding`, `getPartLimits`, `MAX_PARTS` and the unit helpers from the existing modules and re-implements none of them.

Tests use Vitest and fast-check. Each property test runs at least 100 iterations through the shared `PBT_OPTIONS` constant (`numRuns: 100`) and carries the tag comment `// Feature: ai-answer-service, Property N: <title>`. Every task group ends with a checkpoint that runs `npm test`, `npm run typecheck` and `npm run lint` from `packages/brain` and requires all three to pass. The design contains a Correctness Properties section, so each property is its own required sub-task.

## Tasks

- [x] 1. Set up AI client types, mock, fixed texts and test support
  - [x] 1.1 Create `ai.types.ts` and `ai.mock.ts`
    - `Prompt`, `AiClient`, `AI_ERROR_KINDS`, `AiErrorKind`, `AiError`, `isAiError`, `toAiError` (foreign values become kind `unknown` with a fixed message)
    - `MockStep`, `MockClient`, `createMockClient` (steps consumed in order, last step repeats; supports `text`, `error`, `reject`, `throws`, `value` and `hang`; records `calls`; reads no env and makes no network call)
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 8.3_
  - [x] 1.2 Create `answer.types.ts` and `answer.texts.ts`
    - Types: `Topic`, `RequestKind`, `ScamVerdict`, `ScamResult`, `AnswerCache`, `AnswerDeps` (no sender or phone field)
    - Constants: `TARGET_PARTS`, `MAX_QUESTION_CODE_POINTS`, `MAX_REASON_CODE_POINTS`, `CACHE_TTL_MS`, `CACHE_MAX_ENTRIES`, `CALL_TIMEOUT_MS`, `LEAK_RUN_LENGTH`, `REDACTED`, `OPEN_DELIMITER`, `CLOSE_DELIMITER`
    - `FIXED_TEXTS` for `en`, `ur`, `roman-ur` (tryLater, promptForQuestion, promptForScamText, uncertainty, referral per topic, scamWord, scamReason) plus the topic, live-fact and price keyword lists in English, Urdu script and Roman Urdu
    - _Requirements: 1.1, 4.4, 4.5, 4.6, 7.8, 7.7, 8.8, 10.7_
  - [x] 1.3 Create `answer.arbitraries.ts` and the test guard setup
    - Export `PBT_OPTIONS` (`numRuns: 100`) and arbitraries: mixed-script text, whitespace variants, keyword-embedded questions, secrets (excluding substrings of `[redacted]` and strings with `[` or `]`), valid `ScamResult`, client scripts, phone-like digit runs
    - Add a Vitest setup file that fails any test calling global `fetch` and any non-adapter test reading `GEMINI_API_KEY` or `GEMINI_MODEL`; register it in `vitest.config.ts`
    - Reuse `arbitraries.ts` and `router.arbitraries.ts` where they fit
    - _Requirements: 1.6, 13.1, 13.8_
  - [x] 1.4 Write unit tests for AI types, mock client and fixed texts
    - File `answer.texts.unit.test.ts`; test `isAiError` and `toAiError`, every `MockStep` kind, last-step repeat and call recording
    - Test each Language: `ur` texts have no Latin letters, `roman-ur` texts have no Urdu script, every `tryLater` is non-blank with `splitSms(tryLater).length === 1`, no fixed text has a newline, no referral or note is a substring of another fixed text, verdict words contain no colon
    - _Requirements: 1.3, 4.4, 4.5, 4.6, 8.8, 13.7_

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement text helpers
  - [x] 3.1 Create `answer.text.ts`
    - `stripMarkdown` (per-line list marker removal, delete `*`, `_`, `#`, backtick, then `normalizeMessage`)
    - `fitsSms` (`joinSms(splitSms(t)) === t`), `smartCut`, `shortenToFit` (600 code unit pre-cut, binary search, then step-down loop), `hasPromptLeak` (40-character windows), `removeAll`
    - Reuse `splitSms`, `joinSms`, `isHighSurrogate`, `WORD_BOUNDARY_WINDOW`; do not duplicate budget math
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.8, 11.4_
  - [x] 3.2 Write property test for shortening
    - **Property 3: Shortening keeps a clean prefix and an intact suffix**
    - File `answer.text.property.test.ts`; generate model text with surrogate pairs and Urdu script plus fixed suffixes
    - **Validates: Requirements 3.4, 3.5**
  - [x] 3.3 Write property test for markdown stripping
    - **Property 4: Markdown markers are removed**
    - File `answer.text.property.test.ts`
    - **Validates: Requirements 3.8**
  - [x] 3.4 Write unit tests for text helpers
    - File `answer.text.unit.test.ts`; cover sentence-end cut, word-boundary cut within 15 units, exact-limit cut, no cut inside a surrogate pair, model text shrinking to empty, `hasPromptLeak` at 39 and 40 matching characters and a system text shorter than 40, `removeAll` with repeated copies
    - _Requirements: 3.3, 3.4, 3.5, 3.8, 11.4_

- [x] 4. Implement the redactor
  - [x] 4.1 Create `answer.redact.ts`
    - `redactSecrets`: ignore empty secrets, mark overlapping occurrences as intervals, merge, replace with `[redacted]`, repeat up to 5 passes, case-sensitive
    - `maskPhoneNumbers`: `/\+?\d(?:[ -]*\d){6,}/g`, mask all digits except the last 3, keep `+`, spaces and hyphens in place
    - _Requirements: 10.2, 10.3, 10.5, 10.6_
  - [x] 4.2 Write property test for secret redaction
    - **Property 25: Redaction removes every secret**
    - File `answer.redact.property.test.ts`; text of 0 to 5,000 characters with secrets inserted 0 or more times, including overlapping and repeated insertions; empty or all-empty secret list returns the input unchanged
    - **Validates: Requirements 10.2, 10.3, 13.6**
  - [x] 4.3 Write property test for phone-number masking
    - **Property 26: Phone-number masking keeps the last 3 digits**
    - File `answer.redact.property.test.ts`; runs of 7 or more digits keep length, punctuation and the last 3 digits; runs of 6 or fewer digits are unchanged
    - **Validates: Requirements 10.5, 10.6**
  - [x] 4.4 Write unit tests for the redactor
    - File `answer.redact.unit.test.ts`; empty list, empty-string secret, repeated secret, overlapping secrets, `+92 300-1234567` style number, six-digit run left alone
    - _Requirements: 10.2, 10.3, 10.5, 10.6_

- [x] 5. Implement cache key and memory cache
  - [x] 5.1 Create `answer.key.ts`
    - `buildCacheKey(kind, language, text)` as `JSON.stringify([kind, language, foldLatin(normalizeMessage(text))])`, where `foldLatin` lower-cases only `A-Z`
    - _Requirements: 7.1, 7.5, 7.7_
  - [x] 5.2 Create `answer.cache.ts`
    - `createMemoryCache(maxEntries = CACHE_MAX_ENTRIES)` over a `Map`; `get` drops expired entries (`expiresAt <= now`) and re-inserts hits to mark use; `set` replaces, then evicts the oldest key while over capacity; `size`
    - _Requirements: 7.3, 7.4, 7.8, 7.9, 7.11_
  - [x] 5.3 Write property test for cache keys
    - **Property 11: Cache keys ignore case and whitespace**
    - File `answer.key.property.test.ts`; keys differ when kind or Language differs
    - **Validates: Requirements 7.1, 7.5, 13.3**
  - [x] 5.4 Write property test for the memory cache
    - **Property 15: The cache is bounded and evicts least recently used**
    - File `answer.cache.property.test.ts`; model-based test against a reference LRU where a hit counts as use
    - **Validates: Requirements 7.8, 7.9**
  - [x] 5.5 Write unit tests for key and cache
    - File `answer.cache.unit.test.ts`; default capacity is 500, entry live at `expiresAt - 1` and missing at `expiresAt`, overwrite keeps one entry, eviction order after a read
    - _Requirements: 7.4, 7.8, 7.9_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the topic classifier
  - [x] 7.1 Create `answer.topic.ts`
    - `classifyTopic` (priority `health`, `legal`, `money`; Latin keywords case-insensitive whole words, Urdu keywords as substrings; list for the Language plus the English list), `asksForLiveFacts`, `asksForPriceOrRate`, `containsUnsupportedAmount` (maps Arabic-Indic digits to ASCII, removes thousands separators, compares against numbers in the question)
    - Blank input returns `{ sensitive: false, topic: null }` and `false`
    - _Requirements: 5.1, 5.5, 6.2, 6.3, 6.4, 6.5_
  - [x] 7.2 Write property test for classifier matching rules
    - **Property 8: Classifier matching rules**
    - File `answer.topic.property.test.ts`; keyword embedded in arbitrary text and case matches, embedding inside a longer Latin word does not, blank input is not sensitive, repeated calls return identical results
    - **Validates: Requirements 5.1, 5.5, 6.4, 6.5**
  - [x] 7.3 Write unit tests for the classifier
    - File `answer.topic.unit.test.ts`; one keyword per topic in each of English, Urdu script and Roman Urdu, topic priority on mixed text, live-fact keywords, `containsUnsupportedAmount` with `Rs`, `$`, `%` and Urdu digits
    - _Requirements: 5.1, 5.5, 6.2, 6.3, 6.4_

- [x] 8. Implement the prompt builder
  - [x] 8.1 Create `answer.prompt.ts`
    - `buildPrompt(text, { kind, language, topic, liveFacts })` returning `{ system, user }`
    - System blocks: role, format and character limit (`TARGET_PARTS * getPartLimits(detectEncoding(sample)).multi`), Language, Safety_Rules, sensitive block (only with a topic), injection block, scam block (only for `scam`)
    - User: one `OPEN_DELIMITER`, the text truncated to 500 code points with `⟦` and `⟧` removed, one `CLOSE_DELIMITER`; sender text never enters `system`
    - _Requirements: 2.5, 2.6, 3.1, 3.2, 4.2, 5.2, 6.1, 9.1, 9.8, 11.1, 11.2, 11.3_
  - [x] 8.2 Write property test for the size limit in the prompt
    - **Property 22: The prompt states the right size limit**
    - File `answer.prompt.property.test.ts`; 459 for `en` and `roman-ur`, 201 for `ur`
    - **Validates: Requirements 3.2**
  - [x] 8.3 Write property test for sender text isolation
    - **Property 23: Sender text is isolated and delimited**
    - File `answer.prompt.property.test.ts`; exactly one opening and one closing delimiter, at most 500 code points between them, sender text of 8 or more characters not in `system`
    - **Validates: Requirements 2.5, 2.6, 11.1, 11.3**
  - [x] 8.4 Write prompt contract unit tests
    - File `answer.prompt.unit.test.ts`; for language x topic x kind check the plain-text rule, language instruction, sensitive block, unsure and "check prices locally" lines, injection block, scam rules (`SCAM`, `SAFE`, `UNSURE`, money, PIN, OTP, passwords, bank details, prize)
    - _Requirements: 3.1, 4.2, 5.2, 6.1, 9.1, 9.8, 11.2_

- [x] 9. Implement the scam parser and printer
  - [x] 9.1 Create `answer.scam.ts`
    - `parseScam(output, language)`: first non-blank line, split at first colon, accept canonical and localized verdict words, unknown word gives `UNSURE`, Reason normalized and capped to 120 code points, blank Reason uses the fixed Reason, unparseable output gives `UNSURE` with the fixed Reason
    - `printScam(result, language)`: localized verdict word, `: `, Reason
    - _Requirements: 9.2, 9.3, 9.5, 9.6, 9.7_
  - [x] 9.2 Write property test for the scam round trip
    - **Property 18: Scam printing and parsing round trip**
    - File `answer.scam.property.test.ts`; valid results only (non-empty, `normalizeMessage`-stable, single line, at most 120 code points), all three Languages
    - **Validates: Requirements 9.2, 9.12, 13.4**
  - [x] 9.3 Write property test for parser totality
    - **Property 19: The scam parser is total and defaults to UNSURE**
    - File `answer.scam.property.test.ts`
    - **Validates: Requirements 9.5, 9.6, 9.7**
  - [x] 9.4 Write unit tests for the scam parser and printer
    - File `answer.scam.unit.test.ts`; each verdict printed and parsed in each Language, canonical English token with a localized Reason, unknown verdict word, no colon, blank Reason, multi-line output
    - _Requirements: 9.2, 9.5, 9.6, 9.7, 13.7_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement the call policy
  - [x] 11.1 Create `answer.call.ts`
    - `callWithPolicy(client, prompt, timeoutMs)`: one attempt wrapped in `try/catch` and raced against a timer that yields `AiError('timeout')`; clear the timer; ignore late results; non-string resolution becomes `ok: true` with `''`; rejections go through `toAiError`
    - Policy: `quota` and `unknown` make 1 call; `timeout` and `network` retry once (at most 2 calls)
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 12.6_
  - [x] 11.2 Write unit tests for the call policy
    - File `answer.call.unit.test.ts`; use `vi.useFakeTimers()` with a `hang` step for the 8000 ms timeout, call counts per error kind, retry then success, late result ignored, synchronous throw, non-AiError rejection, non-string value
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 13.7_

- [x] 12. Implement the answer service
  - [x] 12.1 Implement `answerQuestion` in `answer.service.ts`
    - Top-level `try/catch` so the function never rejects; `resolveLanguage` (supplied value used without `detectLanguage`, invalid gives `en`, none gives one `detectLanguage` call)
    - Blank question returns the prompt text; truncate to 500 code points; cache read (throwing cache is a miss); classify, build Prompt, `callWithPolicy` with `deps.timeoutMs ?? CALL_TIMEOUT_MS`; on `quota` re-read the cache once; failures return `tryLater` and write nothing
    - Post-process: `redactSecrets`, `hasPromptLeak` (reject), `stripMarkdown` (reject if blank), price guard, `removeAll` of existing referral and note copies, rebuild suffix (referral then note, each once), `shortenToFit`, then cache write with `clock() + CACHE_TTL_MS` inside `try/catch`
    - _Requirements: 1.1, 1.4, 2.1, 2.2, 2.3, 2.4, 2.7, 3.3, 3.5, 3.9, 4.1, 4.3, 4.7, 5.3, 5.4, 5.6, 6.2, 6.3, 6.6, 7.2, 7.3, 7.4, 7.6, 8.1, 8.2, 8.9, 10.1, 10.4, 11.4, 12.6_
  - [x] 12.2 Implement `checkScam` in `answer.service.ts`
    - Same shape with `kind = 'scam'`: blank argument returns `promptForScamText`; after redaction, leak check and `stripMarkdown`, run `parseScam`; money referral only when topic is `money` and verdict is `UNSURE`; shorten only the Reason against the fixed `verdict: ` prefix and suffix, falling back to the fixed Reason if it shrinks to empty; single-line output; cache under kind `scam`
    - _Requirements: 5.7, 5.8, 7.2, 9.1, 9.3, 9.4, 9.5, 9.9, 9.10, 9.11, 12.6_
  - [x] 12.3 Write property test for non-blank replies
    - **Property 1: The service always replies with non-blank text**
    - File `answer.service.reply.property.test.ts`; inputs of 0 to 10,000 characters, any Language, every client behavior (usable text, blank, non-string, each AiError kind, non-AiError rejection, synchronous throw, hang under fake timers); both `answerQuestion` and `checkScam`
    - **Validates: Requirements 2.4, 2.7, 3.9, 8.1, 8.2, 8.3, 12.6, 12.7**
  - [x] 12.4 Write property test for SMS fit
    - **Property 2: Replies fit the SMS budget without truncation**
    - File `answer.service.reply.property.test.ts`; model output of 0 to 5,000 characters including emoji, markdown and non-ASCII; assert `joinSms(splitSms(reply)) === reply` and 1 to `MAX_PARTS` parts
    - **Validates: Requirements 3.3, 3.6, 3.7, 9.4, 13.2**
  - [x] 12.5 Write property test for fixed text language choice
    - **Property 5: Fixed texts follow the Language that was chosen**
    - File `answer.service.reply.property.test.ts`; failing client; detected, supplied and invalid Language
    - **Validates: Requirements 4.1, 4.3, 4.7**
  - [x] 12.6 Write property test for scam reply shape
    - **Property 20: Scam replies are one line and keep the verdict word**
    - File `answer.service.reply.property.test.ts`; multi-line, very long and markdown-heavy model output
    - **Validates: Requirements 9.3, 9.4**
  - [x] 12.7 Write property test for blank input
    - **Property 21: Blank input skips the AI**
    - File `answer.service.reply.property.test.ts`; zero client calls and the fixed prompt text for the Language
    - **Validates: Requirements 2.3, 9.9**
  - [x] 12.8 Write property test for the professional referral
    - **Property 6: Sensitive questions contain the referral exactly once**
    - File `answer.service.safety.property.test.ts`; model output that already contains the referral once or several times
    - **Validates: Requirements 5.3, 5.4, 13.5**
  - [x] 12.9 Write property test for sensitive failures
    - **Property 7: Sensitive questions never show model text when the AI fails**
    - File `answer.service.safety.property.test.ts`
    - **Validates: Requirements 5.6**
  - [x] 12.10 Write property test for the scam money referral
    - **Property 9: Scam money referral appears only for UNSURE**
    - File `answer.service.safety.property.test.ts`
    - **Validates: Requirements 5.7, 5.8**
  - [x] 12.11 Write property test for live facts and invented amounts
    - **Property 10: Live-fact questions carry the Uncertainty_Note exactly once, and invented amounts are dropped**
    - File `answer.service.safety.property.test.ts`
    - **Validates: Requirements 6.2, 6.3, 6.6**
  - [x] 12.12 Write property test for error detail leaks
    - **Property 17: Error details never reach the reply**
    - File `answer.service.safety.property.test.ts`; AiError messages and rejection values containing a Secret
    - **Validates: Requirements 8.10, 10.1**
  - [x] 12.13 Write property test for echoed system instructions
    - **Property 24: Echoed system instructions are discarded**
    - File `answer.service.safety.property.test.ts`; reply is the Try_Later_Text and the cache is unchanged
    - **Validates: Requirements 11.4**
  - [x] 12.14 Write service-level property test for redaction
    - **Property 25: Redaction removes every secret** (service level)
    - File `answer.service.safety.property.test.ts`; replies, prompts, cache keys and cached values contain no Secret from model output
    - **Validates: Requirements 10.1, 10.4**
  - [x] 12.15 Write property test for cache idempotence
    - **Property 12: Repeated questions call the AI once**
    - File `answer.service.cache.property.test.ts`; question and scam requests for the same text use different keys
    - **Validates: Requirements 7.2, 7.10, 9.11**
  - [x] 12.16 Write property test for failures and the cache
    - **Property 13: Failures never touch the cache**
    - File `answer.service.cache.property.test.ts`; every failing client behavior plus blank and leaked model text
    - **Validates: Requirements 1.4, 7.6, 9.10**
  - [x] 12.17 Write property test for the 24-hour TTL
    - **Property 14: Cache entries live exactly 24 hours**
    - File `answer.service.cache.property.test.ts`; fake clock
    - **Validates: Requirements 7.3, 7.4**
  - [x] 12.18 Write property test for the retry policy
    - **Property 16: Retry policy depends on the error kind**
    - File `answer.service.policy.property.test.ts`; arbitrary client scripts, fake timers
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6, 8.7**
  - [x] 12.19 Write property test for purity and input immutability
    - **Property 27: Helpers are pure and inputs are not mutated**
    - File `answer.service.policy.property.test.ts`; call each pure helper twice; deep-clone the caller inputs before `answerQuestion` and `checkScam` (question or argument, optional Language, and the deps object including its `secrets` array and other caller-supplied data) and assert deep equality after the call; the Answer_Cache is excluded from the snapshot because storing the Reply_Text is the intended effect
    - **Validates: Requirements 12.1, 12.4, 13.16**
  - [x] 12.20 Write service example tests
    - File `answer.unit.test.ts`; each AiError kind returns the Try_Later_Text, 8 s timeout with a `hang` step, cache hit, cache expiry with a fake clock, each Language, each Scam_Verdict, host cache stub receives all reads and writes, throwing cache and throwing clock
    - The cache-contents and `quota` re-check examples live in tasks 12.21, 12.23 and 12.24
    - _Requirements: 7.11, 13.7_
  - [x] 12.21 Write example test that the cache holds the Reply_Text
    - File `answer.service.store.unit.test.ts`; after a successful `answerQuestion` and a successful `checkScam` with a Mock_Client and an in-memory cache, assert the Answer_Cache holds the returned Reply_Text under the expected Cache_Key with expiry `clock() + CACHE_TTL_MS`
    - _Requirements: 7.3, 12.4, 13.16_
  - [x] 12.22 Write property test for the quota cache re-check
    - **Property 30: Quota re-checks the cache exactly once**
    - File `answer.service.quota.property.test.ts`; question and scam requests with a fake cache that counts `get` calls and a Mock_Client that rejects with `quota`; cache read exactly twice and client called exactly once; reply equals the entry when one appears only at the re-check, else the Try_Later_Text; for every other failure kind the cache is read once
    - **Validates: Requirements 7.2, 8.1, 8.9, 13.18**
  - [x] 12.23 Write example test for a cache hit at the quota re-check
    - File `answer.service.quota.unit.test.ts`; Mock_Client rejects with `quota`, fake cache misses on the first `get` and holds an unexpired entry at the second; assert the reply is that Reply_Text, `get` called exactly twice and the AI_Client called exactly once
    - _Requirements: 7.2, 8.9, 13.18_
  - [x] 12.24 Write example test for a cache miss at the quota re-check
    - File `answer.service.quota.unit.test.ts`; Mock_Client rejects with `quota`, fake cache misses on both reads; assert the reply is the Try_Later_Text, `get` called exactly twice, the AI_Client called exactly once and no write to the cache
    - _Requirements: 7.2, 8.1, 8.9, 13.18_

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement the Gemini adapter
  - [x] 14.1 Create `models.ts`
    - Export `DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'` (the only source file with the model literal) and pure `resolveModel(option, envValue)`: trimmed option, else trimmed env value, else default
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  - [x] 14.2 Add the pinned `@google/genai` dependency
    - In `packages/brain/package.json` add `"@google/genai": "3.2.0"` under `dependencies` with the exact version (no `^`, `~`, `*`, `>`, `<` or `x`); update the lockfile with the repo's package manager; keep the `engines`/CI Node version at 22 or later (SDK 3.x requires `>=22.0.0`)
    - _Requirements: 14.10, 14.11, 13.17_
  - [x] 14.3 Implement `createGeminiClient` in `gemini.entry.ts`
    - Create `gemini.entry.ts`, the only file that imports `@google/genai` and the only file that reads `GEMINI_API_KEY` and `GEMINI_MODEL` (from `options.env` or `process.env`); export the `GenaiLike` interface (`models.generateContent`), `EnvConfig`, `GeminiOptions` (`env`, `model`, `genai` factory, `log`) and `createGeminiClient(options?)`
    - Default `genai` factory is `key => new GoogleGenAI({ apiKey: key })`, the only place that constructor is written; the trimmed key is passed only to that factory and nowhere else (no URL, header, log or error)
    - Missing, empty or whitespace key returns a client whose every call rejects with `AiError('unknown', 'GEMINI_API_KEY is not configured')`; the factory is never called and there is no network call
    - Each attempt makes exactly one `generateContent({ model, contents: prompt.user, config: { systemInstruction: prompt.system, maxOutputTokens: 300, temperature: 0.3 } })` call; no `tools`, `toolConfig`, `cachedContent`, `httpOptions` or batch field, no `fetch`; result is `response.text` when a string, else `''`; model from `resolveModel(options.model, env.GEMINI_MODEL)`
    - Failures go through `mapSdkError`; every log line passes through `redactSecrets(text, [key])` and `maskPhoneNumbers`
    - _Requirements: 1.7, 1.8, 1.9, 14.1, 14.3, 14.4, 14.5, 14.6, 14.11, 15.2, 15.3, 15.4, 16.1, 16.2, 16.3, 16.4, 16.7_
  - [x] 14.4 Implement `mapSdkError` in `gemini.entry.ts`
    - Pure, never throws, evaluated in this order: existing `AiError` returned unchanged; `status === 429` or text containing `RESOURCE_EXHAUSTED` gives `quota`; `status` 408 or 504, `AbortError`/`TimeoutError` name or `timeout`/`ETIMEDOUT` code gives `timeout`; other 5xx, `TypeError` or codes `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN` give `network`; `status` 400/401/403/404, text containing `PERMISSION_DENIED`, `FAILED_PRECONDITION`, `billing` or `permission`, and everything else give `unknown`; no retry on another model or feature
    - The SDK error message is read only for detection and never copied; the AiError message is a fixed description plus the status, for example `Gemini request failed (status 429)`
    - _Requirements: 14.4, 14.5, 16.5, 16.6_
  - [x] 14.5 Create the `Fake_Genai_SDK` test helper
    - File `gemini.fake.ts` (test support, no import of `@google/genai`); returns a `GenaiLike` factory that records every constructor key and every `generateContent` argument, and can be scripted to return text or throw an error object with `status`, `name`, `code` and `message` fields
    - _Requirements: 1.9, 13.1, 13.11, 13.14_
  - [x] 14.6 Write property test for model resolution
    - **Property 28: Model resolution precedence**
    - File `gemini.property.test.ts`; arbitrary optional factory model and optional `GEMINI_MODEL` strings, including whitespace-only values
    - **Validates: Requirements 15.2, 15.3, 15.4**
  - [x] 14.7 Write property test for key leakage
    - **Property 29: The Gemini adapter never leaks the key**
    - File `gemini.property.test.ts`; key of 1 to 100 non-whitespace characters and Fake_Genai_SDK errors whose message echoes the key; AiError messages and every log line contain no key; the key reaches only the Fake_Genai_SDK factory; missing, empty or whitespace key gives zero factory calls, zero `generateContent` calls and a rejection of kind `unknown`
    - **Validates: Requirements 14.1, 14.3, 14.4, 14.5, 14.6, 13.11, 13.12**
  - [x] 14.8 Write unit tests for the Gemini adapter
    - File `gemini.unit.test.ts`; Fake_Genai_SDK and stub Env_Config, no network: missing, empty and whitespace key give zero SDK constructions and zero `generateContent` calls (Requirement 13.11); present key goes only to the factory; `generateContent` argument has `model`, `contents` and `config` with `systemInstruction`, `maxOutputTokens` and `temperature` and no `tools`, `toolConfig`, `cachedContent` or batch field; error with `status` 429 or text `RESOURCE_EXHAUSTED` maps to `quota`; 403 billing or permission error maps to `unknown` with a single call (Requirement 13.14); factory option beats `GEMINI_MODEL`, which beats the default; `DEFAULT_GEMINI_MODEL === 'gemini-3.5-flash-lite'` (Requirement 13.13); `mapSdkError` branches for `timeout`, `network` and `unknown`
    - _Requirements: 13.11, 13.13, 13.14, 14.6, 15.1, 16.1, 16.2, 16.5, 16.6_

- [x] 15. Wire exports and repository checks
  - [x] 15.1 Create or update `.env.example`
    - Add `GEMINI_API_KEY=` (empty) and `GEMINI_MODEL=` with a comment that it is optional, that the default is a free-tier Flash-Lite model, that models are retired over time, and that `GEMINI_MODEL` changes the model with no code change; if the file exists, add lines only
    - _Requirements: 14.8, 15.6_
  - [x] 15.2 Check `.gitignore`
    - Confirm the root `.gitignore` lists `.env` (and keeps `!.env.example`); add the line only if it is missing
    - _Requirements: 14.7_
  - [x] 15.3 Update `index.ts` and `package.json` exports
    - Export `AiClient`, `AiError`, `AiErrorKind`, `Prompt`, `createMockClient`, `answerQuestion`, `checkScam`, `ScamVerdict`, `ScamResult`, `AnswerCache`, `AnswerDeps`, `createMemoryCache`, `DEFAULT_GEMINI_MODEL` and the pure helpers used by tests; do not export `gemini.entry.ts` from `index.ts`
    - Set `"exports": { ".": "./src/index.ts", "./gemini": "./src/gemini.entry.ts" }` in `packages/brain/package.json`
    - _Requirements: 1.5, 12.5, 15.1_
  - [x] 15.4 Write exports test
    - File `answer.exports.test.ts`; all required symbols exported from the entry point, `index.ts` has no import of `gemini.entry`
    - _Requirements: 1.5, 12.5, 14.9_
  - [x] 15.5 Write repository checks
    - File `answer.repo.test.ts`; `.gitignore` lists `.env`; `.env.example` contains the line `GEMINI_API_KEY=` with an empty value and a `GEMINI_MODEL=` line with an optional comment; no tracked source, test or doc file matches `AIza[0-9A-Za-z_-]{35}`; the model name literal appears only in `models.ts`, tests and docs
    - SDK checks: `@google/genai` in `packages/brain/package.json` is an exact version (no `^`, `~`, `*`, `>`, `<` or `x`); the string `@google/genai` is imported only in `src/gemini.entry.ts` (not in the Answer_Service, the Mock_Client, `gemini.fake.ts` or any test file); no `process.env` outside `gemini.entry.ts` (and the test-only guard); `gemini.entry.ts` has no `fetch` and no `generativelanguage.googleapis.com` string
    - Source scans: Answer_Service sources have no Gemini entry import, no React Native, Next.js or Node-only imports, no `console` calls, `Date.now`, `new Date` or `Math.random` in the pure helpers
    - _Requirements: 1.7, 1.9, 10.8, 12.1, 12.3, 13.15, 13.17, 14.2, 14.7, 14.8, 14.9, 14.10, 14.11, 15.5, 15.6_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tests are required sub-tasks, matching the sibling specs. Each task references specific requirement clauses for traceability; the design holds the algorithm detail.
- Run from `packages/brain`: `npm test` (`vitest --run`, single run), `npm run typecheck` (`tsc --noEmit`), `npm run lint`. Every checkpoint needs all three to pass.
- Property tests use `PBT_OPTIONS` (`numRuns: 100` minimum); fast-check prints the seed and shrunk counterexample on failure, and `{ seed }` reproduces it.
- Service property tests are split into four files (`reply`, `safety`, `cache`, `policy`) and module unit tests into per-module files, instead of the design's single `answer.service.property.test.ts` and `answer.unit.test.ts`, so independent test tasks can run in parallel without writing to the same file.
- `gemini.entry.ts` is the only module that reads `GEMINI_API_KEY` or `GEMINI_MODEL` and the only module that imports the official `@google/genai` SDK, which is pinned to the exact version `3.2.0` in `packages/brain/package.json` (Node 22 or later). Tests use only fake keys such as `test-key-123`, the `Fake_Genai_SDK` helper injected through the `GenaiLike` factory option, and a stub Env_Config; no test imports the SDK or touches the network. The no-network guard in the test setup (task 1.3) stays in place.
- The Answer_Cache is the one designated mutable collaborator. Property 27 snapshots only caller inputs (question or argument, Language, and deps including secrets) and excludes the cache; task 12.21 asserts separately that the cache holds the Reply_Text after a successful call.
- Property 30 and its two examples (tasks 12.22 to 12.24) cover the cache order: first check, then exactly one re-check after a `quota` rejection, with the AI_Client called once.
- The adapter is split across tasks 14.2 to 14.4 (dependency, `createGeminiClient`, `mapSdkError`); the last two write the same file, so they sit in different waves.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "14.1", "14.2", "15.1", "15.2"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "3.1", "4.1", "5.1", "5.2", "7.1", "8.1", "9.1", "11.1"] },
    { "id": 3, "tasks": ["1.4", "3.2", "3.4", "4.2", "4.4", "5.3", "5.4", "5.5", "7.2", "7.3", "8.2", "8.4", "9.2", "9.4", "11.2", "12.1", "14.3", "14.6"] },
    { "id": 4, "tasks": ["3.3", "4.3", "8.3", "9.3", "12.2", "14.4", "14.5"] },
    { "id": 5, "tasks": ["12.3", "12.8", "12.15", "12.18", "12.20", "12.21", "12.22", "12.23", "14.7", "14.8", "15.3"] },
    { "id": 6, "tasks": ["12.4", "12.9", "12.16", "12.19", "12.24", "15.4", "15.5"] },
    { "id": 7, "tasks": ["12.5", "12.10", "12.17"] },
    { "id": 8, "tasks": ["12.6", "12.11"] },
    { "id": 9, "tasks": ["12.7", "12.12"] },
    { "id": 10, "tasks": ["12.13"] },
    { "id": 11, "tasks": ["12.14"] }
  ]
}
```
