# Implementation Plan: SMS Reminders

## Overview

Build REMIND, LIST and CANCEL in three layers, in this order:

1. The pure Reminder_Module in `packages/brain/src` (TypeScript, strict mode, no `any`): LIST and CANCEL routing, reminder types and the `reminders` field on `GatewayState`, Pakistan_Time clock, Time_Parser, Time_Printer, Due_Time_Resolver, Reminder_Store_Model, Reminder_Texts, List_Formatter, pipeline integration (including STOP removing every reminder of the number), Delivery_Decision, the state wire format and the package exports. Tests use Vitest and fast-check 4.10.2. Every property runs at least 100 iterations through `REMINDER_PBT_OPTIONS`, is one `it(...)` whose name starts with the requirement number (for example `3.8 Due_Time is later than the receive time and within 30 days`) and carries the tag comment `// Feature: sms-reminders, Property N: <title>`. No test reads the real clock; every receive time and current time is an explicit millisecond value. Brain tasks end with `npx vitest --run` passing in `packages/brain`.
2. The Kotlin Native_Module in `apps/necromancer/android`: schema version 2 with the `reminder` table and a savepoint migration, the four new change types in `StoreWire`/`StoreSql`, `ReminderScheduler` with exact or inexact alarms, the alarm and system-event receivers, `BootReceiver` re-arming, `ReminderModule` and the manifest. Kotlin JVM tests (`./gradlew testDebugUnitTest`) cover the pure policy, the scheduler with a fake alarm port, and the migration on real SQLite through `sqlite-jdbc`.
3. The JS glue and UI in `apps/necromancer/src`: the `RemindersPort`, the reminders runner, the loop's "run due reminders" work item, the Main_Screen reminder count and banners. Jest tests run with the Native_Module mocked. The app contains no time parsing, slot, formatting or delivery logic of its own (Requirement 11.12).

Optional marking: test sub-tasks marked `*` may be skipped for a faster MVP. Test sub-tasks that Requirement 14 names, tests that keep existing suites green after the `GatewayState`, Command and STOP changes, and the safety-critical properties (STOP removes all reminders, STOP always wins, delivery check order, Daily_Send_Cap, privacy) stay required.

## Tasks

- [x] 1. Route LIST and CANCEL
  - [x] 1.1 Add LIST and CANCEL to the Command_Router
    - `router.types.ts`: `COMMANDS` becomes the 9 values `HELP, STOP, START, SCAM, REMIND, TRANSLATE, LIST, CANCEL, QUESTION`
    - `aliases.ts`: `ALIAS_TABLE` adds `list`, `fehrist`, `فہرست` → LIST and `cancel`, `mansookh`, `منسوخ` → CANCEL; `ROMAN_URDU_ALIASES` adds `fehrist`, `mansookh`; `ENGLISH_KEYWORD` adds `LIST` and `CANCEL`
    - `router.ts`: small `strictForm(command, rest, text, language)` with `SLOT_TOKEN = /^[0-9\u06F0-\u06F9]{1,3}$/`, called after the alias lookup only for LIST and CANCEL; STOP lookup stays first; `printer.ts` needs no code change
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 1.11_

  - [x] 1.2 Update existing router tests and arbitraries for the 9 Commands
    - `router.arbitraries.ts` (Command and keyword arbitraries include LIST and CANCEL), `router.unit.test.ts`, `router.property.test.ts`, `router.argmissing.property.test.ts`, `router.exports.test.ts`: expectations for the Command count and for bodies such as `list ...` or `cancel ...` that used to route to QUESTION
    - Every existing Command_Router test must still pass
    - _Requirements: 1.7, 1.11, 14.6_

  - [x] 1.3 Write property test for strict LIST and CANCEL routing
    - File `router.listcancel.property.test.ts`; test name starts with `1.12`
    - **Property 1: LIST and CANCEL route only in their strict form**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.12**

  - [x] 1.4 Write property test for the LIST/CANCEL print and route round trip
    - File `router.listcancel.roundtrip.property.test.ts`; test name starts with `1.9`
    - **Property 2: LIST and CANCEL print and route round trip**
    - **Validates: Requirements 1.8, 1.9**

  - [x] 1.5 Write property test for router totality and STOP precedence
    - File `router.listcancel.total.property.test.ts`
    - **Property 3: Router stays total and STOP keeps precedence**
    - **Validates: Requirements 1.7, 1.11**

  - [x] 1.6 Write unit tests for LIST and CANCEL routing examples
    - File `router.listcancel.unit.test.ts`: `LIST`, `list?`, `fehrist` (`roman-ur`), `فہرست` (`ur`) → LIST; `list of foods` → QUESTION; `CANCEL 2` → argument `2`; `cancel ۲` → argument `۲`; `CANCEL` → `argumentMissing` true; `cancel my order`, `cancel 2 3`, `CANCEL 1234`, `cancel 2.` → QUESTION; `stop list`, `stop cancel 2` → STOP
    - _Requirements: 1.5, 1.7, 1.10, 14.6_

