# Requirements Document

## Introduction

The Command_Router is a set of pure TypeScript functions in `packages/brain` that classifies an incoming SMS body into exactly one command and detects the language of the message. It is shared by the Android app and the web Ouija simulator. The supported commands are HELP, STOP, START, SCAM, REMIND, TRANSLATE and QUESTION. QUESTION is the fallback for any free text. The router is tolerant of letter case, extra whitespace and Roman Urdu keyword variants, and it guarantees that STOP always wins. The router does not send messages, call the AI client, or parse reminder times into timestamps; it only extracts the raw argument text for each command.

## Glossary

- **Command_Router**: The pure function `routeCommand` in `packages/brain` that maps an SMS body to a Routed_Command.
- **Language_Detector**: The pure function `detectLanguage` in `packages/brain` that maps an SMS body to a Language.
- **Command_Printer**: The pure function `printCommand` in `packages/brain` that formats a Routed_Command as a canonical message string.
- **Routed_Command**: The result of routing, containing a Command, an Argument string, and a Language.
- **Command**: One of the seven values `HELP`, `STOP`, `START`, `SCAM`, `REMIND`, `TRANSLATE`, `QUESTION`.
- **Argument**: The text that follows the command keyword after normalization. For QUESTION the Argument is the full normalized message.
- **Keyword**: The first whitespace-delimited token of a normalized message.
- **Normalized_Message**: The SMS body after Unicode NFKC normalization, trimming of leading and trailing whitespace, and collapsing of each run of whitespace characters into a single space.
- **Alias**: A Roman Urdu or Urdu script word that maps to a Command, as listed in the Alias_Table.
- **Alias_Table**: The fixed mapping from Keywords to Commands. English entries are `help`, `stop`, `start`, `scam`, `remind`, `translate`. Roman Urdu entries are `madad` (HELP), `band` (STOP), `shuru` (START), `dhoka` (SCAM), `yaad` (REMIND), `tarjuma` (TRANSLATE).
- **Language**: One of `en` (English), `ur` (Urdu script), `roman-ur` (Roman Urdu).
- **Urdu_Script_Character**: A character in the Unicode ranges U+0600 to U+06FF, U+0750 to U+077F, U+FB50 to U+FDFF, or U+FE70 to U+FEFF.
- **Roman_Urdu_Marker**: A word from the fixed Roman_Urdu_Marker_List of common Roman Urdu words written in Latin letters (for example `kya`, `hai`, `mein`, `kaise`, `nahi`, `aap`, `meri`, `karo`).
- **Latin_Word**: A whitespace-delimited token made only of ASCII letters, digits and ASCII punctuation.

## Requirements

### Requirement 1: Classify every message into exactly one command

**User Story:** As a gateway operator, I want every incoming SMS to map to exactly one command, so that the gateway always knows what to do with a message.

#### Acceptance Criteria

1. WHEN any string is passed to the Command_Router, THE Command_Router SHALL return a Routed_Command whose Command is exactly one of HELP, STOP, START, SCAM, REMIND, TRANSLATE or QUESTION.
2. WHEN a Normalized_Message is empty, THE Command_Router SHALL return the command QUESTION with an empty Argument.
3. WHEN the Keyword of a Normalized_Message does not match any entry in the Alias_Table, THE Command_Router SHALL return the command QUESTION with the full Normalized_Message as the Argument.
4. WHEN the Keyword of a Normalized_Message matches an entry in the Alias_Table, THE Command_Router SHALL return the command mapped to that entry with the remaining text after the Keyword, trimmed of leading and trailing whitespace, as the Argument.
5. WHEN the same input string is passed to the Command_Router in 2 or more calls, THE Command_Router SHALL return a Routed_Command with identical `command`, `argument`, `language` and `argumentMissing` values on every call.
6. IF the input contains characters outside the Basic Multilingual Plane, THEN THE Command_Router SHALL return a Routed_Command with one of the 7 allowed Commands without throwing an error.

