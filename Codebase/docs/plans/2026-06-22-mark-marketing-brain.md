# Plan: Make Mark a professional marketer (Brand Identity Engine + content pipeline)

**Date:** 2026-06-22
**Decision:** Build "Both as one system" — a deep Brand Identity Engine plus a
multi-step content-quality pipeline that reads from it. Add a **keyless Gemini
adapter** now (flips live when `GEMINI_API_KEY` is set), mirroring the existing
Anthropic keyless-fallback pattern.

## Why
Today Mark generates *plausible but generic* output: single-shot Claude calls
with "you are an expert" prompts over thin profile fields (`businessName,
category, brandTone, description, targetAudience, location, slogan`). No
strategy layer, no brand depth, no self-critique, no marketing frameworks.
Generic in → generic out.

## The 6 levers (what "training" actually means here — no fine-tuning)
1. **Brand Identity Engine** — rich brand brief built once, stored, read by every generator.
2. **Marketing methodology in prompts** — real frameworks (hooks, AIDA/PAS, platform-native rules, CTA discipline).
3. **Multi-step pipeline** — research/strategy → draft → self-critique (rubric) → refine.
4. **Quality rubric gate** — specificity, on-brand voice, hook, CTA, no-cliché.
5. **Exemplar + banned-cliché bank** — great/bad per platform; ban current filler.
6. **Gemini role + preference memory** — Gemini = grounded research; Claude = strategy/voice/copy/critique; capture approve/edit/reject at the gate as per-business preference.

## Constraints (MUST hold)
- Keyless fallback everywhere — blank credential never breaks app or tests.
- All 99 backend tests stay green; `templateContent/Slogans/AgentAct/...` signatures unchanged.
- Money/ad approval gate stays deterministic, never model-decided.
- New creds → fill-in section in `CREDENTIALS.local.md` + placeholder in `.env.example`.
- Additive db columns only (`addColumn()` try/catch ALTER pattern).

## Build phases
- **P1 (workflow, parallel authoring):** brand-brief framework + gen prompt + template fallback; copy frameworks + per-platform rules; quality rubric + banned-cliché/anti-pattern bank; per-platform exemplars; pipeline prompts (strategy/draft/critique/refine) + upgraded agent system prompt; Gemini research role. Critic pass for contradictions/gaps.
- **P2 (main context, integration):**
  - `backend/providers/{anthropic,gemini,index}.js` — provider abstraction, keyless.
  - `backend/marketing/{frameworks,rubric,exemplars}.js` — static knowledge.
  - `backend/brand.js` — brand-brief schema, `generateBrandBrief()`, template fallback.
  - `backend/ai.js` — pipeline (`generateContent` → strategy→draft→critique→refine reading brief); upgraded `agentAct` system prompt; all keyless paths preserved.
  - `backend/db.js` — additive `brand_brief` storage on profile.
  - `backend/server.js` — endpoints to generate/get/update brand brief; pass brief into generators.
  - `backend/config.js` + `.env.example` + `CREDENTIALS.local.md` — `GEMINI_API_KEY`.
  - Frontend — surface/edit brand brief; wire pro content path. (May phase.)
  - Tests stay green; add brand + pipeline + provider-fallback tests.

## Out of scope (for now)
- Real image/video rendering (mediagen stays keyless 501) — we improve the *prompts* it would consume.
- Live Gemini key wiring (adapter is keyless stub until a key is provided).
