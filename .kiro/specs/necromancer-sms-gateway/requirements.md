# Requirements Document

## Introduction

Necromancer is the Android app in `apps/necromancer` that turns an old Android phone into the Lazarus SMS gateway. It is a bare React Native app with a Kotlin native module. The native side receives SMS, sends SMS as multipart messages, runs a foreground service that keeps the gateway alive, restarts the gateway after the phone reboots, and stores the Operator's Gemini API key in encrypted storage. The JavaScript side passes each inbound message to the `@lazarus/brain` package and sends the reply back to the sender.

The pure gateway decision logic (the Gateway_Pipeline, phone-number normalizing, printing and masking, the Rate_Limiter, the Heartbeat_Model, Settings serialization, API key validation and masking, and the Fixed_Gateway_Texts) is a new Gateway_Module in `packages/brain`, exported from `@lazarus/brain` and tested there with Vitest and fast-check. `apps/necromancer` contains only the React Native UI and the native-bridge glue, tested with Jest.

The Gemini API key is not bundled in the APK. The Operator pastes the key once on the Setup_Screen. The Native_Module stores the key in the Api_Key_Store, and the Necromancer_App reads no environment variable or `.env` file for the key or the Gemini model name. The AI client uses the default model of the `@lazarus/brain/gemini` entry point.

This spec adds the Gateway_Module to the brain package and does not change or duplicate the existing brain modules:

- the Command_Router (`routeCommand`, spec `brain-command-router`), which classifies a message and detects its Language;
- the Answer_Service (`answerQuestion`, `checkScam`, spec `ai-answer-service`), which produces a Reply_Text and never rejects;
- the SMS_Splitter (`splitSms`, spec `sms-message-splitter`), which splits a Reply_Text into at most 4 prefixed parts sized for concatenated SMS.

This spec adds the gateway safety layer on the phone: a locally stored Stop_List where STOP always wins until START, a per-number Rate_Limiter, an optional Allowlist mode, phone-number masking in every log and screen, and loop protection against automated senders.

The target device is a Xiaomi phone running Android 15 (HyperOS). The app is installed as a sideloaded debug APK only; there is no Play Store release. The app includes a Permission_Screen that explains each SMS permission before Android asks for it, and a Setup_Screen that guides the operator through HyperOS Autostart, battery optimisation, restricted settings for sideloaded apps, and SMS permissions. The Main_Screen shows the heartbeat states from the design steering file: ALIVE, SLEEPING with a reason, and SENDING.

Scope decisions in this version:

- REMIND and TRANSLATE are recognised by the Command_Router, but the brain package has no handler for them yet. The gateway replies with a fixed Not_Available_Text in the sender's Language. Scheduling reminders and translating are out of scope.
- The gateway sends no reply to a STOP message. This is the strict reading of the product rule "after STOP, never send to that number again until it texts START".
- Message bodies are not stored in the Activity_Log. Only time, Masked_Number or Masked_Sender, Command and Outcome are stored.
- Messages received while the Operator has paused the gateway are recorded with the Outcome `ignored-paused` and are not answered later. A STOP received during a pause is still added to the Stop_List. A short Paused_Path_Task runs the Command_Router on the body in memory to decide whether the message is a STOP. If Android refuses to start the Paused_Path_Task, the Native_Module uses the Stop_Keyword_Check instead and stores only a Pending_Stop_Record (sender address, STOP marker and receive time) for a STOP, never any other part of the body. The Pending_Stop_Record is applied before any other Inbound_Message is processed and is then deleted.
- A START received while the Allowlist cannot be read still removes the number from the Stop_List and records the Outcome `started`, with no reply. Opt-in and opt-out win over the Allowlist.
- Messages received while the Gateway_Service is not running for any other reason (for example after a reboot, before the service starts) are stored in the Pending_Inbox and answered once the Gateway_Service starts.

## Known limitations

- **Reply delay during radio failures.** The 30-second reply target of Requirement 6 criterion 12 holds only while no earlier multipart SMS is in a Send_Timeout wait or a retry wait. During generic radio failures or no-service conditions, the 60-second Send_Timeout (Requirement 8 criterion 8) and the 30-second retry wait (Requirement 8 criterion 3) hold back later replies (Requirement 8 criterion 7), so those replies can arrive more than 30 seconds after their receive time.
- **Fallback STOP detection while paused.** When Android refuses to start the Paused_Path_Task, the Stop_Keyword_Check decides whether a message is a STOP. The Stop_Keyword_Check uses the same STOP keywords as the Command_Router but not the Command_Router's full text normalization, so a STOP written in unusual characters (for example fullwidth letters) can be missed in this fallback case.
- **Unlogged paused messages.** When Android refuses to start the Paused_Path_Task and the message is not a STOP under the Stop_Keyword_Check, the message is discarded without an Activity_Entry, so the Main_Screen counters do not include it.

## Glossary

- **Necromancer_App**: The React Native Android app in `apps/necromancer`, made of the React Native UI, the JavaScript native-bridge glue and the Kotlin Native_Module. The Necromancer_App contains no gateway decision logic of its own; the Necromancer_App calls the Gateway_Module.
- **Gateway_Module**: The pure TypeScript gateway logic in `packages/brain`, exported from `@lazarus/brain`, made of the Gateway_Pipeline, the Number_Normalizer, the Number_Printer, the Number_Masker, the Sender_Masker, the Rate_Limiter, the Heartbeat_Model, the Settings_Serializer, the Api_Key_Validator, the Key_Masker and the Fixed_Gateway_Texts. The Gateway_Module has no React Native, Android, storage, network or system-clock dependency.
- **Brain_Test_Suite**: The Vitest and fast-check tests in `packages/brain` that test the Gateway_Module.
- **App_Test_Suite**: The Jest tests in `apps/necromancer` that test the React Native UI and the native-bridge glue with the Native_Module replaced by a mock.
- **Native_Module**: The Kotlin code in the Necromancer_App that bridges Android SMS, service, settings, key storage and system-state APIs to JavaScript.
- **Gemini_Api_Key**: The Google Gemini API key that the Operator pastes on the Setup_Screen and that the AI_Client uses to call the Gemini API.
- **Api_Key_Store**: The Native_Module storage for the Gemini_Api_Key: an EncryptedSharedPreferences file in the Necromancer_App's private storage, encrypted with a key held in the Android Keystore.
- **Api_Key_Validator**: The pure function in the Gateway_Module that trims a pasted value and decides whether the trimmed value is an acceptable Gemini_Api_Key.
- **Masked_Key**: The display form of a Gemini_Api_Key: the 4 characters `••••` followed by the last 4 characters of the Gemini_Api_Key.
- **Key_Masker**: The pure function in the Gateway_Module that converts a Gemini_Api_Key into a Masked_Key.
- **Key_Input_Field**: The text input on the Setup_Screen where the Operator pastes the Gemini_Api_Key.
- **AI_Client**: The AI client created by the `createGeminiClient` function of the `@lazarus/brain/gemini` entry point and passed to the Answer_Service.
- **Sms_Receiver**: The Native_Module component that is notified by Android when an SMS arrives and turns the received SMS PDUs into one Inbound_Message.
- **Sms_Sender**: The Native_Module component that sends a list of SMS parts to one phone number as one multipart SMS and reports a Send_Result for each part.
- **Send_Result**: The result the Sms_Sender reports to the Gateway_Service. One of `sent` (a Reply_Part was sent), `failed` (a Reply_Part was not sent, with an error kind of generic radio failure, no-service, or other), or `refused-stopped` (the whole send was refused because the Canonical_Number is on the Stop_List and no SMS part was sent). A Send_Result is not an Outcome.
- **Send_Timeout**: The maximum time of 60 seconds the Sms_Sender waits for a Send_Result for a Reply_Part in one send attempt before reporting `failed` with a no-service error.
- **Gateway_Service**: The Android foreground service in the Necromancer_App that keeps the gateway process running and processes Inbound_Messages while the app UI is closed.
- **Boot_Receiver**: The Native_Module component that starts the Gateway_Service after the phone finishes booting or after the Necromancer_App package is replaced.
- **Gateway_Pipeline**: The pure TypeScript function in the Gateway_Module in `packages/brain` that takes one Inbound_Message plus the current Gateway_State and decides the Outcome and the Reply_Parts to send, if any. It calls the Command_Router, the Answer_Service and the SMS_Splitter. The Necromancer_App calls the Gateway_Pipeline and carries out its decisions.
- **Gateway_State**: The persisted data the Gateway_Pipeline reads and updates: the Stop_List, the Allowlist, the Allowlist_Mode flag, the Rate_Limiter records, the current day's sent-part count and the Settings.
- **Inbound_Message**: One received SMS after reassembly, made of the sender address, the full body text and the receive time in milliseconds since the Unix epoch.
- **Sender_Address**: The originating address string that Android reports for an SMS.
- **Phone_Number**: A Sender_Address made only of an optional leading `+` and 7 to 15 digits after removing spaces, hyphens, dots and parentheses.
- **Automated_Sender**: A Sender_Address that is not a Phone_Number, such as an empty address, an alphanumeric sender ID (for example `JAZZ`) or a short code of fewer than 7 digits.
- **Canonical_Number**: The form of a Phone_Number used for all matching and storage: `+` followed by the country code and the subscriber digits, with no other characters.
- **Default_Country_Code**: The country calling code used to convert a national-format Phone_Number (for example `03001234567`) into a Canonical_Number. The default value is `92` (Pakistan).
- **Number_Normalizer**: The pure function in the Gateway_Module that converts a Sender_Address into a Canonical_Number, or reports that the Sender_Address is an Automated_Sender.
- **Number_Printer**: The pure function in the Gateway_Module that formats a Canonical_Number as a display string in international format.
- **Masked_Number**: A display form of a Canonical_Number in which every digit except the last 3 digits is replaced by the character `•`, and the leading `+` is kept.
- **Number_Masker**: The pure function in the Gateway_Module that converts a Canonical_Number into a Masked_Number.
- **Masked_Sender**: A display form of an Automated_Sender's Sender_Address in which every character except the last 3 characters is replaced by the character `•`. A Sender_Address of 3 or fewer characters is shown unchanged, and an empty Sender_Address is shown as the single character `•`.
- **Sender_Masker**: The pure function in the Gateway_Module that converts an Automated_Sender's Sender_Address into a Masked_Sender.
- **Pending_Inbox**: The persisted store in which the Sms_Receiver keeps Inbound_Messages received while the Gateway_Service is not running for a reason other than the Operator pausing the gateway (Requirement 1 criterion 6).
- **Paused_Path_Task**: A short React Native headless JavaScript task that the Native_Module starts for one Inbound_Message received while the Operator has paused the gateway. The Paused_Path_Task calls the Command_Router on the body text in memory, records the Outcome for that Inbound_Message under Requirement 9, and ends without starting the Gateway_Service.
- **Stop_Alias_List**: The keywords of the Command_Router alias table that map to the Command STOP, exported by `@lazarus/brain`.
- **Stop_Keyword_Check**: The Native_Module fallback check used only when Android refuses to start the Paused_Path_Task. The Stop_Keyword_Check passes when the first whitespace-separated token of the trimmed body text, with the trailing punctuation characters that the Command_Router removes taken off, case-insensitively equals an entry of the Stop_Alias_List.
- **STOP_Marker**: The fixed value stored in a Pending_Stop_Record in place of the body text, stating that the Inbound_Message routed to the Command STOP.
- **Pending_Stop_Record**: A persisted minimal record of a STOP received while the Operator has paused the gateway and the Paused_Path_Task could not run, made of exactly 3 fields: the Sender_Address, the STOP_Marker and the receive time. A Pending_Stop_Record contains no other part of the body text.
- **Stop_List**: The persisted set of Canonical_Numbers that have sent STOP and have not sent START since.
- **Allowlist**: The persisted set of up to 500 Canonical_Numbers that the Operator has approved.
- **Allowlist_Mode**: An Operator setting. WHILE Allowlist_Mode is on, the gateway answers only senders on the Allowlist.
- **Rate_Limiter**: The pure logic in the Gateway_Module that counts accepted Inbound_Messages per Canonical_Number in a sliding time window and decides whether a new Inbound_Message is within the limit.
- **Per_Number_Limit**: The maximum number of Inbound_Messages from one Canonical_Number that the gateway answers in one Rate_Window. The default value is 5.
- **Rate_Window**: The sliding time window used by the Rate_Limiter. The default value is 60 minutes.
- **Daily_Send_Cap**: The maximum number of SMS parts the gateway sends in one calendar day in the phone's local time zone, across all senders. The default value is 200.
- **Slow_Down_Text**: A fixed short message in each Language telling the sender they have sent too many messages and to try again later.
- **Help_Text**: A fixed message in each Language listing the commands HELP, STOP, SCAM, REMIND, TRANSLATE and free questions, fitting in 1 SMS part for GSM-7 text.
- **Welcome_Back_Text**: A fixed short message in each Language confirming that the sender will receive replies again after START.
- **Not_Available_Text**: A fixed short message in each Language saying that the requested command is not available yet.
- **Usage_Hint_Text**: A fixed short message in each Language showing the correct form of a command whose argument is missing, for example `SCAM <message text>`.
- **Fixed_Gateway_Texts**: The set of Slow_Down_Text, Help_Text, Welcome_Back_Text, Not_Available_Text and Usage_Hint_Text for every Language, defined in the Gateway_Module.
- **Reply_Text**: The text to send back to a sender, as defined by the Answer_Service spec, or one of the Fixed_Gateway_Texts, or the Try_Later_Text.
- **Reply_Parts**: The list of strings returned by `splitSms` for a Reply_Text.
- **Outcome**: The single result the Gateway_Pipeline records for an Inbound_Message. One of these 11 values: `replied`, `stopped`, `started`, `ignored-stopped`, `ignored-not-allowed`, `ignored-automated`, `ignored-own-number`, `ignored-paused`, `rate-limited`, `send-capped`, `send-failed`.
- **Command_Router**: The existing `routeCommand` function in `@lazarus/brain`.
- **Mock_Client**: The scripted AI client test double exported by `@lazarus/brain` as `createMockClient`.
- **Try_Later_Text**: The fixed busy message for each Language exported by `@lazarus/brain` as `FIXED_TEXTS[language].tryLater`.
- **Answer_Service**: The existing `answerQuestion` and `checkScam` functions in `@lazarus/brain`.
- **SMS_Splitter**: The existing `splitSms` function in `@lazarus/brain`.
- **Language**: One of `en`, `ur`, `roman-ur`, as returned in the `language` field of a Routed_Command.
- **Routed_Command**: The result of the Command_Router, with fields `command`, `argument`, `language` and `argumentMissing`.
- **Command**: One of HELP, STOP, START, SCAM, REMIND, TRANSLATE, QUESTION, as defined by the Command_Router.
- **Activity_Log**: The persisted list of the most recent 200 Activity_Entries, shown on the Main_Screen.
- **Activity_Entry**: One record in the Activity_Log containing the receive time, the Masked_Number (or the Masked_Sender for an Automated_Sender), the Command and the Outcome.
- **Gateway_Service status**: One of running, stopped by Android, or paused by the Operator.
- **Heartbeat_State**: The gateway status shown on the Main_Screen. One of ALIVE, SLEEPING, SENDING.
- **Sleep_Reason**: The cause shown with the SLEEPING state. One of `no-sms-permission`, `no-notification-permission`, `battery-optimised`, `no-signal`, `airplane-mode`, `service-stopped`, `paused-by-operator`.
- **Heartbeat_Model**: The pure function in the Gateway_Module that derives the Heartbeat_State and the Sleep_Reason from the current Device_Status and the Gateway_Service status.
- **Device_Status**: A snapshot of the phone state reported by the Native_Module: SMS permission granted, notification permission granted, battery optimisation ignored for the Necromancer_App, cellular service in service, airplane mode on.
- **Main_Screen**: The screen shown once permissions are granted and setup is complete. It shows the Heartbeat_State, the Sleep_Reason, today's counters and the Activity_Log.
- **Permission_Screen**: The screen that explains why the Necromancer_App needs each runtime permission and then requests the permission from Android.
- **Setup_Screen**: The screen with a checklist that guides the Operator through the HyperOS settings the gateway needs and through saving the Gemini_Api_Key.
- **Setup_Step**: One item on the Setup_Screen checklist.
- **Settings_Screen**: The screen where the Operator edits the Allowlist, Allowlist_Mode, Per_Number_Limit, Rate_Window, Daily_Send_Cap, Default_Country_Code and Own_Number, and views the Stop_List.
- **Settings**: The persisted values of Allowlist_Mode, Per_Number_Limit, Rate_Window, Daily_Send_Cap, Default_Country_Code and Own_Number. The Settings do not include the Gemini_Api_Key.
- **Settings_Serializer**: The pure functions in the Gateway_Module that convert Settings to a stored string and parse a stored string back into Settings.
- **Own_Number**: An optional Canonical_Number that the Operator enters for the gateway phone's own SIM.
- **Operator**: The person, usually a family member, who installs and configures the Necromancer_App on the gateway phone.
- **Sender**: A person who texts the gateway phone.
- **Restricted_Settings**: The Android 13 and later protection that blocks SMS permissions for sideloaded apps until the user enables "Allow restricted settings" in the app's system App info page.
- **Reduced_Motion**: The Android system setting that removes or reduces animations.