- [x] 2. Add reminder types, the Reminder_Store_Model fold and shared arbitraries
  - [x] 2.1 Create `reminder.types.ts`
    - `ReminderId` (branded), `ReminderSlot`, `Reminder` (with `handedAt`), `ReminderState` (`ok` / `unreadable`), `EMPTY_REMINDERS`, `DayWord`, `DayPeriod`, `TimeExpression`, `ParseResult`, `ResolveResult`, `DELIVERY_OUTCOMES`, `DeliveryOutcome`, `DeliveryStep`
    - Constants `REMINDER_LIMIT = 5`, `PK_OFFSET_MS = 18_000_000`, `REMINDER_HORIZON_MS = 2_592_000_000`, `LATE_WINDOW_MS = 3_600_000`, `REMINDER_TEXT_MAX = 140` (UTF-16 code units)
    - _Requirements: 3.1, 3.7, 5.1, 10.3, 10.10, 12.1_

  - [x] 2.2 Extend `GatewayState` and `StateChange`, and add the store fold
    - `gateway.types.ts`: required `reminders: ReminderState` on `GatewayState`; `StateChange` variants `reminder-add`, `reminder-remove`, `reminder-remove-all`, `reminder-handed`; `ActivityEntry.outcome` widened to `Outcome | DeliveryOutcome | 'reminders-failed'`; `ACTIVITY_OUTCOMES`; update the "no StateChange holds the body" comment to name the `reminder-add` exception
    - Move `notAllowed(number, state)` unchanged from `gateway.pipeline.ts` into new `gateway.checks.ts`
    - `reminder.store.ts`: `activeFor`, `lowestFreeSlot`, `findBySlot`, `dueReminders` (not handed, `dueAt <= now`, sorted by `(dueAt, id)`), `nextDueAt`, `applyReminderChange` (unreadable stays unreadable; `reminder-add` applied only below the limit and on a free slot)
    - `applyChange` in `gateway.pipeline.ts` delegates the four new change types to `applyReminderChange`
    - _Requirements: 5.1, 5.13, 7.5, 7.6, 8.1, 10.8, 10.11, 11.4, 12.7_

  - [x] 2.3 Create `reminder.arbitraries.ts`
    - `REMINDER_PBT_OPTIONS = { numRuns: 100 }`; `timeExpression` (valid values only, per Requirement 4.4), `reminderText` (1 to 140 UTF-16 code units of Latin, Urdu, digits, emoji, spaces; trimmed; long draws cut at the limit), `printableReminderText` (first-token filter of Property 9), `receiveTime` (0 to 4,102,444,800,000), `reminder`, `reminderStore(pool)` (at most 5 per number, distinct slots), `surfaceVariant(text)`, `slotSpelling(n)`
    - Not exported from `index.ts`
    - _Requirements: 4.4, 14.1, 14.2_

  - [x] 2.4 Update existing fixtures for the new `reminders` field
    - `gateway.arbitraries.ts`: `gatewayState()` defaults to `EMPTY_REMINDERS` and takes an optional reminder store arbitrary
    - `gateway.state.ts`: `decodeStoredState` sets `reminders: { status: 'unreadable' }` until task 12.1 adds `decodeReminders` (the documented result for a missing key)
    - Add `reminders: EMPTY_REMINDERS` to every hand-built `GatewayState` in brain tests (for example `gateway.pipeline.smoke.test.ts`, `gateway.pipeline.outcomes.unit.test.ts`, `gateway.pipeline.safety.unit.test.ts`, `gateway.pipeline.cap.unit.test.ts`, `gateway.pipeline.calls.unit.test.ts`, `gateway.pending.unit.test.ts`, `gateway.state.unit.test.ts`) and in any `apps/necromancer/__tests__` fixture flagged by `tsc --noEmit`
    - `tsc --noEmit` passes in `packages/brain` and `apps/necromancer`; every existing test still passes
    - _Requirements: 12.7, 14.9_

  - [x] 2.5 Write unit tests for the Reminder_Store_Model
    - File `reminder.store.unit.test.ts`: `lowestFreeSlot` with gaps and with 5 used; `reminder-add` on a used slot or a sixth reminder is ignored; `reminder-remove-all` keeps other numbers; every change on an `unreadable` store leaves it `unreadable`; `nextDueAt` skips handed reminders
    - _Requirements: 5.1, 5.13, 7.5, 7.6, 8.2_

- [x] 3. Implement the Pakistan_Time clock
  - [x] 3.1 Create `reminder.clock.ts`
    - `DAY_MS`, `pkDayStart(t)` and `pkWallClock(t)` (hour, minute, day of month, month) with integer arithmetic on epoch milliseconds; no `Date` object
    - _Requirements: 3.1, 3.2_

  - [x] 3.2 Write unit tests for the clock
    - File `reminder.clock.unit.test.ts`: `pkDayStart` at 18:59:59.999Z and 19:00:00.000Z; `pkWallClock` for 2025-01-15T05:00:00Z is 10:00 on 15 Jan
    - _Requirements: 3.1, 3.2_

- [x] 4. Implement the Time_Parser
  - [x] 4.1 Create `reminder.parse.ts`
    - Tokenizer on `/[ \t\n]+/` keeping end offsets; `toDigitValue` for ASCII and Extended Arabic-Indic digits; small matchers for Day_Word, Day_Period, Filler_Word, units, `am`/`pm` (whole tokens only, Latin lowercased)
    - Grammar of the design: `relative`, `dayWord? clockPart`, period ranges (morning 1–12, evening 1–11, night 6–11), period dropped after `am`/`pm` or hour 0 / 13–23, default period times 09:00, 18:00, 21:00, at most one Filler_Word per position
    - `parseReminder(argument)`: longest valid expression, Reminder_Text sliced from the original argument and trimmed, `no-time` / `no-text` / `text-too-long` (count UTF-16 code units with `text.length`); no throw, no state
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17_

  - [x] 4.2 Write property test that parse never throws
    - File `reminder.parse.total.property.test.ts`; test name starts with `2.16`; inputs include empty, whitespace-only, lone surrogates and strings longer than 10,000 characters
    - **Property 4: Time_Parser never throws**
    - **Validates: Requirements 2.16**

  - [x] 4.3 Write property test that parse is deterministic
    - File `reminder.parse.determinism.property.test.ts`; test name starts with `2.17`
    - **Property 5: Time_Parser is deterministic**
    - **Validates: Requirements 2.17**

  - [x] 4.4 Write property test for Day_Period bare hours
    - File `reminder.parse.period.property.test.ts`
    - **Property 7: Bare hours follow the Day_Period ranges**
    - **Validates: Requirements 2.5, 2.6, 2.12**

  - [x] 4.5 Write property test for 12-hour clocks
    - File `reminder.parse.clock12.property.test.ts`
    - **Property 8: 12-hour clocks map to the right 24-hour time**
    - **Validates: Requirements 2.3**

  - [x] 4.6 Write unit tests for parser examples and boundaries
    - File `reminder.parse.unit.test.ts`: `subah 8pm` → 20:00 with no period; `shaam` alone → 18:00; `shaam ko 6 baje x`; `at 8pm x`; `kalam`, `subahdam`, `8pmx` do not match; `no-time` for `13pm`, `20:00pm`, `kal`, `raat 3`, `in 0 hours`, `in 1234567 minutes`, `9 take medicine`; `8pm` → `no-text`; 70 emoji (140 UTF-16 code units) and 140 Urdu letters accepted, 70 emoji plus 1 letter (141 units) → `text-too-long`
    - _Requirements: 2.2, 2.7, 2.8, 2.11, 2.12, 2.14, 2.15, 14.3, 14.4_

