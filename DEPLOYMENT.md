# Markivo — Deployment checklist

Sequenced go-live guide. The app runs keyless (every integration falls back
gracefully), so you can deploy first and switch integrations to live one at a
time. Secrets come from `CREDENTIALS.local.md` → `backend/.env`; see
[`CLAUDE.md`](./CLAUDE.md) for the credentials workflow.

## Architecture

Two containers (see [`docker-compose.yml`](./docker-compose.yml)):
- **backend** — Express API on `:5000`, SQLite + uploads on named volumes.
- **frontend** — nginx serving the built React bundle on `:8080`, proxying
  `/api` and `/uploads` to the backend (same-origin, so no CORS needed).

## Pre-flight (must do)

- [ ] **Rotate `JWT_SECRET`** — generate a fresh one, don't reuse the dev value:
      `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- [ ] **Set `CORS_ORIGIN`** to your real frontend origin (e.g.
      `https://app.markivo.uz`). Leave `*` only if the frontend is served
      same-origin via the nginx container.
- [ ] **Set `APP_URL`** to the public frontend URL (Stripe redirects, message links).
- [ ] **`TRUST_PROXY=true`** when behind nginx / Railway / Render (already the
      compose default) so rate limiters key on the real client IP.
- [ ] **`VITE_API_URL`** — baked into the frontend at build time. Use `/` for the
      same-origin nginx setup (compose default), or the public API URL for a
      split deploy.
- [ ] Confirm the **persistent volumes** (`markivo-db`, `markivo-uploads`) are
      backed by durable storage on your host/platform.

## Deploy (Docker)

```bash
# Provide secrets via a root .env or your platform's secret store, then:
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") \
  docker compose up --build -d

# Frontend → http://localhost:8080   API → http://localhost:5000
# Health   → http://localhost:5000/api/health  → {"status":"ok"}
```

`docker-compose.yml` reads these from the environment (all optional except
`JWT_SECRET` in prod): `CORS_ORIGIN`, `APP_URL`, `ANTHROPIC_API_KEY`,
`AI_CONTENT_MODEL`, `AI_AGENT_MODEL`, `GOOGLE_MAPS_API_KEY`, `MEDIA_API_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TIER_PRICE_PRO`,
`TIER_PRICE_ULTIMATE`, `TELEGRAM_ENABLED`, `INSTAGRAM_APP_ID`,
`INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI`, `PUBLIC_BASE_URL`.

## Per-integration go-live

Each row is independent — ship with all blank, then flip on as keys land. Full
setup steps live in `CREDENTIALS.local.md`.

| Integration | Set | Verify live |
|---|---|---|
| **Claude AI** | `ANTHROPIC_API_KEY` | Content/agent replies stop being templated |
| **Google Places** | `GOOGLE_MAPS_API_KEY` | Discovery scan shows real ratings |
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Upgrade opens real Checkout; webhook flips tier |
| **fal.ai media** | `MEDIA_API_KEY` | Media render returns a PNG, not 501 |
| **Instagram** | `INSTAGRAM_APP_ID/SECRET`, `INSTAGRAM_REDIRECT_URI`, `PUBLIC_BASE_URL` | "Connect Instagram" → Connected as @handle |
| **Telegram** | `TELEGRAM_ENABLED=true` (already on) | Pill connects a bot (token entered in UI) |

### Stripe webhook
Add a Dashboard endpoint at `https://<api-host>/api/billing/webhook` for
`checkout.session.completed` + `customer.subscription.deleted`, then set the
`whsec_...` signing secret. Start in **test mode**, swap to live keys at launch.

### Instagram redirect + public URL
- Register `INSTAGRAM_REDIRECT_URI` (`https://<api-host>/api/instagram/oauth/callback`)
  in the Instagram business-login settings **byte-for-byte**.
- Set `PUBLIC_BASE_URL=https://<api-host>` — Instagram fetches post images
  server-side, so it must be publicly reachable (not localhost or a dev tunnel).

## Post-deploy smoke test

- [ ] `GET /api/health` → `{"status":"ok"}`
- [ ] Register a user, complete onboarding into the dashboard.
- [ ] Generate content (templated or live depending on the AI key).
- [ ] `docker compose logs backend` — no crash loops; only the expected
      keyless-fallback warnings for integrations you haven't enabled yet.
