# Prompts to paste into Kiro (Spec mode), in order

Open the `lazarus` folder in Kiro. Steering files are already in `.kiro/steering`.
For each prompt: choose **Spec**, paste, review requirements, then design, then tasks. Run tasks one by one.
After each spec, add 2 lines and a screenshot to `docs/kiro-journal.md`.

## 1. message-splitter
Create a spec for `packages/brain` message splitter. Follow `.kiro/steering/sms-rules.md` exactly. Input: reply text. Output: array of SMS parts. Include property-based tests with fast-check: parts rejoin to the original, no part exceeds its encoding limit, surrogate pairs never split, max 4 parts. Set up the brain package with TypeScript strict and Vitest.

## 2. command-router
Create a spec for the brain command router. Parse incoming SMS into one of: HELP, STOP, START, SCAM, REMIND, TRANSLATE, QUESTION. Case-insensitive, tolerant of extra spaces and Roman Urdu variants (e.g. "madad" = HELP, "band" = STOP). Detect language: English, Urdu script, Roman Urdu. Property test: every input maps to exactly one command; any message starting with STOP maps to STOP.

## 3. ai-answer-guardrails
Create a spec for the AI answer service in brain. Uses Gemini free tier via an injectable client (mockable). Short answers sized for at most 4 SMS parts, same language as the question, safety rules from product.md, a cache for repeated questions, graceful "try later" when quota is exhausted. SCAM command returns verdict plus one-line reason.

## 4. sms-gateway (Android)
Create a spec for `apps/necromancer`: bare React Native Android app with a Kotlin native module that receives SMS (BroadcastReceiver), sends SMS (SmsManager, multipart), runs a foreground service, restarts on boot, and passes messages to the brain package. Permission explanation screen, per-number rate limit, allowlist mode, STOP list stored locally. Main screen shows heartbeat states from design.md.

## 5. reminders
Create a spec for REMIND: parse times like "8pm", "20:00", "kal subah 9", store reminders on the device, send the SMS at the right time even after reboot.

## 6. crypt-dashboard and ouija-simulator
Create a spec for `apps/crypt` (Next.js): a dashboard showing masked conversations and counters, and an Ouija simulator: a retro button phone UI with T9 typing that sends text through the same brain package and shows SMS parts as they would arrive. Deployable to Vercel free tier. Follow design.md.

# Hooks to create (Agent Hooks panel)
1. **Test on save:** when a file in `packages/brain/src` is saved, run the brain tests and fix failures.
2. **Help sync:** when `packages/brain/src/commands.ts` changes, update the HELP reply text and the commands table in README.md.
3. **Secret guard:** before commit or on save of any file, check no API key or phone number is hard-coded.
4. **Journal nudge:** when a spec's tasks are all done, append a dated entry to docs/kiro-journal.md summarising what was built.

# Custom agents
- `android-native`: expert in Kotlin, Android SMS APIs, permissions, foreground services.
- `ghost-ux`: reviews screens against `.kiro/steering/design.md` and accessibility rules.
