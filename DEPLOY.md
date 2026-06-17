# Markivo — Deployment Runbook

## Prerequisites

- A hosting account (Railway, Render, or any VPS with Docker) and a domain.
- The API keys collected in `CREDENTIALS.local.md` (never commit real values):
  `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`, `MEDIA_API_KEY` (optional),
  Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). Every integration
  key is optional — features fall back gracefully when a key is blank.
- A JWT secret (REQUIRED in production — the backend refuses to boot without it):

  ```sh
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

### Environment variables (backend)

| Variable | Required | Notes |
| --- | --- | --- |
| `JWT_SECRET` | yes | generated above |
| `NODE_ENV` | yes | `production` |
| `CORS_ORIGIN` | yes | frontend origin(s), comma-separated; `*` only for same-origin proxy setups |
| `TRUST_PROXY` | yes (behind any proxy/LB) | `true` — Railway/Render edges and the nginx container all proxy; rate limiters need real client IPs |
| `APP_URL` | yes | public app URL, e.g. `https://app.markivo.uz` (Stripe redirects) |
| `DB_PATH` | yes | SQLite path on the persistent volume, e.g. `/app/database/markivo.db` |
| `ANTHROPIC_API_KEY` | no | blank = template fallback |
| `GOOGLE_MAPS_API_KEY` | no | blank = mock discovery scan |
| `TELEGRAM_ENABLED` | no | `true` for launch; `false` rolls back to coming-soon gate |
| `MEDIA_API_KEY` | no | media rendering engine (coming soon) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | no | blank = billing in SIMULATED mode (tier changes apply without payment) |
| `TIER_PRICE_PRO` / `TIER_PRICE_ULTIMATE` | no | monthly USD prices (defaults 20 / 50) |

Frontend build-time variable: `VITE_API_URL` — public API URL, or `/` when
nginx proxies `/api` same-origin (the docker-compose default).

---

## Variant A — Railway

1. Create a project, add a service from this repo, root directory `backend`
   (Railway auto-detects `backend/Dockerfile`).
2. Attach a **volume** mounted at `/app/database`, and a second one at
   `/app/uploads` (or one volume at `/app/database` and accept ephemeral
   uploads to start).
3. Set the env vars from the table above (Railway → Variables).
4. Add a second service for `frontend` (root directory `frontend`), with build
   arg / variable `VITE_API_URL=https://<backend-domain>` and set the backend's
   `CORS_ORIGIN=https://<frontend-domain>`.
5. Attach your domains, deploy, then run the smoke test (below).

## Variant B — Render

1. New → Web Service → this repo, root directory `backend`, runtime **Docker**.
2. Add a **Disk** mounted at `/app/database` (1 GB is plenty). Render allows one
   disk per service — uploads at `/app/uploads` are ephemeral unless you point
   the disk at `/app` parent paths; database persistence is the priority.
3. Set the env vars from the table above.
4. New → Web Service (or Static Site) for `frontend` with
   `VITE_API_URL=https://<backend>.onrender.com`; set `CORS_ORIGIN` to the
   frontend URL on the backend service.
5. Deploy, then run the smoke test.

## Variant C — VPS (docker compose)

```sh
# On the server, in the repo root — put secrets in .env next to docker-compose.yml:
cat > .env <<'EOF'
JWT_SECRET=<generated>
APP_URL=https://app.example.com
ANTHROPIC_API_KEY=...
GOOGLE_MAPS_API_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
EOF

docker compose up -d --build
```

- Frontend listens on `:8080` (nginx serves the SPA and proxies `/api` +
  `/uploads` to the backend, so CORS and `VITE_API_URL` defaults just work).
- Put **Caddy or nginx with Let's Encrypt** in front of `:8080` for TLS, e.g.
  Caddyfile: `app.example.com { reverse_proxy localhost:8080 }` — Caddy
  provisions certificates automatically. Keep `TRUST_PROXY=true` (default).
- Data persists in the `markivo-db` and `markivo-uploads` named volumes.

## Variant D — Free stack (Vercel + Fly.io) — keep SQLite