- [x] 5. Implement the Time_Printer
  - [x] 5.1 Create `reminder.print.ts`
    - `printTimeExpression(expr)` per Requirement 4.1 (`[today|tomorrow] [morning|evening|night] [H:MM]` or `in N unit(s)`; period hour printed as `hour - 12` for 13–23)
    - `isValidTimeExpression(expr)` per Requirement 4.4
    - _Requirements: 4.1, 4.4, 4.5_

  - [x] 5.2 Write property test for the Time_Printer round trip
    - File `reminder.print.roundtrip.property.test.ts`; test name starts with `4.2`
    - **Property 9: Time_Printer round trip**
    - **Validates: Requirements 4.2, 4.4, 2.4, 2.9, 2.10, 2.13**

  - [x] 5.3 Write property test for surface form independence
    - File `reminder.parse.surface.property.test.ts`
    - **Property 6: Surface form does not change the parse**
    - **Validates: Requirements 2.1, 2.2, 2.11**

  - [x] 5.4 Write property test for printer length, totality and format
    - File `reminder.print.total.property.test.ts`
    - **Property 11: Printer output is short, total and stable**
    - **Validates: Requirements 4.1, 4.5**

  - [x] 5.5 Write unit tests for the printer
    - File `reminder.print.unit.test.ts`: `evening 6:00`, `tomorrow morning 12:59`, `in 1 hour`, `in 999999 minutes`; `isValidTimeExpression` accepts every result of the task 4.6 examples and rejects hour 24, minute 60, evening with hour 9, N 0
    - _Requirements: 4.1, 4.4_

- [x] 6. Implement the Due_Time_Resolver
  - [x] 6.1 Create `reminder.resolve.ts`
    - `resolveDueTime(expr, receivedAt)`: relative durations checked against the horizon before multiplying (no overflow); clock and period times on the Pakistan_Time day with seconds and ms 0; `tomorrow` next day; `today` → `past` when at or before the receive time; no Day_Word → today if later, else tomorrow; `too-far` beyond `REMINDER_HORIZON_MS`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10_

  - [x] 6.2 Write property test that Due_Time is in the future and within 30 days
    - File `reminder.resolve.horizon.property.test.ts`; test name starts with `3.8`
    - **Property 12: Due_Time is in the future and within 30 days**
    - **Validates: Requirements 3.8**

  - [x] 6.3 Write property test that the resolver never throws and is deterministic
    - File `reminder.resolve.total.property.test.ts`; test name starts with `3.9`
    - **Property 13: Due_Time_Resolver never throws and is deterministic**
    - **Validates: Requirements 3.9, 3.10**

  - [x] 6.4 Write property test that printed and original expressions resolve the same
    - File `reminder.print.resolve.property.test.ts`; test name starts with `4.3`
    - **Property 10: Printed and original expressions resolve the same**
    - **Validates: Requirements 4.3**

  - [x] 6.5 Write property test for the wall-clock day and minute
    - File `reminder.resolve.wallclock.property.test.ts`
    - **Property 14: Clock and period times land on the right Pakistan_Time day and minute**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.11**

  - [x] 6.6 Write property test for relative durations
    - File `reminder.resolve.relative.property.test.ts`
    - **Property 15: Relative durations add exactly**
    - **Validates: Requirements 3.5, 3.7**

  - [x] 6.7 Write example tests for routing, parsing and resolving together
    - File `reminder.resolve.unit.test.ts`, receive time 2025-01-15T05:00:00Z: `REMIND 8pm take medicine` and `REMIND 20:00 call Ali` → 2025-01-15 20:00 PKT; `YAAD kal subah 9 dawai` → 2025-01-16 09:00; `REMIND in 2 hours drink water` → +7,200,000; `یاد شام کو دوا لینی ہے` → 18:00 with text `دوا لینی ہے`; `today 8am x` → `past`; `in 31 days x` → `too-far`; `in 30 days x` accepted at exactly the horizon; `in 43201 minutes x` → `too-far`
    - Day boundaries: `tomorrow 8am x` at 2025-01-15T18:30:00Z → 2025-01-16 08:00 PKT; `8pm x` at exactly 2025-01-15 20:00:00 PKT → 2025-01-16 20:00; the 3.1 example
    - _Requirements: 3.1, 3.3, 3.4, 3.7, 14.3, 14.4, 14.5_

  - [x] 6.8 Write the process time zone test
    - File `reminder.resolve.tz.test.ts`: run a small script in child processes with `TZ=UTC` and `TZ=America/New_York` that resolves the task 6.7 cases, and assert equal Due_Times
    - _Requirements: 3.1, 14.5_

