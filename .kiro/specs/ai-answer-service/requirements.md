# Requirements Document

## Introduction

The Answer_Service is a TypeScript module in `packages/brain` that turns a free-text question (command QUESTION) or a SCAM argument into a short reply text, using the Gemini free tier through an injectable AI_Client. It is shared by the Android app and the web Ouija simulator. The Answer_Service reuses the existing `Language` type and `detectLanguage` from the Command_Router and the existing `splitSms`, `detectEncoding`, `getPartLimits` and `MAX_PARTS` from the SMS_Splitter; it does not re-implement them. The Answer_Service returns reply text only. It does not receive or send SMS, route commands, enforce rate limits, enforce STOP or allowlists, or parse reminder times. Those concerns belong to the Command_Router, the gateway and other specs.

The AI_Client is an interface so that tests and the Ouija simulator can supply a mock. The real Gemini adapter (Gemini_Client) sits at the host edge, outside the Answer_Service, and is the only component that touches the environment: it takes its API key from the env var `GEMINI_API_KEY` (directly or through a host-supplied Env_Config object populated from that variable only), passes the key to the constructor of the official Genai_SDK, and takes its model name from `GEMINI_MODEL` or a factory option. The Gemini_Client calls `ai.models.generateContent({ model, contents, config })` on the Genai_SDK and is the only module that imports the Genai_SDK. The Answer_Service and the Mock_Client read no environment variables and do not import the Genai_SDK. No network call is made by the pure parts of the module, no test touches the network, and only free-tier Gemini features are used (Requirements 14 to 16).

## Glossary

- **Answer_Service**: The module in `packages/brain` exposing `answerQuestion` and `checkScam`, which produce a Reply_Text from user input.
- **AI_Client**: An injectable interface with one asynchronous method that takes a Prompt and returns generated text, or rejects with an AI_Error.
- **Gemini_Client**: The production implementation of the AI_Client that calls the Gemini free tier through the Genai_SDK. It is an adapter at the host edge and lives in its own entry point, separate from the Answer_Service.
- **Genai_SDK**: The official Google Gen AI npm package `@google/genai`. The Gemini_Client creates one `GoogleGenAI` instance with `{ apiKey }` and calls `ai.models.generateContent({ model, contents, config })`, where `config` carries the system instruction (`systemInstruction`), `maxOutputTokens` and `temperature`. Tests replace it with a Fake_Genai_SDK or bypass it with the Mock_Client.
- **Fake_Genai_SDK**: A test double with the same shape as the used part of the Genai_SDK (a constructor that receives `{ apiKey }` and an `models.generateContent` method), injected into the Gemini_Client factory so that no test touches the network.
- **Env_Config**: A plain object of string values (`GEMINI_API_KEY` and optionally `GEMINI_MODEL`) that the host builds from environment variables and passes to the Gemini_Client factory. When the host passes no Env_Config, the Gemini_Client entry reads the same two variables from the process environment.
- **Gemini_Model**: The Gemini model name string sent to the API. It comes from `GEMINI_MODEL`, a factory option, or the Default_Model, in that order of precedence (factory option first).
- **Default_Model**: The single exported constant `DEFAULT_GEMINI_MODEL`, set to `gemini-3.5-flash-lite`, a Flash-Lite model that Google's pricing page lists as free of charge on the Gemini API free tier. It is the only place the default model name is written, so it is easy to change when Google retires or renames models (for example `gemini-2.5-flash-lite` is scheduled for retirement on 20 October 2026).
- **Free_Tier_Feature**: A Gemini API capability that the free tier offers at no charge for the chosen Gemini_Model: plain text generation with a system instruction and user content.
- **Billing_Only_Feature**: A capability or model available only on a paid tier or billed separately, including Grounding with Google Search, context caching, the paid Batch API, image, video and speech generation models, and any model not listed as free of charge.
- **Mock_Client**: A test implementation of the AI_Client that returns scripted text or scripted AI_Errors without network access.
- **AI_Error**: A typed failure from the AI_Client with a `kind` of `quota`, `timeout`, `network` or `unknown`.
- **Prompt**: The system instruction plus user text sent to the AI_Client, built by the Prompt_Builder.
- **Prompt_Builder**: The pure function that builds a Prompt from the user text, the Language and the Safety_Rules.
- **Reply_Text**: The final string returned by the Answer_Service, before it is passed to `splitSms`.
- **Language**: One of `en`, `ur`, `roman-ur`, as defined by the Command_Router.
- **Answer_Budget**: The maximum Reply_Text size, equal to the code-unit capacity of `MAX_PARTS` (4) SMS parts for the encoding of the Reply_Text, including the `(n/total) ` prefix on each part, as computed by the SMS_Splitter.
- **Target_Parts**: The preferred reply size of 1 to 3 SMS parts, stated to the model in the Prompt.
- **Safety_Rules**: The rules from product.md: health, legal and money answers stay general and suggest a professional; no invented prices or facts, and uncertainty is stated; STOP handling stays outside this module.
- **Sensitive_Topic**: A question about health, law or money (including loans, taxes, investments and insurance), as determined by the Topic_Classifier.
- **Topic_Classifier**: The pure function that decides whether user text is a Sensitive_Topic using fixed keyword lists in English, Urdu script and Roman Urdu.
- **Professional_Referral**: A fixed sentence in each Language that suggests asking a doctor, lawyer or financial adviser, chosen to match the Sensitive_Topic.
- **Uncertainty_Note**: A fixed sentence in each Language saying the answer may be wrong and should be checked.
- **Answer_Cache**: An injectable key-value store that holds Reply_Texts for repeated questions, with a time-to-live.
- **Cache_Key**: The string derived from the Normalized_Message, the Language and the request kind (`question` or `scam`).
- **Clock**: An injectable function returning the current time in milliseconds, used for cache expiry.
- **Try_Later_Text**: A fixed short message in each Language telling the sender the service is busy and to try again later.
- **Scam_Verdict**: One of `SCAM`, `SAFE` or `UNSURE`.
- **Scam_Result**: A Scam_Verdict plus a Reason of one line.
- **Reason**: A single-line explanation containing no newline characters.
- **Scam_Parser**: The pure function that parses model output into a Scam_Result.
- **Scam_Printer**: The pure function that formats a Scam_Result as a Reply_Text.
- **Secret**: The Gemini API key or any other credential held in configuration.
- **Redactor**: The pure function that removes Secrets and phone-number-like digit runs from text.