## Requirements

### Requirement 1: Receive SMS

**User Story:** As a Sender, I want my text to reach the gateway as one complete message, so that my whole question is answered.

#### Acceptance Criteria

1. WHEN Android delivers an incoming SMS to the Necromancer_App, THE Sms_Receiver SHALL create exactly one Inbound_Message containing the Sender_Address exactly as Android reports it, the full body text, and the receive time as the phone clock time in milliseconds since the Unix epoch when Android delivered the SMS to the Sms_Receiver.
2. WHEN Android delivers an incoming SMS made of 2 or more PDUs from the same Sender_Address in one delivery, THE Sms_Receiver SHALL join the PDU bodies in PDU order into the body text of one Inbound_Message, with no characters added, removed or reordered, for both GSM-7 and UCS-2 encoded PDUs, including Urdu script text.
3. WHEN Android delivers PDUs from 2 or more different Sender_Addresses in one delivery, THE Sms_Receiver SHALL create one Inbound_Message per Sender_Address, each containing only the PDU bodies from that Sender_Address joined in PDU order.
4. WHEN the Sms_Receiver creates an Inbound_Message while the Gateway_Service is running, THE Sms_Receiver SHALL hand the Inbound_Message to the Gateway_Service within 2 seconds of Android delivering the SMS to the Sms_Receiver.
5. WHILE the Necromancer_App UI is closed and the Gateway_Service is running, THE Sms_Receiver SHALL hand each Inbound_Message to the Gateway_Service for processing within the same 2 second limit as when the UI is open.
6. IF the Gateway_Service is not running for a reason other than the Operator pausing the gateway when the Sms_Receiver creates an Inbound_Message, THEN THE Sms_Receiver SHALL store the Inbound_Message in the Pending_Inbox so that it survives an app process restart, and THE Gateway_Service SHALL process every Inbound_Message in the Pending_Inbox in receive-time order within 10 seconds after the Gateway_Service starts, after applying every Pending_Stop_Record under Requirement 9 criterion 15.
7. WHEN 2 or more Inbound_Messages are waiting for processing, THE Gateway_Service SHALL process them one at a time, finishing the Gateway_Pipeline run for one Inbound_Message before starting the next, in ascending order of receive time, with Inbound_Messages that have equal receive times processed in the order the Sms_Receiver created them, and without dropping any Inbound_Message.
8. WHEN Android delivers an incoming SMS whose body is empty, THE Sms_Receiver SHALL create one Inbound_Message with an empty body text and hand it to the Gateway_Service like any other Inbound_Message.
9. IF the Sms_Receiver fails to decode an incoming SMS because its PDUs cannot be parsed or the Sender_Address is missing, THEN THE Sms_Receiver SHALL discard that SMS, create no Inbound_Message, send no reply, and write exactly one logcat line stating the decode failure that contains no part of the message body and no digits of the Sender_Address other than its last 3 digits.
10. THE Sms_Receiver SHALL leave each incoming SMS in the phone's SMS inbox, without deleting it, changing its body or changing its read status.

### Requirement 2: Normalize, print and mask phone numbers

**User Story:** As an Operator, I want every phone number handled in one consistent form, so that STOP, the Allowlist and rate limits apply to the same person however the number is written.

#### Acceptance Criteria

1. WHEN a Sender_Address is a Phone_Number that begins with `+`, THE Number_Normalizer SHALL return a Canonical_Number made of `+` and the digits of the Phone_Number, after removing every space, hyphen, dot and parenthesis from the Sender_Address.
2. WHEN a Sender_Address is a Phone_Number that begins with `00` after removing every space, hyphen, dot and parenthesis, THE Number_Normalizer SHALL return a Canonical_Number made of `+` and the digits that follow the leading `00`.
3. WHEN a Sender_Address is a Phone_Number that begins with a single `0` followed by a digit from 1 to 9 after removing every space, hyphen, dot and parenthesis, THE Number_Normalizer SHALL return a Canonical_Number made of `+`, the Default_Country_Code and the digits that follow the leading `0`.
4. WHEN a Sender_Address is a Phone_Number that begins with a digit from 1 to 9 after removing every space, hyphen, dot and parenthesis, including a Phone_Number that begins with the digits of the Default_Country_Code, THE Number_Normalizer SHALL return a Canonical_Number made of `+` and the digits of the Phone_Number, without adding the Default_Country_Code.
5. IF a Sender_Address is an Automated_Sender, including an empty Sender_Address, a Sender_Address containing any letter, a Sender_Address containing any character other than digits, a leading `+`, spaces, hyphens, dots and parentheses, or a Sender_Address with fewer than 7 or more than 15 digits, THEN THE Number_Normalizer SHALL return a result that marks the Sender_Address as an Automated_Sender and contains no Canonical_Number.
6. FOR ALL Canonical_Numbers, normalizing a Canonical_Number SHALL return the same Canonical_Number (idempotence property).
7. THE Number_Printer SHALL format a Canonical_Number as a string identical to the Canonical_Number: `+` followed by the digits of the Canonical_Number, with no spaces or other separator characters.
8. FOR ALL Canonical_Numbers, normalizing the output of the Number_Printer SHALL return the original Canonical_Number (round-trip property).
9. THE Number_Masker SHALL return a Masked_Number that starts with the `+` of the Canonical_Number, keeps the last 3 digits of the Canonical_Number in place, and replaces every other digit with `•`.
10. FOR ALL Canonical_Numbers, THE Number_Masker SHALL return a Masked_Number with the same character length as the Canonical_Number, containing exactly 3 digit characters, which equal the last 3 digits of the Canonical_Number in the same order (invariant property).
11. IF applying criteria 1 to 4 would produce a result with fewer than 7 digits, more than 15 digits, or a first digit of `0` after the `+`, THEN THE Number_Normalizer SHALL return a result that marks the Sender_Address as an Automated_Sender and contains no Canonical_Number.
12. THE Number_Normalizer SHALL accept a Default_Country_Code of 1 to 3 digits whose first digit is from 1 to 9, and SHALL use `92` when no Default_Country_Code is set in the Settings.
13. THE Sender_Masker SHALL return a Masked_Sender in which the last 3 characters of the Sender_Address are kept in place and every other character is replaced by `•`, SHALL return a Sender_Address of 3 or fewer characters unchanged, and SHALL return the single character `•` for an empty Sender_Address.