- [x] 7. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npx tsc --noEmit` in `packages/brain`. Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the Reminder_Texts and the Help_Text update
  - [x] 8.1 Create `reminder.texts.ts` and add `formatWhen` to `reminder.clock.ts`
    - `ReminderTexts` and `REMINDER_TEXTS` for `en`, `roman-ur`, `ur` with the design's draft wording, `timeHelpExamples`, `cancelExample`, `deliveryLead`, `listLead`, `months`
    - `formatWhen(dueAt, language)`: `D Mon H:MM` with `Jan`…`Dec` or `جنوری`…`دسمبر`, 24-hour clock, minutes 2 digits
    - Shorten wording where the task 8.3 tests show more than 1 part
    - _Requirements: 5.2, 5.3, 5.5, 5.7, 5.8, 7.3, 7.4, 9.1, 9.2, 9.3, 9.4, 9.6_

  - [x] 8.2 Update the Help_Text in `gateway.texts.ts` and its tests
    - Help_Text names REMIND as available and keeps TRANSLATE "coming soon"; the `ur` Help_Text uses `فہرست` only as the LIST keyword
    - Extend the keywords-in-texts check in `gateway.texts.unit.test.ts` to LIST and CANCEL; `en`/`roman-ur` 1 part, `ur` at most 2
    - _Requirements: 9.8, 9.6_

  - [x] 8.3 Write exhaustive unit tests for the Reminder_Texts
    - File `reminder.texts.unit.test.ts`: every item in 3 Languages non-empty with no newline; `en`/`roman-ur` GSM-7 basic only; `ur` Urdu script plus digits, spaces, punctuation and keywords; 1 Reply_Part for every item except Time_Help_Text and the lead-in, with slots 1 to 5, all 31 days, 12 months and 00:00, 12:59, 23:59 for the Reminder_Set_Text; Time_Help_Text has at least 2 examples and 1 or 2 parts; every keyword in a text routes to its Command in that Language; `cancelExample` routes to CANCEL with 1 to 5; no `set` text contains the Reminder_Text
    - _Requirements: 5.2, 9.1, 9.2, 9.3, 9.4, 9.6_

  - [x] 8.4 Write property test that Time_Help examples always resolve
    - File `reminder.texts.examples.property.test.ts`
    - **Property 27: Time_Help examples always resolve**
    - **Validates: Requirements 9.5**

  - [x] 8.5 Write property test that the Reminder_Delivery_Text fits 1 to 3 parts
    - File `reminder.texts.delivery.property.test.ts`; test name starts with `9.7`
    - **Property 28: Reminder_Delivery_Text fits 1 to 3 parts**
    - **Validates: Requirements 9.7**

- [x] 9. Implement the List_Formatter
  - [x] 9.1 Create `reminder.list.ts`
    - `formatReminderList(reminders, language, split = splitSms)`: sort by `(dueAt, slot)`; entries `<slot>) <when> <preview>` joined by `; ` after `listLead`; one shared preview length starting at 20 and shrinking to 0 until the reply gives at most 3 parts; previews are leading code points, unchanged
    - _Requirements: 6.2, 6.3, 6.4, 6.6_

  - [x] 9.2 Write property test that LIST replies fit 3 parts and show every reminder
    - File `reminder.list.parts.property.test.ts`; test name starts with `6.4`
    - **Property 20: LIST replies fit 3 parts and show every reminder**
    - **Validates: Requirements 6.2, 6.3, 6.4**

  - [x] 9.3 Write unit tests for the List_Formatter
    - File `reminder.list.unit.test.ts`: short texts shown whole; equal Due_Times ordered by slot; 5 reminders of 140 UTF-16 code units of UCS-2 text shrink the preview; preview length 0 keeps every slot and time
    - _Requirements: 6.2, 6.3_

- [x] 10. Integrate REMIND, LIST, CANCEL and STOP removal into the Gateway_Pipeline
  - [x] 10.1 Create `reminder.pipeline.ts`
    - `reminderReply(routed, number, messageId, receivedAt, reminders, split)`: unreadable → Reminders_Unavailable_Text; REMIND: limit check before parsing, parse errors and resolver errors to their texts, `reminder-add` with id `r:<messageId>`, the sender's number, the lowest free slot and the Reminder_Set_Text; LIST: No_Reminders_Text or `formatReminderList(activeFor(...))`; CANCEL: Cancel_Usage_Text, `reminder-remove` and Reminder_Cancelled_Text, or No_Such_Reminder_Text
    - `parseSlotArgument`, `cappedReminderChanges` (CANCEL still removes at the cap), `reminderWriteFailed(decision, split)`
    - Keep each function small: one helper per Command
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.12, 5.14, 6.1, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 12.7, 12.11_

  - [x] 10.2 Wire reminders and STOP removal into `gateway.pipeline.ts` and `gateway.pending.ts`
    - `replyFor`: REMIND with `argumentMissing` keeps the usage hint; REMIND, LIST, CANCEL otherwise use `reminderReply`; TRANSLATE keeps the Not_Available_Text
    - `evaluateLimits`: `send-capped` at `handed >= cap` adds `cappedReminderChanges`; `completeReply`: when the cap blocks the parts, drop `reminder-add` and keep `reminder-remove`
    - STOP in `evaluateRouted` and `evaluatePaused` and in `applyPendingStop` emits `[stop-add, reminder-remove-all]` for the number, whether or not the store lists a reminder; START restores nothing
    - _Requirements: 5.9, 5.10, 5.11, 7.7, 8.1, 8.2, 8.5, 9.9, 9.10_

  - [x] 10.3 Update existing pipeline tests for the new STOP change list and REMIND replies
    - STOP expectations now include `reminder-remove-all` in `gateway.pipeline.stopstate.property.test.ts`, `gateway.pipeline.safety.unit.test.ts`, `gateway.pipeline.outcomes.unit.test.ts`, `gateway.pipeline.smoke.test.ts`, `gateway.pipeline.start.property.test.ts`, `gateway.pipeline.paused.property.test.ts`, `gateway.pending.unit.test.ts`, `gateway.pending.apply.property.test.ts`
    - `gateway.pipeline.replysource.property.test.ts`: REMIND, LIST, CANCEL use the reminder replies, not the Not_Available_Text
    - `gateway.pipeline.nobody.property.test.ts`: allow the Reminder_Text only inside `reminder-add` of a REMIND message; every other change still holds no body
    - `gateway.pipeline.parts.property.test.ts`, `gateway.pipeline.earlyexit.property.test.ts`, `gateway.pipeline.nokey.property.test.ts`: adjust only where LIST, CANCEL or REMIND now take the reminder path
    - _Requirements: 8.1, 9.9, 14.6, 14.9_

  - [x] 10.4 Write property test that STOP removes all reminders for that number
    - File `reminder.pipeline.stop.property.test.ts`; test name starts with `8.3`; covers live, paused and Pending_Stop_Record STOP and readable and unreadable stores
    - **Property 24: STOP removes all reminders for that number**
    - **Validates: Requirements 8.1, 8.2, 8.3**

  - [x] 10.5 Write property test for the Reminder_Limit and distinct slots over any sequence
    - File `reminder.pipeline.slots.property.test.ts`; test name starts with `5.13`
    - **Property 18: Reminder_Limit and distinct slots hold over any sequence**
    - **Validates: Requirements 5.13**

  - [x] 10.6 Write property test for a successful REMIND
    - File `reminder.pipeline.remind.property.test.ts`
    - **Property 16: A successful REMIND adds one correct reminder**
    - **Validates: Requirements 5.1, 5.2, 5.12, 7.6**

  - [x] 10.7 Write property test that the Reminder_Limit is checked first
    - File `reminder.pipeline.limit.property.test.ts`
    - **Property 17: The Reminder_Limit is checked first**
    - **Validates: Requirements 5.8, 5.14**

  - [x] 10.8 Write property test that reminder commands are local and respect early exits
    - File `reminder.pipeline.local.property.test.ts`
    - **Property 19: Reminder commands are local and respect early exits**
    - **Validates: Requirements 5.9, 5.10, 9.9**

  - [x] 10.9 Write property test that LIST shows only the sender's reminders
    - File `reminder.pipeline.listprivacy.property.test.ts`
    - **Property 21: LIST shows only the sender's reminders and changes nothing**
    - **Validates: Requirements 6.6, 6.7**

  - [x] 10.10 Write property test for CANCEL
    - File `reminder.pipeline.cancel.property.test.ts`
    - **Property 22: CANCEL removes at most one reminder, the sender's slot n**
    - **Validates: Requirements 7.1, 7.3, 7.5, 7.8**

  - [x] 10.11 Write property test for slot arguments
    - File `reminder.pipeline.slotarg.property.test.ts`
    - **Property 23: Slot arguments read as base-10 numbers**
    - **Validates: Requirements 7.2**

  - [x] 10.12 Write unit tests for pipeline boundaries
    - File `reminder.pipeline.unit.test.ts`: sixth REMIND → Reminder_Limit_Text, no change; CANCEL 1 and 5 → Reminder_Cancelled_Text; CANCEL 0 and 6 → No_Such_Reminder_Text with every reminder unchanged; cap blocks a Reminder_Set_Text → `send-capped`, no `reminder-add`; cap blocks a Reminder_Cancelled_Text → `send-capped` with `reminder-remove`; unreadable store → Reminders_Unavailable_Text for all three Commands while STOP still emits `reminder-remove-all`; `reminderWriteFailed` result; STOP, START, LIST → No_Reminders_Text and next REMIND → slot 1; TRANSLATE still Not_Available_Text
    - _Requirements: 5.8, 5.11, 7.1, 7.3, 7.7, 8.5, 9.10, 12.7, 12.11, 14.4_

- [x] 11. Implement the Delivery_Decision and load reconciliation
  - [x] 11.1 Create `reminder.delivery.ts`
    - `decideDelivery(r, state, now, today, split?)`: `wait` if `dueAt > now`; then Stop_List, `notAllowed` from `gateway.checks.ts`, Late_Window (`now > dueAt + LATE_WINDOW_MS`), cap (`handed + parts > cap`); else `send` with `split(deliveryLead + text)` and changes `[reminder-handed, counters reserve]`; final steps carry `reminder-remove`; `rate` and `slowDown` untouched
    - `finalizeDelivery(r, partCount, report, counters, today)`: outcome mapping, release unsent parts from `handed`, add sent parts to `partsSent`, always `reminder-remove`
    - `buildDeliveryEntry(r, outcome, at)` with `maskNumber`, command `REMIND`, never reading `r.text`; `buildProcessingFailedEntry(at)` with no number
    - _Requirements: 8.4, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.13, 11.15, 13.1, 13.4_

  - [x] 11.2 Add `reconcileOnLoad` to `reminder.store.ts`
    - `reminder-remove-all` for each Stop_List number with reminders; for each handed reminder of a number not on the Stop_List, `reminder-remove` and one `reminder-failed` Activity_Entry
    - _Requirements: 8.8, 10.15_

  - [x] 11.3 Write property test for the delivery check-order model
    - File `reminder.delivery.model.property.test.ts`
    - **Property 29: Delivery_Decision matches the check-order model**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.9, 10.13, 8.4**

  - [x] 11.4 Write property test for exactly one Delivery_Outcome
    - File `reminder.delivery.outcome.property.test.ts`; test name starts with `10.10`
    - **Property 30: Exactly one Delivery_Outcome**
    - **Validates: Requirements 10.10**

  - [x] 11.5 Write property test that STOP always wins for reminders
    - File `reminder.delivery.stopwins.property.test.ts`; test name starts with `8.7`; includes reminders due before the STOP and inside the Late_Window, and STOP folds whose reminder removal was dropped
    - **Property 25: STOP always wins for reminders**
    - **Validates: Requirements 8.4, 8.7**

  - [x] 11.6 Write property test for delivery finalization accounting
    - File `reminder.delivery.finalize.property.test.ts`
    - **Property 31: Delivery finalization accounting**
    - **Validates: Requirements 10.6, 10.7, 10.8**

  - [x] 11.7 Write property test that a run of due reminders never exceeds the cap
    - File `reminder.delivery.cap.property.test.ts`
    - **Property 32: A run of due reminders never exceeds the cap**
    - **Validates: Requirements 10.11, 11.4, 11.14**

  - [x] 11.8 Write property test for delivery Activity_Entry privacy
    - File `reminder.delivery.privacy.property.test.ts`
    - **Property 35: Delivery Activity_Entries never reveal the number or the text**
    - **Validates: Requirements 13.1, 13.4**

  - [x] 11.9 Write property test for load reconciliation
    - File `reminder.store.reconcile.property.test.ts`
    - **Property 26: Load reconciliation removes stopped and handed reminders**
    - **Validates: Requirements 8.8, 10.15**

  - [x] 11.10 Write unit tests for delivery boundaries
    - File `reminder.delivery.unit.test.ts`: decided at `dueAt + 3,600,000` → `send`, at `+3,600,001` → `reminder-expired`; parts bringing `handed` exactly to the cap → `send`, one part over → `reminder-capped`; `dueAt > now` → `wait`; unreadable Allowlist under Allowlist_Mode → `reminder-not-allowed`; `refused-stopped` → `reminder-stopped`; partial send → `reminder-failed` with the sent parts counted
    - _Requirements: 10.2, 10.3, 10.4, 10.7, 10.13, 14.4_

- [x] 12. Implement the reminder state wire format
  - [x] 12.1 Create `reminder.state.ts` and wire it into `gateway.state.ts`
    - `encodeReminder(r)` and strict `decodeReminders(value)` (`null`, missing, non-array, wrong key set, non-canonical number, slot outside 1–5, text outside 1–140 UTF-16 code units (`text.length`), unknown Language, non-safe-integer time, duplicate `(number, slot)` → `unreadable`)
    - `decodeStoredState` uses `decodeReminders` for the `reminders` key; `serializeChanges` encodes the four new change types
    - _Requirements: 12.6, 12.7, 12.8_

  - [x] 12.2 Write property test for the reminder wire format round trip
    - File `reminder.state.roundtrip.property.test.ts`; test name starts with `12.8`
    - **Property 33: Reminder wire format round trip**
    - **Validates: Requirements 12.8**

  - [x] 12.3 Write property test for malformed stored reminders
    - File `reminder.state.decode.property.test.ts`
    - **Property 34: Malformed stored reminders make the store unreadable**
    - **Validates: Requirements 12.7**

  - [x] 12.4 Update `gateway.state.unit.test.ts`
    - Valid payload with reminders decodes to `ok`; missing `reminders` key and `null` decode to `unreadable`; `serializeChanges` round trip for `reminder-add`, `reminder-remove`, `reminder-remove-all`, `reminder-handed`
    - _Requirements: 12.6, 12.7, 12.8_

- [x] 13. Wire the brain exports
  - [x] 13.1 Update `packages/brain/src/index.ts`
    - A `// Reminder_Module public API` block exporting every public symbol of `reminder.*.ts` (except `reminder.arbitraries.ts`) and `gateway.checks.ts`, with the `.js` suffix convention; `ACTIVITY_OUTCOMES` exported
    - _Requirements: 11.12_

  - [x] 13.2 Write an export test for the Reminder_Module
    - File `reminder.exports.test.ts`: import every public function from the package entry; `expectTypeOf` for `DeliveryOutcome`, `Reminder` and `TimeExpression`; the arbitraries are not exported
    - _Requirements: 11.12_

