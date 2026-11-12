# Implementation Plan: Brain Command Router

## Overview

Implement the pure TypeScript Command_Router in `packages/brain/src/` in small steps: types, normalization and aliases, language detection, router, printer, then wiring through `index.ts`. All code is TypeScript strict mode with no `any`. Tests use Vitest and fast-check. Every task ends with `vitest --run` passing (run from `packages/brain`).

## Tasks

- [x] 1. Set up types, normalization and alias table
  - [x] 1.1 Create `router.types.ts`
    - Define `COMMANDS`, `Command`, `LANGUAGES`, `Language` and the readonly `RoutedCommand` interface (`command`, `argument`, `language`, `argumentMissing`)
    - Use string literal unions so the compiler rejects other values
    - _Requirements: 7.1, 7.2, 8.4_

  - [x] 1.2 Create `normalize.ts` and `aliases.ts`
    - `normalizeMessage`: NFKC, collapse `\s+` to one space, trim
    - `ALIAS_TABLE` (18 English, Roman Urdu and Urdu script entries), `ROMAN_URDU_ALIASES`, `ENGLISH_KEYWORD`
    - _Requirements: 2.2, 2.3, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 1.3 Create shared fast-check arbitraries in `router.arbitraries.ts`
    - `anyText`, `aliasArb`, `caseMutate`, `punctArb`, `wsArb`, `urduCharArb`, `markerArb`, `plainLatinWordArb`
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [x] 1.4 Write unit tests for `normalizeMessage`
    - Cover tabs, newlines, repeated spaces, leading and trailing whitespace, empty input, NFKC fullwidth input
    - _Requirements: 2.2, 2.3, 2.5_

- [x] 2. Implement language detection
  - [x] 2.1 Create `language.ts`
    - `URDU_RE`, `ROMAN_URDU_MARKERS`, `detectLanguage` (normalizes internally, whole-word and case-insensitive matching, first-word alias rule)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9_

  - [x] 2.2 Write property test for Urdu script detection
    - **Property 9: Urdu script implies `ur`**
    - **Validates: Requirements 6.1**

  - [x] 2.3 Write property test for Roman Urdu detection
    - **Property 10: Roman Urdu markers imply `roman-ur`**
    - **Validates: Requirements 6.2, 6.5, 6.6**

  - [x] 2.4 Write property test for English fallback
    - **Property 11: No Urdu and no marker implies `en`**
    - **Validates: Requirements 6.3, 6.4, 6.7**

  - [x] 2.5 Write property test for language totality
    - **Property 12: Language detection is total and deterministic**
    - Use arbitrary strings of length 0 to 1,000, at least 100 runs
    - **Validates: Requirements 6.9, 9.3**

  - [x] 2.6 Write unit tests for `detectLanguage`
    - One example each for `en`, `ur`, `roman-ur`; whitespace-only input; case-insensitive marker; marker inside a longer word
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 9.4_