### Requirement 3: STOP always wins

**User Story:** As a Sender, I want STOP to end all messages from the gateway until I text START, so that I am never texted after I opt out.

#### Acceptance Criteria

1. WHEN an Inbound_Message is routed to the Command STOP, THE Gateway_Pipeline SHALL add the Canonical_Number of the sender to the Stop_List, record the Outcome `stopped`, and produce no Reply_Parts, including when the Canonical_Number is already on the Stop_List, in which case the Stop_List SHALL keep exactly one entry for that Canonical_Number.
2. WHEN an Inbound_Message from a Phone_Number is routed to the Command STOP, THE Gateway_Pipeline SHALL add the Canonical_Number to the Stop_List regardless of Allowlist_Mode, the Allowlist, the Rate_Limiter records, the number of SMS parts sent today against the Daily_Send_Cap, and whether the Operator has paused the gateway.
3. WHILE a Canonical_Number is on the Stop_List, THE Gateway_Pipeline SHALL produce no Reply_Parts for any Inbound_Message from that Canonical_Number whose Command is not START or STOP, SHALL skip the Answer_Service for that Inbound_Message, and SHALL record the Outcome `ignored-stopped`.
4. WHEN an Inbound_Message from a Canonical_Number on the Stop_List is routed to the Command START, THE Gateway_Pipeline SHALL remove the Canonical_Number from the Stop_List regardless of Allowlist_Mode, the Allowlist, the Rate_Limiter records and the Daily_Send_Cap, and SHALL then decide the reply and the Outcome under criterion 13.
5. WHEN an Inbound_Message from a Canonical_Number that is not on the Stop_List is routed to the Command START, THE Gateway_Pipeline SHALL leave the Stop_List unchanged and SHALL decide the reply and the Outcome under criterion 13.
6. WHEN the Gateway_Pipeline adds a Canonical_Number to or removes a Canonical_Number from the Stop_List, THE Necromancer_App SHALL persist the updated Stop_List within 1 second and before the Gateway_Service processes the next Inbound_Message.
7. WHEN the Necromancer_App restarts or the phone reboots, THE Necromancer_App SHALL load the Stop_List with exactly the same Canonical_Numbers that were persisted before the restart, before the Gateway_Service processes any Inbound_Message.
8. IF the Sms_Sender is asked to send to a Canonical_Number that is on the persisted Stop_List, including a retry under Requirement 8, THEN THE Sms_Sender SHALL send no SMS part and report the Send_Result `refused-stopped` to the Gateway_Service, and THE Gateway_Service SHALL record the Outcome `ignored-stopped` for that Inbound_Message and add 0 SMS parts to today's sent count.
9. WHEN the Gateway_Pipeline records the Outcome `stopped` for a Canonical_Number, THE Gateway_Service SHALL cancel every reply for an earlier Inbound_Message from the same Canonical_Number that has not yet been handed to the Sms_Sender, including replies waiting for the Answer_Service or for a retry, and SHALL record the Outcome `ignored-stopped` for each cancelled Inbound_Message.
10. FOR ALL sequences of Inbound_Messages from one Canonical_Number with any Commands, THE Gateway_Pipeline SHALL produce no Reply_Parts for the STOP message itself and for any Inbound_Message that comes after a STOP and before the next START in the sequence (property: STOP always wins).
11. IF the Stop_List cannot be read from storage, THEN THE Gateway_Service SHALL produce and send no Reply_Parts for any Inbound_Message, set the Heartbeat_State SLEEPING with the Sleep_Reason `service-stopped`, and show an error message on the Main_Screen telling the Operator that the Stop_List could not be loaded, until a later read of the Stop_List succeeds.
12. IF the Necromancer_App fails to persist the updated Stop_List, THEN THE Gateway_Pipeline SHALL keep the change in the Stop_List used for processing, THE Necromancer_App SHALL retry the write up to 3 times at 1-second intervals, and IF all 3 retries fail, THEN THE Main_Screen SHALL show an error message telling the Operator that the Stop_List could not be saved.
13. WHEN the Gateway_Pipeline has handled the Stop_List for an Inbound_Message routed to the Command START, THE Gateway_Pipeline SHALL continue with the Allowlist_Mode, Rate_Limiter and Daily_Send_Cap checks in the order of Requirement 7 criterion 3: IF Requirement 4 criterion 8 or criterion 11 applies, THEN the Gateway_Pipeline SHALL produce no Reply_Parts and record the Outcome `started`; IF the Rate_Limiter or the Daily_Send_Cap blocks the reply, THEN the Gateway_Pipeline SHALL record the Outcome `rate-limited` or `send-capped` and produce Reply_Parts only as Requirement 5 allows; otherwise the Gateway_Pipeline SHALL produce the Reply_Parts of the Welcome_Back_Text in the Language of the Inbound_Message and record the Outcome `started`.
14. IF the stored Gateway_State cannot be decoded or the stored Stop_List is not a list when the Gateway_Service loads it, THEN THE Gateway_Service SHALL treat the state as unreadable under criterion 11 and hold every Inbound_Message, and SHALL NOT start processing with an empty Stop_List.

### Requirement 4: Allowlist mode

**User Story:** As an Operator, I want to limit the gateway to approved numbers, so that I control who uses my SIM credit.

#### Acceptance Criteria

1. WHERE Allowlist_Mode is on, WHEN an Inbound_Message whose Command is not STOP or START arrives from a Canonical_Number that is not on the Allowlist and not on the Stop_List, THE Gateway_Pipeline SHALL produce no Reply_Parts, record the Outcome `ignored-not-allowed`, skip the Answer_Service, and leave the Rate_Limiter records and today's sent count unchanged.
2. WHERE Allowlist_Mode is on, WHEN an Inbound_Message whose Command is not STOP arrives from a Canonical_Number that is on the Allowlist and not on the Stop_List, THE Gateway_Pipeline SHALL continue processing the Inbound_Message under Requirement 5 and Requirement 6.
3. WHERE Allowlist_Mode is off, WHEN an Inbound_Message whose Command is not STOP arrives from a Canonical_Number that is not on the Stop_List, THE Gateway_Pipeline SHALL continue processing the Inbound_Message under Requirement 5 and Requirement 6 regardless of whether the Canonical_Number is on the Allowlist.
4. WHEN the Operator adds a phone number to the Allowlist on the Settings_Screen, THE Necromancer_App SHALL store the Canonical_Number produced by the Number_Normalizer for that phone number, and IF that Canonical_Number is already on the Allowlist, THEN THE Necromancer_App SHALL keep exactly one Allowlist entry for it and show a message on the Settings_Screen stating that the number is already on the Allowlist.
5. IF the Operator enters a value on the Settings_Screen that the Number_Normalizer reports as an Automated_Sender, THEN THE Settings_Screen SHALL reject the value, leave the Allowlist unchanged, and show a message explaining that a phone number of 7 to 15 digits is required.
6. WHEN the Operator adds a Canonical_Number to the Allowlist, removes a Canonical_Number from the Allowlist, or switches Allowlist_Mode on or off, THE Necromancer_App SHALL persist the updated Allowlist and Allowlist_Mode within 1 second, apply them to every Inbound_Message processed after the change is persisted, and load the same Allowlist and Allowlist_Mode after the Necromancer_App restarts or the phone reboots.
7. THE Settings_Screen SHALL show every Allowlist entry and every Stop_List entry as a Masked_Number, and SHALL show no full Canonical_Number after the Operator saves an entry.
8. WHERE Allowlist_Mode is on, WHEN an Inbound_Message routed to the Command START arrives from a Canonical_Number that is not on the Allowlist, THE Gateway_Pipeline SHALL remove the Canonical_Number from the Stop_List if present (Requirement 3 criterion 4), produce no Reply_Parts, record the Outcome `started`, and leave the Rate_Limiter records and today's sent count unchanged.
9. IF Allowlist_Mode is on and the Allowlist cannot be read from storage, THEN THE Gateway_Pipeline SHALL produce no Reply_Parts for any Inbound_Message whose Command is not STOP or START, record the Outcome `ignored-not-allowed` for each such Inbound_Message, and THE Main_Screen SHALL show an error message telling the Operator that the Allowlist could not be loaded. STOP is handled under Requirement 3 criterion 1 and START under criterion 11.
10. IF the Operator tries to add a Canonical_Number while the Allowlist already holds 500 entries, THEN THE Settings_Screen SHALL reject the value, leave the Allowlist unchanged, and show a message stating that the Allowlist is full at 500 numbers.
11. WHERE Allowlist_Mode is on, WHILE the Allowlist cannot be read from storage, WHEN an Inbound_Message routed to the Command START arrives from a Canonical_Number, THE Gateway_Pipeline SHALL remove the Canonical_Number from the Stop_List if present (Requirement 3 criterion 4), produce no Reply_Parts, record the Outcome `started`, and leave the Rate_Limiter records and today's sent count unchanged, in the same way as Requirement 4 criterion 8.

### Requirement 5: Per-number rate limit and daily send cap

**User Story:** As an Operator, I want each number limited to a few answers per hour and a total daily cap, so that one person cannot drain the SIM credit or the AI free tier.

#### Acceptance Criteria

