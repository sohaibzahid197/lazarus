// @lazarus/brain — shared core logic for the Lazarus project.
//
// The SMS_Splitter (encoding detection, code-unit counting, limits,
// greedy splitting, truncation, prefixing) is implemented across several
// modules and exposed here through the public `splitSms` / `joinSms` API.
// This package has no dependency on React Native or Next.js: it is pure
// TypeScript consumed by both apps.
//
// The helper modules' public symbols are re-exported so consumers can
// import everything from `@lazarus/brain`. Internal modules must import
// from the defining module, never from this entry point, to avoid cycles.
//
// The Gemini client (`gemini.entry.ts`) is deliberately NOT exported here;
// it is available only through the `@lazarus/brain/gemini` subpath so the
// core entry stays free of env reads and the `@google/genai` dependency.
export * from './encoding.js';
export * from './limits.js';
export * from './prefix.js';
export * from './units.js';
export {
  applyPrefixes,
  applyWordBoundary,
  findCutByBudget,
  splitContent,
} from './split.js';
export { applyHardCap } from './truncation.js';
export { joinSms, splitSms } from './sms.js';
// Command_Router public API.
export * from './router.types.js';
export { routeCommand } from './router.js';
export { detectLanguage } from './language.js';
export { printCommand } from './printer.js';
export { normalizeMessage } from './normalize.js';
// AI client contract and mock (_Requirements: 1.5_).
export type { AiClient, AiErrorKind, Prompt } from './ai.types.js';
export { AI_ERROR_KINDS, AiError, isAiError, toAiError } from './ai.types.js';
export type { MockClient, MockStep } from './ai.mock.js';
export { createMockClient } from './ai.mock.js';
// Answer_Service public API (_Requirements: 12.5_).
export type {
  AnswerCache,
  AnswerDeps,
  RequestKind,
  ScamResult,
  ScamVerdict,
  Topic,
} from './answer.types.js';
export { answerQuestion, checkScam, resolveLanguage } from './answer.service.js';
export { createMemoryCache } from './answer.cache.js';
// Model configuration (_Requirements: 15.1_).
export { DEFAULT_GEMINI_MODEL, resolveModel } from './models.js';
// Pure helpers used by tests.
export type { PromptOptions } from './answer.prompt.js';
export { buildPrompt, promptCharLimit, sanitizeUserText } from './answer.prompt.js';
export type { TopicResult } from './answer.topic.js';
export {
  asksForLiveFacts,
  asksForPriceOrRate,
  classifyTopic,
  containsUnsupportedAmount,
} from './answer.topic.js';
export {
  fitsSms,
  hasPromptLeak,
  joinReply,
  removeAll,
  shortenToFit,
  smartCut,
  stripMarkdown,
} from './answer.text.js';
export { parseScam, printScam } from './answer.scam.js';
export { maskPhoneNumbers, redactSecrets } from './answer.redact.js';
export { buildCacheKey } from './answer.key.js';
export type { FixedTexts } from './answer.texts.js';
export {
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
  CALL_TIMEOUT_MS,
  CLOSE_DELIMITER,
  FIXED_TEXTS,
  LEAK_RUN_LENGTH,
  LIVE_FACT_KEYWORDS,
  MAX_QUESTION_CODE_POINTS,
  MAX_REASON_CODE_POINTS,
  OPEN_DELIMITER,
  PRICE_KEYWORDS,
  REDACTED,
  TARGET_PARTS,
  TOPIC_KEYWORDS,
} from './answer.texts.js';
// Gateway_Module public API (_Requirements: 17.7, 17.10_).
// `gateway.arbitraries.ts` is test-only and deliberately not exported.
export type {
  ActivityEntry,
  ActivityOutcome,
  CanonicalNumber,
  DayCounters,
  DeviceStatus,
  FinalOutcome,
  GatewayDecision,
  GatewaySettings,
  GatewayState,
  Heartbeat,
  InboundMessage,
  Outcome,
  PartResult,
  PipelineContext,
  SendReport,
  SenderIdentity,
  ServiceStatus,
  SleepReason,
  StateChange,
} from './gateway.types.js';
export { ACTIVITY_OUTCOMES, OUTCOMES, SLEEP_REASONS } from './gateway.types.js';
export {
  FALLBACK_COUNTRY_CODE,
  isCanonicalNumber,
  isValidCountryCode,
  maskNumber,
  maskSender,
  normalizeSender,
  printNumber,
} from './gateway.number.js';
export type { RateCheck } from './gateway.rate.js';
export {
  checkRate,
  countInWindow,
  pruneRate,
  RATE_RETENTION_MS,
  slowDownDue,
} from './gateway.rate.js';
export {
  countersFor,
  localDayKey,
  recordFinal,
  releaseParts,
  reserveParts,
  zeroCounters,
} from './gateway.counters.js';
export type { GatewayTexts } from './gateway.texts.js';
export { GATEWAY_TEXTS } from './gateway.texts.js';
export type { AnswerRequest, EvalStep, PendingReply, PipelineDeps } from './gateway.pipeline.js';
export {
  applyChanges,
  completeReply,
  evaluateInbound,
  finalizeSend,
  orderInbound,
  runGatewayPipeline,
} from './gateway.pipeline.js';
export { deriveHeartbeat } from './gateway.heartbeat.js';
export { ACTIVITY_LOG_MAX, buildActivityEntry, trimActivityLog } from './gateway.activity.js';
export type {
  AllowlistAdd,
  FieldResult,
  ParsedSettings,
  SettingsField,
} from './gateway.settings.js';
export {
  addToAllowlist,
  ALLOWLIST_MAX,
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
  validateSettingsField,
} from './gateway.settings.js';
export type { KeyCheck } from './gateway.key.js';
export { API_KEY_INVALID_MESSAGE, maskApiKey, validateApiKey } from './gateway.key.js';
export type { DecodedState } from './gateway.state.js';
export { decodeStoredState, serializeChanges } from './gateway.state.js';
export type { PendingStopRecord } from './gateway.pending.js';
export {
  applyPendingStop,
  decodePendingStopRecord,
  orderPendingStops,
} from './gateway.pending.js';
export type { StopAliasAsset } from './stopAliases.js';
export {
  KEYWORD_TRAILING_PUNCTUATION,
  STOP_ALIAS_LIST,
  STOP_MARKER,
  stopAliasAsset,
  stopKeywordCheck,
  trailingPunctuationRegex,
} from './stopAliases.js';
// Reminder_Module public API (_Requirements: 11.12_).
// `reminder.arbitraries.ts` is test-only and deliberately not exported.
export type {
  DayPeriod,
  DayWord,
  DeliveryOutcome,
  DeliveryStep,
  DurationUnit,
  ParseError,
  ParseResult,
  Reminder,
  ReminderId,
  ReminderSlot,
  ReminderState,
  ResolveResult,
  TimeExpression,
} from './reminder.types.js';
export {
  DELIVERY_OUTCOMES,
  EMPTY_REMINDERS,
  LATE_WINDOW_MS,
  PK_OFFSET_MS,
  REMINDER_HORIZON_MS,
  REMINDER_LIMIT,
  REMINDER_TEXT_MAX,
} from './reminder.types.js';
export type { PkWallClock } from './reminder.clock.js';
export { DAY_MS, formatWhen, pkDayStart, pkWallClock } from './reminder.clock.js';
export { parseReminder, toDigitValue } from './reminder.parse.js';
export { isValidTimeExpression, printTimeExpression } from './reminder.print.js';
export { resolveDueTime } from './reminder.resolve.js';
export type { ReminderTexts } from './reminder.texts.js';
export { REMINDER_TEXTS } from './reminder.texts.js';
export { formatReminderList } from './reminder.list.js';
export type { ReminderChange } from './reminder.store.js';
export {
  activeFor,
  applyReminderChange,
  dueReminders,
  findBySlot,
  lowestFreeSlot,
  nextDueAt,
  reconcileOnLoad,
} from './reminder.store.js';
export type { ReminderCommand, ReminderReply } from './reminder.pipeline.js';
export {
  cappedReminderChanges,
  parseSlotArgument,
  reminderReply,
  reminderWriteFailed,
} from './reminder.pipeline.js';
export {
  buildDeliveryEntry,
  buildProcessingFailedEntry,
  decideDelivery,
  deliveryText,
  finalizeDelivery,
} from './reminder.delivery.js';
export type { EncodedReminder } from './reminder.state.js';
export { decodeReminders, encodeReminder } from './reminder.state.js';
export { notAllowed, stopChanges } from './gateway.checks.js';
