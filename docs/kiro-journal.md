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