- [x] 14. Checkpoint - Ensure all brain tests pass
  - Run `npx vitest --run`, `npx tsc --noEmit` and lint in `packages/brain`, and `npx tsc --noEmit` and `npx jest` in `apps/necromancer`. Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement Kotlin schema version 2 and reminder storage
  - [x] 15.1 Add the `SqlConn` abstraction and the JVM SQLite test dependency
    - `store/SqlConn.kt` (`exec`, `query`, `savepoint(name, block)`) and `store/AndroidSqlConn.kt`
    - `android/app/build.gradle`: `testImplementation 'org.xerial:sqlite-jdbc:<current stable>'`; test helper `JdbcSqlConn.kt` under `src/test/java/dev/lazarus/necromancer/store/`
    - _Requirements: 14.8_

  - [x] 15.2 Add the `reminder` table DDL and `ReminderMigration`
    - `StoreSchema`: `VERSION = 2`, `REMINDER_DDL` and the `reminder_due` index from the design (`CHECK` on slot, text length and language, `UNIQUE (number, slot)`)
    - `store/ReminderMigration.kt`: `migrate(conn)` inside `SAVEPOINT v2`; on any exception `ROLLBACK TO v2; RELEASE v2` and return `false`; logs only the exception class
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 15.3 Wire reminders into `LazarusDb`, `StoreSql` and `StoreWire`
    - `LazarusDb.onUpgrade(1, 2)` runs the migration and stores `reminderTableReady`; `onOpen` retries when not ready; `loadSnapshot()` adds `reminders` (`null` when not ready or the read fails); `nextReminderDueAt()` returns `MIN(due_at)` where `handed_at IS NULL`
    - `StoreWire` parses `reminder-add` strictly (text 1–140 UTF-16 code units via Kotlin `String.length`; the SQLite `CHECK` on `length(text)` counts code points and is only a looser bound), `reminder-remove`, `reminder-remove-all`, `reminder-handed`, and encodes reminder rows; error messages contain neither the number nor the text; `StoreSql` maps them to the INSERT, DELETE and UPDATE statements of the design inside the existing single `commit` transaction
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.7, 12.10, 12.11, 13.5_

  - [x] 15.4 Write Kotlin JVM tests for the migration and the table
    - `ReminderMigrationTest` with `JdbcSqlConn`: a version 1 database with rows in every table upgrades with every row unchanged; an already version 2 database is unchanged; an injected failure after `CREATE TABLE` rolls back and leaves version 1 data unchanged; a second row with the same `(number, slot)` is rejected; `CHECK` rejects slot 0 and empty text
    - _Requirements: 12.2, 12.3, 12.4, 14.8_

  - [x] 15.5 Write `StoreWireTest` additions
    - The four new change types parse; malformed `reminder-add` payloads (slot 6, 141 UTF-16 code units such as 70 emoji plus 1 letter, unknown language, lone surrogate) are rejected with messages that contain neither the number nor the text
    - _Requirements: 12.7, 12.11, 13.2_