## Requirements

### Requirement 1: Injectable AI client

**User Story:** As a developer, I want the AI client to be injectable, so that I can test the service and run the Ouija simulator without network access or API keys.

#### Acceptance Criteria

1. THE Answer_Service SHALL receive the AI_Client, the Answer_Cache and the Clock as constructor or function arguments and SHALL NOT import the Gemini_Client directly.
2. THE AI_Client interface SHALL expose exactly one asynchronous method that accepts one Prompt argument and resolves with a string.
3. IF the AI_Client call fails, THEN THE AI_Client SHALL reject with an AI_Error whose `kind` is exactly one of `quota`, `timeout`, `network` or `unknown`, and THE Answer_Service SHALL receive that AI_Error unchanged.
4. IF the AI_Client rejects, THEN THE Answer_Service SHALL handle the failure under Requirement 8 and SHALL leave the Answer_Cache contents unchanged.
5. THE `packages/brain` package SHALL export the AI_Client interface, the AI_Error type and a Mock_Client factory from its entry point.
6. WHEN the Answer_Service runs with a Mock_Client, THE Answer_Service SHALL make zero network calls and SHALL read zero environment variables.
7. THE Gemini_Client SHALL obtain its API key and model name only as specified in Requirement 14 and Requirement 15, and THE Answer_Service and THE Mock_Client SHALL contain zero reads of environment variables, with the Gemini_Client entry point being the only module that reads `GEMINI_API_KEY` or `GEMINI_MODEL`.
8. THE Gemini_Client SHALL use only Free_Tier_Features as specified in Requirement 16, and the handling of a missing or empty API key SHALL follow Requirement 14.
9. THE Gemini_Client SHALL call the Gemini API only through the Genai_SDK as an implementation of the AI_Client interface, SHALL accept the Genai_SDK constructor as an injectable factory argument, and SHALL contain zero hand-written HTTP calls to the Gemini API.

### Requirement 2: Answer a free question

**User Story:** As a sender with a button phone, I want a short useful answer to my question, so that I get help without internet.

#### Acceptance Criteria

1. WHEN `answerQuestion` is called with a question that contains at least one non-whitespace character and no unexpired Reply_Text is cached, THE Answer_Service SHALL build exactly one Prompt with the Prompt_Builder and send it to the AI_Client.
2. WHEN the AI_Client resolves with text that contains at least one non-whitespace character, THE Answer_Service SHALL return a Reply_Text derived from the resolved text.
3. IF the question is empty or contains only whitespace, THEN THE Answer_Service SHALL return the fixed prompt-for-question text in the question's Language without calling the AI_Client.
4. IF the AI_Client resolves with an empty or whitespace-only string, THEN THE Answer_Service SHALL return the Try_Later_Text in the question's Language.
5. THE Answer_Service SHALL pass the user question to the AI_Client as user content in a field separate from the system instruction, and THE Answer_Service SHALL NOT include the user question text in the system instruction.
6. IF the question is longer than 500 characters, THEN THE Answer_Service SHALL truncate the question to its first 500 characters before building the Prompt.
7. IF the AI_Client rejects or does not resolve in time, THEN THE Answer_Service SHALL return the Try_Later_Text in the question's Language and SHALL NOT throw an error to the caller, with retries limited as stated in Requirement 8.

