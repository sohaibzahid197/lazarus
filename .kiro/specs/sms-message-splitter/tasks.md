# Implementation Plan: SMS Message Splitter

## Overview

The `SMS_Splitter` is a set of pure TypeScript functions in the `packages/brain` package that splits a reply string into SMS parts within encoding-aware character limits. The implementation is built bottom-up: scaffolding first, then low-level helpers (encoding detection, code-unit counting, limits, prefixes), then the core greedy splitter with word-boundary preference, then the 4-part truncation cap, and finally the public `splitSms`/`joinSms` API wired together.

Each module exports its internals so unit and property tests can target them directly. Testing uses Vitest with fast-check property-based tests (minimum 100 iterations each, each tagged with its design property number and the requirement clause it validates) plus example-based unit tests for edge cases. The design contains a Correctness Properties section, so property test sub-tasks are included as required tasks alongside the implementation tasks.

## Tasks

- [x] 1. Set up package scaffolding and tooling
  - [x] 1.1 Create monorepo workspace root and the `packages/brain` package
    - Create root `package.json` with npm workspaces pointing at `packages/*` only (React Native app in `apps/necromancer` keeps its own install and links `@lazarus/brain` later)
    - Create `packages/brain/package.json` (name `@lazarus/brain`) with `vitest`, `fast-check`, `typescript`, and `@typescript-eslint` as dev dependencies
    - Create `packages/brain/tsconfig.json` with `strict: true` and `noImplicitAny: true`
    - Create `packages/brain/vitest.config.ts` configured for non-watch single runs
    - Create an ESLint config enabling `@typescript-eslint/no-explicit-any` so `any` is forbidden at build time
    - Run install and confirm `tsc --noEmit` and `vitest --run` execute without error on an empty suite
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Implement encoding detection
  - [x] 2.1 Implement `encoding.ts`
    - Define `SmsEncoding = 'GSM-7' | 'UCS-2'` type
    - Build `GSM_7_BASIC` `Set<string>` from the 3GPP TS 23.038 default alphabet (printable chars, space, LF, CR), excluding the backtick/grave accent
    - Build `GSM_7_EXTENSION` `Set<string>` = `^ { } \ [ ~ ] | €`
    - Implement `isGsm7Basic`, `isGsm7Extension`, `isGsm7`, and `detectEncoding` (returns `'UCS-2'` iff any character is non-GSM-7)
    - _Requirements: 4.1_
  - [x] 2.2 Write property test for encoding detection
    - **Property 5: Encoding detection is whole-message**
    - For `anyTextArb`, assert `detectEncoding(t) === 'UCS-2'` iff some character is non-GSM-7
    - **Validates: Requirements 4.1**
  - [x] 2.3 Write unit tests for encoding detection
    - Test pure GSM-7 basic text → `'GSM-7'`; GSM-7 extension-only text → `'GSM-7'`; Urdu characters, emoji (surrogate pair), and the backtick `` ` `` → `'UCS-2'`
    - _Requirements: 4.1_

- [x] 3. Implement code unit counting
  - [x] 3.1 Implement `units.ts`
    - Implement `gsm7CharWeight(ch)` returning `1` for basic and `2` for extension characters
    - Implement `countCodeUnits(text, encoding)`: weighted sum over code points for GSM-7, `text.length` for UCS-2
    - Implement `isHighSurrogate(cu)` (`0xD800–0xDBFF`) and `isLowSurrogate(cu)` (`0xDC00–0xDFFF`)
    - _Requirements: 5.1_
  - [x] 3.2 Write property test for extension character counting
    - **Property 7: Extension characters count as two code units**
    - For `gsm7TextArb`, assert `countCodeUnits(text, 'GSM-7')` equals `(#basic)*1 + (#extension)*2`
    - **Validates: Requirements 5.1**
  - [x] 3.3 Write unit tests for code unit counting
    - Test basic chars count 1, extension chars (`^`, `€`) count 2, a supplementary emoji counts as 2 in UCS-2 (`text.length`)
    - _Requirements: 5.1_

- [x] 4. Implement limits and prefixes
  - [x] 4.1 Implement `limits.ts`
    - Define constants `GSM_7_SINGLE_LIMIT=160`, `GSM_7_MULTI_LIMIT=153`, `UCS2_SINGLE_LIMIT=70`, `UCS2_MULTI_LIMIT=67`, `WORD_BOUNDARY_WINDOW=15`, `MAX_PARTS=4`, `TRUNCATION_INDICATOR='...'`
    - Implement `getPartLimits(encoding)` returning `{ single, multi }` for the encoding
    - _Requirements: 3.1, 3.2, 4.2, 4.3_
  - [x] 4.2 Implement `prefix.ts`
    - Define `PART_PREFIX_PATTERN = /^\(\d+\/\d+\) /`
    - Implement `formatPartPrefix(n, total)` returning `(n/total) ` and `stripPartPrefix(part)` removing one leading prefix if present
    - _Requirements: 7.1, 7.3_
  - [x] 4.3 Write unit tests for the prefix module
    - Test `formatPartPrefix(1, 2)` → `(1/2) `, `stripPartPrefix('(1/2) hi')` → `hi`, and no-op when no prefix matches
    - _Requirements: 7.1, 7.3_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement core splitting logic
  - [x] 6.1 Implement `split.ts`
    - Implement `findCutByBudget(text, budget, encoding)`: largest code-unit prefix fitting `budget`, decrementing `cut` by 1 if it would split a surrogate pair (UCS-2); guard `hardCut >= 1`
    - Implement `applyWordBoundary(text, hardCut)`: latest space in the last `WORD_BOUNDARY_WINDOW` code units, returning `spaceIndex + 1` (space stays in current part), or `hardCut`
    - Implement `splitContent(text, encoding)`: return `[text]` if within single limit, else greedily fill parts at `contentBudget = multiLimit - prefixUnits`
    - Implement `applyPrefixes(parts)`: no prefix when one part, else `(n/total) ` per part
    - _Requirements: 2.1, 2.2, 2.3, 6.1, 6.2, 6.3, 7.1, 7.3_
  - [x] 6.2 Write property test for surrogate pair integrity
    - **Property 3: Surrogate pairs never split across parts**
    - For `ucs2TextArb` containing emoji, assert no adjacent parts separate a high surrogate from its low surrogate
    - **Validates: Requirements 6.1**
  - [x] 6.3 Write property test for word-boundary split preference
    - **Property 8: Word-boundary split preference**
    - For multi-part `anyTextArb`, recompute the expected cut per part and assert it matches the actual content length (hard cut, or after the latest space within the window)
    - **Validates: Requirements 6.2, 6.3**
  - [x] 6.4 Write unit tests for splitting
    - Test GSM-7 text of exactly 160 units → 1 part; 161 units → 2 parts each `<= 153`; a single very long word (no spaces) longer than the budget splits at the hard limit with no character loss; an emoji placed near a split boundary is never split
    - _Requirements: 2.2, 2.3, 3.1, 3.2, 6.1, 6.2, 6.3_

- [x] 7. Implement truncation and hard cap
  - [x] 7.1 Implement `truncation.ts`
    - Implement `applyHardCap(parts, contentBudget, encoding)`: if `parts.length <= 4` return unchanged; else keep first 3, rejoin the rest, cut at `contentBudget - 3` with `applyWordBoundary`, and append `'...'` to the 4th part
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 7.2 Write property test for truncation behavior
    - **Property 10: Truncation behavior for over-cap replies**
    - For `overCapacityTextArb`, assert exactly 4 parts, the last part ends with `...`, and the pre-indicator content ends at a word boundary when a space is near the truncation point
    - **Validates: Requirements 9.2, 9.3, 9.5**
  - [x] 7.3 Write unit tests for truncation
    - Test content split exceeding 4 parts produces exactly 4 parts; last part ends with `...`; the `...` (3 code units) counts toward the last part's limit
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 8. Implement public API and integration
  - [x] 8.1 Implement `index.ts`
    - Implement `splitSms(replyText)`: `detectEncoding` → `splitContent` → `applyHardCap` → `applyPrefixes`
    - Implement `joinSms(parts)`: when `parts.length > 1` strip one prefix per part then concatenate; when a single part, return it unchanged (no stripping even if it begins with a prefix-shaped token)
    - _Requirements: 2.1, 7.1, 7.3, 8.1, 8.2_
  - [x] 8.2 Write property test for round-trip reconstruction
    - **Property 1: Round-trip reconstruction**
    - For `anyTextArb` and `prefixShapedSingleArb` constrained to `<= 4` parts, assert `joinSms(splitSms(t)) === t`; the `prefixShapedSingleArb` case guards that a single-part message beginning with a token like `(1/2) ` round-trips unchanged
    - **Validates: Requirements 8.2**
  - [x] 8.3 Write property test for no part exceeding its encoding limit
    - **Property 2: No part exceeds its encoding limit**
    - For `anyTextArb`, assert every part is within the single or multi limit depending on part count (covers prefix and `...` budget consumption)
    - **Validates: Requirements 3.1, 3.2, 4.2, 4.3, 7.2, 9.4**
  - [x] 8.4 Write property test for maximum 4 parts
    - **Property 4: Maximum 4 parts produced**
    - For `anyTextArb` including very long inputs, assert `splitSms(t).length <= 4`
    - **Validates: Requirements 9.1**
  - [x] 8.5 Write property test for single-part iff within single limit
    - **Property 6: Single-part iff within single limit**
    - For `anyTextArb`, assert part count is 1 iff total code units `<= singleLimit`
    - **Validates: Requirements 2.2, 2.3**
  - [x] 8.6 Write property test for part prefixing
    - **Property 9: Part prefixing**
    - For `anyTextArb`, assert no prefix on a single part (and `joinSms` returns it unchanged), and `(n/total)` sequential numbering with consistent totals on multi-part output; `joinSms` strips exactly one prefix per part
    - **Validates: Requirements 7.1, 7.3**
  - [x] 8.7 Write unit tests for the public API
    - Test empty string → `[""]` and `joinSms([""]) === ""`; `joinSms` strips `(1/2) ` and `(2/2) ` and concatenates for a 2-part GSM-7 reply and a 2-part UCS-2 reply; a 1-part reply has no prefix; `splitSms("(1/2) Hello")` returns `["(1/2) Hello"]` and round-trips unchanged; `splitSms` output passed straight to `joinSms` round-trips for inputs up to 4 parts
    - _Requirements: 2.1, 7.1, 7.3, 8.1, 8.2_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirement clauses for traceability; the design document holds the full algorithm detail.
- Checkpoints ensure incremental validation between implementation layers.
- Property tests run a minimum of 100 fast-check iterations each and are tagged with their design property number and the requirements clause they validate.
- `joinSms` strips prefixes only when `parts.length > 1`; a single part is returned verbatim so a message that naturally begins with a prefix-shaped token round-trips intact (covered by `prefixShapedSingleArb` in Property 1).
- Test execution: `npm test --workspace @lazarus/brain` runs `vitest --run` once (non-watch); typecheck via `tsc --noEmit -p packages/brain` enforces strict mode and `noImplicitAny`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "4.2"] },
    { "id": 2, "tasks": ["3.1", "4.1", "2.2", "4.3"] },
    { "id": 3, "tasks": ["6.1", "2.3", "3.2"] },
    { "id": 4, "tasks": ["7.1", "3.3", "6.2"] },
    { "id": 5, "tasks": ["8.1", "6.3"] },
    { "id": 6, "tasks": ["6.4", "8.2"] },
    { "id": 7, "tasks": ["7.2", "8.3"] },
    { "id": 8, "tasks": ["7.3", "8.4"] },
    { "id": 9, "tasks": ["8.5"] },
    { "id": 10, "tasks": ["8.6"] },
    { "id": 11, "tasks": ["8.7"] }
  ]
}
```
