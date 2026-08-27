// ==========================================================================
// Autopilot — the autonomous marketing agent worker.
//
// For each business that has enabled Autopilot and is due, it: analyzes the
// profile + recent activity, generates platform-native ORGANIC promotional
// posts, and then either publishes them right away through the platform
// connectors (sandbox-simulated when keyless, live when connected) or queues
// them as pending approvals for one-tap human sign-off — per the owner's
// `autoPublish` setting.
//
// SAFETY INVARIANT (mirrors CLAUDE.md): Autopilot NEVER creates or runs paid ad
// campaigns. It only ever produces FREE organic posts. Money spend always stays
// behind the deterministic human approval gate in server.js — never decided by
// the model or triggered automatically here.
//
// Publishing goes through injected `publishers` closures so this module stays
// decoupled from server.js's Express helpers (same pattern as the agent's
// `actions`). When a platform can't be published right now (e.g. Telegram is
// off or unlinked), the post is scheduled to the calendar instead, so nothing
// is lost — the scheduled-post worker delivers it once the channel is ready.
// ==========================================================================

const autopilotContext = require('./autopilotContext');
const geminiDefault = require('./gemini');

const FREQ_MS = {
  test: 60 * 1000, // 1 minute — for demos and tests
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

function nextRunFrom(frequency, fromMs) {
  return new Date(fromMs + (FREQ_MS[frequency] || FREQ_MS.daily)).toISOString();
}

// Spread deferred posts into the near future so they don't all fire at once.
function scheduledTimeFor(index, fromMs) {
  return new Date(fromMs + (2 + index * 60) * 60 * 1000).toISOString();
}

// Owner's monthly AI allowance (mirrors server.usageInfo, db-only).
function withinBudget(db, config, userId, tier) {
  const t = config.aiTierLimits[tier] != null ? tier : 'freemium';
  return db.usage.countThisMonth(userId) < config.aiTierLimits[t];
}

// Read back real content from the business's own connected accounts (best
// effort, cooldown-gated so a frequent tick doesn't hammer Meta/YouTube/
// Telegram) plus real competitor content already collected by Competitor
// Intel, and fold both into a short planning digest. Never throws — every
// fetch failure just means that platform contributes nothing this round.
async function gatherExternalActivity({ db, ownContentFetch, config, profileId, connectedPlatforms, tgConn, nowMs }) {
  const cooldownMs = config.ownContentFetchCooldownMs;
  for (const platform of connectedPlatforms) {
    const conn = platform === 'telegram' ? null : db.connections.findByProfile(profileId, platform);
    const source = db.ownContent.sourceFor(profileId, platform);
    const stale = !source || !source.lastFetchedAt || (nowMs - new Date(source.lastFetchedAt).getTime()) > cooldownMs;
    if (!stale) continue;
    const result = await ownContentFetch.fetchOwnContent(platform, conn, tgConn);
    db.ownContent.upsertSource({ profileId, platform, status: result.error ? 'error' : (result.found ? 'ok' : 'empty'), error: result.error });
    if (result.posts && result.posts.length) db.ownContent.replacePosts(profileId, platform, result.posts);
  }

  const ownPosts = db.ownContent.listByProfile(profileId, 15);
  const ownExternalActivity = ownPosts
    .filter((p) => p.caption)
    .slice(0, 8)
    .map((p) => `[${p.platform}] ${String(p.caption).slice(0, 100)}`);

  const competitorPosts = db.competitorPosts.listByProfile(profileId, 40).filter((p) => p.caption);
  const competitors = db.competitors.listByProfile(profileId).filter((c) => c.source === 'manual' || c.source === 'places');
  const nameById = Object.fromEntries(competitors.map((c) => [c.id, c.competitor_name]));
  const competitorHighlights = competitorPosts
    .slice(0, 8)
    .map((p) => `${nameById[p.competitorId] || 'A competitor'}: "${String(p.caption).slice(0, 100)}"`);

  return { ownExternalActivity, competitorHighlights, ownPostCount: ownPosts.length, competitorPostCount: competitorPosts.length };
}

// Run Autopilot once for a single profile. Returns a small summary object.
// `force` (manual "Run now") bypasses the dueness claim; worker-initiated runs
// must win an atomic claim so overlapping ticks can't double-run a profile.
async function runProfileAutopilot({ db, ai, connectors, config, publishers = {}, ownContentFetch, gemini = geminiDefault, profileId, nowMs = Date.now(), force = false }) {
  const profile = db.profiles.findById(profileId);
  const cfg = db.autonomous.getConfig(profileId);
  if (!profile || !cfg || !cfg.enabled) return { skipped: 'not-enabled' };

  const user = db.users.findById(profile.userId);
  const nowIso = new Date(nowMs).toISOString();
  const nextRunAt = nextRunFrom(cfg.frequency, nowMs);

  // Claim this run up front (advance next_run_at BEFORE the first await). The
  // worker path uses an atomic conditional claim: if another tick already took
  // this profile — or it isn't due — claimDue returns false and we bail, so a
  // profile is never run twice. Manual "Run now" (force) skips the dueness check.
  if (force) {
    db.autonomous.setRun(profileId, { lastRunAt: nowIso, nextRunAt });
  } else if (!db.autonomous.claimDue(profileId, nowIso, nextRunAt)) {
    return { skipped: 'not-due' };
  }

  // Respect the owner's monthly AI allowance — pause until it resets.
  if (user && !withinBudget(db, config, user.id, user.tier)) {
    db.autonomous.logActivity({ profileId, kind: 'skipped', summary: 'Monthly AI allowance reached — Autopilot paused until it resets.' });
    return { skipped: 'budget' };
  }

  // Target platforms: the owner's chosen set intersected with what's actually
  // connected (Telegram counts when a bot is linked). Fall back to the chosen
  // set, then to Instagram, so a keyless/sandbox setup still produces drafts.
  const tgConn = db.telegram.findByProfile(profileId);
  const connected = new Set(db.connections.listByProfile(profileId).map((c) => c.platform));
  if (tgConn) connected.add('telegram');
  let platforms = (cfg.platforms || []).filter((p) => connected.size === 0 || connected.has(p));
  if (!platforms.length) platforms = (cfg.platforms && cfg.platforms.length) ? cfg.platforms : ['meta_instagram'];

  const recentPosts = db.calendar.listByProfile(profileId).slice(-5).map((p) => p.post_text).filter(Boolean);
  const competitors = db.competitors.listByProfile(profileId).filter((c) => c.source === 'manual' || c.source === 'places').slice(0, 5).map((c) => c.competitor_name).filter(Boolean);

  // Best-effort live read of real content: the business's own connected
  // accounts (organic posts made outside Markivo) plus real fetched competitor
  // posts (not just names) — see gatherExternalActivity above. Never throws;
  // a total failure here just means the plan proceeds without this extra context.
  let ownExternalActivity = [];
  let competitorHighlights = [];
  let externalActivityCounts = { ownPostCount: 0, competitorPostCount: 0 };
  if (ownContentFetch) {
    try {
      const gathered = await gatherExternalActivity({ db, ownContentFetch, config, profileId, connectedPlatforms: connected, tgConn, nowMs });
      ownExternalActivity = gathered.ownExternalActivity;
      competitorHighlights = gathered.competitorHighlights;
      externalActivityCounts = gathered;
    } catch (err) {
      db.autonomous.logActivity({ profileId, kind: 'error', summary: `Own/competitor content read failed: ${err.message}` });
    }
  }

  // CONTEXT GATE — a distinct, testable step, not a line in the generation
  // prompt. Autopilot must not fire off a generic ad: before spending anything
  // we check whether this channel actually gives us enough to say something
  // worth saying. If it does not, the run HALTS here and the owner is asked.
  // Runs BEFORE db.usage.record below, so a paused run costs the owner nothing.
  // (The assessment itself is a cheap Flash call and is not metered, the same
  // way the onboarding brand brief isn't.)
  const gate = await autopilotContext.ensureContext({ db, gemini, profileId, platforms, nowMs });
  if (!gate.ok) {
    return { paused: 'needs-context', reason: gate.reason, requestId: gate.request ? gate.request.id : null };
  }

  // One analyze+generate call counts as one AI generation against the allowance.
  if (user) db.usage.record({ userId: user.id, kind: 'autonomous' });

  let plan;
  try {
    plan = await ai.analyzeAndPlan({
      platforms,
      businessName: profile.businessName,
      category: profile.category,
      description: profile.description,
      brandTone: profile.brandTone,
      audience: profile.targetAudience,
      location: profile.location,
      recentPosts,
      competitors,
      ownExternalActivity,
      competitorHighlights,
      // The stored per-business context cell plus whatever the owner told us
      // when Autopilot last asked, so generation is grounded in THIS business.
      businessContext: gate.context.businessContext,
      userContext: gate.context.userContext,
      adType: gate.context.adType,
    });
  } catch (err) {
    db.autonomous.logActivity({ profileId, kind: 'error', summary: `Analysis failed: ${err.message}` });
    return { error: err.message };
  }

  db.autonomous.logActivity({ profileId, kind: 'analysis', summary: plan.analysis, payload: { platforms } });
  if (externalActivityCounts.ownPostCount || externalActivityCounts.competitorPostCount) {
    db.autonomous.logActivity({
      profileId,
      kind: 'external_content',
      summary: `Grounded this plan in ${externalActivityCounts.ownPostCount} real post${externalActivityCounts.ownPostCount === 1 ? '' : 's'} from your own connected accounts and ${externalActivityCounts.competitorPostCount} from tracked competitors.`,
      // The actual snippets that fed the prompt — otherwise they're used once
      // and thrown away, leaving the owner with only a count in the summary.
      payload: { ownExternalActivity: ownExternalActivity.slice(0, 5), competitorHighlights: competitorHighlights.slice(0, 5) },
    });
  }

  // Publish `text` to `platform` now, or report that it must be deferred.
  const publishNow = async (platform, text) => {
    if (platform === 'telegram') {
      if (publishers.telegramReady && publishers.telegramReady(profile) && publishers.publishTelegram) {
        await publishers.publishTelegram(profile, text);
        return { published: true, simulated: false };
      }
      return { deferred: true };
    }
    if (publishers.publishPlatform && connectors.get(platform)) {
      const r = await publishers.publishPlatform(profile, platform, text);
      return { published: true, simulated: !!(r && r.simulated) };
    }
    return { deferred: true };
  };

  let published = 0;
  let scheduled = 0;
  let queued = 0;
  let errors = 0;

  for (let i = 0; i < plan.posts.length; i += 1) {
    const post = plan.posts[i];
    const platform = String(post.platform || 'meta_instagram').toLowerCase();

    // Guard against a live model returning a platform key we can't act on (e.g.
    // a bare 'instagram', or a Meta key while Meta is disabled). Such a post
    // would otherwise become an orphaned scheduled row or an un-executable
    // approval. Skip it.
    if (platform !== 'telegram' && !connectors.get(platform)) {
      errors += 1;
      db.autonomous.logActivity({ profileId, kind: 'error', summary: `Skipped a post for unknown channel "${platform}".` });
      continue;
    }

    // Queue mode: create a pending organic approval for one-tap human sign-off.
    if (!cfg.autoPublish) {
      const isTg = platform === 'telegram';
      const adapter = isTg ? null : connectors.get(platform);
      const approval = db.approvals.create({
        profileId,
        actionType: isTg ? 'telegram_post' : 'platform_post',
        actionPayload: {
          action: `Publish ${isTg ? 'Telegram' : (adapter ? adapter.label : platform)} Post`,
          cost: 'Free — organic post',
          target: isTg ? ((tgConn && tgConn.chatTitle) || 'your channel') : (adapter ? adapter.label : platform),
          creative: post.text,
          text: post.text,
          platform: isTg ? undefined : (adapter ? adapter.key : platform),
          autonomous: true, // lets the UI badge it as Autopilot-generated
        },
      });
      queued += 1;
      db.autonomous.logActivity({ profileId, kind: 'approval_created', summary: post.text.slice(0, 140), payload: { platform, approvalId: approval.id } });
      continue;
    }

    // Auto-publish mode: post it now (or schedule it if the channel isn't ready).
    try {
      const result = await publishNow(platform, post.text);
      if (result.deferred) {
        const row = db.calendar.add({ profileId, platform, postText: post.text, scheduledTime: scheduledTimeFor(i, nowMs), status: 'scheduled' });
        scheduled += 1;
        db.autonomous.logActivity({ profileId, kind: 'post_scheduled', summary: post.text.slice(0, 140), payload: { platform, calendarId: row.id, scheduledTime: row.scheduled_time } });
      } else {
        published += 1;
        db.autonomous.logActivity({ profileId, kind: 'post_published', summary: post.text.slice(0, 140), payload: { platform, simulated: result.simulated } });
      }
    } catch (err) {
      errors += 1;
      db.autonomous.logActivity({ profileId, kind: 'error', summary: `${platform}: ${err.message}` });
    }
  }

  return { posts: plan.posts.length, published, scheduled, queued, errors, autoPublish: cfg.autoPublish };
}

// Scan for all due Autopilot profiles and run each. Called on an interval by the
// server, and on demand by tests.
async function runAutonomousTick({ db, ai, connectors, config, publishers, ownContentFetch, gemini, now = Date.now() }) {
  const due = db.autonomous.dueProfiles(new Date(now).toISOString());
  const results = [];
  for (const profileId of due) {
    try {
      results.push({ profileId, ...(await runProfileAutopilot({ db, ai, connectors, config, publishers, ownContentFetch, gemini, profileId, nowMs: now })) });
    } catch (err) {
      db.autonomous.logActivity({ profileId, kind: 'error', summary: err.message });
      results.push({ profileId, error: err.message });
    }
  }
  return { due: due.length, results };
}

module.exports = { runAutonomousTick, runProfileAutopilot, nextRunFrom };