### Requirement 3: Reply size within SMS parts

**User Story:** As a sender paying per SMS, I want short replies, so that I receive at most 4 parts and usually 1 to 3.

#### Acceptance Criteria

1. THE Prompt_Builder SHALL instruct the model to answer in plain text with no markdown, no lists and no emoji, in at most Target_Parts SMS parts.
2. THE Prompt_Builder SHALL state the maximum character count for the Language, equal to Target_Parts multiplied by the per-part character limit for that Language's encoding exported by the SMS_Splitter, so that the Target_Parts size is expressed in characters.
3. WHEN the text from the AI_Client exceeds the Answer_Budget after markdown stripping, THE Answer_Service SHALL shorten the text so that `splitSms` of the Reply_Text returns at most `MAX_PARTS` parts.
4. WHEN the Answer_Service shortens the text, THE Answer_Service SHALL cut at the last sentence end or, if none exists, the last word boundary within the final 15 code units before the cut point, SHALL cut at the exact budget limit if neither exists, and SHALL NOT cut inside a surrogate pair.
5. WHEN the Reply_Text is shortened and Requirement 5 or Requirement 6 requires a Professional_Referral or Uncertainty_Note, THE Answer_Service SHALL keep the appended sentence unchanged and SHALL shorten only the model text.
6. THE Answer_Service SHALL call the existing `splitSms` and `detectEncoding` from the SMS_Splitter to measure the size and SHALL NOT re-implement encoding detection or part counting.
7. FOR ALL AI_Client outputs, including empty strings and strings of 10,000 or more characters, `splitSms` of the Reply_Text returned by the Answer_Service SHALL return between 1 and `MAX_PARTS` parts (property).
8. WHEN the Answer_Service receives text from the AI_Client, THE Answer_Service SHALL strip the markdown markers `*`, `_`, `#`, backticks and leading list markers (`-`, `*`, `•` and `1.` style numbering) from the text before measuring its size.
9. IF the text from the AI_Client is empty or contains only whitespace after markdown stripping, THEN THE Answer_Service SHALL return the Try_Later_Text in the question's Language, which fits in 1 part.

### Requirement 4: Reply in the language of the question

**User Story:** As a sender who writes in Urdu or Roman Urdu, I want the reply in the same language, so that I can read it.

#### Acceptance Criteria

1. WHEN `answerQuestion` is called without a supplied Language, THE Answer_Service SHALL determine the Language of the question by calling the existing `detectLanguage` exactly once and SHALL NOT re-implement language detection.
2. THE Prompt_Builder SHALL instruct the model to reply in English for `en`, in Urdu script for `ur` and in Roman Urdu written in Latin letters for `roman-ur`.
3. WHEN the Command_Router has already supplied a Language for the message, THE Answer_Service SHALL accept that Language as an optional argument and use it without calling `detectLanguage`.
4. THE Answer_Service SHALL select every fixed text (Try_Later_Text, Professional_Referral, Uncertainty_Note, prompt-for-question text) in the same Language as the question, so that each of the 3 Languages (`en`, `ur`, `roman-ur`) has a defined variant of each fixed text.
5. WHEN the Language is `ur`, THE Answer_Service SHALL produce fixed texts in which every letter character is in Urdu script, with no Latin letters.
6. WHEN the Language is `roman-ur`, THE Answer_Service SHALL produce fixed texts written only in Latin letters, with no Urdu script characters.
7. IF `detectLanguage` returns a value other than `en`, `ur` or `roman-ur`, or the supplied Language is not one of those 3 values, THEN THE Answer_Service SHALL use `en` as the Language for the Prompt_Builder instruction and for all fixed texts.

### Requirement 5: Safety for health, legal and money questions

**User Story:** As a family member who set up the gateway, I want sensitive answers kept general, so that my relatives are not given risky advice.

#### Acceptance Criteria