1. WHEN an Inbound_Message with receive time T arrives from a Canonical_Number that has fewer than Per_Number_Limit accepted Inbound_Messages with receive times greater than T minus Rate_Window and less than or equal to T, THE Rate_Limiter SHALL accept the Inbound_Message and record receive time T for that Canonical_Number.
2. WHEN an Inbound_Message with receive time T arrives from a Canonical_Number that already has Per_Number_Limit or more accepted Inbound_Messages with receive times greater than T minus Rate_Window and less than or equal to T, THE Gateway_Pipeline SHALL record the Outcome `rate-limited`, skip the Answer_Service, and leave the Rate_Limiter records for that Canonical_Number unchanged.
3. WHEN the Gateway_Pipeline records a `rate-limited` Outcome with receive time T for a Canonical_Number that has received no Slow_Down_Text with a receive time greater than T minus Rate_Window, THE Gateway_Pipeline SHALL produce the Reply_Parts of the Slow_Down_Text in the Language of the Inbound_Message, subject to criteria 8 and 12.
4. WHEN the Gateway_Pipeline records a `rate-limited` Outcome with receive time T for a Canonical_Number that has already received a Slow_Down_Text for an Inbound_Message with a receive time greater than T minus Rate_Window, THE Gateway_Pipeline SHALL produce no Reply_Parts.
5. FOR ALL sequences of Inbound_Messages from one Canonical_Number with non-decreasing receive times, THE Rate_Limiter SHALL accept at most Per_Number_Limit Inbound_Messages within any half-open interval of length Rate_Window (invariant property).
6. FOR ALL pairs of distinct Canonical_Numbers, THE Rate_Limiter SHALL accept or reject Inbound_Messages from one Canonical_Number independently of Inbound_Messages from the other Canonical_Number (independence property).
7. WHEN the Gateway_Pipeline evaluates an Inbound_Message that is routed to the Command STOP, that is a START handled under Requirement 4 criterion 8 or criterion 11, or that receives the Outcome `ignored-stopped`, `ignored-not-allowed`, `ignored-automated`, `ignored-own-number` or `ignored-paused`, THE Gateway_Pipeline SHALL decide that Outcome before the Rate_Limiter and SHALL exclude the Inbound_Message from the Rate_Limiter count.
8. IF the number of SMS parts handed to the Sms_Sender since 00:00 local time on the current day plus the number of Reply_Parts for an Inbound_Message would exceed the Daily_Send_Cap, THEN THE Gateway_Pipeline SHALL produce no Reply_Parts, record the Outcome `send-capped`, and hand none of the Reply_Parts to the Sms_Sender.
9. WHILE the number of SMS parts handed to the Sms_Sender since 00:00 local time on the current day is equal to the Daily_Send_Cap, THE Main_Screen SHALL show a message stating that the daily send cap is reached and that sending resumes at 00:00 local time on the next day.
10. THE Settings_Screen SHALL let the Operator set the Per_Number_Limit to an integer from 1 to 60, the Rate_Window to an integer number of minutes from 1 to 1440, and the Daily_Send_Cap to an integer from 1 to 2000, and THE Gateway_Pipeline SHALL apply a saved value to every Inbound_Message received after the save without deleting existing Rate_Limiter records or the current day's sent-part count.
11. IF the Operator enters a Per_Number_Limit, Rate_Window or Daily_Send_Cap that is not an integer or is outside its allowed range, THEN THE Settings_Screen SHALL reject the value, keep the previous value in the Settings, and show the allowed range for that field.
12. IF the number of SMS parts handed to the Sms_Sender since 00:00 local time on the current day already equals the Daily_Send_Cap when the Gateway_Pipeline evaluates an Inbound_Message that is not excluded by criterion 7, THEN THE Gateway_Pipeline SHALL record the Outcome `send-capped`, skip the Answer_Service, and produce no Reply_Parts.
13. WHEN the Gateway_Service restarts or the phone reboots, THE Necromancer_App SHALL keep the Rate_Limiter records and the current day's sent-part count from before the restart, and SHALL reset the sent-part count to 0 at 00:00 local time each day.
14. WHEN a Slow_Down_Text is due under criterion 3 for a rate-limited Inbound_Message but sending it would exceed the Daily_Send_Cap under criterion 8, THE Gateway_Pipeline SHALL record the Outcome `send-capped`, produce no Reply_Parts, and SHALL NOT record that a Slow_Down_Text was sent.

### Requirement 6: Route messages to the brain package

**User Story:** As a Sender, I want each command or question answered in my own language, so that I get a short, useful reply.

#### Acceptance Criteria

1. WHEN the Gateway_Pipeline accepts an Inbound_Message, THE Gateway_Pipeline SHALL call the Command_Router exactly once with the unmodified body text of the Inbound_Message and use the returned Routed_Command, including its Language, for all later decisions about that Inbound_Message.
2. WHEN the Routed_Command has the Command QUESTION and an argument containing at least 1 non-whitespace character, THE Gateway_Pipeline SHALL obtain the Reply_Text by calling `answerQuestion` exactly once with the argument and the Language of the Routed_Command.
3. WHEN the Routed_Command has the Command SCAM and `argumentMissing` is false, THE Gateway_Pipeline SHALL obtain the Reply_Text by calling `checkScam` exactly once with the argument and the Language of the Routed_Command.
4. WHEN the Routed_Command has the Command HELP, THE Gateway_Pipeline SHALL use the Help_Text in the Language of the Routed_Command as the Reply_Text and SHALL make no call to the Answer_Service.
5. WHEN the Routed_Command has the Command QUESTION and an argument that is empty or contains only whitespace characters, THE Gateway_Pipeline SHALL use the Help_Text in the Language of the Routed_Command as the Reply_Text and SHALL make no call to the Answer_Service.
6. WHEN the Routed_Command has the Command REMIND or TRANSLATE and `argumentMissing` is false, THE Gateway_Pipeline SHALL use the Not_Available_Text in the Language of the Routed_Command as the Reply_Text and SHALL make no call to the Answer_Service.
7. WHEN the Routed_Command has the Command SCAM, REMIND or TRANSLATE and `argumentMissing` is true, THE Gateway_Pipeline SHALL use the Usage_Hint_Text for that Command in the Language of the Routed_Command as the Reply_Text and SHALL make no call to the Answer_Service.
8. WHEN the Gateway_Pipeline has a Reply_Text for an Inbound_Message, THE Gateway_Pipeline SHALL produce the Reply_Parts by calling the SMS_Splitter exactly once with that Reply_Text.
9. THE Gateway_Pipeline SHALL pass to the Answer_Service only the argument and the Language of the Routed_Command, and SHALL pass no Sender_Address, Canonical_Number, Masked_Number, Masked_Sender or receive time.
10. THE Gateway_Pipeline SHALL produce at least 1 and at most 4 Reply_Parts for each accepted Inbound_Message that has a Reply_Text.
11. FOR ALL Languages, every Fixed_Gateway_Text SHALL produce exactly 1 Reply_Part when passed to the SMS_Splitter, except the Help_Text for the Language `ur`, which SHALL produce at most 2 Reply_Parts.
12. WHILE no earlier multipart SMS is in a Send_Timeout wait (Requirement 8 criterion 8) or a retry wait (Requirement 8 criterion 3), WHEN the Gateway_Pipeline produces Reply_Parts for an accepted Inbound_Message, THE Gateway_Service SHALL hand the Reply_Parts to the Sms_Sender no later than 30 seconds after the receive time of that Inbound_Message. During such a wait, later Reply_Parts are held under Requirement 8 criterion 7 and can be handed over later than 30 seconds, as described under Known limitations in the Introduction.
13. IF the Answer_Service has not returned a Reply_Text within 25 seconds of the call to `answerQuestion` or `checkScam`, THEN THE Gateway_Pipeline SHALL use the Try_Later_Text exported by the brain package in the Language of the Routed_Command as the Reply_Text.
14. IF the Answer_Service returns a Reply_Text after the Gateway_Pipeline has already used the Try_Later_Text for the same Inbound_Message, THEN THE Gateway_Pipeline SHALL discard the late Reply_Text and SHALL hand no further Reply_Parts for that Inbound_Message to the Sms_Sender.
15. IF the Command_Router or the SMS_Splitter throws an error while processing an Inbound_Message, THEN THE Gateway_Pipeline SHALL use the Try_Later_Text for the Language `en`, or for the Language of the Routed_Command when the Command_Router returned one, as the Reply_Text, and SHALL go on to process the next Inbound_Message.

### Requirement 7: Loop protection

**User Story:** As an Operator, I want the gateway to ignore automated senders and itself, so that the gateway does not get stuck in an endless reply loop.

#### Acceptance Criteria

1. IF the Number_Normalizer reports that the Sender_Address of an Inbound_Message is an Automated_Sender, including an empty Sender_Address, an alphanumeric sender ID or a short code of fewer than 7 digits, THEN THE Gateway_Pipeline SHALL produce an empty list of Reply_Parts and record the Outcome `ignored-automated`, whatever the body text of the Inbound_Message contains, including STOP, START or HELP.
2. WHERE the Operator has set an Own_Number, IF the Canonical_Number that the Number_Normalizer produces for the Sender_Address of an Inbound_Message equals the Own_Number, THEN THE Gateway_Pipeline SHALL produce an empty list of Reply_Parts and record the Outcome `ignored-own-number`, whatever the body text of the Inbound_Message contains. A national-format Sender_Address (for example `03001234567` with Default_Country_Code `92`) and an international-format Sender_Address (for example `+92 300 1234567`) SHALL both match an Own_Number of `+923001234567`.
3. WHEN the Gateway_Pipeline evaluates an Inbound_Message while the gateway is not paused by the Operator, THE Gateway_Pipeline SHALL apply the checks in this order: Automated_Sender, Own_Number, STOP and START handling, Stop_List, Allowlist_Mode, Rate_Limiter, Daily_Send_Cap, command routing. The first check that produces an Outcome SHALL end the evaluation, and no later check SHALL run for that Inbound_Message. STOP handling produces the Outcome `stopped`. START handling updates the Stop_List under Requirement 3 criteria 4 and 5, skips the Stop_List check, continues with the Allowlist_Mode check (which ends the evaluation with the Outcome `started` under Requirement 4 criterion 8 when the Canonical_Number is not on the Allowlist, or under Requirement 4 criterion 11 when the Allowlist cannot be read), the Rate_Limiter and Daily_Send_Cap checks, and uses the Welcome_Back_Text in place of command routing, as defined in Requirement 3 criterion 13.
4. THE Gateway_Pipeline SHALL record exactly one Outcome for each Inbound_Message, for every combination of Inbound_Message and Gateway_State, and that Outcome SHALL be one of the 11 values listed in the Outcome definition. This is an invariant property.
5. WHEN the Gateway_Pipeline records the Outcome `ignored-automated` or `ignored-own-number`, THE Gateway_Pipeline SHALL leave the Stop_List, the Allowlist, the Rate_Limiter records and the count of SMS parts sent toward the Daily_Send_Cap unchanged, and SHALL NOT call the Command_Router or the Answer_Service.
6. WHEN the Gateway_Pipeline records the Outcome `ignored-automated`, THE Necromancer_App SHALL add one Activity_Entry for that Inbound_Message that stores the Masked_Sender produced by the Sender_Masker for the Sender_Address, in which every character except the last 3 characters is replaced by the character `•`.

### Requirement 8: Send SMS replies

**User Story:** As a Sender on a button phone, I want a reply that arrives in order as one readable message, so that I can read the answer easily.

#### Acceptance Criteria

1. WHEN the Gateway_Service hands a list of 1 to 4 Reply_Parts to the Sms_Sender, THE Sms_Sender SHALL send the Reply_Parts to the Canonical_Number of the Sender as one multipart SMS, with each Reply_Part as one segment, in the order of the list, without changing the text of any Reply_Part.
2. WHEN the Sms_Sender sends a multipart SMS, THE Sms_Sender SHALL report to the Gateway_Service exactly one Send_Result per Reply_Part, where each Send_Result is `sent` or `failed`, or SHALL report the single Send_Result `refused-stopped` when Requirement 3 criterion 8 applies.
3. IF any Reply_Part has the Send_Result `failed` with a generic radio failure or no-service error, THEN THE Sms_Sender SHALL retry the whole multipart SMS exactly once, 30 seconds (±5 seconds) after the last Send_Result of the first attempt, and SHALL check the persisted Stop_List again immediately before the retry and report `refused-stopped` instead of retrying if the Canonical_Number is on the Stop_List.
4. IF a multipart SMS still has a `failed` Reply_Part after the retry, or a Reply_Part has the Send_Result `failed` with an error other than a generic radio failure or no-service error, THEN THE Gateway_Service SHALL record the Outcome `send-failed` for the Inbound_Message, make no further send attempt for that Inbound_Message, and add only the number of Reply_Parts with the Send_Result `sent` to today's sent count.
5. WHEN all Reply_Parts of a multipart SMS have the Send_Result `sent`, THE Gateway_Service SHALL record the Outcome `replied`, `started` or `rate-limited` as decided by the Gateway_Pipeline, and add the number of Reply_Parts to today's sent count exactly once, including when the parts were sent on the retry.
6. THE Sms_Sender SHALL send through the phone's default SIM using the Android SMS API, with no third-party SMS gateway.
7. WHILE the Sms_Sender is sending a multipart SMS, including the 30-second wait before a retry, THE Sms_Sender SHALL send no other multipart SMS, and THE Gateway_Service SHALL hold later Reply_Parts in the order of the receive time of their Inbound_Messages.
8. IF the Sms_Sender receives no Send_Result for a Reply_Part within the Send_Timeout of 60 seconds after starting a send attempt, THEN THE Sms_Sender SHALL report the Send_Result `failed` with a no-service error for that Reply_Part.
9. WHILE the Sms_Sender is sending a multipart SMS, THE Main_Screen SHALL show the Heartbeat_State SENDING unless a Sleep_Reason applies, and WHEN the Sms_Sender reports the final Send_Results, THE Main_Screen SHALL show the Heartbeat_State derived by the Heartbeat_Model within 2 seconds.
10. IF the Gateway_Service has an empty list of Reply_Parts for an Inbound_Message, THEN THE Gateway_Service SHALL not call the Sms_Sender and SHALL add 0 to today's sent count.
11. WHEN any Reply_Part of the first attempt has a Send_Result `failed` with an error other than a generic radio failure or no-service error, THE Sms_Sender SHALL NOT retry, even if other Reply_Parts of the same attempt failed with a generic radio failure or no-service error; criterion 4 takes precedence over criterion 3.
12. WHEN the Sms_Sender retries under criterion 3, THE Sms_Sender SHALL send every Reply_Part again, and the Send_Report SHALL hold only the Send_Results of the second attempt with an attempt count of 2.

