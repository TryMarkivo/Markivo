# Markivo

An AI-powered marketing operating system that builds, manages, and grows a small
business's entire online presence — designed first for Uzbekistan and Central
Asia, in Uzbek, Russian, and English.

> Status: MVP in active development. The product vision lives in [`Overview`](./Overview)
> and the scoped plan in [`MVP_PLAN.md`](./MVP_PLAN.md).

## Stack

| Tier | Tech |
|------|------|
| Frontend | React 19 + Vite, `react-i18next` (English-first; uz/ru optional) |
| Backend | Node.js + Express, JWT auth (access + refresh), SQLite (`better-sqlite3`) |
| AI | Claude via `@anthropic-ai/sdk` — Haiku for content/slogans, Opus for the **Markiv** agent; smart-template fallback when no key is set |
| Telegram | Real Bot API integration — guided BotFather setup, auto-branding, channel detection, publish-with-approval through Markiv |
| Tests | Node's built-in `node:test` runner |
| Deploy | Docker + docker-compose (backend container + nginx-served frontend) |

The backend data layer is isolated in [`backend/db.js`](./backend/db.js); migrating
to PostgreSQL later means reimplementing only that one file.

## Local development

```bash
# 1. Install all dependencies (root + backend + frontend)
npm run install:all

# 2. (optional) configure environments
cp backend/.env.example backend/.env       # set JWT_SECRET for non-dev use
cp frontend/.env.example frontend/.env      # set VITE_API_URL if backend isn't on :5000

# 3. Run backend (:5000) + frontend (Vite, usually :5173) together
npm run dev
```

Then open the Vite URL, click **Build From Scratch**, register, and walk the
onboarding wizard into the dashboard.

## Enabling real AI (Markiv)

Set `ANTHROPIC_API_KEY` in `backend/.env` and restart. Content generation,
slogans, and the Markiv agent switch from smart templates to live Claude
generation — no code changes needed.

## Connecting Telegram

Telegram has no API for creating bots, so the flow is guided (~1 minute):

1. On the dashboard, click the **Telegram** pill → follow the steps: create a
   bot via [@BotFather](https://t.me/BotFather) (`/newbot`) and paste its token.
   Markivo automatically brands the bot with your business name, description,
   and slogan.
2. Add the bot to your channel as an **administrator** (Post messages) → click
   **Detect My Channel** (or enter `@yourchannel` manually).
3. Ask **Markiv** in the chat panel: *"Post our weekend offer to Telegram"* —
   review the draft in the approval dialog, approve, and it publishes for real.

Bot tokens are stored AES-256-GCM-encrypted at rest. Every publish goes
through the human approval gate; the model can never post or spend on its own.

## Testing

```bash
# Backend unit + integration tests (auth, refresh tokens, data layer)
cd backend && npm test

# Frontend production build (type/JSX sanity)
cd frontend && npm run build && npm run lint
```

## Deployment (Docker)

```bash
# Build and run both services
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") \
  docker compose up --build
# Frontend → http://localhost:8080   API → http://localhost:5000
```

For a real deployment, set `JWT_SECRET`, `CORS_ORIGIN` (your frontend origin),
and build the frontend with `VITE_API_URL` pointing at the public API URL.

## Environment variables

**Backend** (`backend/.env`): `PORT`, `NODE_ENV`, `JWT_SECRET` (required in prod),
`ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `CORS_ORIGIN`, `DB_PATH`,
`AUTH_RATE_LIMIT`, `AUTH_RATE_WINDOW_MIN`. See [`backend/.env.example`](./backend/.env.example).

**Frontend** (`frontend/.env`): `VITE_API_URL`. See [`frontend/.env.example`](./frontend/.env.example).

## Project layout

```
backend/
  server.js       Express routes (auth, onboarding, content, dashboard, agent)
  config.js       Env-driven configuration
  db.js           SQLite data-access layer (swap point for Postgres)
  validators.js   Input validation
  test/           node:test suites
frontend/
  src/lib/api.js  Central API client (base URL + token refresh)
  src/components/  Landing, onboarding (A/B), dashboard, content engine, agent
  src/i18n/       Uzbek / Russian / English translations
```
