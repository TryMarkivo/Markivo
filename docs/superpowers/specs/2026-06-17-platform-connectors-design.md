# Platform Connector Framework — Design Spec

**Date:** 2026-06-17
**Status:** Approved-to-build (user directive: "build all the frameworks for all the platforms")
**Author:** Markivo / Claude

## Goal

Let Markivo's AI agent **publish & manage content on behalf of business clients**
across multiple social platforms — *compliantly*, through each platform's
**official API** (never by impersonating/driving a personal account). Generalize
the proven Telegram pattern into one framework with thin per-platform **adapters**.

## The compliance principle (drives the whole design)

Markivo acts **on the user's behalf via the official API**, with a **human
approval gate** before anything publishes. It never logs in as the user or
automates the app UI. This is exactly what the Telegram integration already does
(user connects their own bot → Markivo publishes via Bot API → approval gate).

## Platforms (v1)

| Adapter key | Platform | Connect method | Live publish requires |
|---|---|---|---|
| `telegram` | Telegram | BotFather token (existing) | bot token + linked chat |
| `meta_instagram` | Instagram (Business/Creator) | Meta OAuth | Meta app + App Review + IG Business linked to a FB Page |
| `meta_facebook` | Facebook Page | Meta OAuth | Meta app + App Review + Page admin |
| `tiktok` | TikTok | TikTok OAuth | TikTok app + Content Posting audit |
| `google_business` | Google Business Profile | Google OAuth | Business Profile API access + verified location |
| `youtube` | YouTube | Google OAuth | YouTube Data API + channel |

Every adapter ships a **keyless sandbox fallback** (Markivo rule: no credential
ever breaks the app or the tests). Sandbox = connect is simulated, publish
records a simulated `posted` calendar entry, status reports `sandbox: true`.

## Architecture (additive — Telegram path untouched)

```
                         server.js routes / worker / agent
                                      │
                                      ▼
                       backend/connectors/registry.js
        ┌──────────────┬──────────────┼──────────────┬───────────────┐
        ▼              ▼              ▼              ▼               ▼
   telegram.js    meta.js        tiktok.js   googleBusiness.js  youtube.js
   (wraps the   (Graph API)   (Content API)  (Biz Profile API)  (Data API)
    existing                                                    
    tg client)        each implements the same PlatformAdapter contract (base.js)
```

### Adapter contract (`connectors/base.js`)

Every adapter is a stateless module exporting:

| Method | Purpose |
|---|---|
| `key`, `label`, `group` | identity (`group` e.g. `meta` ties IG+FB to one OAuth) |
| `isLive()` | real credentials configured? (else sandbox) |
| `getAuthUrl({ profile, state })` | OAuth consent URL, or `null` for non-OAuth (telegram) |
| `handleCallback({ db, profile, query })` | exchange code → tokens, persist (encrypted) |
| `status({ db, profile })` | `{ connected, live, sandbox, accountHandle, ... }` |
| `publish({ db, profile, text, mediaUrl })` | post via API (or simulate); throws `ConnectorError` on real failure |
| `disconnect({ db, profile })` | revoke + delete stored connection |
| `metrics?({ db, profile })` | optional follower/engagement read |

Adapters are **db-free of their own connection** — the server passes the single
`db` instance in (mirrors how `ai.js` receives closures). Tokens are stored
encrypted via `secrets.js` (same AES-256-GCM used for the Telegram token).

### Data layer (`db.js`, additive)

New generic table + `db.connections` namespace (Telegram keeps its own
`telegram_connections` table for back-compat; its adapter delegates there):

```sql
CREATE TABLE IF NOT EXISTS platform_connections (
  id, profile_id, platform, status, account_handle, account_id,
  access_token (enc), refresh_token (enc), token_expires_at, scopes,
  meta (JSON), created_at, updated_at, UNIQUE(profile_id, platform)
);
```

### Config (`config.js`, additive, keyless-detecting)

`config.connectors = { redirectBase, meta:{clientId,clientSecret,enabled},
tiktok:{clientKey,clientSecret,enabled}, google:{clientId,clientSecret,enabled} }`
— `enabled` is true only when both id+secret are present (else sandbox).
OAuth redirect = `${redirectBase}/api/connect/<key>/callback`.

### Server wiring (`server.js`, additive)

- Generic routes: `GET /api/connect/status`, `POST /api/connect/:key/start`,
  `GET /api/connect/:key/callback`, `POST /api/connect/:key/disconnect`.
- Generalized publish executor `executePost(profile, platform, text)` dispatches
  to the connector; Telegram keeps `executeTelegramPost` (delegated to by its
  adapter) so the existing approval/worker branches are unchanged.
- Approval gate: new `action_type: 'platform_post'` (carries `platform`); the
  existing `telegram_post` type stays working.
- Worker: `runScheduledPostsTick` dispatches due posts per-platform via the
  registry (Telegram branch preserved).

### Agent (`ai.js`, additive)

A generalized `publish_post` tool (with a `platform` arg) is offered for any
connected non-Telegram platform, returning `{ type: 'platform_post', platform,
text }`. The existing `post_to_telegram` tool + `{type:'telegram_post'}` return
are kept verbatim so current tests pass.

## Build order

1. **Foundation** — config block, `platform_connections` store, `base.js`,
   `registry.js`, `telegram` adapter (delegates to existing). Tests stay green. ← first checkpoint
2. **Adapters** — `meta`, `tiktok`, `googleBusiness`, `youtube` (parallel; each
   self-contained with sandbox fallback + unit tests).
3. **Wiring** — generic connect routes, generalized executor/worker/approval,
   agent `publish_post` tool.
4. **Frontend** — generalize `TelegramConnect.jsx` into a generic `ConnectCard`
   per platform (separate follow-up).
5. **Verify** — `cd backend && npm test` green; `cd frontend && npm run lint && npm run build`.

## Non-goals (v1)

- Going *live* on any platform (needs deployed domain + app review + legal pages).
- Comment/DM/review management (publish + status + basic metrics first).
- Durable media hosting for image/video posts (uploads still ephemeral).

## Credentials added (→ CREDENTIALS.local.md + backend/.env.example)

`META_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`,
`GOOGLE_OAUTH_CLIENT_ID/SECRET`, `OAUTH_REDIRECT_BASE`. All optional — blank =
sandbox.