- [x] 16. Implement the Kotlin ReminderScheduler, receivers and manifest
  - [x] 16.1 Create `reminder/ReminderAlarmPolicy.kt`
    - Pure `mode(sdkInt, canExact)` delegating to `GatewayLifecycle.alarmMode`; `onTrigger(paused, serviceRunning, loopAttached)` → `RESCHEDULE_ONLY` / `NOTIFY_LOOP` / `START_SERVICE`; update the `GatewayLifecycle.alarmMode` comment about `SCHEDULE_EXACT_ALARM`
    - _Requirements: 11.1, 11.2, 11.7_

  - [x] 16.2 Create `reminder/ReminderScheduler.kt`
    - `AlarmPort` interface over `AlarmManager`; a next-due provider function; `reschedule()` (none → cancel, else arm), `retryIn60s()`; one explicit `PendingIntent` to `ReminderAlarmReceiver` with request code `REMINDER_ALARM` and `FLAG_UPDATE_CURRENT or FLAG_IMMUTABLE`; `setExactAndAllowWhileIdle` or `setAndAllowWhileIdle` with `RTC_WAKEUP`; `SecurityException` falls back to inexact for the same time; fixed log strings only
    - _Requirements: 11.1, 11.2, 11.3, 11.10, 11.13, 11.15_

  - [x] 16.3 Create the reminder receivers and update `BootReceiver`
    - `ReminderAlarmReceiver` (not exported, `goAsync()`, applies `onTrigger`); `ReminderEventsReceiver` for `TIME_SET`, `TIMEZONE_CHANGED`, `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED` → `reschedule` and the same trigger path; `BootReceiver` calls `ReminderScheduler.reschedule` for `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED`, paused or not
    - _Requirements: 11.4, 11.6, 11.7_

  - [x] 16.4 Create `ReminderModule` and the `NativeReminders` spec
    - `src/native/specs/NativeReminders.ts` (`reschedule`, `scheduleRetry`, `getExactAlarmAccess`, `openExactAlarmSettings`, `onRemindersDue`) and its `codegenConfig` entry in `apps/necromancer/package.json`
    - `reminder/ReminderModule.kt` implementing the spec; `openExactAlarmSettings` uses `ACTION_REQUEST_SCHEDULE_EXACT_ALARM` with a `package:` URI and falls back to App info; emits `onRemindersDue` when the loop is attached; register in `LazarusPackage`
    - _Requirements: 11.4, 11.6, 11.9_

  - [x] 16.5 Update `AndroidManifest.xml`
    - `SCHEDULE_EXACT_ALARM`; `USE_EXACT_ALARM` with `tools:node="remove"`; `ReminderAlarmReceiver` (`exported="false"`) and `ReminderEventsReceiver` (`exported="true"`) with the three actions
    - _Requirements: 11.6, 11.8_

  - [x] 16.6 Write Kotlin JVM tests for the alarm policy and scheduler
    - `ReminderAlarmPolicyTest`: exact on API 26 and 30, exact on API 31 with access, inexact on API 31 without; `onTrigger` table for paused, running and stopped
    - `ReminderSchedulerTest` with a fake `AlarmPort`: arming twice leaves 1 pending alarm; no rows cancels; a `SecurityException` from the exact call falls back to inexact for the same time; `retryIn60s` arms `now + 60,000`
    - _Requirements: 11.1, 11.2, 11.10, 11.13, 14.8_

  - [x] 16.7 Update `__tests__/manifest.test.ts`
    - `SCHEDULE_EXACT_ALARM` present, `USE_EXACT_ALARM` absent or removed, the two receivers with the right `exported` values and actions, the existing `database` backup exclusion still present
    - _Requirements: 11.8, 12.9_

