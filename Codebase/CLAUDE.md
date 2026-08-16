# Markivo — project instructions for Claude

## Credentials workflow (ALWAYS follow)

- **`CREDENTIALS.local.md`** (repo root, gitignored) is the single intake file for ALL
  secrets: API keys, tokens, account info. It contains fill-in slots plus plain-language
  instructions for obtaining each credential.
- When the user says the file is **filled**, copy the values into `backend/.env`
  (gitignored), restart, and **verify each integration actually switched from mock to
  live** before declaring it done.
- When new code needs a NEW credential: (1) add a fill-in section with simple
  how-to-get-it steps to `CREDENTIALS.local.md`, (2) document the variable in
  `backend/.env.example` (placeholder only), (3) tell the user what to fetch.
- **Never** hardcode secrets in source, commit `.env` / `CREDENTIALS.local.md`, or echo
  full key values into the chat, logs, or git history.
- Every integration MUST work keyless via a graceful fallback (pattern: `backend/ai.js`,
  `backend/places.js`) — a blank credential never breaks the app or the tests.

## Commands

- Dev (backend :5000 + Vite): `npm run dev` (repo root)
- Backend tests: `cd backend && npm test` — must stay green
- Frontend checks: `cd frontend && npm run lint && npm run build`

## Conventions & gotchas

- Feature flags live in `backend/config.js` (`TELEGRAM_ENABLED` — Telegram is built but
  post-MVP, default off; routes answer 503 coming-soon).
- `db.js` is the single data-layer swap point; new columns use the additive
  `addColumn()` try/catch ALTER pattern (CREATE TABLE IF NOT EXISTS never alters).
- Onboarding `construct` must return the profile WITH a `platforms` boolean map or the
  dashboard crashes.
- The money/ad approval gate in `server.js` stays deterministic — never model-decided.
- Generation allowances are three WEEKLY buckets (`writing` / `image` / `video`) that
  refill 00:00 UTC Monday, not one monthly pool — the per-call costs differ ~100x. Every
  `db.usage.record` names its bucket, and the bucket is STORED so remapping a `kind`
  later never rewrites what a user was already charged. Guard routes with
  `checkBudget('<bucket>')`; `/api/media/:id/render` checks inline instead, because
  image-vs-video is not known until the row is loaded.
- Media rendering runs on `GEMINI_API_KEY` (images via the image model, video via Veo) —
  there is no separate media key. Video is a long-running job: charged at submit,
  refunded if it fails, swept out after `VEO_MAX_WAIT_MS`. A failure to *poll* is not a
  failed job — never refund on a transient error, or a blip destroys a paid-for render.
- `VEO_MODEL` and `VEO_DURATION_SECONDS` are money dials (Veo bills per second). Treat a
  change to either as a pricing decision, not a config tweak.
- Tests are `node:test`; env vars must be set BEFORE requiring the app (config caches
  env at load; each test file gets its own process). Test files that make many
  generations must raise `AI_LIMIT_FREEMIUM_WRITING` or they run dry mid-file.