### Requirement 2: Normalize input before matching

**User Story:** As a sender on a button phone, I want typos in spacing and case to be forgiven, so that my command still works.

#### Acceptance Criteria

1. WHEN matching a Keyword, THE Command_Router SHALL compare the Keyword to the Alias_Table without regard to letter case, for both ASCII letters (A-Z, a-z) and Roman Urdu text.
2. THE Command_Router SHALL ignore leading whitespace, trailing whitespace and repeated whitespace between tokens when determining the Keyword and Argument.
3. WHEN a message contains tab or newline characters between tokens, THE Command_Router SHALL treat each such character as whitespace equivalent to a single space.
4. WHEN a Keyword is immediately followed by one or more trailing punctuation characters from the set `. , ! ? : ;`, THE Command_Router SHALL ignore those characters when matching the Keyword and SHALL exclude them from the Argument.
5. IF the input is an empty string or contains only whitespace characters, THEN THE Command_Router SHALL return the command QUESTION with an empty Argument and SHALL NOT raise an error.
6. THE Command_Router SHALL preserve the original letter case and internal characters of the Argument, other than collapsing whitespace runs between tokens to a single space.
7. FOR ALL input strings, routing the Normalized_Message of the input SHALL produce a Routed_Command equal to routing the original input, and normalizing a Normalized_Message SHALL return it unchanged (idempotence of normalization).

### Requirement 3: Roman Urdu and Urdu aliases

**User Story:** As a Roman Urdu speaker, I want to use words like "madad" and "band", so that I can command the gateway in my own language.

#### Acceptance Criteria

1. WHEN the Keyword matches an Alias in the Alias_Table, THE Command_Router SHALL return the Command mapped to that Alias.
2. WHEN the Keyword is `madad`, THE Command_Router SHALL return the command HELP.
3. WHEN the Keyword is `band`, THE Command_Router SHALL return the command STOP.
4. WHEN the Keyword is `shuru`, THE Command_Router SHALL return the command START.
5. WHEN the Keyword is `dhoka`, THE Command_Router SHALL return the command SCAM.
6. WHEN the Keyword is `yaad`, THE Command_Router SHALL return the command REMIND.
7. WHEN the Keyword is `tarjuma`, THE Command_Router SHALL return the command TRANSLATE.
8. THE Alias_Table SHALL map each of these Urdu script aliases to the same Command as its Roman Urdu alias: `مدد` (HELP), `بند` (STOP), `شروع` (START), `دھوکہ` (SCAM), `یاد` (REMIND), `ترجمہ` (TRANSLATE).
9. THE Command_Router SHALL match Roman Urdu aliases case-insensitively, so that `MADAD`, `Madad` and `madad` each return HELP.
10. IF the Keyword does not match any Alias in the Alias_Table, THEN THE Command_Router SHALL return the command QUESTION.
11. WHEN the Keyword matches an Alias for the STOP command (`band` or `بند`), THE Command_Router SHALL return STOP with the same precedence as the English `stop` Keyword.

### Requirement 4: STOP always wins

**User Story:** As a recipient, I want my request to stop messages to be honored every time, so that I never receive texts I have opted out of.

#### Acceptance Criteria

1. WHEN the first token of a Normalized_Message is the Keyword `stop` or an Alias for STOP, THE Command_Router SHALL return the command STOP regardless of any text that follows that token, including an empty remainder, a remainder of up to 1,600 characters, and a remainder containing other command keywords.
2. FOR ALL strings whose Normalized_Message begins with the Keyword `stop` in any letter case, THE Command_Router SHALL return the command STOP (property: STOP prefix always maps to STOP).
3. FOR ALL strings whose Normalized_Message begins with the Alias `band` or `بند`, THE Command_Router SHALL return the command STOP (property: STOP alias prefix always maps to STOP).
4. WHEN a Normalized_Message begins with the Keyword `stop` followed by text that contains another command keyword (HELP, SCAM, REMIND, TRANSLATE or START), THE Command_Router SHALL return the command STOP and SHALL NOT return the other command.
5. WHEN the word `stop` appears in a Normalized_Message only as a token other than the first token, THE Command_Router SHALL route the message by its first token only and SHALL NOT return the command STOP because of that later token.
6. WHEN the first token of a Normalized_Message is the Keyword `start` in any letter case, THE Command_Router SHALL return the command START.
7. IF a Normalized_Message is empty, THEN THE Command_Router SHALL return the command QUESTION and SHALL NOT return the command STOP.

