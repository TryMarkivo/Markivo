# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: a marketing operator who runs social presence for **several business accounts at once** — long laptop sessions, high repetition, switching between client profiles many times a day. Density and speed matter more than hand-holding or onboarding warmth. Confirmed by the user this session.

Secondary (the accounts being managed): Uzbek small businesses — cafés, salons, retail boutiques, clinics — whose owners supplied the brand facts once at onboarding and do not log in daily.

Interface language is English, Russian, and Uzbek (`frontend/src/i18n/`), so every label must survive roughly 1.4× expansion into Russian without breaking layout.

## Product Purpose

Markivo runs a small business's entire social presence from one profile the owner filled in once: it writes the copy, generates or enhances the media, holds the queue, and publishes to the connected channels. Success is a queue that stays full and goes out on time without the operator writing anything from scratch.

## Positioning

The mechanism is the **single business profile as compiler input**. One structured record (category, tone, slogan, keywords, competitors, location) drives copy generation, media briefs, scheduling cadence, and per-platform formatting across every channel — instead of the operator retyping brand context into a general-purpose AI tool per post. It is built Uzbek-market-first: Telegram is a first-class publishing channel alongside Instagram, and posts can carry Uzbek, Russian, and English in one message in a chosen order.

## Operating Context

Seven working surfaces, all inside one shell with a persistent left rail and a persistent right-hand agent panel ("Markiv"):

1. **Dashboard** — channel connection status, three headline metrics with recorded history, local SEO keyword ranks, AI search visibility.
2. **AI Content Engine** — pick platform, pick language order, generate copy, attach photo/video, post now or schedule. Also holds reusable message templates.
3. **Autopilot** — the autonomous agent loop plus a month calendar of scheduled and published posts.
4. **Media Studio** — generate a creative brief, render or upload an image/video, then publish it through the same post/schedule path.
5. **Competitor Intel** — nearby competitors captured at onboarding.
6. **Connections** — OAuth/token connection per platform.
7. **Settings** — profile, billing, language, theme.

Rituals that matter: check what went out, fix what failed, refill the queue, switch to the next account.

## Capabilities and Constraints

- Backend is Express + SQLite (`backend/db.js` is the single data-layer swap point); ~60 routes. Frontend is React + Vite, vanilla CSS with custom-property tokens, `react-i18next`, Font Awesome icon set.
- **Keyless doctrine (binding):** every integration must work with a blank credential via graceful fallback. The UI therefore must be able to render every surface with mock, empty, or partial data without breaking.
- **Live today:** Instagram and Telegram publishing, Gemini copy generation, scheduling worker, media upload, recorded metric history.
- **Not live today (must not be presented as real):** Anthropic-backed Markiv agent (falls back to canned template replies), AI image rendering (`MEDIA_API_KEY` unset → 501), video rendering (never implemented), Google Maps competitor scan (mock), AI Search Visibility score (hardcoded 78 / "Top 5" for every business), Google views / Instagram followers metrics (hardcoded constants), TikTok / Facebook / Google Business / YouTube publishing (simulated). Stripe runs on test keys.
- Consequence for design: the interface needs a **first-class, honest "simulated / demo data" state** — this is a real recurring product state, not an edge case.
- Feature flag `TELEGRAM_ENABLED` in `backend/config.js`.
- Media is fetched server-side from a public URL by Instagram and Telegram, so `PUBLIC_BASE_URL` is required to publish; Instagram has no text-only post type.

## Brand Commitments

- Name: **Markivo**. The in-app agent is **Markiv**.
- Logo asset `frontend/src/assets/markivo-logo.png` is binding and must be kept.
- Light/dark theme toggle must remain fully functional in both directions.
- Everything else — accent color (the incumbent `#d4a373` gold), typefaces, component language, layout — was explicitly released by the user this session: "nothing is sacred — brand included."

## Evidence on Hand

- Real: live Telegram subscriber counts, real generated copy, real scheduled/published post records, uploaded user media.
- Absent and must not be fabricated: customer names, testimonials, pricing proof, case studies, benchmark numbers, user counts, real Google/Instagram analytics. Any figure shown for those is demo data and must be labeled as such in the interface.

## Product Principles

1. **Never present simulated output as real.** Demo data, canned agent replies, and simulated publishes are labeled at the point of display, not in a JSON field.
2. **The queue is the product.** What is scheduled, what went out, and what failed outranks every vanity metric on screen.
3. **One profile, many channels.** Per-platform differences are surfaced as constraints and previews, never as separate re-authoring work.
4. **Built for the second hour, not the first minute.** The operator is repeating themselves across accounts; optimize for scanning, keyboard reach, and low-ceremony repetition over guided delight.
5. **Degrade in the open.** A missing credential produces a legible, actionable state, never a broken screen and never a silent fake.

## Accessibility & Inclusion

- Trilingual UI (en/ru/uz); layouts must tolerate Russian string expansion.
- Both themes must meet normal text contrast; the incumbent design fails this in places (muted text on translucent surfaces).
- Long sessions on a laptop: motion must be bounded and honor `prefers-reduced-motion`.
