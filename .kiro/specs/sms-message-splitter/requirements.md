# Requirements Document

## Introduction

The SMS Message Splitter is a TypeScript module in the `packages/brain` package that takes a reply text string and splits it into an array of SMS parts, each within the character limit for its encoding. The splitter detects whether the text uses GSM-7 or UCS-2 encoding, counts extension characters and surrogate pairs correctly, prefers word boundaries for split points, prefixes multi-part messages with a part counter, and enforces a hard cap of 4 parts. This module is a core building block of Lazarus, a system that turns an old Android phone into a free AI server answering people by plain SMS.

## Glossary

- **Package**: The `packages/brain` TypeScript package containing the SMS_Splitter and shared core logic.
- **SMS_Splitter**: The TypeScript module in the Package that splits Reply_Text into SMS_Parts.
- **Reply_Text**: The input string provided to the SMS_Splitter to be divided into SMS_Parts.
- **SMS_Part**: A single SMS message segment string returned by the SMS_Splitter.
- **GSM-7**: A 7-bit character encoding that supports basic Latin letters, digits, and common symbols used in standard SMS text.
- **GSM-7_Extension_Character**: A character in the GSM-7 extension table (`^ { } \ [ ~ ] | €`) that counts as 2 Code_Units due to an escape prefix.
- **UCS-2**: A 16-bit character encoding used when the Reply_Text contains any character outside the GSM-7 character set, supporting Urdu script, emoji, and other non-Latin characters.
- **Code_Unit**: The counting unit for SMS character limits. In GSM-7 encoding, each basic character counts as 1 Code_Unit and each GSM-7_Extension_Character counts as 2 Code_Units. In UCS-2 encoding, each UTF-16 code unit counts as 1 Code_Unit, so supplementary characters represented as Surrogate_Pairs count as 2 Code_Units.
- **Surrogate_Pair**: A pair of UTF-16 code units representing a single Unicode supplementary character above U+FFFF, such as certain emoji.
- **Part_Prefix**: A string of the form `(n/total) ` prepended to each SMS_Part when more than one part is produced, where `n` is the 1-indexed part number and `total` is the number of parts.
- **Part_Limit**: The maximum number of Code_Units allowed in a single SMS_Part for the active encoding: 160 Code_Units for a single GSM-7 message, 153 Code_Units per part for multi-part GSM-7, 70 Code_Units for a single UCS-2 message, and 67 Code_Units per part for multi-part UCS-2.
- **Word_Boundary**: A space character that separates words, used as a preferred split point to avoid breaking words across SMS_Parts.
- **Truncation_Indicator**: The string `...` (three ASCII period characters, GSM-7 safe) appended to the end of the last SMS_Part when the Reply_Text is truncated to fit within the 4-part cap, signaling to the reader that the message was cut. Each period counts as 1 Code_Unit, so the Truncation_Indicator counts as 3 Code_Units toward the Part_Limit.

## Requirements

### Requirement 1: Package Setup

**User Story:** As a developer, I want the Package configured with TypeScript strict mode and testing tools, so that I can build and test the SMS_Splitter with type safety and property-based testing.

#### Acceptance Criteria

1. THE Package SHALL be configured with TypeScript strict mode enabled.
2. THE Package SHALL use Vitest as the test runner.
3. THE Package SHALL include fast-check for property-based testing.
4. THE Package SHALL not use the `any` type in any source file.

### Requirement 2: Split Reply Text into SMS Parts

**User Story:** As a developer, I want a function that takes Reply_Text and returns an array of SMS_Parts, so that a reply can be sent as one or more SMS messages.

#### Acceptance Criteria

1. WHEN Reply_Text is provided, THE SMS_Splitter SHALL return an array of SMS_Part strings.
2. WHEN the Reply_Text fits within the Part_Limit for a single message, THE SMS_Splitter SHALL return an array containing a single SMS_Part.
3. WHEN the Reply_Text exceeds the Part_Limit for a single message, THE SMS_Splitter SHALL split the Reply_Text into multiple SMS_Parts.

### Requirement 3: GSM-7 Encoding Limits

**User Story:** As a developer, I want the splitter to apply GSM-7 character limits, so that standard SMS text is split at the correct boundaries.

#### Acceptance Criteria