### Requirement 5: Commands that take an argument

**User Story:** As a user, I want to send SCAM, REMIND and TRANSLATE commands with text, so that I can get help checking a message, setting a reminder or translating.

#### Acceptance Criteria

1. WHEN the Keyword maps to SCAM and the text after the Keyword is not empty, THE Command_Router SHALL return the command SCAM with the text after the Keyword as the Argument, trimmed of leading and trailing whitespace.
2. WHEN the Keyword maps to TRANSLATE and the text after the Keyword is not empty, THE Command_Router SHALL return the command TRANSLATE with the text after the Keyword as the Argument, trimmed of leading and trailing whitespace.
3. WHEN the Keyword maps to REMIND and the text after the Keyword is not empty, THE Command_Router SHALL return the command REMIND with the text after the Keyword as the Argument, trimmed of leading and trailing whitespace, and without parsing, validating or altering the time portion.
4. IF the Keyword maps to SCAM, REMIND or TRANSLATE and the text after the Keyword is empty or contains only whitespace, THEN THE Command_Router SHALL return that same Command with an Argument of zero characters and an `argumentMissing` flag set to true.
5. WHEN the Keyword maps to SCAM, REMIND or TRANSLATE and the Argument is not empty, THE Command_Router SHALL return the `argumentMissing` flag set to false.
6. WHEN the Keyword maps to HELP, STOP or START, THE Command_Router SHALL return the Argument as the text after the Keyword, trimmed of leading and trailing whitespace, which MAY be zero characters long, and SHALL NOT set `argumentMissing` to true.
7. THE Command_Router SHALL preserve the letter case, inner whitespace, digits, punctuation and non-ASCII characters (including Urdu script) of the Argument exactly as they appear in the Normalized_Message.

### Requirement 6: Language detection

**User Story:** As a sender, I want the reply in the language I wrote in, so that I can read it.

#### Acceptance Criteria

1. WHEN a message contains at least one Urdu_Script_Character, THE Language_Detector SHALL return `ur`, regardless of how many Latin_Words or digits the message also contains.
2. WHEN a message contains no Urdu_Script_Character and at least one Latin_Word matches the Roman_Urdu_Marker_List, THE Language_Detector SHALL return `roman-ur`.
3. WHEN a message contains no Urdu_Script_Character and no Latin_Word matches the Roman_Urdu_Marker_List, THE Language_Detector SHALL return `en`.
4. WHEN a message is the empty string or contains only whitespace characters, THE Language_Detector SHALL return `en`.
5. WHEN a message contains no Urdu_Script_Character and its first Latin_Word, after leading whitespace is ignored, equals a Roman Urdu Alias (such as `madad` or `band`) without regard to letter case, THE Language_Detector SHALL return `roman-ur`.
6. THE Language_Detector SHALL compare Latin_Words against the Roman_Urdu_Marker_List and Roman Urdu Aliases without regard to letter case.
7. THE Language_Detector SHALL match a Latin_Word against the Roman_Urdu_Marker_List only as a whole word, so that a marker appearing inside a longer word does not count as a match.
8. WHEN the Command_Router routes a message, THE Command_Router SHALL set the `language` field of the Routed_Command to the same value the Language_Detector returns for that message, for every Command.
9. FOR ALL input strings, THE Language_Detector SHALL return exactly one of `en`, `ur` or `roman-ur`, and SHALL return the same value when called again with the same input.

