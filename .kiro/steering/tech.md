---
inclusion: always
---
# Tech

## Monorepo layout
- `packages/brain`: TypeScript core logic (command router, language detection, SMS splitter, AI client, guardrails). Pure functions where possible. Shared by mobile and web.
- `apps/necromancer`: React Native (bare) Android app with a Kotlin native module for SMS receive/send and a foreground service.
- `apps/crypt`: Next.js web app with the Crypt dashboard and Ouija simulator. Deployed on Vercel free tier.

## Rules
- TypeScript strict mode everywhere. No `any`.
- Tests: Vitest; property-based tests with fast-check for splitter and router.
- Never commit secrets. API keys only via `.env` (gitignored) and `.env.example`.
- Only free services: Gemini free tier for AI, Vercel free tier. No paid SMS gateways.
- Android minSdk 26. Request SMS permissions at runtime with a clear explanation screen.
- Keep functions small; every spec task ends with tests passing.
