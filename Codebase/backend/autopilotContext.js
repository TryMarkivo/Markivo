// ==========================================================================
// Autopilot's context gate — "do we actually know enough to post right now?"
//
// This runs as a DISTINCT step before Autopilot spends a generation. Without
// it, a business we know nothing about still gets a post — a generic ad written
// from nothing. With it, Autopilot stops and asks the owner instead.
//
// The gate is a real interrupt, not a hopeful instruction inside a prompt: when
// context is insufficient the run RETURNS, a pending question row is written,
// and nothing is generated or published until the owner answers.
//
// Deliberately free of Express and fetch so the decision logic is unit-testable
// with no server and no network. The model call is injected (`gemini`), which is
// what lets a test drive the pause path without an API key.
//
// KEYLESS CONTRACT: with no GEMINI_API_KEY the assessor returns null and we fall
// back to `heuristicAssessment`, which says "sufficient" whenever there is any
// real signal to work from. That is deliberate — a pause is a POSITIVE finding
// ("we looked, and the context is genuinely thin"). With no model we have not
// looked, so claiming otherwise would report an assessment we never made, and
// would silently kill Autopilot on every keyless install.
// ==========================================================================

const businessContextService = require('./businessContextService');

// An unanswered question must not wedge Autopilot forever. After this long the
// gate expires the ask and re-assesses from scratch.
const CONTEXT_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The three things we need from the owner when we cannot work it out ourselves.
// Kept as plain English here; the UI renders them through i18n.
const DEFAULT_QUESTIONS = [
  'What kind of post do you want right now (offer, announcement, reminder, something else)?',
  'What is the goal of this campaign — more visits, more orders, more followers?',
  'What should someone do after seeing it (visit, call, order, book, follow)?',
];

// Everything the assessor is allowed to look at. Pure and synchronous: reads
// the db, touches no network.
function gatherChannelSignals({ db, profileId, platforms }) {
  const profile = db.profiles.findById(profileId);

  const connectedPlatforms = db.connections.listByProfile(profileId).map((c) => c.platform);
  const tg = db.telegram.findByProfile(profileId);
  const ig = db.instagram.findByProfile(profileId);

  const recentPosts = db.calendar.listByProfile(profileId).slice(-5).map((p) => p.post_text).filter(Boolean);
  const competitors = db.competitors.listByProfile(profileId)
    .filter((c) => c.source === 'manual' || c.source === 'places')
    .slice(0, 5)
    .map((c) => c.competitor_name)
    .filter(Boolean);

  return {
    profile,
    businessContext: businessContextService.getBusinessContext(db, profileId),
    userContext: db.autonomous.latestAnsweredContext(profileId),
    connectedPlatforms,
    telegram: { linked: !!tg, chatTitle: tg ? tg.chatTitle : null },
    instagram: { linked: !!ig, username: ig ? ig.igUsername : null },
    recentPosts,
    competitors,
    targetPlatforms: Array.isArray(platforms) ? platforms : [],
  };
}

// The deterministic, keyless assessment. Pure — no db, no network.
function heuristicAssessment(signals) {
  const s = signals || {};
  const profile = s.profile || {};

  const hasBusinessContext = !!(s.businessContext && String(s.businessContext.summary || '').trim());
  const hasUserAnswer = !!(s.userContext && String(s.userContext.answer || '').trim());
  const hasChannelSignal =
    (s.connectedPlatforms || []).length > 0
    || !!(s.telegram && s.telegram.linked)
    || !!(s.instagram && s.instagram.linked)
    || (s.recentPosts || []).length > 0
    || (s.competitors || []).length > 0
    || !!String(profile.description || '').trim();

  if (hasBusinessContext || hasUserAnswer || hasChannelSignal) {
    return {
      sufficient: true,
      adType: 'general promotional post',
      rationale: 'Working from the stored business context and the connected channel.',
      questions: [],
      source: 'heuristic',
    };
  }

  return {
    sufficient: false,
    adType: '',
    rationale:
      'Autopilot has no business description, no connected channel, no post history and no tracked '
      + 'competitors to work from, so anything it wrote would be generic.',
    questions: DEFAULT_QUESTIONS.slice(),
    source: 'heuristic',
  };
}

// Gemini first, deterministic heuristic when it is unavailable or misses.
async function assessContext({ db, gemini, profileId, platforms, signals }) {
  const sig = signals || gatherChannelSignals({ db, profileId, platforms });
  let assessment = null;
  try {
    assessment = gemini && gemini.assessAdContext ? await gemini.assessAdContext(sig) : null;
  } catch (err) {
    // gemini.assessAdContext swallows its own errors; this is belt-and-braces.
    console.error('assessAdContext threw unexpectedly, using heuristic:', err.message);
  }
  return assessment || heuristicAssessment(sig);
}

// The gate itself. Returns { ok: true, context } to proceed, or
// { ok: false, reason, request } to halt the run.
async function ensureContext({ db, gemini, profileId, platforms, nowMs = Date.now() }) {
  // 1. An outstanding question already put to the owner. Do NOT re-assess, do
  //    NOT create a second row, do NOT log again — on the 'test' cadence the
  //    worker ticks every 60s, which would flood the activity log and burn
  //    Gemini quota re-asking a question nobody has answered yet.
  const pending = db.autonomous.pendingContextRequest(profileId);
  if (pending) {
    const age = nowMs - Date.parse(pending.created_at);
    if (!(age >= CONTEXT_REQUEST_TTL_MS)) {
      return { ok: false, reason: 'awaiting-answer', request: pending };
    }
    // 2. Stale: expire it and fall through to a fresh assessment.
    db.autonomous.expireContextRequest(pending.id);
  }

  const signals = gatherChannelSignals({ db, profileId, platforms });

  // 3. The owner answered AFTER the most recent ask — respect it and proceed,
  //    without consulting the model. Otherwise an assessor that keeps returning
  //    "insufficient" would trap them in a loop they can never answer their way
  //    out of.
  const answeredAt = signals.userContext && Date.parse(signals.userContext.answeredAt || '');
  const lastAskedAt = pending ? Date.parse(pending.created_at) : null;
  if (answeredAt && (!lastAskedAt || answeredAt > lastAskedAt)) {
    return {
      ok: true,
      context: {
        businessContext: signals.businessContext,
        userContext: signals.userContext,
        adType: 'owner-directed post',
        rationale: 'Using the context the owner supplied.',
      },
    };
  }

  const assessment = await assessContext({ db, gemini, profileId, platforms, signals });

  if (assessment.sufficient) {
    return {
      ok: true,
      context: {
        businessContext: signals.businessContext,
        userContext: signals.userContext,
        adType: assessment.adType,
        rationale: assessment.rationale,
      },
    };
  }

  // 4. Insufficient: halt and ask. This is the interrupt.
  const request = db.autonomous.createContextRequest({
    profileId,
    questions: assessment.questions,
    rationale: assessment.rationale,
    adType: assessment.adType,
    source: assessment.source,
  });
  db.autonomous.logActivity({
    profileId,
    kind: 'context_needed',
    summary: assessment.rationale,
    payload: { requestId: request.id, questions: assessment.questions },
  });
  return { ok: false, reason: 'needs-context', request };
}

module.exports = {
  gatherChannelSignals,
  heuristicAssessment,
  assessContext,
  ensureContext,
  CONTEXT_REQUEST_TTL_MS,
  DEFAULT_QUESTIONS,
};