### Requirement 9: Foreground service

**User Story:** As an Operator, I want the gateway to keep running when the screen is off or the app is closed, so that Senders get answers at any time.

#### Acceptance Criteria

1. WHEN the Operator starts the gateway from the Main_Screen, THE Necromancer_App SHALL start the Gateway_Service as a foreground service with a persistent notification within 5 seconds, and SHALL keep at most 1 running instance of the Gateway_Service if the Gateway_Service is already running.
2. WHILE the Gateway_Service is running, THE Gateway_Service SHALL show a persistent notification that states the Heartbeat_State in words, and the count of Activity_Entries with Outcome `replied` whose receive time is on the current calendar day in the phone's local time zone. The notification SHALL update within 5 seconds of a change to either value, SHALL contain no Sender_Address, Canonical_Number, Masked_Number or Masked_Sender, and SHALL be shown again within 5 seconds if the Operator dismisses it.
3. WHEN the Operator taps the persistent notification, THE Necromancer_App SHALL open the Main_Screen within 2 seconds, and the Gateway_Service SHALL keep running.
4. IF Android stops the Gateway_Service for any reason other than the Operator pausing the gateway, THEN THE Gateway_Service SHALL request Android to restart the Gateway_Service, and THE Necromancer_App SHALL keep the Gateway_State, the Activity_Log and the Settings unchanged across the restart.
5. WHEN the Operator pauses the gateway from the Main_Screen, THE Necromancer_App SHALL stop the Gateway_Service within 5 seconds, remove the persistent notification, set the Sleep_Reason `paused-by-operator`, and keep the Gateway_Service stopped until the Operator resumes the gateway. This SHALL hold across Necromancer_App restarts and phone reboots, during which the Boot_Receiver SHALL NOT start the Gateway_Service.
6. WHILE the Gateway_Service is running, THE Gateway_Service SHALL process each Inbound_Message as defined in Requirement 1 while the Necromancer_App UI is closed, the screen is off, or the phone is locked.
7. IF the persistent notification cannot be shown because the notification permission is not granted, THEN THE Necromancer_App SHALL set the Sleep_Reason `no-notification-permission`, and THE Main_Screen SHALL show a message stating that the notification permission is missing together with the fix button defined for `no-notification-permission` in Requirement 13 criterion 7.
8. WHEN the Operator resumes the gateway from the Main_Screen while the Sleep_Reason is `paused-by-operator`, THE Necromancer_App SHALL clear the Sleep_Reason `paused-by-operator` and start the Gateway_Service as defined in criterion 1.
9. IF the Gateway_Service is not running 60 seconds after Android stopped it for a reason other than the Operator pausing the gateway, THEN THE Necromancer_App SHALL set the Sleep_Reason `service-stopped` and show on the Main_Screen a control that lets the Operator start the gateway again.
10. WHILE the Sleep_Reason is `paused-by-operator`, WHEN the Paused_Path_Task processes an Inbound_Message that criterion 11 does not cover, THE Necromancer_App SHALL produce no Reply_Parts for that Inbound_Message, record the Outcome `ignored-paused` and add one Activity_Entry for it, store nothing for later processing, and send no reply for that Inbound_Message after the Operator resumes the gateway.
11. WHILE the Sleep_Reason is `paused-by-operator`, WHEN the Command_Router called by the Paused_Path_Task routes an Inbound_Message from a Phone_Number that does not match the Own_Number to the Command STOP, THE Necromancer_App SHALL apply Requirement 3 criterion 1 and record the Outcome `stopped` in place of `ignored-paused`.
12. WHILE the Sleep_Reason is `paused-by-operator`, WHEN the Sms_Receiver creates an Inbound_Message, THE Native_Module SHALL start one Paused_Path_Task for that Inbound_Message, and THE Paused_Path_Task SHALL decide whether the Inbound_Message routes to the Command STOP by calling the Command_Router on the body text in memory.
13. WHILE the Sleep_Reason is `paused-by-operator`, IF Android refuses to start the Paused_Path_Task for an Inbound_Message and the body text passes the Stop_Keyword_Check, THEN THE Native_Module SHALL persist one Pending_Stop_Record for that Inbound_Message, made only of the Sender_Address, the STOP_Marker and the receive time, before discarding the body text from memory.
14. WHILE the Sleep_Reason is `paused-by-operator`, IF Android refuses to start the Paused_Path_Task for an Inbound_Message and the body text fails the Stop_Keyword_Check, THEN THE Native_Module SHALL discard the Inbound_Message, store nothing for later processing, create no Activity_Entry, and write exactly one logcat line stating that the message was dropped while paused, containing no part of the body text and no character of the Sender_Address other than its last 3 characters.
15. WHEN the Gateway_Service or a Paused_Path_Task next starts while 1 or more Pending_Stop_Records are persisted, THE Necromancer_App SHALL apply every Pending_Stop_Record in ascending order of receive time before processing any other Inbound_Message, including Inbound_Messages in the Pending_Inbox. Applying a Pending_Stop_Record SHALL pass the Sender_Address to the Gateway_Pipeline, which SHALL record the Outcome `ignored-automated` (Requirement 7 criterion 1) or `ignored-own-number` (Requirement 7 criterion 2) when those apply, and otherwise add the Canonical_Number to the Stop_List under Requirement 3 criterion 1 and record the Outcome `stopped`, with 0 Reply_Parts in every case. THE Necromancer_App SHALL add one Activity_Entry with the receive time of the Pending_Stop_Record and the Command STOP.
16. WHEN the Necromancer_App has persisted the Stop_List change and the Activity_Entry for an applied Pending_Stop_Record, THE Necromancer_App SHALL delete that Pending_Stop_Record from storage. IF persisting the Stop_List change fails after the retries of Requirement 3 criterion 12, THEN THE Necromancer_App SHALL keep the Pending_Stop_Record in storage and apply it again at the next start of the Gateway_Service or a Paused_Path_Task.
17. WHEN the Necromancer_App restarts or the phone reboots, THE Necromancer_App SHALL keep every Pending_Stop_Record that was persisted and not yet deleted before the restart.
18. IF the persisted paused flag cannot be read, THEN THE Sms_Receiver, the BootReceiver and the RestartReceiver SHALL treat the gateway as not paused and start or keep queueing for the Gateway_Service, and THE Gateway_Service SHALL read the flag again before it processes any Inbound_Message.

### Requirement 10: Restart on boot

**User Story:** As an Operator, I want the gateway to come back after a power cut or reboot, so that I do not need to open the app by hand.

#### Acceptance Criteria

1. WHEN Android reports that boot is complete and the Operator had not paused the gateway before the shutdown, THE Boot_Receiver SHALL start the Gateway_Service within 60 seconds of Android reporting that boot is complete, without the Operator opening the Necromancer_App.
2. WHEN Android reports that boot is complete and the Operator had paused the gateway before the shutdown, THE Boot_Receiver SHALL leave the Gateway_Service stopped, and THE Main_Screen SHALL show the Heartbeat_State SLEEPING with the Sleep_Reason `paused-by-operator` when the Operator next opens the Necromancer_App.
3. WHEN Android reports that the Necromancer_App package was replaced by installing a new debug APK and the Operator had not paused the gateway before the update, THE Boot_Receiver SHALL start the Gateway_Service within 60 seconds of Android reporting that the package was replaced.
4. WHEN Android reports that the Necromancer_App package was replaced by installing a new debug APK and the Operator had paused the gateway before the update, THE Boot_Receiver SHALL leave the Gateway_Service stopped.
5. IF the Gateway_Service is not running 60 seconds after Android reports that boot is complete or that the package was replaced, and the Operator had not paused the gateway, THEN THE Boot_Receiver SHALL show exactly 1 notification telling the Operator to open the Necromancer_App and check the Setup_Screen, and SHALL leave the Gateway_State unchanged.
6. WHEN the Gateway_Service starts after a reboot or a package replacement, THE Gateway_Service SHALL use the same Stop_List, Allowlist, Allowlist_Mode, Rate_Limiter records and Settings that were persisted before the shutdown or update.
7. WHILE the Gateway_Service runs after a reboot, THE Gateway_Pipeline SHALL send no SMS to any Canonical_Number that was on the Stop_List before the shutdown until that Canonical_Number sends START.
8. WHEN Android delivers an Inbound_Message after boot is complete but before the Gateway_Service has started, and the Operator had not paused the gateway, THE Gateway_Service SHALL process that Inbound_Message after it starts, in the order of receive time, within 60 seconds of starting.

### Requirement 11: Permission explanation screen

**User Story:** As an Operator, I want to understand why the app needs SMS access before Android asks me, so that I can trust the app and grant the right permissions.

#### Acceptance Criteria

1. WHEN the Necromancer_App starts, IF any of the RECEIVE_SMS, SEND_SMS or POST_NOTIFICATIONS permissions is not granted, THEN THE Necromancer_App SHALL show the Permission_Screen before the Setup_Screen and the Main_Screen, and SHALL show neither the Setup_Screen nor the Main_Screen at start until all 3 permissions are granted.
2. THE Permission_Screen SHALL show one explanation for each of RECEIVE_SMS, SEND_SMS and POST_NOTIFICATIONS, and each explanation SHALL be at most 300 characters long, name the permission, and state what the gateway uses it for.
3. THE Permission_Screen SHALL state, before the continue button, that message bodies are not uploaded anywhere except the question text sent to the AI service, and that message bodies are not stored in the Activity_Log.
4. WHEN the Operator taps the continue button on the Permission_Screen, THE Necromancer_App SHALL request from Android at runtime only those of RECEIVE_SMS, SEND_SMS and POST_NOTIFICATIONS that are not yet granted, and SHALL request no permission before the Operator taps the continue button.
5. IF the Operator denies one or more requested permissions and Android still allows asking again, THEN THE Permission_Screen SHALL list each denied permission by name with its explanation, and SHALL show an ask-again button that requests only the denied permissions.
6. IF the Operator denies a requested permission and Android no longer shows the permission dialog for it, THEN THE Permission_Screen SHALL mark that permission as missing and show a button that opens the Necromancer_App's system App info page in 1 tap.
7. IF Android blocks the RECEIVE_SMS or SEND_SMS permission request because of Restricted_Settings, THEN THE Permission_Screen SHALL show numbered instructions with these 4 steps in this order: open App info, tap the menu, choose "Allow restricted settings", and return to the Necromancer_App. The screen SHALL also show a button that opens the Necromancer_App's system App info page.
8. WHEN the Necromancer_App returns to the foreground while the Permission_Screen is shown, THE Permission_Screen SHALL re-check the RECEIVE_SMS, SEND_SMS and POST_NOTIFICATIONS permissions within 1 second and update the granted or missing status shown for each.
9. WHEN all of RECEIVE_SMS, SEND_SMS and POST_NOTIFICATIONS are granted while the Permission_Screen is shown, THE Necromancer_App SHALL leave the Permission_Screen and show the Setup_Screen within 1 second.
10. IF any of RECEIVE_SMS, SEND_SMS or POST_NOTIFICATIONS is revoked while the Necromancer_App is in the background, THEN THE Necromancer_App SHALL show the Permission_Screen with the revoked permission marked as missing when it next comes to the foreground, and THE Heartbeat_Model SHALL apply the matching Sleep_Reason `no-sms-permission` or `no-notification-permission` under Requirement 13 until the permission is granted again.