1. WHEN user text is submitted for classification, THE Topic_Classifier SHALL return whether the text is a Sensitive_Topic and, if it is, exactly one topic value from `health`, `legal` or `money`.
2. WHEN the question is a Sensitive_Topic, THE Prompt_Builder SHALL instruct the model to give general information only, to avoid diagnoses, dosages, legal conclusions and specific investment or loan instructions, and to suggest a professional.
3. WHEN the question is a Sensitive_Topic and the model text does not already contain the Professional_Referral for that topic and Language, THE Answer_Service SHALL append that Professional_Referral to the Reply_Text.
4. WHEN the question is a Sensitive_Topic, THE Reply_Text SHALL contain the Professional_Referral for that topic and Language exactly once.
5. IF the text contains at least one keyword from the fixed list for a topic, THEN THE Topic_Classifier SHALL treat the text as a Sensitive_Topic for that topic, comparing keywords without regard to letter case and, for Latin-letter keywords, as whole words only.
6. IF the question is a Sensitive_Topic and the AI_Client fails, THEN THE Answer_Service SHALL return the Try_Later_Text and SHALL NOT return any model text.
7. WHEN the SCAM command argument is a Sensitive_Topic with topic `money` and the verdict is `UNSURE`, THE Answer_Service SHALL append the money Professional_Referral for the reply Language to the Reply_Text, after the Reason, exactly once.
8. WHEN the SCAM command argument is a Sensitive_Topic with topic `money` and the verdict is not `UNSURE`, THE Answer_Service SHALL NOT append the Professional_Referral to the Reply_Text.

### Requirement 6: No invented facts or prices

**User Story:** As a sender, I want the service to admit when it is unsure, so that I do not act on made-up facts.

#### Acceptance Criteria

1. THE Prompt_Builder SHALL include in every model prompt an instruction to state when the model is unsure, an instruction to give no specific price, rate, date or statistic unless it appears in the user question, and an instruction to say that current prices must be checked locally.
2. WHEN the Topic_Classifier flags a question as asking for a current price, rate, exchange rate, weather, score or news item, THE Answer_Service SHALL append the Uncertainty_Note, written in the question's Language, to the Reply_Text.
3. IF the Topic_Classifier flags a question as asking for a current price or rate AND the model text contains a currency amount or percentage that does not appear in the question, THEN THE Answer_Service SHALL replace the entire model text with the Uncertainty_Note in the question's Language.
4. THE Topic_Classifier SHALL expose a pure function that takes the question text and its Language and returns true when the text contains at least one keyword from the fixed keyword list for English, Urdu script or Roman Urdu, and false otherwise, with no side effects and the same result for the same input.
5. IF the question text is empty or contains only whitespace, THEN THE Topic_Classifier SHALL return false.
6. THE Answer_Service SHALL produce a Reply_Text that contains the Uncertainty_Note exactly once, including when the note was appended under criterion 2 and the model text was also replaced under criterion 3.

### Requirement 7: Cache for repeated questions

**User Story:** As a gateway operator, I want repeated questions answered from a cache, so that the free quota lasts longer.

#### Acceptance Criteria

1. THE Answer_Service SHALL build the Cache_Key from exactly three parts: the Normalized_Message produced by the existing `normalizeMessage` with Latin letters (A-Z) lower-cased, the Language, and the request kind.
2. WHEN the Answer_Cache holds an unexpired Reply_Text for the Cache_Key at the first check of a request, THE Answer_Service SHALL return that Reply_Text without calling the AI_Client.
3. WHEN the AI_Client resolves with usable text, THE Answer_Service SHALL store the final Reply_Text in the Answer_Cache under the Cache_Key with a time-to-live of 24 hours (86,400,000 milliseconds) measured by the Clock from the moment of storing.
4. WHEN the Clock reports a time at or after the stored expiry, THE Answer_Service SHALL treat the entry as missing, call the AI_Client, and replace the expired entry with the new Reply_Text if the AI_Client resolves with usable text.
5. WHEN two questions differ only in letter case of Latin letters, leading or trailing whitespace, or runs of repeated whitespace, THE Answer_Service SHALL produce the same Cache_Key.
6. IF the Reply_Text is a Try_Later_Text, a prompt-for-question text, or any text produced after an AI_Error, THEN THE Answer_Service SHALL NOT store it in the Answer_Cache, and the Answer_Cache entry count SHALL remain unchanged.
7. THE Answer_Service SHALL NOT include the sender's phone number or any other sender identifier in the Cache_Key or the cached value.
8. THE Answer_Cache SHALL hold at most 500 entries.
9. WHEN storing a new entry would make the Answer_Cache exceed 500 entries, THE Answer_Cache SHALL evict the least recently used entry, where reading an entry via a cache hit counts as use.
10. WHEN the same question from any senders is answered twice within the time-to-live, THE Answer_Service SHALL call the AI_Client exactly once and return equal Reply_Texts both times (property).
11. WHERE the host supplies a different Answer_Cache implementation, THE Answer_Service SHALL use it through the same interface and SHALL NOT use the default implementation.

### Requirement 8: Graceful failure when quota is exhausted

**User Story:** As a sender, I want a polite "try later" message when the service is out of quota, so that I know what to do.

