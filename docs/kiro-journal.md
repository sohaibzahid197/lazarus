# Kiro journal

Short notes on how Kiro was used. This becomes the Kiro write-up and blog.

## 2026-11-09
- Wrote steering files first (product, tech, sms-rules, design) so every spec starts with the same rules.
- `sms-rules.md` and `design.md` use fileMatch inclusion so they load only for the brain package and the apps.

## 2026-11-09 (later)
- Created the bare React Native 0.88 Android shell for `apps/necromancer` with the RN CLI (boilerplate only; features will come from Kiro specs).
- Confirmed the gateway phone: Android 15 (SDK 35), MIUI/HyperOS, Jazz SIM in slot 1. Debug build installs over USB.
- Note for sms-gateway spec: Xiaomi needs autostart and battery "No restrictions" for the foreground service.