### Requirement 12: HyperOS and AI key setup screen

**User Story:** As an Operator setting up a Xiaomi phone, I want a checklist for the HyperOS settings that keep the gateway alive and for my Gemini API key, so that HyperOS does not silently kill the gateway and the gateway can answer questions.

#### Acceptance Criteria

1. THE Setup_Screen SHALL show exactly 6 Setup_Steps in this order: (1) allow Restricted_Settings, (2) grant SMS and notification permissions, (3) save the Gemini_Api_Key (the AI key Setup_Step), (4) enable Autostart, (5) set battery usage to "No restrictions", (6) lock the Necromancer_App in recent apps.
2. WHEN the Operator taps the Autostart Setup_Step, THE Necromancer_App SHALL open the HyperOS Autostart settings page for the Necromancer_App.
3. IF Android reports that the HyperOS Autostart settings page cannot be opened, THEN THE Necromancer_App SHALL open the Necromancer_App's system App info page, and THE Setup_Screen SHALL show written instructions under the Autostart Setup_Step that name each menu item the Operator must tap to reach the Autostart switch, and SHALL keep those instructions visible when the Operator returns to the Setup_Screen.
4. WHEN the Operator taps the battery Setup_Step, THE Necromancer_App SHALL ask Android to exclude the Necromancer_App from battery optimisation.
5. IF Android reports that the battery optimisation request cannot be shown, THEN THE Necromancer_App SHALL open the Necromancer_App's battery settings page, and THE Setup_Screen SHALL show written instructions under the battery Setup_Step that name each menu item the Operator must tap to choose "No restrictions", and SHALL keep those instructions visible when the Operator returns to the Setup_Screen.
6. WHEN the Setup_Screen becomes visible, THE Setup_Screen SHALL read the Device_Status and mark each of these Setup_Steps as done or not done: the Restricted_Settings Setup_Step is done when SMS permission is granted; the permissions Setup_Step is done when both SMS permission and notification permission are granted; the AI key Setup_Step is done when the Api_Key_Store holds a Gemini_Api_Key that the Native_Module can read and decrypt; the battery Setup_Step is done when battery optimisation is ignored for the Necromancer_App. If Android reports that a permission or exclusion has been revoked, or the Gemini_Api_Key has been removed or cannot be read, the Setup_Step SHALL be marked not done, even if it was done earlier. The AI key Setup_Step SHALL also be re-marked within 1 second after the Operator saves or removes the Gemini_Api_Key.
7. WHEN the Operator taps the done control on the Autostart Setup_Step or the recent-apps Setup_Step, THE Setup_Screen SHALL toggle that Setup_Step between done and not done, and SHALL persist the mark so that the same mark is shown after the Necromancer_App restarts and after the phone reboots.
8. THE Setup_Screen SHALL show, under each Setup_Step and without any extra tap, an explanation of at most 120 characters stating what goes wrong for the gateway if the step is skipped.
9. WHEN all 6 Setup_Steps are marked done, THE Setup_Screen SHALL show a button that opens the Main_Screen. WHILE 1 or more Setup_Steps are marked not done, THE Setup_Screen SHALL NOT show that button.
10. WHILE the Main_Screen is visible, THE Main_Screen SHALL show a button that opens the Setup_Screen, and opening the Setup_Screen SHALL NOT stop or pause the Gateway_Service.
11. WHEN the Operator taps the Restricted_Settings Setup_Step, THE Necromancer_App SHALL open the Necromancer_App's system App info page, and THE Setup_Screen SHALL show written instructions under that Setup_Step that name each menu item the Operator must tap to enable "Allow restricted settings".
12. WHEN the Operator taps the permissions Setup_Step, THE Necromancer_App SHALL open the Permission_Screen, and WHEN the Operator leaves the Permission_Screen, THE Necromancer_App SHALL return to the Setup_Screen.
13. WHEN the Necromancer_App starts, all of RECEIVE_SMS, SEND_SMS and POST_NOTIFICATIONS are granted, and 1 or more Setup_Steps are marked not done, THE Necromancer_App SHALL show the Setup_Screen instead of the Main_Screen. The start screen order SHALL be: Permission_Screen while any of those 3 permissions is missing (Requirement 11 criterion 1), then the Setup_Screen while any Setup_Step is not done, then the Main_Screen.
14. WHEN the Operator taps the AI key Setup_Step, THE Setup_Screen SHALL show the Key_Input_Field and a save button, and WHILE the Api_Key_Store holds a readable Gemini_Api_Key, THE Setup_Screen SHALL also show the text "key saved", the Masked_Key and a remove-key button, as defined in Requirement 16.

### Requirement 13: Heartbeat states on the main screen

**User Story:** As an Operator, I want to see at a glance whether the gateway is alive and why it is not, so that I can fix problems quickly.

#### Acceptance Criteria

1. WHILE no Sleep_Reason applies and the Sms_Sender is not sending a multipart SMS, THE Heartbeat_Model SHALL return the Heartbeat_State ALIVE.
2. WHILE no Sleep_Reason applies and the Sms_Sender is sending a multipart SMS, THE Heartbeat_Model SHALL return the Heartbeat_State SENDING. A multipart SMS is being sent from the moment the Reply_Parts are handed to the Sms_Sender until the Sms_Sender has reported a Send_Result for every part, where a part with no Send_Result after the Send_Timeout of 60 seconds counts as reported `failed` under Requirement 8 criterion 8.
3. WHILE one or more Sleep_Reasons apply, THE Heartbeat_Model SHALL return the Heartbeat_State SLEEPING with exactly one Sleep_Reason, even if the Sms_Sender is sending a multipart SMS. The Sleep_Reason SHALL be chosen in this priority order: `paused-by-operator`, `no-sms-permission`, `no-notification-permission`, `service-stopped`, `airplane-mode`, `no-signal`, `battery-optimised`.
4. FOR ALL Device_Status values and Gateway_Service statuses, THE Heartbeat_Model SHALL return exactly one Heartbeat_State, and SHALL return a Sleep_Reason if and only if the Heartbeat_State is SLEEPING (invariant property).
5. WHILE the Heartbeat_State is ALIVE and Reduced_Motion is off, THE Main_Screen SHALL show a heartbeat line in soul green `#39FF88` that pulses once every 1 to 2 seconds.
6. WHEN an Inbound_Message is received while the Heartbeat_State is ALIVE and Reduced_Motion is off, THE Main_Screen SHALL show 1 extra pulse on the heartbeat line within 1 second of the receive time.
7. WHILE the Heartbeat_State is SLEEPING, THE Main_Screen SHALL show a flat heartbeat line in the muted colour from the design steering file, 1 sentence of at most 120 characters that names the Sleep_Reason's cause and the action that fixes it, and 1 fix button. The fix button SHALL do the following for each Sleep_Reason:
   - `no-sms-permission` and `no-notification-permission`: open the Permission_Screen.
   - `battery-optimised`: open the Android battery optimisation page for the Necromancer_App.
   - `airplane-mode`: open the Android airplane mode settings page.
   - `no-signal`: open the Android mobile network settings page.
   - `service-stopped`: start the Gateway_Service.
   - `paused-by-operator`: resume the Gateway_Service.
8. WHILE the Heartbeat_State is SENDING and Reduced_Motion is off, THE Main_Screen SHALL show the heartbeat line with an ember `#FFB347` glow.
9. WHILE Reduced_Motion is on, THE Main_Screen SHALL show every Heartbeat_State with no pulse animation, no glow animation and no extra pulse for received Inbound_Messages. It SHALL instead show a static line in the state colour and the state name as text.
10. THE Main_Screen SHALL show the Heartbeat_State name (ALIVE, SLEEPING or SENDING) as text next to the heartbeat line, so that the state can be read without relying on colour or animation.
11. WHEN the Device_Status changes, the Gateway_Service status changes, or the Main_Screen comes to the foreground, THE Main_Screen SHALL show the Heartbeat_State and Sleep_Reason returned by the Heartbeat_Model for the current Device_Status within 2 seconds.
12. THE Main_Screen SHALL show 4 counters for the current calendar day in the phone's local time zone:
    - messages received: the number of Inbound_Messages.
    - replies sent: the number of Inbound_Messages with Outcome `replied` or `started`.
    - SMS parts sent: the number of parts the Sms_Sender reported as `sent`.
    - messages ignored: the number of Inbound_Messages with an Outcome that starts with `ignored-`, including `ignored-paused`.

    The counters SHALL reset to 0 at local midnight, SHALL keep their values when the app or the phone restarts on the same day, and SHALL update within 2 seconds after an Outcome is recorded.
13. WHILE the Gateway_Service status is paused by the Operator, THE Heartbeat_Model SHALL treat `paused-by-operator` as applying. WHILE the Gateway_Service is not running and not paused by the Operator, THE Heartbeat_Model SHALL treat `service-stopped` as applying.
14. THE Heartbeat_Model SHALL treat a Sleep_Reason as applying exactly when the Device_Status reports the matching condition:
    - `no-sms-permission`: SMS permission is not granted.
    - `no-notification-permission`: notification permission is not granted.
    - `battery-optimised`: battery optimisation is not ignored for the Necromancer_App.
    - `airplane-mode`: airplane mode is on.
    - `no-signal`: airplane mode is off and cellular service is not in service.
15. IF the Native_Module does not report a Device_Status within 5 seconds of the Main_Screen asking for it, THEN THE Main_Screen SHALL keep showing the last Heartbeat_State it showed and SHALL show a text saying the phone status could not be read, until a Device_Status is reported.
16. WHILE the gateway is paused, THE Paused_Path_Task SHALL count every non-STOP Inbound_Message under "messages ignored" (criterion 12) by committing a day-counters change, and SHALL store nothing else for that Inbound_Message.

### Requirement 14: Activity log and privacy

**User Story:** As an Operator, I want to see recent gateway activity without exposing anyone's full number, so that I can check the gateway while keeping Senders private.

#### Acceptance Criteria