#### Acceptance Criteria

1. IF the AI_Client rejects with an AI_Error of kind `quota` AND no unexpired cached Reply_Text exists for the Cache_Key at the re-check under criterion 9, THEN THE Answer_Service SHALL resolve with the Try_Later_Text in the question's Language and SHALL NOT throw.
2. IF the AI_Client rejects with an AI_Error of kind `timeout`, `network` or `unknown` AND any permitted retry has also failed, THEN THE Answer_Service SHALL resolve with the Try_Later_Text in the question's Language and SHALL NOT throw.
3. IF the AI_Client rejects with a value that is not an AI_Error, THEN THE Answer_Service SHALL treat the value as an AI_Error of kind `unknown`, SHALL NOT retry the call, and SHALL resolve with the Try_Later_Text in the question's Language.
4. IF the AI_Client has not resolved or rejected within 8000 milliseconds of the call starting, THEN THE Answer_Service SHALL treat the call as an AI_Error of kind `timeout`.
5. WHEN the AI_Client rejects with kind `quota`, THE Answer_Service SHALL make no further AI_Client calls within the same request.
6. WHEN the AI_Client rejects with kind `timeout` or `network`, THE Answer_Service SHALL retry the call at most 1 time, so the total number of AI_Client calls per request is at most 2.
7. WHEN the AI_Client rejects with kind `unknown`, THE Answer_Service SHALL make no further AI_Client calls within the same request.
8. THE Try_Later_Text SHALL fit within 1 SMS part, as counted by the SMS splitter, for each supported Language (English, Urdu script and Roman Urdu).
9. WHEN the AI_Client rejects with kind `quota`, THE Answer_Service SHALL re-check the Answer_Cache for the Cache_Key exactly once, in addition to the first check under Requirement 7.2, and IF an unexpired Reply_Text exists at that re-check, THEN THE Answer_Service SHALL resolve with that Reply_Text instead of the Try_Later_Text.
10. THE Try_Later_Text SHALL NOT contain the AI_Error message, the stack trace or any Secret from the AI_Error.

### Requirement 9: SCAM verdict with one-line reason

**User Story:** As a user who got a suspicious text, I want a clear verdict and a short reason, so that I can decide quickly.

#### Acceptance Criteria

1. WHEN `checkScam` is called with a non-empty argument, THE Answer_Service SHALL send a SCAM Prompt to the AI_Client that asks for a Scam_Verdict of `SCAM`, `SAFE` or `UNSURE` and a one-line Reason.
2. THE Scam_Printer SHALL format a Scam_Result as the verdict word, a colon, a single space and the Reason, in the question's Language for the verdict word.
3. THE Reply_Text for a Scam_Result SHALL contain exactly one line, with no newline characters (`\n` or `\r`).
4. THE Reply_Text for a Scam_Result SHALL fit within the Answer_Budget, with the Reason shortened under Requirement 3 when needed and the verdict word kept in full.
5. IF the model output cannot be parsed by the Scam_Parser, THEN THE Answer_Service SHALL return a Scam_Result with the verdict `UNSURE` and a fixed Reason in the question's Language.
6. IF the model output gives a verdict other than `SCAM`, `SAFE` or `UNSURE`, THEN THE Scam_Parser SHALL return the verdict `UNSURE`.
7. IF the Reason from the model is empty or contains only whitespace, THEN THE Scam_Parser SHALL use a fixed Reason for the verdict in the question's Language.
8. THE Scam_Prompt SHALL instruct the model to mark a message `SCAM` when it asks for money, PIN, OTP, passwords or bank details, or claims an unexpected prize, and to answer `UNSURE` rather than `SAFE` when the evidence is weak.
9. IF `checkScam` is called with an empty or whitespace-only argument, THEN THE Answer_Service SHALL return a fixed prompt-for-text message in the argument's Language without calling the AI_Client.
10. IF the AI_Client fails, THEN THE `checkScam` function SHALL return the Try_Later_Text under Requirement 8 and SHALL NOT write a cache entry.
11. THE Answer_Service SHALL cache SCAM results under the Cache_Key of kind `scam` under Requirement 7.
12. FOR ALL valid Scam_Results with a single-line Reason, parsing the output of the Scam_Printer SHALL return a Scam_Result with the same verdict and Reason (round-trip property).

### Requirement 10: Secrets and privacy

**User Story:** As the project owner, I want API keys and phone numbers kept out of replies and logs, so that nothing sensitive leaks.

#### Acceptance Criteria

