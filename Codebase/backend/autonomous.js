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

// How much of the owner's WEEKLY writing allowance is left (mirrors
// server.usageInfo, db-only). Autopilot writes posts, so it spends from the
// same pool as anything the owner types by hand — a scheduled post is not
// cheaper to produce than a manual one.
function writingRemaining(db, config, userId, tier) {
  const t = config.aiTierLimits[tier] != null ? tier : 'freemium';
  const limit = config.aiTierLimits[t].writing;
  return Math.max(0, limit - db.usage.countThisWeek(userId, 'writing'));
}

// Run Autopilot once for a single profile. Returns a small summary object.
// `force` (manual "Run now") bypasses the dueness claim; worker-initiated runs
// must win an atomic claim so overlapping ticks can't double-run a profile.
async function runProfileAutopilot({ db, ai, connectors, config, publishers = {}, profileId, nowMs = Date.now(), force = false }) {
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

  // Respect the owner's weekly writing allowance — pause until it resets.
  // `budget` is re-read here rather than trusted later: the plan may contain
  // more posts than the owner can still afford, and publishing unbudgeted work
  // would let Autopilot quietly outspend everyone who writes by hand.
  const budget = user ? writingRemaining(db, config, user.id, user.tier) : Infinity;
  if (budget <= 0) {
    db.autonomous.logActivity({ profileId, kind: 'skipped', summary: 'Weekly writing allowance reached — Autopilot paused until it resets on Monday.' });
    return { skipped: 'budget' };
  }

  // Target platforms: the owner's chosen set intersected with what's actually
  // connected (Telegram counts when a bot is linked). Fall back to the chosen
  // set, then to Instagram, so a keyless/sandbox setup still produces drafts.
  const connected = new Set(db.connections.listByProfile(profileId).map((c) => c.platform));
  if (db.telegram.findByProfile(profileId)) connected.add('telegram');
  let platforms = (cfg.platforms || []).filter((p) => connected.size === 0 || connected.has(p));
  if (!platforms.length) platforms = (cfg.platforms && cfg.platforms.length) ? cfg.platforms : ['meta_instagram'];

  const recentPosts = db.calendar.listByProfile(profileId).slice(-5).map((p) => p.post_text).filter(Boolean);
  const competitors = db.competitors.listByProfile(profileId).slice(0, 5).map((c) => c.competitorName).filter(Boolean);

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
    });
  } catch (err) {
    db.autonomous.logActivity({ profileId, kind: 'error', summary: `Analysis failed: ${err.message}` });
    return { error: err.message };
  }

  db.autonomous.logActivity({ profileId, kind: 'analysis', summary: plan.analysis, payload: { platforms } });

  const tgConn = db.telegram.findByProfile(profileId);

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
  let spent = 0;
  let unaffordable = 0;

  for (let i = 0; i < plan.posts.length; i += 1) {
    const post = plan.posts[i];
    const platform = String(post.platform || 'meta_instagram').toLowerCase();

    // Guard against a live model returning a platform key we can't act on (e.g.
    // 'instagram' instead of 'meta_instagram'). Such a post would otherwise
    // become an orphaned scheduled row or an un-executable approval. Skip it.
    if (platform !== 'telegram' && !connectors.get(platform)) {
      errors += 1;
      db.autonomous.logActivity({ profileId, kind: 'error', summary: `Skipped a post for unknown channel "${platform}".` });
      continue;
    }

    // One post, one unit — the same price the owner pays writing it by hand.
    // A plan can be larger than what is left, so the run delivers what it can
    // afford and stops. Charged BEFORE the post exists, so a publish failure
    // still counts: the generation was produced either way.
    if (spent >= budget) {
      unaffordable += 1;
      continue;
    }
    if (user) db.usage.record({ userId: user.id, kind: 'autonomous', bucket: 'writing' });
    spent += 1;

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

  // Say so out loud when the allowance truncated the run — silently producing
  // fewer posts than planned would look like the model underdelivering.
  if (unaffordable) {
    db.autonomous.logActivity({
      profileId,
      kind: 'skipped',
      summary: `Weekly writing allowance reached — ${unaffordable} of ${plan.posts.length} posts were not created. Resets Monday.`,
    });
  }

  return {
    posts: plan.posts.length, published, scheduled, queued, errors, unaffordable,
    autoPublish: cfg.autoPublish,
  };
}

// Scan for all due Autopilot profiles and run each. Called on an interval by the
// server, and on demand by tests.
async function runAutonomousTick({ db, ai, connectors, config, publishers, now = Date.now() }) {
  const due = db.autonomous.dueProfiles(new Date(now).toISOString());
  const results = [];
  for (const profileId of due) {
    try {
      results.push({ profileId, ...(await runProfileAutopilot({ db, ai, connectors, config, publishers, profileId, nowMs: now })) });
    } catch (err) {
      db.autonomous.logActivity({ profileId, kind: 'error', summary: err.message });
      results.push({ profileId, error: err.message });
    }
  }
  return { due: due.length, results };
}

module.exports = { runAutonomousTick, runProfileAutopilot, nextRunFrom };