1. WHEN all characters in the Reply_Text are GSM-7 characters, THE SMS_Splitter SHALL apply a Part_Limit of 160 Code_Units for a single message.
2. WHEN all characters in the Reply_Text are GSM-7 characters and the Reply_Text exceeds 160 Code_Units, THE SMS_Splitter SHALL apply a Part_Limit of 153 Code_Units per part.

### Requirement 4: UCS-2 Encoding Detection and Limits

**User Story:** As a developer, I want the splitter to detect non-GSM-7 characters and switch to UCS-2 limits, so that Urdu, emoji, and other non-GSM-7 text is split correctly.

#### Acceptance Criteria

1. WHEN the Reply_Text contains any non-GSM-7 character, THE SMS_Splitter SHALL use UCS-2 encoding for the entire Reply_Text.
2. WHILE the Reply_Text contains any non-GSM-7 character, THE SMS_Splitter SHALL apply a Part_Limit of 70 Code_Units for a single message.
3. WHILE the Reply_Text contains any non-GSM-7 character and the Reply_Text exceeds 70 Code_Units, THE SMS_Splitter SHALL apply a Part_Limit of 67 Code_Units per part.

### Requirement 5: GSM-7 Extension Character Counting

**User Story:** As a developer, I want extension characters counted as 2 Code_Units, so that the Part_Limit is accurate for messages containing GSM-7 extension characters.

#### Acceptance Criteria

1. WHERE the Reply_Text contains a GSM-7_Extension_Character, THE SMS_Splitter SHALL count that character as 2 Code_Units toward the Part_Limit.

### Requirement 6: Split Point Selection

**User Story:** As a developer, I want the splitter to avoid breaking surrogate pairs and words, so that SMS_Parts remain valid and readable.

#### Acceptance Criteria

1. WHEN selecting a split point, THE SMS_Splitter SHALL not split inside a Surrogate_Pair.
2. WHEN a Word_Boundary exists within the last 15 characters of a potential split point, THE SMS_Splitter SHALL split at the Word_Boundary rather than inside a word.
3. WHEN no Word_Boundary exists within the last 15 characters of a potential split point, THE SMS_Splitter SHALL split at the character limit.

### Requirement 7: Part Prefixing

**User Story:** As a recipient, I want multi-part SMS messages to include a part counter, so that I know the message order and how many parts to expect.

#### Acceptance Criteria

1. WHEN the SMS_Splitter produces more than one SMS_Part, THE SMS_Splitter SHALL prefix each SMS_Part with a Part_Prefix of the form `(n/total) `.
2. WHEN the SMS_Splitter produces more than one SMS_Part, THE Part_Prefix SHALL count toward the Part_Limit of each SMS_Part.
3. WHEN the SMS_Splitter produces a single SMS_Part, THE SMS_Splitter SHALL not prefix the SMS_Part.

### Requirement 8: Round-trip Reconstruction

**User Story:** As a developer, I want joining all SMS_Parts to reconstruct the original Reply_Text, so that no information is lost during splitting.

#### Acceptance Criteria

1. THE SMS_Splitter SHALL provide a function that joins an array of SMS_Parts back into a single string by removing all Part_Prefixes and concatenating the remaining content.
2. FOR ALL valid Reply_Text inputs that fit within 4 SMS_Parts, joining the SMS_Parts produced by the SMS_Splitter SHALL produce the original Reply_Text exactly (round-trip property).

### Requirement 9: Part Count Hard Cap

**User Story:** As a developer, I want a maximum of 4 SMS_Parts per reply, so that replies stay short and cost-effective.

#### Acceptance Criteria

1. THE SMS_Splitter SHALL produce no more than 4 SMS_Parts.
2. WHEN the Reply_Text exceeds the capacity of 4 SMS_Parts, THE SMS_Splitter SHALL truncate the content at a Word_Boundary to fit within 4 SMS_Parts.
3. WHEN the Reply_Text is truncated to fit within 4 SMS_Parts, THE SMS_Splitter SHALL append a Truncation_Indicator to the end of the last SMS_Part.
4. WHEN a Truncation_Indicator is appended, THE Truncation_Indicator SHALL count toward the Part_Limit of the last SMS_Part.
5. FOR ALL Reply_Text inputs that exceed the capacity of 4 SMS_Parts, THE SMS_Splitter SHALL produce exactly 4 SMS_Parts and the last SMS_Part SHALL end with a Truncation_Indicator.
