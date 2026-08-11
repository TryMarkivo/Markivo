# Markivo — Deployment checklist

Sequenced go-live guide. The app runs keyless (every integration falls back
gracefully), so you can deploy first and switch integrations to live one at a
time. Secrets come from `CREDENTIALS.local.md` → `backend/.env`; see
[`CLAUDE.md`](./CLAUDE.md) for the credentials workflow.

## Architecture

Two containers (see [`Codebase/docker-compose.yml`](./Codebase/docker-compose.yml)):
- **backend** — Express API on `:5000`, SQLite + uploads on named volumes.
- **frontend** — nginx serving the built React bundle on `:8080`, proxying
  `/api` and `/uploads` to the backend (same-origin, so no CORS needed).

For public HTTPS, [`docker-compose.prod.yml`](./docker-compose.prod.yml) overlays a
**Caddy** container in front of the frontend (automatic Let's Encrypt certs for the
apex plus `www.`, `login.`, and `app.` — see [`Caddyfile`](./Caddyfile)).

## Pre-flight (must do)

- [ ] **Rotate `JWT_SECRET`** — generate a fresh one, don't reuse the dev value:
      `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- [ ] **Set `CORS_ORIGIN`** to your real frontend origin (e.g.
      `https://app.trymarkivo.com`). Leave `*` only if the frontend is served
      same-origin via the nginx container. With subdomain routing on, list
      **every** origin the SPA is served from — see the table below.
- [ ] **Set `APP_URL`** to the public frontend URL (Stripe redirects, message links).
- [ ] **`TRUST_PROXY=true`** when behind nginx / Railway / Render (already the
      compose default) so rate limiters key on the real client IP.
- [ ] **`VITE_API_URL`** — baked into the frontend at build time. Use `/` for the
      same-origin nginx setup (compose default), or the public API URL for a
      split deploy.
- [ ] **`VITE_ROOT_DOMAIN`** — also baked in at build time. Set it to
      `trymarkivo.com` **if you serve the app on `login.` / `app.` subdomains**;
      leave blank only for a genuine single-origin deploy. See
      [Subdomain routing](#subdomain-routing) below — getting this wrong is silent.
- [ ] Confirm the **persistent volumes** (`markivo-db`, `markivo-uploads`) are
      backed by durable storage on your host/platform.

## Deploy (Docker)

`docker-compose.yml` lives in `Codebase/`, so run compose from there:

```bash
cd Codebase
# Provide secrets via a .env next to docker-compose.yml, or your platform's
# secret store, then:
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") \
  docker compose up --build -d

# Frontend → http://localhost:8080   API → http://localhost:5000
# Health   → http://localhost:5000/api/health  → {"status":"ok"}
```

### Public HTTPS (Caddy overlay)

`docker-compose.prod.yml` and `Caddyfile` live at the **repo root**, one level up
from `docker-compose.yml`. Compose resolves every relative path in a merged stack
against the directory of the *first* `-f` file, so the two cannot both be satisfied
by a naive invocation — verify with `docker compose ... config` before deploying:

```bash
# From the repo root — confirm BOTH resolve to real paths in the output:
#   frontend build context -> Codebase/frontend
#   caddy volume source    -> <repo root>/Caddyfile
docker compose -f Codebase/docker-compose.yml -f docker-compose.prod.yml config \
  | grep -A2 -E 'context:|source:.*Caddyfile'
```

If the Caddyfile source resolves to `Codebase/Caddyfile` (which does not exist),
either keep `Caddyfile` + `docker-compose.prod.yml` beside `docker-compose.yml` in
`Codebase/`, or change the overlay's mount to `../Caddyfile`. Pick one and make the
deploy script match — a wrong path here silently drops TLS for every hostname.

**Changing a `VITE_*` value requires `--build`** — those are baked into the static
bundle at image-build time, so a plain `restart` or `up -d` keeps serving the old one.

```bash
docker compose -f Codebase/docker-compose.yml -f docker-compose.prod.yml \
  up -d --build frontend
```

`docker-compose.yml` reads these from the environment (all optional except
`JWT_SECRET` in prod): `CORS_ORIGIN`, `APP_URL`, `ANTHROPIC_API_KEY`,
`AI_CONTENT_MODEL`, `AI_AGENT_MODEL`, `GOOGLE_MAPS_API_KEY`, `MEDIA_API_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TIER_PRICE_PRO`,
`TIER_PRICE_ULTIMATE`, `TELEGRAM_ENABLED`, `INSTAGRAM_APP_ID`,
`INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI`, `PUBLIC_BASE_URL`.

Two more are read from the environment but passed as **build args**, not runtime
env — they are inlined into the static bundle and only change on a rebuild:
`VITE_API_URL`, `VITE_ROOT_DOMAIN`.

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

## Subdomain routing

Optional, and **off unless `VITE_ROOT_DOMAIN` is set at build time**. The `Caddyfile`
already terminates TLS for all four hostnames and nginx's `server_name _` matches any
host, so DNS + certs can be fully correct while the app still ignores the subdomain
entirely. Full reference: [`Codebase/DEPLOY.md`](./Codebase/DEPLOY.md#subdomain-routing-optional).

| Hostname | Section |
|---|---|
| `trymarkivo.com`, `www.trymarkivo.com` | Landing |
| `login.trymarkivo.com` | Auth (login / register) |
| `app.trymarkivo.com` | The whole authed app — setup wizard **and** dashboard, told apart by in-app state, not by subdomain |

Checklist:

- [ ] DNS record for each subdomain pointing at the frontend host.
- [ ] Hostname listed in `Caddyfile` (all four already are).
- [ ] `VITE_ROOT_DOMAIN=trymarkivo.com` in the deploy environment, **and the frontend
      image rebuilt** (`up -d --build frontend`) — a restart will not pick it up.
- [ ] `CORS_ORIGIN` lists every origin, unless the API is same-origin (`VITE_API_URL=/`,
      the compose default, in which case it is not needed).

**Verify it actually shipped** — a blank value is compiled away silently, with no error
in any log. Check the served bundle rather than trusting the env:

```sh
ASSET=$(curl -s https://app.trymarkivo.com/ \
  | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -s "https://app.trymarkivo.com$ASSET" | grep -cF 'trymarkivo.com`.replace'
```

`1` = the root domain was baked in and `login.` / `app.` route correctly.
`0` = routing is **off**; every subdomain renders the landing view.

Match the initializer, not the bare domain — the landing page also contains the
string `app.trymarkivo.com` in its hero mockup, so a plain `grep -c 'trymarkivo.com'`
reports a hit either way. The pattern above keys on the minified `ROOT_DOMAIN`
constant, which is emitted as an empty literal when the build var is blank.

## Post-deploy smoke test

- [ ] `GET /api/health` → `{"status":"ok"}`
- [ ] Register a user, complete onboarding into the dashboard.
- [ ] Generate content (templated or live depending on the AI key).
- [ ] `docker compose logs backend` — no crash loops; only the expected
      keyless-fallback warnings for integrations you haven't enabled yet.
- [ ] If subdomain routing is on: `login.` shows the auth form and `app.` shows the
      app — not the landing page (see the bundle check above).