1. WHEN the Gateway_Pipeline records an Outcome for an Inbound_Message from a Phone_Number, THE Necromancer_App SHALL add one Activity_Entry to the Activity_Log within 1 second, containing the receive time of the Inbound_Message, the Masked_Number of the Sender, the Command and the Outcome, and SHALL persist the updated Activity_Log so that it is still shown after the Necromancer_App or the phone restarts.
2. IF the Gateway_Pipeline records an Outcome for an Inbound_Message from an Automated_Sender, THEN THE Necromancer_App SHALL store in the Activity_Entry, in place of a Masked_Number, the Masked_Sender produced by the Sender_Masker for the Sender_Address, in which every character except the last 3 characters is replaced by the character `•`.
3. WHEN adding an Activity_Entry makes the Activity_Log hold more than 200 Activity_Entries, THE Necromancer_App SHALL remove the Activity_Entries with the oldest receive times until exactly 200 Activity_Entries remain.
4. THE Main_Screen SHALL list the Activity_Entries ordered by receive time with the newest Activity_Entry first, showing for each Activity_Entry the receive time in the phone's local time zone, the Masked_Number or Masked_Sender, the Command and the Outcome.
5. THE Necromancer_App SHALL display every Canonical_Number on the Main_Screen, the Settings_Screen and the persistent notification only as a Masked_Number, and every Automated_Sender's Sender_Address only as a Masked_Sender, except for the characters the Operator is typing into a phone number input field on the Settings_Screen before the value is saved.
6. THE Necromancer_App SHALL write every Canonical_Number to Android logcat and to JavaScript console output only as a Masked_Number, and every Automated_Sender's Sender_Address only as a Masked_Sender.
7. THE Necromancer_App SHALL keep the body text of an Inbound_Message only in memory, SHALL discard it no later than the moment the Gateway_Pipeline records the Outcome for that Inbound_Message, and SHALL never write the body text to the Activity_Log, the Gateway_State, Android logcat or JavaScript console output. There are exactly 2 exceptions: the Inbound_Messages stored in the Pending_Inbox under Requirement 1 criterion 6, each of which SHALL be deleted from storage when the Gateway_Pipeline records its Outcome; and the Pending_Stop_Records stored under Requirement 9 criterion 13, each of which holds the STOP_Marker in place of the body text and SHALL be deleted under Requirement 9 criterion 16.
8. FOR ALL Activity_Entries created from any Inbound_Message, the Masked_Number, Command and Outcome fields of the Activity_Entry SHALL contain no substring of 4 or more consecutive digits from the Canonical_Number of the Sender (privacy property).
9. WHEN the Operator taps the clear button on the Main_Screen, THE Necromancer_App SHALL show a confirmation dialog with a confirm action and a cancel action.
10. WHEN the Operator confirms the confirmation dialog for clearing the Activity_Log, THE Necromancer_App SHALL delete all Activity_Entries from the persisted Activity_Log within 1 second and show an empty Activity_Log on the Main_Screen.
11. IF the Operator cancels the confirmation dialog for clearing the Activity_Log, THEN THE Necromancer_App SHALL leave every Activity_Entry unchanged.
12. IF the Necromancer_App fails to persist an Activity_Entry, THEN THE Necromancer_App SHALL continue processing and sending Reply_Parts for that and later Inbound_Messages, keep the previously persisted Activity_Entries unchanged, and write one logcat line stating the failure that contains no body text and no phone number other than a Masked_Number or Masked_Sender.
13. THE Native_Module SHALL write to each Pending_Stop_Record exactly 3 fields, the Sender_Address, the STOP_Marker and the receive time, and the Pending_Stop_Record SHALL contain no character of the body text of the Inbound_Message, including the STOP keyword as the Sender typed it and any text after the STOP keyword.
14. THE Native_Module SHALL write the Sender_Address of a Pending_Stop_Record to Android logcat only with every character except the last 3 characters replaced by `•`.

### Requirement 15: Settings persistence

**User Story:** As an Operator, I want my settings kept across restarts, so that I configure the gateway once.

#### Acceptance Criteria

1. WHEN the Operator saves a Settings value on the Settings_Screen that passes validation under Requirement 4 and Requirement 5, THE Necromancer_App SHALL persist the new value within 1 second, so that the new value is loaded after the Necromancer_App is force-stopped and restarted 1 second or more after the save.
2. WHEN the Necromancer_App starts, including a start of the Gateway_Service by the Boot_Receiver after the phone reboots, THE Necromancer_App SHALL load the Settings, the Allowlist, the Stop_List and the Rate_Limiter records with the values persisted before the restart, and SHALL finish loading them before the Gateway_Pipeline processes the first Inbound_Message.
3. WHEN the Necromancer_App starts with no persisted Settings, THE Necromancer_App SHALL use Allowlist_Mode off, Per_Number_Limit 5, Rate_Window 60 minutes, Daily_Send_Cap 200, Default_Country_Code `92` and no Own_Number.
4. FOR ALL valid Settings values, where valid means Allowlist_Mode on or off, Per_Number_Limit an integer from 1 to 60, Rate_Window an integer number of minutes from 1 to 1440, Daily_Send_Cap an integer from 1 to 2000, Default_Country_Code a string of 1 to 3 digits with no leading zero, and Own_Number either absent or a Canonical_Number, saving the Settings and then loading the Settings SHALL return equal Settings values (round-trip property).
5. IF persisted Settings data cannot be parsed or contains a value outside the valid ranges in criterion 4, THEN THE Necromancer_App SHALL use the default Settings values from criterion 3, keep the Stop_List and the Allowlist unchanged, and show a message on the Main_Screen stating that the Settings were reset to defaults until the Operator dismisses the message.
6. THE Settings_Screen SHALL show every Stop_List entry as a Masked_Number in a read-only list that offers no control to add, edit or remove an entry.
7. IF persisting a Settings value fails, THEN THE Settings_Screen SHALL show a message stating that the change was not saved, and THE Necromancer_App SHALL keep the previously persisted value in storage unchanged.
8. IF persisted Stop_List data cannot be parsed when the Necromancer_App starts, THEN THE Necromancer_App SHALL leave the stored Stop_List data unmodified, THE Gateway_Pipeline SHALL produce no Reply_Parts for any Inbound_Message, and THE Main_Screen SHALL show a message stating that the Stop_List could not be loaded and replies are paused.
9. WHEN a change made on the Settings_Screen has been persisted (Settings or Allowlist), THE Necromancer_App SHALL apply it to the Gateway_State used by the running Gateway_Service before the next Inbound_Message is evaluated, without restarting the Gateway_Service.

### Requirement 16: Gemini API key on the gateway phone and free services

**User Story:** As an Operator, I want to paste my Gemini API key once on the phone and have it kept encrypted, so that the key is never bundled in the APK or the repository, stays private, and running the gateway costs nothing.

#### Acceptance Criteria

1. THE Necromancer_App SHALL obtain the Gemini_Api_Key only from the Operator through the Key_Input_Field, and SHALL read no environment variable, `.env` file, build configuration value or bundled asset for the Gemini_Api_Key or for a Gemini model name.
2. THE Necromancer_App debug APK and every Necromancer_App source file committed to the repository SHALL contain no Gemini_Api_Key value.
3. WHEN the Operator saves a value in the Key_Input_Field, THE Api_Key_Validator SHALL remove leading and trailing whitespace from the value and SHALL accept the trimmed value only if the trimmed value is 30 to 64 characters long and contains only the characters `A` to `Z`, `a` to `z`, `0` to `9`, `-` and `_`.
4. IF the Api_Key_Validator rejects a saved value, including an empty value or a value made only of whitespace, THEN THE Setup_Screen SHALL leave the Api_Key_Store unchanged and show a message stating that the value is not a valid Gemini API key and that a key is 30 to 64 letters, digits, hyphens or underscores, and the message SHALL contain no character of the entered value.
5. WHEN the Api_Key_Validator accepts a saved value, THE Native_Module SHALL write the trimmed value to the Api_Key_Store within 1 second, and THE Setup_Screen SHALL then clear the Key_Input_Field and show the text "key saved" together with the Masked_Key.
6. WHEN the Api_Key_Validator accepts a saved value while the Api_Key_Store already holds a Gemini_Api_Key, THE Native_Module SHALL replace the stored Gemini_Api_Key with the new value, and THE Necromancer_App SHALL use an AI_Client created with the new value for every Answer_Service call that starts after the write finishes.
7. WHEN the Operator taps the remove-key button on the Setup_Screen, THE Setup_Screen SHALL show a confirmation dialog with a confirm action and a cancel action.
8. WHEN the Operator confirms the confirmation dialog for removing the Gemini_Api_Key, THE Native_Module SHALL delete the Gemini_Api_Key from the Api_Key_Store within 1 second, and THE Necromancer_App SHALL apply criteria 18 and 19 to every Inbound_Message processed after the deletion.
9. IF the Operator cancels the confirmation dialog for removing the Gemini_Api_Key, THEN THE Necromancer_App SHALL leave the Api_Key_Store unchanged.
10. THE Key_Input_Field SHALL turn off autocorrect, text suggestions and automatic capitalisation, SHALL keep the entered text only in memory, and SHALL discard the entered text when the Operator saves the value or leaves the Setup_Screen.
11. THE Setup_Screen, the Main_Screen, the Settings_Screen and the persistent notification SHALL show a stored Gemini_Api_Key only as the Masked_Key, and the Key_Input_Field SHALL show no stored Gemini_Api_Key after a save.
12. THE Key_Masker SHALL return a Masked_Key made of the 4 characters `••••` followed by the last 4 characters of the Gemini_Api_Key.
13. FOR ALL values accepted by the Api_Key_Validator, THE Key_Masker SHALL return a Masked_Key of exactly 8 characters whose last 4 characters equal the last 4 characters of the Gemini_Api_Key and whose first 4 characters are `••••`, whatever the length of the Gemini_Api_Key (invariant property).
14. THE Necromancer_App SHALL write no character of the Gemini_Api_Key to Android logcat, JavaScript console output, the Activity_Log, the Gateway_State, the Settings, any notification or any committed file, and SHALL keep the Gemini_Api_Key in JavaScript memory only for creating the AI_Client.
15. WHEN the Necromancer_App starts or the Gateway_Service starts, including a start by the Boot_Receiver after the phone reboots, THE Native_Module SHALL read the Gemini_Api_Key from the Api_Key_Store and pass the Gemini_Api_Key in memory to the JavaScript code that creates the AI_Client, before the Gateway_Pipeline processes the first Inbound_Message.
16. WHEN the Necromancer_App is force-stopped and restarted or the phone reboots, THE Api_Key_Store SHALL return the same Gemini_Api_Key that was stored before the restart.
17. THE Necromancer_App SHALL create the AI_Client through the `@lazarus/brain/gemini` entry point, passing the Gemini_Api_Key read from the Api_Key_Store as an explicit value and passing no model name, so that the `@lazarus/brain/gemini` entry point uses its default free-tier model and reads no process environment variable, and SHALL pass that AI_Client to the Answer_Service for every QUESTION and SCAM message.
18. WHILE the Api_Key_Store holds no readable Gemini_Api_Key, THE Gateway_Pipeline SHALL use the Try_Later_Text in the Language of the Routed_Command as the Reply_Text for QUESTION messages with an argument containing at least 1 non-whitespace character and for SCAM messages whose `argumentMissing` is false, SHALL make no AI_Client call, and SHALL handle HELP, STOP, START, REMIND, TRANSLATE, SCAM with a missing argument and QUESTION with an empty argument the same way as when a Gemini_Api_Key is stored.
19. WHILE the Api_Key_Store holds no readable Gemini_Api_Key, THE Main_Screen SHALL show a message stating that the AI key is missing and that questions get a busy reply, together with a button that opens the Setup_Screen at the AI key Setup_Step.
20. IF the Api_Key_Store cannot be opened, the Android Keystore key is missing, or the stored Gemini_Api_Key cannot be decrypted, THEN THE Native_Module SHALL report that no Gemini_Api_Key is stored, write exactly one logcat line stating the failure that contains no character of the Gemini_Api_Key, and THE Necromancer_App SHALL keep running without crashing, apply criteria 18 and 19, and show under the AI key Setup_Step a message telling the Operator to paste the Gemini_Api_Key again.
21. WHEN the Operator saves a value accepted by the Api_Key_Validator after the failure in criterion 20, THE Native_Module SHALL replace the unreadable Api_Key_Store data with the new Gemini_Api_Key.
22. THE Necromancer_App SHALL exclude the Api_Key_Store from Android auto-backup and from device-to-device transfer, and SHALL keep the Api_Key_Store only in the Necromancer_App's private storage, so that Android deletes the Gemini_Api_Key when the Operator uninstalls the Necromancer_App.
23. THE Necromancer_App SHALL send network requests only to the Gemini API, SHALL send SMS only through the Sms_Sender using the phone's own SIM, and SHALL show no account sign-in screen and call no paid SMS gateway or paid AI service.
24. THE repository `.gitignore` file SHALL list the `.env` file. The `GEMINI_API_KEY` and `GEMINI_MODEL` entries in `.env.example` belong to `packages/brain`, and THE Necromancer_App SHALL read none of the variables listed in `.env.example`.