- [x] 17. Checkpoint - Ensure the build and tests pass
  - Run `./gradlew testDebugUnitTest assembleDebug` in `apps/necromancer/android` and `npx jest` in `apps/necromancer`. Ensure all tests pass, ask the user if questions arise.

- [x] 18. Implement the JS glue and Main_Screen
  - [x] 18.1 Add the `RemindersPort` to `src/native/ports.ts`
    - `RemindersPort` (`reschedule`, `scheduleRetry`, `getExactAlarmAccess`, `openExactAlarmSettings`, `onRemindersDue`) with decoders that drop malformed values; `GatewayPorts.reminders`; the activity decoder accepts `ACTIVITY_OUTCOMES`
    - _Requirements: 11.4, 11.9, 13.1_

  - [x] 18.2 Update `__tests__/support/mockPorts.ts`
    - A recording `reminders` mock with scripted results (including a rejecting `reschedule` and `scheduleRetry`) and a way to fire `onRemindersDue`; `loadState` payloads gain `reminders`
    - _Requirements: 14.7_

  - [x] 18.3 Add reminder status to `store.ts` and `loopSupport.ts`
    - `store.ts`: `reminderCount: number | null`; banners `reminders-unreadable`, `reminders-save-failed`, `reminders-may-be-late`
    - `loopSupport.ts`: `LoopContext.remindersDue`; `showReminderStatus(ctx)` sets the count from the in-memory store or `null` when unreadable
    - _Requirements: 10.14, 11.9, 13.6, 13.7_

  - [x] 18.4 Create `src/gateway/reminders.ts`
    - `reconcileReminders(ctx)` (applies `reconcileOnLoad`, commits, appends entries, before any alarm is armed); `runDueReminders(ctx)` per the design outline; `recordDelivery` (memory first, commit with 3 retries at 1 s, then `reminders-save-failed`); `sendReminder` (`sendParts("reminder:<id>", ...)`, a rejection counts as all parts `failed-other`, `finalizeDelivery`, commit, `buildDeliveryEntry`); `recordProcessingFailed` and `scheduleRetry` when the store is unreadable; `rescheduleSafely`
    - Only fixed log strings or masked numbers; no Reminder_Text in logs, banners or errors; no parsing, slot or delivery logic of its own
    - _Requirements: 8.8, 10.11, 10.12, 10.14, 10.15, 11.3, 11.4, 11.5, 11.11, 11.12, 11.14, 11.15, 13.1, 13.2, 13.3, 13.8_

  - [x] 18.5 Add the reminders work item to `src/gateway/loop.ts`
    - `remindersDue` set by `onRemindersDue`, loop start, resume and the 60-second retry; `prepare` runs `reconcileReminders` then `runDueReminders` after `applyPendingStops` and only once the Stop_List is readable; `drain` runs reminders before each `takeNextInbound()`; idle wait races `waitForInbound()` with `onRemindersDue`
    - `processMessage`: a batch with `reminder-add` or `reminder-remove` is committed before it is applied to memory, and on rejection the loop uses `reminderWriteFailed` and commits that decision instead; STOP batches keep memory-first with the Stop_List retries; `rescheduleSafely` after every reminder add, cancel or STOP
    - _Requirements: 8.6, 8.8, 8.9, 10.12, 11.3, 11.6, 11.7, 11.14, 12.5, 12.11_

  - [x] 18.6 Update `src/ui/screens/MainScreen.tsx`
    - Reminder count row (0 and above) using the theme tokens; the "reminders could not be loaded" message in place of the count; `reminders-save-failed` banner; "reminders can arrive late" banner with an "Allow exact alarms" button calling `openExactAlarmSettings()`, re-checked through `getExactAlarmAccess()` on `AppState` `active`
    - _Requirements: 10.14, 11.9, 12.7, 13.6, 13.7_

  - [x] 18.7 Update existing app tests for reminders and the new STOP change list
    - `loop.test.ts` (call order now includes reconcile, due reminders and `reschedule`; STOP commits carry `reminder-remove-all`), `pausedTask.test.ts`, `pausedPath.test.ts`, `pendingStops.test.ts`, `mockPorts.test.ts`, `commitQueue.test.ts`, `ports.test.ts` (new activity outcomes)
    - _Requirements: 8.1, 14.7, 14.9_

  - [x] 18.8 Write Jest tests for the reminders runner
    - File `__tests__/reminders.test.ts`: `onRemindersDue` passes due reminders in `(dueAt, id)` order; the hand-off marker commit precedes `sendParts`; a failed marker commit sends nothing and keeps the reminder; a removal commit failure retries 3 times then raises `reminders-save-failed`; an `appendActivity` failure keeps the outcome and sends nothing more; a handed row at load records `reminder-failed` and is never resent; `rescheduleSafely` after every run
    - _Requirements: 10.11, 10.14, 10.15, 11.4, 11.14, 13.8, 14.7_

  - [x] 18.9 Write Jest tests for reminders in the gateway loop
    - File `__tests__/loop.reminders.test.ts`: a STOP commit carries `stop-add` and `reminder-remove-all` in one `commit` call; reminders run between Inbound_Messages; a paused gateway hands nothing to the Sms_Sender and keeps every reminder; a Stop_List read failure at start sends nothing and keeps the reminder; an unreadable reminder store shows the banner, adds the processing-failed entry and schedules the 60-second retry without crashing; a failed REMIND commit replies with the Reminders_Unavailable_Text
    - _Requirements: 8.1, 10.12, 11.7, 11.15, 12.7, 12.11, 14.7_

  - [x] 18.10 Write the reminder privacy test
    - File `__tests__/reminders.privacy.test.ts`: after a full delivery run, a console spy, the Activity_Log, banners and notification text contain no Reminder_Text and no run of 4 or more digits of the Canonical_Number
    - _Requirements: 13.2, 13.3, 13.4, 14.7_

  - [x] 18.11 Extend `__tests__/screens.test.tsx` for the reminder UI
    - Count 0 and 3; the unreadable message replaces the count; the exact-alarm banner shows without access, re-checks on `AppState` `active` and hides once access is granted; the button calls `openExactAlarmSettings`
    - _Requirements: 11.9, 13.6, 13.7, 14.7_

  - [x] 18.12 Extend `__tests__/sourceGuards.test.ts`
    - `apps/necromancer/src` contains no `subah`, `shaam`, `raat`, `am`/`pm` regexes and no `% 12` hour math, and imports reminder logic from `@lazarus/brain`
    - _Requirements: 11.12_