1. THE Answer_Service SHALL NOT include any configured Secret in a Reply_Text, a Prompt, a cache key or a cached value.
2. THE Redactor SHALL replace every occurrence of a configured Secret, matched case-sensitively and including occurrences that overlap or repeat, with the fixed placeholder `[redacted]` in any text passed to it.
3. IF a configured Secret list is empty or contains an empty string, THEN THE Redactor SHALL return the input text unchanged and SHALL NOT throw an error.
4. WHEN the AI_Client returns text that contains a configured Secret, THE Answer_Service SHALL pass that text through the Redactor before it builds the Reply_Text, so that the returned Reply_Text contains 0 occurrences of the Secret.
5. WHEN text is prepared for logs, THE Redactor SHALL replace every run of 7 or more digits with all digits masked except the last 3, where a run may include a leading `+` and any number of spaces or hyphens between digits, and SHALL preserve the `+`, spaces and hyphens in their original positions.
6. THE Redactor SHALL leave runs of 6 or fewer digits unchanged in text prepared for logs.
7. THE Answer_Service SHALL NOT accept the sender's phone number as an argument or as a field of its input.
8. THE repository SHALL satisfy the `.env` and `.env.example` rules in Requirement 14, and THE repository SHALL contain 0 files, other than the gitignored `.env`, that include the real key value.

### Requirement 11: Prompt injection resistance

**User Story:** As a gateway operator, I want hostile messages not to change the service's rules, so that a sender cannot make it break the Safety_Rules.

#### Acceptance Criteria

1. WHEN THE Prompt_Builder builds a model request, THE Prompt_Builder SHALL place the full Safety_Rules text in the system instruction field and the sender's text in a separate user-content field, with the sender's text wrapped between one opening delimiter and one closing delimiter.
2. WHEN THE Prompt_Builder builds a model request, THE Prompt_Builder SHALL include in the system instruction a statement that the text between the delimiters is data and that any instruction inside it to change the reply language, the Safety_Rules or the reply format is to be ignored.
3. IF the sender's text contains the opening delimiter or the closing delimiter, THEN THE Prompt_Builder SHALL remove or escape every occurrence before wrapping, so that the final user-content field contains exactly one opening delimiter and exactly one closing delimiter.
4. IF the model text contains the system instruction text or any contiguous run of 40 or more characters copied from it, THEN THE Answer_Service SHALL discard the model text and return the Try_Later_Text as the reply.

### Requirement 12: Purity and type safety

**User Story:** As a maintainer, I want the logic around the AI call to be pure and strictly typed, so that the module is easy to test and safe to share between apps.

#### Acceptance Criteria

1. THE Prompt_Builder, Topic_Classifier, Scam_Parser, Scam_Printer, Redactor and Cache_Key builder SHALL be pure functions that perform zero network calls, zero file reads or writes, zero console output, zero clock reads and zero random number reads, and that return identical output for identical input across 100 repeated calls.
2. THE Answer_Service SHALL compile under TypeScript strict mode with zero compiler errors and zero uses of the `any` type.
3. THE Answer_Service SHALL contain zero imports of React Native, Next.js or Node-only modules.
4. WHEN `answerQuestion` or `checkScam` returns, THE Answer_Service SHALL leave every caller-supplied input deeply equal to a snapshot taken before the call, where the caller-supplied inputs are the question or argument string, the optional Language, and the deps object including its secrets array and all other caller-supplied data, and where the Answer_Cache is excluded from this check because writing the Reply_Text to it is the intended effect under Requirement 7.3.
5. THE `packages/brain` package entry point SHALL export `answerQuestion`, `checkScam`, the Scam_Verdict type, the Scam_Result type, the Answer_Cache interface and an in-memory Answer_Cache factory.
6. IF the AI_Client rejects, throws synchronously, times out, or resolves with an empty, whitespace-only or non-string value, THEN THE Answer_Service SHALL resolve `answerQuestion` and `checkScam` with a Reply_Text of at least 1 non-whitespace character and SHALL NOT reject.
7. FOR ALL inputs, including empty strings, strings up to 10,000 characters and any AI_Client behavior, `answerQuestion` and `checkScam` SHALL resolve with a Reply_Text of at least 1 non-whitespace character (property).

### Requirement 13: Test coverage

**User Story:** As a maintainer, I want property and example tests, so that the guarantees are verified automatically.

#### Acceptance Criteria