- [x] 3. Implement the command router
  - [x] 3.1 Create `router.ts`
    - `routeCommand`: normalize, split on first space, strip trailing `. , ! ? : ;`, lowercase, look up in `ALIAS_TABLE`, else QUESTION
    - Set `language` from `detectLanguage(input)` and `argumentMissing` for SCAM, REMIND, TRANSLATE with empty argument
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.4, 2.5, 2.6, 4.1, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.8, 8.1_

  - [x] 3.2 Write property test for totality
    - **Property 1: Routing is total and well-formed**
    - Include empty, whitespace-only, astral, lone-surrogate and over-10,000-character inputs; 200 runs
    - **Validates: Requirements 1.1, 1.2, 1.6, 2.5, 4.7, 7.1, 8.7, 9.1**

  - [x] 3.3 Write property test for determinism
    - **Property 2: Routing is deterministic**
    - **Validates: Requirements 1.5, 8.2**

  - [x] 3.4 Write property test for alias dispatch
    - **Property 3: Alias dispatch with tolerant formatting**
    - 200 runs
    - **Validates: Requirements 1.4, 2.1, 2.2, 2.3, 2.4, 2.6, 3.1, 3.9, 5.1, 5.2, 5.3, 5.7**

  - [x] 3.5 Write property test for unknown keywords
    - **Property 4: Unknown keyword routes to QUESTION**
    - **Validates: Requirements 1.3, 3.10**

  - [x] 3.6 Write property test for STOP precedence
    - **Property 5: STOP always wins**
    - Aliases `stop`, `band`, `بند`; tails up to 1,600 characters; 200 runs
    - **Validates: Requirements 3.11, 4.1, 4.2, 4.3, 4.4, 9.2**

  - [x] 3.7 Write property test for non-leading `stop`
    - **Property 6: A non-leading `stop` does not trigger STOP**
    - **Validates: Requirements 4.5**

  - [x] 3.8 Write property test for `argumentMissing`
    - **Property 7: argumentMissing reflects empty required arguments**
    - **Validates: Requirements 5.4, 5.5, 5.6**

  - [x] 3.9 Write property test for normalization invariance
    - **Property 8: Normalization is idempotent and routing-invariant**
    - **Validates: Requirements 2.7**

  - [x] 3.10 Write property test for language agreement
    - **Property 13: Router language matches the detector**
    - **Validates: Requirements 6.8**

  - [x] 3.11 Write unit tests for `routeCommand`
    - One example per Alias (18, via `it.each`), 2 or more consecutive spaces, mixed case (`StOp`, `HeLp`), `start`/`START`, missing arguments, punctuation-only first token, empty input
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.6, 4.7, 5.4, 9.4_

- [x] 4. Implement the command printer
  - [x] 4.1 Create `printer.ts`
    - `printCommand`: QUESTION returns the argument; others return the English keyword plus a single space and the argument, or the bare keyword when the argument is empty
    - _Requirements: 7.3, 7.4, 7.6_

  - [x] 4.2 Write property test for the print/route round trip
    - **Property 14: Print/route round trip**
    - **Validates: Requirements 7.3, 7.4, 7.5**

  - [x] 4.3 Write property test for QUESTION printing
    - **Property 15: Printing QUESTION is the identity on the argument**
    - **Validates: Requirements 7.6**

  - [x] 4.4 Write unit tests for `printCommand`
    - `SCAM free money`, bare `HELP`, `STOP` with no trailing space, QUESTION unchanged
    - _Requirements: 7.3, 7.4, 7.6_

- [x] 5. Wire exports and static checks
  - [x] 5.1 Update `packages/brain/src/index.ts`
    - Export `routeCommand`, `detectLanguage`, `printCommand`, `normalizeMessage` and the `Command`, `Language`, `RoutedCommand` types, using the existing `.js` suffix convention
    - _Requirements: 8.5_

  - [x] 5.2 Write export, type-level and performance tests
    - Import the three functions from the package entry; `expectTypeOf` checks for the `Command` and `Language` unions
    - A 10,000-character input returns in under 50 ms; a 100,000-character input returns without throwing
    - _Requirements: 7.2, 8.5, 8.6, 8.7_

  - [x] 5.3 Enforce purity and type safety in `eslint.config.mjs`
    - Enable `@typescript-eslint/no-explicit-any` and restrict `Date`, `Math.random`, `console` and `fetch` in the router modules
    - Confirm `tsc --noEmit` passes under strict mode
    - _Requirements: 8.1, 8.4_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design; unit tests cover examples and edge cases
- Each fast-check property runs at least 100 iterations (Req 9.5)
- Do not parse REMIND times here; that belongs to a later feature

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.6", "3.1", "4.2", "4.4"] },
    { "id": 4, "tasks": ["2.3", "3.2", "3.11", "4.3", "5.1"] },
    { "id": 5, "tasks": ["2.4", "3.3", "5.2", "5.3"] },
    { "id": 6, "tasks": ["2.5", "3.4"] },
    { "id": 7, "tasks": ["3.5"] },
    { "id": 8, "tasks": ["3.6"] },
    { "id": 9, "tasks": ["3.7"] },
    { "id": 10, "tasks": ["3.8"] },
    { "id": 11, "tasks": ["3.9"] },
    { "id": 12, "tasks": ["3.10"] }
  ]
}
```