### Requirement 17: Platform, build and code quality

**User Story:** As a maintainer, I want the app built for the target phone and held to the project's code rules, so that it installs and runs reliably on the Xiaomi gateway phone.

#### Acceptance Criteria

1. THE Necromancer_App SHALL set the Android minimum SDK to 26, the target SDK to 35 (Android 15) and the compile SDK to at least 35.
2. WHEN the maintainer runs the debug build command documented in the Necromancer_App README, THE Necromancer_App build SHALL finish with zero build errors and produce one debug APK.
3. WHEN the Operator sideloads the debug APK on a Xiaomi phone running Android 15 (HyperOS) and opens the Necromancer_App for the first time, THE Necromancer_App SHALL install without an install error and show the Permission_Screen or the Setup_Screen within 10 seconds without crashing.
4. THE Necromancer_App SHALL declare the RECEIVE_SMS, SEND_SMS, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, FOREGROUND_SERVICE, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS and INTERNET permissions, and SHALL declare a foreground service type on the Gateway_Service together with the matching foreground service type permission that Android 15 requires for that type.
5. THE Necromancer_App SHALL not declare the READ_SMS, WRITE_SMS, READ_CONTACTS, ACCESS_FINE_LOCATION or ACCESS_COARSE_LOCATION permissions.
6. THE Necromancer_App TypeScript code and the Gateway_Module SHALL compile under TypeScript strict mode with zero errors, and SHALL contain zero uses of the `any` type, either as an explicit type annotation or as a type assertion.
7. THE Necromancer_App SHALL import the Command_Router, the Answer_Service, the SMS_Splitter and the Gateway_Module from `@lazarus/brain`, and SHALL contain no copy of their logic: no function of its own that classifies Commands, detects Language, produces a Reply_Text, splits a Reply_Text into Reply_Parts, decides an Outcome, normalizes, prints or masks a Sender_Address, applies the Per_Number_Limit or the Daily_Send_Cap, derives a Heartbeat_State, serializes Settings, or validates or masks a Gemini_Api_Key. The Stop_Keyword_Check of Requirement 9 criterion 13 and the logcat masking of Requirement 1 criterion 9, Requirement 9 criterion 14 and Requirement 14 criterion 14 are the only exceptions, and the Stop_Keyword_Check SHALL use the Stop_Alias_List exported by `@lazarus/brain` with no separately maintained keyword list.
8. THE Main_Screen, the Permission_Screen, the Setup_Screen and the Settings_Screen SHALL render every text element at a font size of at least 16 sp, with a contrast ratio of at least 4.5:1 between the text colour and its background colour, and SHALL give every icon and every button a non-empty accessibility label.
9. THE Main_Screen, the Permission_Screen, the Setup_Screen and the Settings_Screen SHALL use only the colours from the design steering file: background `#0B0F0C`, surface `#141A16`, text `#E6F2E9`, muted `#8FA396`, soul green `#39FF88`, ember `#FFB347` and blood `#FF4D5E`; SHALL use a corner radius of 14 for rounded elements; and SHALL use only the spacing values 4, 8, 12, 16, 24 and 32 for padding, margins and gaps.
10. WHEN the maintainer runs the `packages/brain` Vitest tests in single-run mode and the `apps/necromancer` Jest tests, THE Brain_Test_Suite and THE App_Test_Suite SHALL each finish with zero failing tests, and THE Brain_Test_Suite SHALL include tests for the Gateway_Pipeline, the Rate_Limiter, the Number_Normalizer, the Number_Printer, the Number_Masker, the Sender_Masker, the Heartbeat_Model, the Settings_Serializer, the Api_Key_Validator and the Key_Masker.
11. THE Necromancer_App source files committed to the repository and the debug APK SHALL contain no API key value, and THE Necromancer_App SHALL obtain the Gemini_Api_Key only from the Api_Key_Store under Requirement 16.
12. THE Necromancer_App README SHALL contain a "Known limitations" section that states each limitation listed under Known limitations in the Introduction of this document, including that during generic radio failures or no-service conditions the 60-second Send_Timeout and the 30-second retry wait can delay later replies beyond 30 seconds after their receive time.

### Requirement 18: Test coverage

**User Story:** As a maintainer, I want the gateway's safety rules verified by automated tests, so that STOP, rate limits and privacy cannot silently break.

#### Acceptance Criteria

1. THE Brain_Test_Suite SHALL test the Gateway_Pipeline, the Number_Normalizer, the Number_Printer, the Number_Masker, the Sender_Masker, the Rate_Limiter, the Heartbeat_Model, the Settings_Serializer, the Api_Key_Validator, the Key_Masker and the Fixed_Gateway_Texts in `packages/brain` with Vitest in a Node process, without a device, emulator, network or real system clock, by passing every receive time and current time to the code under test as an explicit value in milliseconds since the Unix epoch.
2. THE Brain_Test_Suite SHALL include one fast-check property for each of Requirement 2.6, 2.8, 2.10, 3.10, 5.5, 5.6, 7.4, 13.4, 14.8, 15.4 and 16.13, each configured to run at least 100 iterations, with the requirement number in the test name.
3. THE Brain_Test_Suite SHALL replace the AI_Client with the Mock_Client exported by `@lazarus/brain` and the Sms_Sender with a test double that records each requested send, so that no test sends an SMS or calls the network, and SHALL include at least one test asserting that the arguments recorded by the Mock_Client contain no Sender_Address, Canonical_Number, Masked_Number or Masked_Sender (Requirement 6.9).
4. THE Brain_Test_Suite SHALL include at least one example test for each of the 11 Outcomes and each of the 7 Sleep_Reasons, and each Outcome test SHALL assert both the recorded Outcome and the number of Reply_Parts produced (0 to 4).
5. IF any test fails when the maintainer runs the `packages/brain` Vitest test command in single-run mode, THEN THE Brain_Test_Suite SHALL exit with a non-zero status and, for each failed fast-check property, report the shrunk counterexample and the seed that reproduces the failure.
6. WHEN the maintainer runs the `packages/brain` Vitest test command in single-run mode and every test passes, THE Brain_Test_Suite SHALL exit with status 0 within 120 seconds on the maintainer's development machine.
7. THE Brain_Test_Suite SHALL include example tests for the STOP safety rules: a STOP added to the Stop_List while Allowlist_Mode is on and the sender is not on the Allowlist, while the sender is over the Per_Number_Limit, while the Daily_Send_Cap is reached, and while the Operator has paused the gateway (Requirement 3.2 and 9.11); the Sms_Sender test double reporting `refused-stopped` for a Canonical_Number on the Stop_List with the Outcome `ignored-stopped` recorded (Requirement 3.8); a START from a non-allowlisted Canonical_Number on the Stop_List while Allowlist_Mode is on (Requirement 4.8); a START from a Canonical_Number on the Stop_List while Allowlist_Mode is on and the Allowlist cannot be read, removing the Canonical_Number from the Stop_List with the Outcome `started` and 0 Reply_Parts (Requirement 4.11), and a non-START, non-STOP message in the same state recording `ignored-not-allowed` (Requirement 4.9); and the check order of Requirement 7.3, with one test for each adjacent pair of checks in that order.
8. THE Brain_Test_Suite SHALL include boundary example tests in which the Rate_Limiter accepts message number Per_Number_Limit and rejects message number Per_Number_Limit + 1 within one Rate_Window; accepts again at the first receive time outside the Rate_Window of the oldest accepted message; and in which the Gateway_Pipeline sends Reply_Parts that bring today's sent count exactly to the Daily_Send_Cap and records `send-capped` when the Reply_Parts would exceed the Daily_Send_Cap by 1 or more SMS parts.
9. THE Brain_Test_Suite SHALL include example tests in which no Gemini_Api_Key is available: a QUESTION with an argument and a SCAM with an argument each produce the Reply_Parts of the Try_Later_Text with 0 calls recorded by the Mock_Client, and HELP, STOP and START produce the same Outcome and Reply_Parts as when a Gemini_Api_Key is available (Requirement 16.18).
10. THE Brain_Test_Suite SHALL include boundary example tests in which the Api_Key_Validator accepts trimmed values of 30 and 64 characters, rejects trimmed values of 29 and 65 characters, rejects an empty value, a value made only of whitespace and a value containing a character outside `A` to `Z`, `a` to `z`, `0` to `9`, `-` and `_`, and accepts a valid value surrounded by spaces (Requirement 16.3).
11. THE App_Test_Suite SHALL run under Jest in a Node process with the Native_Module replaced by a mock, without a device, emulator, network or real Api_Key_Store, and SHALL make no AI_Client call to the Gemini API.
12. THE App_Test_Suite SHALL include tests for the start screen order of Requirement 12.13, the done marks of the 6 Setup_Steps, the Key_Input_Field being cleared after a save and the Masked_Key shown in place of the Gemini_Api_Key (Requirement 16.5 and 16.11), the remove-key confirmation dialog (Requirement 16.7 to 16.9), the missing-key message on the Main_Screen (Requirement 16.19), and the Native_Module mock reporting an Api_Key_Store read failure without the Necromancer_App crashing (Requirement 16.20).
13. THE Brain_Test_Suite SHALL include example tests in which the Gateway_Pipeline applies a Pending_Stop_Record: a Phone_Number Sender_Address is added to the Stop_List with the Outcome `stopped` and 0 Reply_Parts; an Automated_Sender records `ignored-automated` and an Own_Number match records `ignored-own-number`, each with the Stop_List unchanged (Requirement 9.15); and SHALL include one test asserting that the Stop_Alias_List equals the keywords of the Command_Router alias table that map to STOP.
14. THE App_Test_Suite SHALL include tests, using the Native_Module mock, in which: a Pending_Stop_Record written for a STOP received while paused holds exactly the Sender_Address, the STOP_Marker and the receive time, and contains no character of a body text that has a tail after the STOP keyword (Requirement 9.13 and 14.13); a persisted Pending_Stop_Record is applied before the next Inbound_Message, both a live Inbound_Message and one from the Pending_Inbox, is processed (Requirement 9.15); the Pending_Stop_Record is deleted after it is applied and the Stop_List change is persisted, and is kept when persisting the Stop_List fails (Requirement 9.16); and a message received while paused that the Paused_Path_Task routes to a Command other than STOP records `ignored-paused` and leaves no Pending_Stop_Record (Requirement 9.10).
15. WHEN the maintainer runs the `apps/necromancer` Jest test command and any test fails, THE App_Test_Suite SHALL exit with a non-zero status, and WHEN every test passes, THE App_Test_Suite SHALL exit with status 0.