- [x] 19. Final checkpoint - Ensure all tests pass
  - Run `npx vitest --run` in `packages/brain`, `npx jest` in `apps/necromancer`, `npx tsc --noEmit` in both, `./gradlew testDebugUnitTest` and `./gradlew assembleDebug`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Requirement 14 tests, updates to existing tests and the safety-critical properties are not marked optional.
- Each task references specific requirements for traceability.
- Every property test uses `REMINDER_PBT_OPTIONS` (at least 100 runs), has the requirement number at the start of its test name and the tag comment `// Feature: sms-reminders, Property N: <title>`; fast-check reports the counterexample and seed, and tests do not catch that output.
- Each property test has its own file, so tasks in the same wave never write the same file.
- Run Vitest only with `--run`; never start watch mode.
- Between tasks 2.2 and 2.4 `tsc --noEmit` reports missing `reminders` fields in fixtures; Vitest still passes because nothing emits reminder changes yet. Task 2.4 restores a clean type check.
- The manual device check in the design's Testing Strategy (exact alarm grant and revoke, reboot with a pending reminder, time zone change) is done by hand on the Xiaomi phone and is not part of this plan.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "3.2", "4.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "1.6", "2.4", "2.5", "4.6", "5.1", "6.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "4.5", "5.5", "6.7", "6.8"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "6.2", "6.3", "6.4", "6.5", "6.6", "8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "8.4", "8.5", "9.1"] },
    { "id": 6, "tasks": ["9.2", "9.3", "10.1"] },
    { "id": 7, "tasks": ["10.2"] },
    { "id": 8, "tasks": ["10.3", "10.4", "10.5", "10.6", "10.7", "10.8", "10.9", "10.10", "10.11", "10.12", "11.1"] },
    { "id": 9, "tasks": ["11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8", "11.10", "12.1"] },
    { "id": 10, "tasks": ["11.9", "12.2", "12.3", "12.4", "13.1"] },
    { "id": 11, "tasks": ["13.2", "15.1", "16.1"] },
    { "id": 12, "tasks": ["15.2", "16.2"] },
    { "id": 13, "tasks": ["15.3", "16.5", "16.6"] },
    { "id": 14, "tasks": ["15.4", "15.5", "16.3", "16.4", "16.7"] },
    { "id": 15, "tasks": ["18.1"] },
    { "id": 16, "tasks": ["18.2", "18.3"] },
    { "id": 17, "tasks": ["18.4"] },
    { "id": 18, "tasks": ["18.5", "18.6"] },
    { "id": 19, "tasks": ["18.7", "18.8", "18.9", "18.10", "18.12"] },
    { "id": 20, "tasks": ["18.11"] }
  ]
}
```
