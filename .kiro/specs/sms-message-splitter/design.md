# Design Document

## Introduction

This design defines the `SMS_Splitter` module in the `packages/brain` TypeScript package. The splitter takes a reply text string (`Reply_Text`) and returns an array of SMS parts (`SMS_Part[]`), each within the character limit for its detected encoding. It detects GSM-7 vs UCS-2 encoding, counts extension characters and surrogate pairs correctly, prefers word boundaries for split points, prefixes multi-part messages with a part counter, and enforces a hard cap of 4 parts with a truncation indicator.

Lazarus sends replies over plain SMS from an old Android phone, so correct segment math matters: a wrong split means a garbled or undeliverable reply. The steering file `.kiro/steering/sms-rules.md` and `.kiro/steering/tech.md` define the exact rules this module must follow.

## Research

### GSM-7 and UCS-2 encoding (3GPP TS 23.038 / GSM 03.38)

- GSM-7 packs 7-bit code units into octets. A single SMS carries up to **160** characters; a concatenated (multi-part) SMS reserves space for a User Data Header (UDH), reducing capacity to **153** per part ([Wikipedia – GSM 03.38](https://en.wikipedia.org/wiki/GSM_03.38), [Apeiron SMS Encoding Guide](https://www.apeiron.io/docs/messaging/sms_encoding)).
- The GSM 7-bit **default alphabet** (basic set) takes one septet per character. Characters from the **Basic Character Set Extension table** require an `ESC` escape prefix, so they take **two** septets. The printable extension characters are exactly: `^ { } \ [ ~ ] | €` ([Wikipedia – GSM 03.38, extension table](https://en.wikipedia.org/wiki/GSM_03.38)).
- If the message contains **any** character outside the GSM-7 default alphabet (e.g. Urdu script, emoji, accented Latin not in the table, the backtick/grave accent), the whole message is re-encoded as **UCS-2**: **70** characters for a single SMS, **67** per part when concatenated ([AWS SMS character limits](https://docs.aws.amazon.com/sms-voice/latest/userguide/sms-limitations-character.html)).
- Modern handsets use UTF-16 in place of strict UCS-2; characters above U+FFFF (supplementary plane, e.g. many emoji) are represented as **surrogate pairs** and count as two 16-bit code units ([Wikipedia – GSM 03.38, UCS-2 section](https://en.wikipedia.org/wiki/GSM_03.38)). This matches the requirements glossary: in UCS-2 each UTF-16 code unit counts as 1 `Code_Unit`, so a `Surrogate_Pair` counts as 2.

### UTF-16 surrogate pairs in JavaScript

- JavaScript strings are sequences of UTF-16 code units. `String.prototype.length` returns the code-unit count, so `"😀".length === 2` ([dev.to – surrogate pairs and why JavaScript length lies](https://dev.to/deko39/unicode-utf-8-utf-16-surrogate-pairs-and-why-javascript-length-lies-28l6)).
- A high (lead) surrogate is in `0xD800–0xDBFF`; a low (trail) surrogate is in `0xDC00–0xDFFF`. A supplementary character is always a high+low pair, never split ([Stack Overflow – what is a surrogate pair](https://stackoverflow.com/questions/31986614/what-is-a-surrogate-pair)).
- Practical consequence: for UCS-2, `countCodeUnits(text) === text.length` already gives the correct SMS code-unit count (each surrogate counts as 2). Slicing by code-unit index is the natural unit of work; we must only avoid cutting between a high and a low surrogate.

### Key findings that shape the design

1. UCS-2 counting is just `text.length` in JavaScript (code units), which already double-counts supplementary characters — no special per-character weighting is needed for UCS-2.
2. GSM-7 counting needs per-character weighting: 1 for basic, 2 for extension. All GSM-7 characters are in the BMP (single code units), so no surrogate handling is needed in GSM-7 mode.
3. Because the hard cap is 4 parts, every part number `n` and total `total` is a single digit, so the part prefix `(n/total) ` is always 6 code units. The design still computes the prefix length dynamically for correctness, but this invariant keeps the per-part content budget constant.
4. Word-boundary splitting must **not drop any characters** (the space stays at the end of the current part), otherwise the round-trip property (Requirement 8.2) would break.

## Overview

The `SMS_Splitter` is a set of pure functions in `packages/brain`. It has two public entry points and a set of internal, testable helpers:

- `splitSms(replyText: string): string[]` — split a reply into SMS parts (the main feature).
- `joinSms(parts: string[]): string` — rejoin parts by stripping part prefixes and concatenating (the round-trip inverse).

The pipeline is: detect encoding → count code units → decide single vs multi-part → greedily fill parts up to the content budget, preferring word boundaries and never splitting surrogate pairs → enforce the 4-part cap with truncation indicator → apply part prefixes.

### Design decisions and rationale

- **Pure functions, no I/O.** The splitter never touches the network, filesystem, or SMS stack. This keeps it trivially property-testable and reusable from both `apps/necromancer` (Android) and `apps/crypt` (web).
- **Encoding is a whole-message property.** A single non-GSM-7 character flips the entire message to UCS-2, per the standard. We do not mix encodings across parts.
- **Word boundaries keep the space.** Splitting happens *after* a space (the space remains in the current part). This guarantees `joinSms(splitSms(t)) === t` for non-truncated inputs, since no characters are ever dropped.
- **Dynamic prefix budget, constant in practice.** The content budget per multi-part is `multiLimit - prefixUnits`. Because of the 4-part cap the prefix is always 6 code units, so the budget is `153 - 6 = 147` (GSM-7) and `67 - 6 = 61` (UCS-2). Computing the prefix dynamically keeps the code correct if the cap ever changes.
- **Truncation reserves space for `...`.** When a reply exceeds 4-part capacity, the last part is truncated to `contentBudget - 3` code units so that `content + "..."` fits exactly within the per-part limit.

## Architecture

The module lives in `packages/brain` and is consumed by both apps. It has no dependencies on React Native or Next.js.

```mermaid
flowchart LR
  subgraph packages/brain
    A[encoding.ts<br/>detect GSM-7 vs UCS-2] --> B[units.ts<br/>count Code_Units]
    B --> C[limits.ts<br/>single/multi limits]
    C --> D[split.ts<br/>greedy split + word boundary]
    D --> E[truncation.ts<br/>4-part cap + ...]
    E --> F[prefix.ts<br/>(n/total) prefix + strip]
    F --> G[index.ts<br/>splitSms / joinSms API]
  end
  H[(apps/necromancer<br/>Android SMS send)] --> G
  I[(apps/crypt<br/>web Ouija preview)] --> G
```

### Split pipeline

```mermaid
flowchart TD
  S([Reply_Text]) --> DET{detectEncoding}
  DET -->|all GSM-7| GSM[GSM-7]
  DET -->|any non-GSM-7| UCS[UCS-2]
  GSM --> COUNT[countCodeUnits]
  UCS --> COUNT
  COUNT --> DEC{total <= singleLimit?}
  DEC -->|yes| ONE["return [text]<br/>(1 part, no prefix)"]
  DEC -->|no| MULTI["greedy fill parts<br/>contentBudget = multiLimit - prefix"]
  MULTI --> SPLIT[findCutByBudget + applyWordBoundary<br/>never split surrogate pair]
  SPLIT --> CAP{parts > 4?}
  CAP -->|no| PREF
  CAP -->|yes| TRUNC["truncate 4th part to<br/>contentBudget - 3 + '...'"]
  TRUNC --> PREF["applyPrefixes<br/>(n/total) for multi"]
  PREF --> OUT([SMS_Part[]])
```

## Components and Interfaces

All exports use explicit types; `any` is forbidden (Requirement 1.4). Internal helpers are exported from their modules so unit and property tests can target them directly.

### Public API (`index.ts`)

```ts
/** Split a reply into one or more SMS parts, each within its encoding limit. */
export function splitSms(replyText: string): string[];

/** Rejoin SMS parts by removing all part prefixes and concatenating. */
export function joinSms(parts: string[]): string;
```

### Internal components

| Module | Export | Responsibility |
| --- | --- | --- |
| `encoding.ts` | `type SmsEncoding = 'GSM-7' \| 'UCS-2'` | Encoding tag |
| `encoding.ts` | `isGsm7Basic(ch: string): boolean` | Membership in GSM-7 default alphabet |
| `encoding.ts` | `isGsm7Extension(ch: string): boolean` | Membership in GSM-7 extension table |
| `encoding.ts` | `isGsm7(ch: string): boolean` | Basic or extension |
| `encoding.ts` | `detectEncoding(text: string): SmsEncoding` | UCS-2 iff any char is non-GSM-7 |
| `units.ts` | `gsm7CharWeight(ch: string): 1 \| 2` | 1 for basic, 2 for extension |
| `units.ts` | `countCodeUnits(text: string, encoding: SmsEncoding): number` | Weighted count for GSM-7, `text.length` for UCS-2 |
| `units.ts` | `isHighSurrogate(cu: number): boolean` | `0xD800 <= cu <= 0xDBFF` |
| `units.ts` | `isLowSurrogate(cu: number): boolean` | `0xDC00 <= cu <= 0xDFFF` |
| `limits.ts` | `getPartLimits(encoding: SmsEncoding): { single: number; multi: number }` | 160/153 or 70/67 |
| `prefix.ts` | `formatPartPrefix(n: number, total: number): string` | `(n/total) ` |
| `prefix.ts` | `stripPartPrefix(part: string): string` | Remove a leading `(n/total) ` if present |
| `prefix.ts` | `PART_PREFIX_PATTERN: RegExp` | `/^\(\d+\/\d+\) /` |
| `split.ts` | `findCutByBudget(text: string, budget: number, encoding: SmsEncoding): number` | Largest code-unit prefix fitting `budget`, never splitting a surrogate pair |
| `split.ts` | `applyWordBoundary(text: string, hardCut: number): number` | Latest space in the last 15 code units, or `hardCut` |
| `split.ts` | `splitContent(text: string, encoding: SmsEncoding): string[]` | Greedy split into unprefixed content parts |
| `truncation.ts` | `applyHardCap(parts: string[], contentBudget: number, encoding: SmsEncoding): string[]` | Truncate to 4 parts with `...` when needed |
| `split.ts` | `applyPrefixes(parts: string[]): string[]` | Add `(n/total) ` only when more than one part |

### Algorithm details

**`detectEncoding`** — scan every code point of `text`; if any is not `isGsm7`, return `'UCS-2'`, else `'GSM-7'`.

**`countCodeUnits`**:
- GSM-7: iterate code points (`for...of`, which yields one entry per GSM-7 char since they are all BMP) and sum `gsm7CharWeight` (1 or 2).
- UCS-2: return `text.length` (UTF-16 code units; surrogate pairs already count as 2).

**`findCutByBudget(text, budget, encoding)`** — returns a code-unit count `cut` that fits in `budget` without splitting a surrogate pair:
- UCS-2: `cut = min(text.length, budget)`. If `cut < text.length` and `text.charCodeAt(cut - 1)` is a high surrogate, decrement `cut` by 1 so the pair stays together in the *next* part.
- GSM-7: walk code units, accumulating `gsm7CharWeight(ch)`; stop when adding the next character would exceed `budget`. `cut` is the number of code units taken (equal to characters taken, since each GSM-7 char is one code unit).

**`applyWordBoundary(text, hardCut)`** — scan backward from index `hardCut - 1` down to `max(0, hardCut - 15)` for a space (`0x20`). If found at index `s`, return `s + 1` (split *after* the space; the space stays in the current part so no character is dropped). Otherwise return `hardCut`. A space is never part of a surrogate pair, so this cut is always surrogate-safe.

**`splitContent(text, encoding)`**:
1. `total = countCodeUnits(text, encoding)`. If `total <= singleLimit`, return `[text]`.
2. Otherwise set `contentBudget = multiLimit - prefixUnits` where `prefixUnits = countCodeUnits('(1/4) ', encoding)` (= 6 under the 4-part cap).
3. Greedily take parts: `hardCut = findCutByBudget(remaining, contentBudget, encoding)`; guard `hardCut >= 1` to avoid an infinite loop on a degenerate budget; `cut = applyWordBoundary(remaining, hardCut)`; push `remaining.slice(0, cut)`; set `remaining = remaining.slice(cut)`; repeat until `remaining` is empty.

**`applyHardCap(parts, contentBudget, encoding)`**:
1. If `parts.length <= 4`, return `parts` unchanged.
2. Otherwise keep the first 3 parts; rejoin the remainder as `rest = parts.slice(3).join('')`.
3. Set `truncBudget = contentBudget - 3` (reserve 3 code units for `...`).
4. `hardCut = findCutByBudget(rest, truncBudget, encoding)`; `cut = applyWordBoundary(rest, hardCut)`; the 4th part is `rest.slice(0, cut) + '...'`.
5. Return `[...first3, truncated]` (exactly 4 parts).

**`applyPrefixes(parts)`** — if `parts.length === 1`, return `parts` unchanged (no prefix). Otherwise return `parts.map((p, i) => formatPartPrefix(i + 1, parts.length) + p)`.

**`stripPartPrefix(part)`** — match `PART_PREFIX_PATTERN` at the start; if present, return `part.slice(match.length)`, else return `part` unchanged.

**`joinSms(parts)`** — if `parts.length > 1`, `parts.map(stripPartPrefix).join('')`; otherwise (a single part), return `parts[0]` unchanged. Stripping is conditional on part count: a single-part message whose text naturally begins with a prefix-shaped token (e.g. `"(1/2) Hello"`) is returned verbatim, so `stripPartPrefix` is never applied to a lone part.

**`splitSms(replyText)`** — `encoding = detectEncoding(replyText)`; `content = splitContent(replyText, encoding)`; `contentBudget = multiLimit - prefixUnits`; `capped = applyHardCap(content, contentBudget, encoding)`; `return applyPrefixes(capped)`.

## Data Models

### Types

```ts
export type SmsEncoding = 'GSM-7' | 'UCS-2';
```

### Constants

```ts
export const GSM_7_SINGLE_LIMIT = 160;
export const GSM_7_MULTI_LIMIT = 153;
export const UCS2_SINGLE_LIMIT = 70;
export const UCS2_MULTI_LIMIT = 67;
export const WORD_BOUNDARY_WINDOW = 15; // code units searched back from a hard cut
export const MAX_PARTS = 4;
export const TRUNCATION_INDICATOR = '...'; // 3 code units, GSM-7 safe
```

### GSM-7 character sets

`GSM_7_BASIC` is a `Set<string>` built from the 3GPP TS 23.038 default alphabet (printable characters, space, LF, CR). It includes A-Z, a-z, 0-9, common punctuation (`! " # % & ' ( ) * + , - . / : ; < = > ? _ @`), the currency/symbol characters (`£ $ ¥ ¤ § ¿ ¡`), the Latin-1 supplement members in the table (`è é ù ì ò Ç Ø ø Å å Æ æ ß É Ä Ö Ñ Ü § à ä ö ñ ü`), the Greek capitals in the table (`Δ Φ Γ Λ Ω Π Ψ Σ Θ Ξ`), and the control characters LF (0x0A) and CR (0x0D).

Notably **not** in the basic set: the backtick/grave accent `` ` ``, and every character outside the table.

```ts
export const GSM_7_EXTENSION: Set<string> = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);
```

These are the printable extension characters. Each counts as 2 code units (the `ESC` prefix plus the character).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The following properties were derived from the acceptance criteria prework, then consolidated to remove redundancy. In particular: Requirement 7.2 (prefix counts toward the limit), 9.4 (`...` counts toward the limit), 3.1 (GSM-7 single limit) and 4.2 (UCS-2 single limit) are all subsumed by Property 2 (no part exceeds its encoding limit). Requirements 6.2 and 6.3 are combined into Property 8. Requirements 9.2, 9.3 and 9.5 are combined into Property 10.

### Property 1: Round-trip reconstruction

*For any* `Reply_Text` whose split produces 4 or fewer SMS_Parts, `joinSms(splitSms(text))` SHALL equal `text` exactly.

**Validates: Requirements 8.2** (and underpins 8.1)

### Property 2: No part exceeds its encoding limit

*For any* `Reply_Text` and each SMS_Part `p` in `splitSms(text)`, `countCodeUnits(p, detectEncoding(text))` SHALL be less than or equal to the applicable limit: the single limit (`160` for GSM-7, `70` for UCS-2) when exactly one part is produced, otherwise the multi limit (`153` for GSM-7, `67` for UCS-2).

**Validates: Requirements 3.1, 3.2, 4.2, 4.3, 7.2, 9.4**

### Property 3: Surrogate pairs never split across parts

*For any* `Reply_Text` and any two adjacent SMS_Parts, the last code unit of the earlier part SHALL NOT be a high surrogate whose matching low surrogate begins the next part. Equivalently, stripping prefixes and concatenating adjacent parts never lands a high surrogate at a part boundary followed by its low surrogate.

**Validates: Requirements 6.1**

### Property 4: Maximum 4 parts produced

*For any* `Reply_Text`, `splitSms(text).length` SHALL be at most 4.

**Validates: Requirements 9.1**

### Property 5: Encoding detection is whole-message

*For any* `Reply_Text`, `detectEncoding(text)` SHALL be `'UCS-2'` if and only if at least one character is not a GSM-7 character, and `'GSM-7'` otherwise.

**Validates: Requirements 4.1**

### Property 6: Single-part iff within single limit

*For any* `Reply_Text`, `splitSms(text)` SHALL return exactly one part when `countCodeUnits(text, detectEncoding(text))` is at most the single limit, and two or more parts otherwise.

**Validates: Requirements 2.2, 2.3**

### Property 7: Extension characters count as two code units

*For any* `Reply_Text` consisting solely of GSM-7 characters, `countCodeUnits(text, 'GSM-7')` SHALL equal `(#basic characters) * 1 + (#extension characters) * 2`.

**Validates: Requirements 5.1**

### Property 8: Word-boundary split preference

*For any* `Reply_Text` that splits into multiple parts, and for each non-final content part, let `hardCut` be the largest code-unit prefix of the remaining text that fits the content budget. The actual content length of that part SHALL be `hardCut` when no space exists in the `WORD_BOUNDARY_WINDOW` code units preceding `hardCut`, otherwise it SHALL be the position immediately after the latest such space.

**Validates: Requirements 6.2, 6.3**

### Property 9: Part prefixing

*For any* `Reply_Text`, when `splitSms(text)` produces a single part, `splitSms` SHALL NOT prepend a Part_Prefix (the part equals the original `Reply_Text` when it fits the single limit) and `joinSms` SHALL return that single part unchanged (no stripping, even if the text naturally begins with a prefix-shaped token); when `splitSms(text)` produces more than one part, each part `i` (0-indexed) SHALL begin with `(${i + 1}/${total}) ` where `total` is the number of parts, the totals SHALL be consistent across all parts, and `joinSms` SHALL strip exactly one leading Part_Prefix from each part before concatenating.

**Validates: Requirements 7.1, 7.3**

### Property 10: Truncation behavior for over-cap replies

*For any* `Reply_Text` whose content split would exceed 4 parts, `splitSms(text)` SHALL return exactly 4 parts, the last part SHALL end with the `Truncation_Indicator` (`...`), and the content preceding the indicator (after stripping the prefix) SHALL end at a word boundary when a space exists within `WORD_BOUNDARY_WINDOW` code units of the truncation point.

**Validates: Requirements 9.2, 9.3, 9.5**

## Error Handling

The splitter is a pure transformer; it does not throw for normal input. Error handling is defensive rather than exceptional.

- **Empty input** (`""`): `countCodeUnits = 0`, which is `<= singleLimit`, so `splitSms("")` returns `[""]` (a single empty part) and `joinSms([""]) === ""`. Documented behavior, no throw.
- **Lone (unpaired) surrogates**: a malformed high or low surrogate without its partner is treated as a single code unit. It does not trigger a surrogate-aware adjustment (there is no pair to protect). The output is deterministic; we do not validate Unicode well-formedness.
- **Degenerate content budget**: if `findCutByBudget` returns 0 (budget too small to hold any unit), the splitter forces `cut = 1` to guarantee forward progress and avoid an infinite loop. Under the real limits (GSM-7 budget 147, UCS-2 budget 61) this path is unreachable; it exists only as a guard.
- **Prefix/`...` collisions**: if user content itself begins with a `(n/total) `-shaped token and `splitSms` produces more than one part, `stripPartPrefix` will remove that leading token on join. `joinSms` only strips from parts when `parts.length > 1`, so a single-part message that naturally starts with a prefix-shaped token is returned verbatim and is not affected by this ambiguity. For multi-part messages the prefix shape is distinctive enough to be acceptable for SMS replies; this edge case is documented.
- **No exceptions for over-long input**: exceeding 4-part capacity is handled by truncation, not by throwing. Callers receive a valid, capped result.
- **Type safety**: `any` is forbidden; `tsc` with `strict` and `noImplicitAny`, plus an ESLint rule (`@typescript-eslint/no-explicit-any`), enforce this at build time.

## Testing Strategy

**Dual testing approach**: example-based unit tests for specific scenarios and edge cases, plus fast-check property-based tests for universal behavior. Both run via Vitest (`vitest --run`); property tests use `fast-check`.

### Property-based tests (fast-check)

PBT is appropriate here: the splitter is a set of pure functions with clear input/output behavior and a large input space (arbitrary strings including Urdu script, emoji, and GSM-7 extension characters), where universal properties (round-trip, limits, surrogate integrity, part cap) hold across all inputs. Each property test runs a **minimum of 100 iterations** and is tagged with a comment referencing its design property.

Generators (fast-check arbitraries):
- `gsm7TextArb` — strings built from `GSM_7_BASIC` and `GSM_7_EXTENSION` characters (mix basic and extension).
- `ucs2TextArb` — strings that include at least one non-GSM-7 character (Urdu letters, accented Latin outside the table, and supplementary-plane emoji via surrogate pairs).
- `anyTextArb` — union of the above plus pure-ASCII.
- `prefixShapedSingleArb` — strings that begin with a prefix-shaped token (e.g. `"(1/2) "`, `"(3/4) "`) followed by short GSM-7 text, sized to fit within the single limit so `splitSms` yields exactly one part. Guards the edge case where a single-part message's content naturally starts with a token matching `PART_PREFIX_PATTERN`: since `splitSms` does not prefix single parts and `joinSms` does not strip single parts, the leading token must survive the round trip intact.
- `boundedTextArb(limit, encoding)` — text whose code-unit total is at most `limit`, used for single-part and round-trip properties.
- `overCapacityTextArb(encoding)` — text long enough that the greedy split exceeds 4 parts, used for the truncation properties.

Each property is implemented as a single `fc.assert(fc.property(...))` test:

- **Feature: sms-message-splitter, Property 1: Round-trip reconstruction** — for `anyTextArb` and `prefixShapedSingleArb` constrained to splits of `<= 4` parts, assert `joinSms(splitSms(t)) === t`. The `prefixShapedSingleArb` cases specifically cover the edge case where a single-part message's text naturally starts with a prefix-shaped token like `"(1/2) "`: `splitSms` adds no prefix to a single part and `joinSms` strips nothing from a single part, so the token must round-trip unchanged.
- **Feature: sms-message-splitter, Property 2: No part exceeds its encoding limit** — for `anyTextArb`, compute `encoding`, and assert every part is within the single or multi limit depending on part count.
- **Feature: sms-message-splitter, Property 3: Surrogate pairs never split across parts** — for `ucs2TextArb` containing emoji, assert no adjacent parts separate a high surrogate from its low surrogate.
- **Feature: sms-message-splitter, Property 4: Maximum 4 parts produced** — for `anyTextArb` (including very long inputs), assert `splitSms(t).length <= 4`.
- **Feature: sms-message-splitter, Property 5: Encoding detection is whole-message** — for `anyTextArb`, assert `detectEncoding(t) === 'UCS-2'` iff some char is non-GSM-7.
- **Feature: sms-message-splitter, Property 6: Single-part iff within single limit** — for `anyTextArb`, assert part count is 1 iff total code units `<= singleLimit`.
- **Feature: sms-message-splitter, Property 7: Extension characters count as two code units** — for `gsm7TextArb`, assert `countCodeUnits` equals the weighted sum of basic (1) and extension (2) characters.
- **Feature: sms-message-splitter, Property 8: Word-boundary split preference** — for multi-part `anyTextArb`, recompute the expected cut per part and assert it matches the actual content length.
- **Feature: sms-message-splitter, Property 9: Part prefixing** — for `anyTextArb`, assert prefix presence/absence and sequential `(n/total)` numbering match part count.
- **Feature: sms-message-splitter, Property 10: Truncation behavior for over-cap replies** — for `overCapacityTextArb`, assert exactly 4 parts, last part ends with `...`, and the pre-indicator content ends at a word boundary when a space is near the truncation point.

### Unit tests (example-based)

Focused examples and edge cases that complement the property tests:
- Empty string returns `[""]`.
- GSM-7 text exactly 160 code units → 1 part; 161 → 2 parts each `<= 153`.
- GSM-7 text containing extension characters (`^`, `€`, etc.) counts them as 2 toward the limit.
- A string of exactly 160 `€` characters (each 2 units = 320 units) splits into multiple parts each `<= 153`.
- UCS-2 text with Urdu characters and an emoji (surrogate pair) detected as UCS-2; parts `<= 67` when split.
- A supplementary emoji never appears split between two parts (place an emoji near a split boundary).
- A single very long word (no spaces) longer than the content budget splits at the hard limit with no character loss.
- Text that requires 5+ content parts produces exactly 4 parts with the last ending in `...`.
- `joinSms` strips `(1/2) `, `(2/2) ` prefixes and concatenates to reproduce the original for a 2-part GSM-7 reply and a 2-part UCS-2 reply.
- A 1-part reply has no prefix; `joinSms` of a single non-prefixed part returns it unchanged.
- A 1-part reply whose text naturally begins with a prefix-shaped token (e.g. `splitSms("(1/2) Hello")` returns `["(1/2) Hello"]`) round-trips: `joinSms(["(1/2) Hello"]) === "(1/2) Hello"` — `joinSms` must NOT strip the leading token from a single part.
- Integration point: `splitSms` output passed straight to `joinSms` round-trips for inputs up to 4 parts.

### Test execution

- `npm test --workspace @lazarus/brain` runs `vitest --run` once (non-watch) across unit and property suites.
- Build/typecheck: `tsc --noEmit -p packages/brain` enforces strict mode and `noImplicitAny`; ESLint with `@typescript-eslint/no-explicit-any` forbids `any`.