### Requirement 7: Structured result and parsing round trip

**User Story:** As a developer, I want a typed, printable routing result, so that the app and simulator can log and test it consistently.

#### Acceptance Criteria

1. WHEN the Command_Router routes an inbound message, THE Command_Router SHALL return a Routed_Command containing exactly the fields `command`, `argument`, `language` and `argumentMissing`.
2. THE Command_Router SHALL type the `command` field as a string literal union of HELP, STOP, START, SCAM, REMIND, TRANSLATE and QUESTION, and the `language` field as a string literal union of `en`, `ur` and `roman-ur`, so that the TypeScript compiler rejects any other value.
3. WHEN the Command_Printer formats a Routed_Command whose Command is not QUESTION and whose Argument is non-empty, THE Command_Printer SHALL return the English keyword for the Command, followed by a single space, followed by the Argument.
4. WHEN the Command_Printer formats a Routed_Command whose Command is not QUESTION and whose Argument is empty, THE Command_Printer SHALL return only the English keyword for the Command, with no trailing space.
5. FOR ALL Routed_Commands with a Command other than QUESTION produced by the Command_Router, routing the output of the Command_Printer SHALL produce a Routed_Command with the same Command and the same Argument (round-trip property).
6. FOR ALL Routed_Commands with the Command QUESTION, THE Command_Printer SHALL return the Argument unchanged, with no keyword prefix and no added or removed characters.

### Requirement 8: Purity and type safety

**User Story:** As a maintainer, I want the router to be a pure, strictly typed module, so that it is safe to share between the mobile app and the web app.

#### Acceptance Criteria

1. THE Command_Router SHALL perform no file or console input or output, no network calls, no clock reads and no random number reads during routing.
2. THE Command_Router SHALL return an identical Routed_Command for any two calls made with identical input, regardless of call order or call count.
3. THE Command_Router SHALL leave its input arguments unmodified after each call.
4. THE Command_Router SHALL compile under TypeScript strict mode with zero compiler errors and zero uses of the `any` type.
5. THE Command_Router SHALL be exported from the `packages/brain` package entry point together with the Command, Language and Routed_Command types.
6. WHEN the input string is between 0 and 10000 characters long, THE Command_Router SHALL return a result within 50 milliseconds on a Node.js runtime.
7. IF the input string is longer than 10000 characters, THEN THE Command_Router SHALL still return a Routed_Command without throwing an exception.

### Requirement 9: Test coverage

**User Story:** As a maintainer, I want property and example tests, so that routing guarantees are verified automatically.

#### Acceptance Criteria

1. THE test suite SHALL include a fast-check property that, for arbitrary strings of length 0 to 1,000 characters (including empty, whitespace-only and non-ASCII strings), `routeCommand` returns exactly one Command that is a member of the defined Command set and does not throw.
2. THE test suite SHALL include a fast-check property that, for arbitrary strings with any letter case of `stop`, 0 to 20 leading whitespace characters and 0 to 500 characters of trailing text, a Normalized_Message beginning with `stop` routes to STOP.
3. THE test suite SHALL include a fast-check property that, for arbitrary strings of length 0 to 1,000 characters (including empty, whitespace-only and non-ASCII strings), the Language_Detector returns exactly one Language that is a member of the defined Language set and does not throw.
4. THE test suite SHALL include at least one example test for each Alias in the Alias_Table, at least one example test with 2 or more consecutive spaces between tokens, at least one example test with mixed letter case, and at least one example test for each Language (`en`, `ur` and `roman-ur`).
5. THE test suite SHALL configure each fast-check property to run at least 100 iterations.
6. IF any fast-check property or example test fails, THEN THE test suite SHALL report a failing result with a non-zero exit status, and for property failures SHALL report the shrunk counterexample and the seed needed to reproduce it.
