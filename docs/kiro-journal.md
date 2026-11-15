# Kiro journal

Short notes on how Kiro was used. This becomes the Kiro write-up and blog.

## 2026-11-09
- Wrote steering files first (product, tech, sms-rules, design) so every spec starts with the same rules.
- `sms-rules.md` and `design.md` use fileMatch inclusion so they load only for the brain package and the apps.

## 2026-11-09 (later)
- Created the bare React Native 0.88 Android shell for `apps/necromancer` with the RN CLI (boilerplate only; features will come from Kiro specs).
- Confirmed the gateway phone: Android 15 (SDK 35), MIUI/HyperOS, Jazz SIM in slot 1. Debug build installs over USB.
- Note for sms-gateway spec: Xiaomi needs autostart and battery "No restrictions" for the foreground service.

## 2026-11-09: Spec 1, sms-message-splitter (requirements-first)
- Kiro wrote 9 EARS requirements from the steering file `sms-rules.md`.
- Kiro caught on its own that "…" is a UCS-2 character and would drop an English reply to the 70-char limit; we switched the truncation marker to GSM-7 "...".
- Design phase: Kiro web-searched GSM 03.38 and cited sources; 10 correctness properties for fast-check.
- Review fix: joinSms strips part prefixes only for multi-part messages, so a single reply starting with "(1/2) " round-trips unchanged.
- All test tasks made required (Kiro had marked them optional).

## Spec 2: brain-command-router
- Kiro built the pure router (types, normalizer, 18-alias table, language detector, printer) from 15 correctness properties; 172 tests pass, including fast-check property tests at 100+ runs and a STOP-always-wins property.
- ESLint now bans `any` and restricts Date, console, fetch and Math.random in the router modules, so purity is enforced at lint time.
## Spec 3: ai-answer-service
- Kiro built the Answer_Service (answerQuestion, checkScam) with an injectable AI client, 24 h LRU cache, quota cache re-check, redaction and a Gemini free-tier adapter isolated in `gemini.entry.ts`; 691 tests pass across 30 correctness properties.
- Property tests caught two real bugs: a nested referral re-forming after whitespace collapse (fixed by looping removal) and `stripMarkdown` leaving a lone list marker.
## Spec 4: necromancer-sms-gateway
- Kiro ran the spec in orchestrator mode: 110 of 126 tasks done by parallel sub-agents (up to 5 at a time). Brain Gateway_Module (pipeline, rate limit, daily cap, STOP list, pending stops, heartbeat), Kotlin native side (SQLite store, encrypted key store, SMS receive and send with retry, foreground service, boot watchdog, HyperOS settings intents) and the JS loop glue are in.
- 39 correctness properties for the gateway, including STOP always wins, the AI never sees sender data, and bodies never reach stored data. Brain: 1006 tests; Necromancer Jest: 185; Kotlin JVM: 81. The debug APK builds and bundles JS so it runs without Metro.
- Kotlin never keeps its own STOP keyword list: Gradle generates `stop_aliases.json` from the brain router at build time, and a property test proves the Kotlin fallback check can only fire when the router also says STOP.
- Open spec questions settled and written back into requirements/design (D1–D7): no retry after an "other" send error, retries resend all parts, paused non-STOP messages count as ignored, a capped Slow_Down_Text is `send-capped`, unreadable state holds replies, an unreadable paused flag counts as not paused, and Settings_Screen changes reach the running loop through `settingsSync` without a service restart.
- Found a flaky ai-answer-service property (Property 6, 1 in ~20k runs): Arabic presentation forms in filler text (U+FC20 U+FC0B) NFKC-normalize to "صحتج", which contains the health keyword, so a "money" question became "health". Fixed the generator to check filler after normalization; 60k runs and 5 full runs pass.
- The repo secret scan caught an `AIza…`-shaped fixture in a new Jest test; replaced with a neutral string.
- Still to do: Setup, Main and Settings screens, App.tsx and index.js wiring, the loop/paused-path/source-guard and screen tests, README, and the manual Xiaomi checklist.