Cheapest way to go live: **frontend on Vercel (free)**, **backend on Fly.io
(free allowance, persistent volume)**, no database rewrite. Auth is bearer-token
(localStorage), so the split origin is fine — it just needs `CORS_ORIGIN` set.
Config files: `frontend/vercel.json` and `backend/fly.toml` (already in the repo).

> Free-tier limits and Vercel's exact DNS values drift over time — confirm them
> in each dashboard at signup rather than trusting the numbers below verbatim.

### 1. Backend → Fly.io

```sh
# Install flyctl + sign up (https://fly.io/docs/flyctl/install/)
curl -L https://fly.io/install.sh | sh
fly auth signup            # or: fly auth login

cd backend
fly launch --no-deploy --copy-config   # reuses backend/fly.toml; pick app name + region

# Persistent SQLite volume (must match `source`/`region` in fly.toml):
fly volumes create markivo_data --size 1 --region fra

# Secrets — never put these in fly.toml. Generate JWT_SECRET fresh here:
fly secrets set \
  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
  CORS_ORIGIN="https://trymarkivo.com,https://www.trymarkivo.com,https://<your-vercel-project>.vercel.app" \
  APP_URL="https://trymarkivo.com"
# Optional integrations (blank = graceful fallback):
#   fly secrets set ANTHROPIC_API_KEY=... GOOGLE_MAPS_API_KEY=... STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... MEDIA_API_KEY=...

fly deploy
curl https://<app-name>.fly.dev/api/health   # expect {"status":"ok"} / HTTP 200
```

The backend is now live on its free `https://<app-name>.fly.dev` domain — the
frontend calls that directly, so no custom API domain is required to launch.
(`min_machines_running = 1` keeps the scheduled-post worker ticking 24/7.)

### 2. Frontend → Vercel

1. Push the repo to GitHub, then **Add New → Project** at vercel.com and import it.
2. **Root Directory = `frontend`** (framework auto-detected as Vite via
   `frontend/vercel.json`).
3. Environment variable (Production): `VITE_API_URL=https://<app-name>.fly.dev`.
4. Deploy → live at `https://<your-vercel-project>.vercel.app`.

### 3. DNS → point trymarkivo.com at Vercel (Namecheap)

1. In Vercel: **Project → Settings → Domains → Add `trymarkivo.com`**. Vercel
   shows the exact records to create. Typically:
   - `A` record — Host `@` → `76.76.21.21`
   - `CNAME` record — Host `www` → `cname.vercel-dns.com`
2. Namecheap → **Domain List → Manage → Advanced DNS**: delete the default
   parking/CNAME records, add the two above. Keep "Namecheap BasicDNS" (no need
   to change nameservers).
3. Wait for propagation (minutes–hours). Vercel auto-provisions the HTTPS cert.
4. If you didn't already include the final domain in `CORS_ORIGIN`, set it now
   and `fly deploy` again.

### 4. Verify

```sh
./scripts/smoke.sh https://trymarkivo.com https://<app-name>.fly.dev
```

Later niceties (not needed to launch): an `api.trymarkivo.com` subdomain
(`fly certs add api.trymarkivo.com` + a `CNAME` to `<app-name>.fly.dev`),
a second Fly volume or object storage for durable uploads, and Supabase Postgres
if SQLite is outgrown (swap point: `backend/db.js`).

---

## Post-deploy smoke test

```sh
./scripts/smoke.sh https://app.example.com
# Split frontend/backend domains:
./scripts/smoke.sh https://app.example.com https://api.example.com
```

Checks health, register/login round-trip, authed `/api/usage`, and that the
SPA is served. Exits non-zero on any failure.

## Stripe webhook registration

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**.
2. Endpoint URL: `https://<your-domain>/api/billing/webhook`.
3. Subscribe to checkout/subscription events (at minimum
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`).
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy/restart.

## Rollback notes

- **Telegram**: set `TELEGRAM_ENABLED=false` and restart — routes return 503
  "coming soon" and the dashboard shows the Coming-soon pill. No code changes.
- **Bad release**: redeploy the previous image (Railway/Render keep deploy
  history; on a VPS `git checkout <last-good> && docker compose up -d --build`).
  The SQLite volume is untouched by image rollbacks.
- **Keys**: removing any integration key reverts that feature to its built-in
  mock/template fallback — safe partial rollback.