1. THE test suite SHALL use Vitest with the Mock_Client and SHALL make zero network calls, including DNS lookups and HTTP requests, during any test run.
2. THE test suite SHALL include a fast-check property that, for arbitrary questions of 0 to 1,000 characters and arbitrary model outputs of 0 to 5,000 characters including non-ASCII text, `splitSms` of the Reply_Text returns between 1 and 4 parts inclusive.
3. THE test suite SHALL include a fast-check property that Cache_Keys are equal for inputs differing only in letter case and whitespace (spaces, tabs, and line breaks, including leading, trailing and repeated runs).
4. THE test suite SHALL include a fast-check property that, for every arbitrary valid Scam_Result, the Scam_Parser applied to the Scam_Printer output returns a Scam_Result equal to the original.
5. THE test suite SHALL include a fast-check property that every Reply_Text generated for a Sensitive_Topic contains the Professional_Referral exactly once, including when the model output already contains the Professional_Referral text.
6. THE test suite SHALL include a fast-check property that, for arbitrary text of 0 to 5,000 characters in which each configured Secret is inserted 0 or more times, the Redactor output contains no occurrence of any configured Secret.
7. THE test suite SHALL include at least one example test for each of the following: each AI_Error kind, a cache hit, a cache expiry (asserting a miss after the TTL elapses, using a fake clock), each Language, and each Scam_Verdict.
8. THE test suite SHALL configure each fast-check property to run at least 100 iterations.
9. IF any property or example test fails, THEN THE test suite SHALL exit with a non-zero status, and for each failed property SHALL report the shrunk counterexample and the seed in the test output.
10. WHEN a test run is repeated with the seed reported for a failed property, THE test suite SHALL reproduce the same failure.
11. THE test suite SHALL include example tests, using a Fake_Genai_SDK and a stub Env_Config, that verify the API key handling in Requirement 14: a missing key, an empty key and a whitespace-only key each produce the missing-key outcome with zero Fake_Genai_SDK constructions, zero `generateContent` calls and zero network calls, and a present key is passed only to the Genai_SDK constructor and never appears in any Reply_Text, Prompt, cache key, cached value, log line or thrown error message.
12. THE test suite SHALL include a fast-check property that, for arbitrary key strings of 1 to 100 characters and arbitrary text containing that key 0 or more times, the Redactor output and the log output of the Gemini_Client under any AI_Error contain no occurrence of the key.
13. THE test suite SHALL include example tests that verify the Default_Model rules in Requirement 15: the constant `DEFAULT_GEMINI_MODEL` equals `gemini-3.5-flash-lite`, the model is the default when neither `GEMINI_MODEL` nor a factory option is set, `GEMINI_MODEL` overrides the default, and a factory option overrides `GEMINI_MODEL`.
14. THE test suite SHALL include example tests that verify the free-tier rules in Requirement 16: the argument object that the Gemini_Client passes to the Fake_Genai_SDK `models.generateContent` contains `model`, `contents` and a `config` with the system instruction, and contains no tool, grounding, cached-content or batch field, and a Fake_Genai_SDK error with status 429 or status text `RESOURCE_EXHAUSTED` is mapped to an AI_Error of kind `quota`.
15. THE test suite SHALL include a repository check, run with Vitest, that verifies `.gitignore` lists `.env`, that `.env.example` contains the line `GEMINI_API_KEY=` with an empty value, and that no tracked source, test or documentation file contains a string matching the Gemini API key pattern `AIza` followed by 35 key characters.
16. THE test suite SHALL include a fast-check property that, for arbitrary questions, optional Languages and deps objects (including the secrets array), a deep clone taken before `answerQuestion` or `checkScam` is deeply equal to the caller-supplied inputs after the call, with the Answer_Cache excluded from the comparison under Requirement 12.4, and an example test that asserts the Answer_Cache holds the stored Reply_Text after a successful call.
17. THE test suite SHALL include a repository check, run with Vitest, that verifies the `@google/genai` dependency in `package.json` is pinned to an exact version (no `^`, `~`, `*`, `>`, `<` or `x` range) and that the string `@google/genai` is imported only in the Gemini_Client entry point source file and not in the Answer_Service, the Mock_Client or any test file.
18. THE test suite SHALL include example tests for Requirement 8.9 using the Mock_Client and a fake Answer_Cache: a `quota` rejection with an unexpired entry that appears only at the re-check returns that Reply_Text, a `quota` rejection with no entry at the re-check returns the Try_Later_Text, and the Answer_Cache is read exactly twice and the AI_Client is called exactly once in both cases.

### Requirement 14: Gemini API key from the environment only

**User Story:** As the project owner, I want the Gemini API key read only from the `GEMINI_API_KEY` environment variable and never exposed, so that the key cannot leak through source, logs or replies.

#### Acceptance Criteria

1. THE Gemini_Client entry point SHALL read the API key only from the environment variable `GEMINI_API_KEY`, either from the process environment or from an Env_Config object that the host populated from `GEMINI_API_KEY` only, and SHALL pass the key to the Genai_SDK constructor as `{ apiKey }`.
2. THE repository SHALL contain 0 occurrences of a real API key value in source files, test files, documentation files, fixtures and snapshots, and tests SHALL use only obviously fake keys such as `test-key-123`.
3. THE Gemini_Client SHALL hand the API key only to the Genai_SDK constructor, SHALL NOT build any URL, query string or request header containing the key, and SHALL NOT pass the key to any other function.
4. THE Gemini_Client SHALL NOT write the API key to any log, console output, thrown error message, AI_Error message, Reply_Text, Prompt or Answer_Cache entry.
5. WHEN the Gemini_Client reports an error or logs a request, THE Gemini_Client SHALL pass the text through the Redactor with the API key as a configured Secret before the text leaves the Gemini_Client.
6. IF `GEMINI_API_KEY` is absent, an empty string or whitespace only, THEN THE Gemini_Client factory SHALL construct no Genai_SDK instance, SHALL make zero network calls, SHALL NOT crash the host process, and SHALL either throw a configuration error that names `GEMINI_API_KEY` and does not contain any key value, or return an AI_Client whose every call rejects with an AI_Error of kind `unknown` so that the Answer_Service returns the Try_Later_Text.
7. THE `.gitignore` file at the repository root SHALL list `.env` so that no `.env` file is tracked by git.
8. THE `.env.example` file SHALL contain the line `GEMINI_API_KEY=` with an empty value, and SHALL contain the line `GEMINI_MODEL=` or `GEMINI_MODEL=` followed by the Default_Model name, with a comment stating that the variable is optional.
9. THE Answer_Service source files SHALL contain zero imports of the Gemini_Client entry point, zero references to `process.env` and zero imports of Node-only modules, consistent with Requirement 1 and Requirement 12.
10. THE `package.json` that declares the `@google/genai` dependency SHALL pin it to an exact version with no range operator.
11. THE `@google/genai` package SHALL be imported only by the Gemini_Client entry point, and THE Answer_Service and THE Mock_Client SHALL contain zero imports of `@google/genai`.

### Requirement 15: Configurable free-tier Flash-Lite model

**User Story:** As a gateway operator, I want to change the Gemini model without editing the logic, so that I can follow Google's model changes while staying on the free tier.

#### Acceptance Criteria

1. THE `packages/brain` package SHALL export the constant `DEFAULT_GEMINI_MODEL` with the value `gemini-3.5-flash-lite`, defined in exactly one source file.
2. WHERE a model option is passed to the Gemini_Client factory, THE Gemini_Client SHALL use that option as the Gemini_Model.
3. WHERE a model option is not passed AND the environment variable `GEMINI_MODEL` is a non-empty string after trimming whitespace, THE Gemini_Client SHALL use the value of `GEMINI_MODEL` as the Gemini_Model.
4. IF neither a model option nor a non-empty `GEMINI_MODEL` is supplied, THEN THE Gemini_Client SHALL use `DEFAULT_GEMINI_MODEL` as the Gemini_Model.
5. THE Gemini_Client SHALL NOT contain the Default_Model name or any other Gemini model name as a string literal outside the file that defines `DEFAULT_GEMINI_MODEL`, other than in tests and documentation.
6. THE README or the `.env.example` comments SHALL state that the Default_Model is a free-tier Flash-Lite model, that models are retired over time, and that `GEMINI_MODEL` changes the model without a code change.

### Requirement 16: Free tier only, no billing-only features

**User Story:** As the project owner, I want the service to use only free-tier Gemini features, so that running it never creates a bill.

#### Acceptance Criteria

1. THE Gemini_Client SHALL make requests that use only Free_Tier_Features, each consisting of one `ai.models.generateContent({ model, contents, config })` call on the Genai_SDK, where `model` is the Gemini_Model, `contents` is the user content, and `config` carries the system instruction (`systemInstruction`) and generation settings (`maxOutputTokens` and `temperature`).
2. THE Gemini_Client SHALL NOT include in any request a tool declaration, Grounding with Google Search, a cached-content reference, a Batch API job, or any other Billing_Only_Feature.
3. THE Gemini_Client SHALL NOT create, store or read context caches on the Gemini API, and the only caching in the Answer_Service SHALL be the local Answer_Cache under Requirement 7.
4. THE Gemini_Client SHALL NOT select any image, video, speech or other model that is not listed by Google as free of charge on the Gemini API free tier.
5. IF the Genai_SDK throws an error whose `status` is 429 or whose status text is `RESOURCE_EXHAUSTED`, THEN THE Gemini_Client SHALL reject with an AI_Error of kind `quota`.
6. IF the Genai_SDK throws a billing-required or permission error for the chosen Gemini_Model, THEN THE Gemini_Client SHALL reject with an AI_Error of kind `unknown` and SHALL NOT retry with any other model or feature.
7. THE Gemini_Client SHALL NOT enable billing, upgrade a project or call any billing API.
