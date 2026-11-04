// ==========================================================================
// Autopilot — the autonomous marketing agent worker.
//
// For each business that has enabled Autopilot, on the owner's posting plan
// (autopilotSchedule.js — fixed days and times, or "you decide" from the
// channel's best hours): it learns how the channel writes and what it posts
// about (autopilotStyle.js), asks the owner what it can't learn
// (autopilotBrief.js + autopilotContext.js), picks the next topic, writes
// platform-native ORGANIC posts for that slot, and then either puts them on
// the Calendar at the slot (the scheduled-post worker publishes them —
// sandbox-simulated when keyless, live when connected) or queues them as
// pending approvals for one-tap human sign-off — per the owner's
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
const autopilotSchedule = require('./autopilotSchedule');
const autopilotStyle = require('./autopilotStyle');
const autopilotBrief = require('./autopilotBrief');
const businessContextService = require('./businessContextService');
const geminiDefault = require('./gemini');
const i18n = require('./i18n');

const FREQ_MS = {
  test: 60 * 1000, // 1 minute — for demos and tests
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

// The posting plan in force: the owner's saved schedule, else one derived
// from the legacy frequency. 'test' keeps the old one-minute demo cadence.
const isLegacyCadence = (cfg) => cfg.frequency === 'test';

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

// Read back real content from the business's own connected accounts (best
// effort, cooldown-gated so a frequent tick doesn't hammer Meta/YouTube/
// Telegram) plus real competitor content already collected by Competitor
// Intel, and fold both into a short planning digest. Never throws — every
// fetch failure just means that platform contributes nothing this round.
async function gatherExternalActivity({ db, ownContentFetch, config, profileId, connectedPlatforms, tgConn, nowMs }) {
  const cooldownMs = config.ownContentFetchCooldownMs;
  // Learning from forwarded posts only (config.autopilotLearnFrom): the
  // channels themselves are not read, and only what the owner forwarded is
  // shown to the copywriter as their own posts.
  const forwardedOnly = config.autopilotLearnFrom === 'forwarded';
  for (const platform of (forwardedOnly ? [] : connectedPlatforms)) {
    const conn = platform === 'telegram' ? null : db.connections.findByProfile(profileId, platform);
    const source = db.ownContent.sourceFor(profileId, platform);
    const stale = !source || !source.lastFetchedAt || (nowMs - new Date(source.lastFetchedAt).getTime()) > cooldownMs;
    if (!stale) continue;
    const result = await ownContentFetch.fetchOwnContent(platform, conn, tgConn);
    db.ownContent.upsertSource({ profileId, platform, status: result.error ? 'error' : (result.found ? 'ok' : 'empty'), error: result.error });
    if (result.posts && result.posts.length) db.ownContent.mergePosts(profileId, platform, result.posts);
  }

  const ownPosts = forwardedOnly
    ? db.ownContent.listByProfile(profileId, 200).filter((p) => p.source === 'forwarded').slice(0, 15)
    : db.ownContent.listByProfile(profileId, 15);
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

  return { ownExternalActivity, competitorHighlights, ownPostCount: ownPosts.length, competitorPostCount: competitorPosts.length, forwardedOnly };
}

// Theme keys of Autopilot's recent posts, newest first — what the rotation
// balances against — and the news text dates already used in a post.
function recentAutopilotMemory(db, profileId) {
  const rows = db.autonomous.listActivity(profileId, 80).filter((a) => a.kind === 'analysis' && a.payload);
  return {
    themes: rows.map((a) => a.payload.theme).filter(Boolean),
    newsUsed: new Set(rows.map((a) => a.payload.newsAt).filter(Boolean)),
  };
}

// Tell the owner (best effort, never blocks a run) — the publishers decide
// how: today a Telegram message from the shared bot, when they linked it.
async function notify(publishers, kind, profile, payload, db) {
  const fn = publishers && publishers.notifyOwner;
  if (!fn) return;
  try {
    await fn(kind, profile, payload);
  } catch (err) {
    db.autonomous.logActivity({ profileId: profile.id, kind: 'error', summary: `notify: ${err.message}` });
  }
}

// Run Autopilot once for a single profile. Returns a small summary object.
//
// Three ways in:
//   - the worker, on a schedule: writes the post for the next time slot once
//     that slot's lead window opens (an hour ahead when it publishes on its
//     own, twelve hours ahead when the owner approves first), and puts it on
//     the Calendar AT the slot — the scheduled-post worker sends it on time.
//     Between slots a run still refreshes what Autopilot knows (the channel,
//     its style) and asks the owner what it is missing, but writes nothing;
//   - the legacy 'test' cadence (every minute, demos): writes and publishes
//     right away;
//   - `force` (manual "Run now"): writes one post right away, outside the
//     plan, and leaves the plan alone.
// Worker-initiated runs must win an atomic claim so overlapping ticks can't
// double-run a profile.
async function runProfileAutopilot({ db, ai, connectors, config, publishers = {}, ownContentFetch, gemini = geminiDefault, profileId, nowMs = Date.now(), force = false, lang: requestLang = null }) {
  const profile = db.profiles.findById(profileId);
  const cfg = db.autonomous.getConfig(profileId);
  if (!profile || !cfg || !cfg.enabled) return { skipped: 'not-enabled' };

  const user = db.users.findById(profile.userId);
  // What the owner reads follows the page they have open when they started
  // this run, else their saved UI language (the worker has no request).
  const lang = i18n.langOr(requestLang || (user && user.preferredLang));
  const nowIso = new Date(nowMs).toISOString();
  const legacy = isLegacyCadence(cfg);
  const plan = autopilotSchedule.normalizeSchedule(cfg.schedule, cfg.frequency);
  const known = db.autonomous.getStyle(profileId);
  const best = (known && known.timing) || autopilotSchedule.bestTimes({ category: profile.category, timezone: plan.timezone });

  // Which slot this run writes for (null = between slots, or immediate).
  let slot = null;
  let writing = true;
  if (force) {
    // Run now: outside the plan. Keep the planned next run, or set one.
    const nextRunAt = legacy
      ? nextRunFrom(cfg.frequency, nowMs)
      : (cfg.nextRunAt || autopilotSchedule.slotDecision(plan, { nowMs, autoPublish: cfg.autoPublish, best }).nextRunAt);
    db.autonomous.setRun(profileId, { lastRunAt: nowIso, nextRunAt });
  } else {
    // Claim this run up front (advance next_run_at BEFORE the first await):
    // if another tick already took this profile — or it isn't due — claimDue
    // returns false and we bail, so a profile is never run twice.
    let nextRunAt;
    if (legacy) {
      nextRunAt = nextRunFrom(cfg.frequency, nowMs);
    } else {
      const decision = autopilotSchedule.slotDecision(plan, { nowMs, autoPublish: cfg.autoPublish, best });
      slot = decision.due;
      writing = !!slot;
      nextRunAt = decision.nextRunAt;
    }
    if (!db.autonomous.claimDue(profileId, nowIso, nextRunAt)) return { skipped: 'not-due' };
  }

  // Respect the owner's weekly writing allowance — pause until it resets.
  // `budget` is re-read here rather than trusted later: the plan may contain
  // more posts than the owner can still afford, and publishing unbudgeted work
  // would let Autopilot quietly outspend everyone who writes by hand.
  const budget = user ? writingRemaining(db, config, user.id, user.tier) : Infinity;
  if (writing && budget <= 0) {
    db.autonomous.logActivity({ profileId, kind: 'skipped', summary: i18n.tr(lang, 'Weekly writing allowance reached — Autopilot paused until it resets on Monday.') });
    return { skipped: 'budget' };
  }

  // Target platforms: the owner's chosen set intersected with what's actually
  // connected (Telegram counts when a bot is linked). Fall back to the chosen
  // set, then to Instagram, so a keyless/sandbox setup still produces drafts.
  // Keys with no adapter are dropped first: a config or connection saved before
  // a platform was removed (Google Business Profile) must not steer the plan
  // toward a channel nothing can publish to.
  // Telegram only counts where it is switched on for this deployment;
  // otherwise nothing could ever publish what Autopilot writes for it.
  const telegramOn = !config || config.telegramEnabled !== false;
  const knownPlatform = (p) => (p === 'telegram' ? telegramOn : !!connectors.get(p));
  const tgConn = db.telegram.findByProfile(profileId);
  const connected = new Set(db.connections.listByProfile(profileId).map((c) => c.platform).filter(knownPlatform));
  if (tgConn) connected.add('telegram');
  const chosen = (cfg.platforms || []).filter(knownPlatform);
  let platforms = chosen.filter((p) => connected.size === 0 || connected.has(p));
  if (!platforms.length) platforms = chosen.length ? chosen : ['meta_instagram'];

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
      db.autonomous.logActivity({ profileId, kind: 'error', summary: i18n.tr(lang, 'Own/competitor content read failed: {{reason}}', { reason: err.message }) });
    }
  }

  // What the channel teaches: how this business writes, what it posts about,
  // when its posts do best. Re-learned at most daily (autopilotStyle.js).
  const style = await autopilotStyle.ensureStyle({ db, gemini, profile, lang, timezone: plan.timezone, nowMs });
  const brief = db.autonomous.getBrief(profileId);

  // CONTEXT GATE — a distinct, testable step, not a line in the generation
  // prompt. Autopilot must not fire off a generic ad: before spending anything
  // we check whether the channel and the owner's brief give us enough to say
  // something worth saying. If not, the run HALTS here and the owner is asked.
  // Runs BEFORE db.usage.record below, so a paused run costs the owner nothing.
  // (The assessment itself is a cheap Flash call and is not metered, the same
  // way the onboarding brand brief isn't.)
  const gate = await autopilotContext.ensureContext({
    db, gemini, profileId, platforms, nowMs, lang, brief, style, scheduleChosen: !!cfg.schedule || legacy,
  });
  if (!gate.ok) {
    if (gate.reason === 'needs-context' && gate.request) await notify(publishers, 'questions', profile, { request: gate.request }, db);
    return { paused: 'needs-context', reason: gate.reason, requestId: gate.request ? gate.request.id : null };
  }

  // Between slots: everything is ready, nothing to write yet.
  if (!writing) {
    const next = autopilotSchedule.upcomingSlots(plan, { fromMs: nowMs, count: 1, best: style ? style.timing : best })[0];
    return { waiting: 'next-slot', nextSlotAt: next ? next.at : null };
  }

  // WHAT this post is about: the owner's fresh news first, else the topic most
  // behind its share in the rotation. WHEN: the slot (or now).
  const memory = recentAutopilotMemory(db, profileId);
  const news = autopilotBrief.currentNews(brief, nowMs);
  const useNews = !!(news && !memory.newsUsed.has(news.at));
  const theme = useNews
    ? { key: 'news', name: 'News from the owner' }
    : autopilotBrief.pickTheme(autopilotBrief.themePool({ brief, style }), memory.themes);
  const momentMs = slot ? slot.ms : nowMs;
  const occasions = autopilotSchedule.occasionsNear(momentMs, { timezone: plan.timezone });

  let draft;
  try {
    draft = await ai.analyzeAndPlan({
      lang,
      languages: profile.audienceLanguages,
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
      // Everything remembered about this business, the same block every
      // other generator gets (businessContextService.memoryDigest).
      memory: businessContextService.memoryDigest(db, profile),
      userContext: gate.context.userContext,
      adType: gate.context.adType,
      // What Autopilot learned and was told.
      styleGuide: autopilotStyle.styleDigest(style),
      styleStats: style && style.sufficient ? style.stats : null,
      briefGuide: autopilotBrief.briefDigest(brief, nowMs),
      brief,
      theme,
      news: useNews ? news.text : null,
      moment: autopilotSchedule.slotLabel(momentMs, plan.timezone),
      occasions,
    });
  } catch (err) {
    db.autonomous.logActivity({ profileId, kind: 'error', summary: i18n.tr(lang, 'Analysis failed: {{reason}}', { reason: err.message }) });
    return { error: err.message };
  }

  db.autonomous.logActivity({
    profileId,
    kind: 'analysis',
    summary: draft.analysis,
    payload: {
      platforms,
      theme: theme ? theme.key : null,
      themeName: theme ? theme.name : null,
      slotAt: slot ? slot.at : null,
      newsAt: useNews ? news.at : null,
      learnedFrom: style ? style.sampleCount : 0,
    },
  });
  if (externalActivityCounts.ownPostCount || externalActivityCounts.competitorPostCount) {
    db.autonomous.logActivity({
      profileId,
      kind: 'external_content',
      summary: i18n.tr(lang, externalActivityCounts.forwardedOnly
        ? (externalActivityCounts.ownPostCount === 1
          ? 'Grounded this plan in {{own}} post you forwarded to the bot and {{competitor}} from tracked competitors.'
          : 'Grounded this plan in {{own}} posts you forwarded to the bot and {{competitor}} from tracked competitors.')
        : (externalActivityCounts.ownPostCount === 1
          ? 'Grounded this plan in {{own}} real post from your own connected accounts and {{competitor}} from tracked competitors.'
          : 'Grounded this plan in {{own}} real posts from your own connected accounts and {{competitor}} from tracked competitors.'),
      { own: externalActivityCounts.ownPostCount, competitor: externalActivityCounts.competitorPostCount }),
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

  // A slot's post goes on the Calendar at the slot (never in the past).
  const slotTime = slot ? new Date(Math.max(slot.ms, nowMs + 60 * 1000)).toISOString() : null;
  const themeInfo = theme ? { theme: theme.key, themeName: theme.name } : {};

  let published = 0;
  let scheduled = 0;
  let queued = 0;
  let errors = 0;
  let spent = 0;
  let unaffordable = 0;

  for (let i = 0; i < draft.posts.length; i += 1) {
    const post = draft.posts[i];
    const platform = String(post.platform || 'meta_instagram').toLowerCase();

    // Guard against a live model returning a platform key we can't act on (e.g.
    // a bare 'instagram', or a Meta key while Meta is disabled). Such a post
    // would otherwise become an orphaned scheduled row or an un-executable
    // approval. Skip it.
    if (platform !== 'telegram' && !connectors.get(platform)) {
      errors += 1;
      db.autonomous.logActivity({ profileId, kind: 'error', summary: i18n.tr(lang, 'Skipped a post for unknown channel "{{platform}}".', { platform }) });
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
    // A Telegram post with no linked channel could never be approved into a
    // real post, so it lands on the calendar as a draft instead: the owner
    // still sees it first, and can schedule it once the channel is linked.
    if (!cfg.autoPublish && platform === 'telegram' && !(publishers.telegramReady && publishers.telegramReady(profile))) {
      const row = db.calendar.add({ profileId, platform, postText: post.text, scheduledTime: slotTime || scheduledTimeFor(i, nowMs), status: 'draft', source: 'autopilot' });
      queued += 1;
      db.autonomous.logActivity({ profileId, kind: 'post_scheduled', summary: post.text.slice(0, 140), payload: { platform, calendarId: row.id, scheduledTime: row.scheduled_time, draft: true, ...themeInfo } });
      continue;
    }
    if (!cfg.autoPublish) {
      const isTg = platform === 'telegram';
      const adapter = isTg ? null : connectors.get(platform);
      const approval = db.approvals.create({
        profileId,
        actionType: isTg ? 'telegram_post' : 'platform_post',
        actionPayload: {
          action: i18n.tr(lang, 'Publish {{platform}} Post', { platform: isTg ? 'Telegram' : (adapter ? adapter.label : platform) }),
          cost: i18n.tr(lang, 'Free — organic post'),
          target: isTg ? ((tgConn && tgConn.chatTitle) || i18n.tr(lang, 'your channel')) : (adapter ? adapter.label : platform),
          creative: post.text,
          text: post.text,
          platform: isTg ? undefined : (adapter ? adapter.key : platform),
          autonomous: true, // lets the UI badge it as Autopilot-generated
          // Approved before this time -> it goes out at this time; after -> now.
          scheduledFor: slotTime || undefined,
          ...themeInfo,
        },
      });
      queued += 1;
      db.autonomous.logActivity({ profileId, kind: 'approval_created', summary: post.text.slice(0, 140), payload: { platform, approvalId: approval.id, scheduledFor: slotTime, ...themeInfo } });
      await notify(publishers, 'approval', profile, { approval, timezone: plan.timezone }, db);
      continue;
    }

    // Auto-publish, on a plan: put it on the Calendar at the slot. The
    // scheduled-post worker sends it on time, and until then the owner can
    // still read, edit or delete it there.
    if (slotTime) {
      const row = db.calendar.add({ profileId, platform, postText: post.text, scheduledTime: slotTime, status: 'scheduled', source: 'autopilot' });
      scheduled += 1;
      db.autonomous.logActivity({ profileId, kind: 'post_scheduled', summary: post.text.slice(0, 140), payload: { platform, calendarId: row.id, scheduledTime: row.scheduled_time, ...themeInfo } });
      continue;
    }

    // Auto-publish, right now (Run now / demo cadence), or schedule it if the
    // channel isn't ready.
    try {
      const result = await publishNow(platform, post.text);
      if (result.deferred) {
        const row = db.calendar.add({ profileId, platform, postText: post.text, scheduledTime: scheduledTimeFor(i, nowMs), status: 'scheduled', source: 'autopilot' });
        scheduled += 1;
        db.autonomous.logActivity({ profileId, kind: 'post_scheduled', summary: post.text.slice(0, 140), payload: { platform, calendarId: row.id, scheduledTime: row.scheduled_time, ...themeInfo } });
      } else {
        published += 1;
        db.autonomous.logActivity({ profileId, kind: 'post_published', summary: post.text.slice(0, 140), payload: { platform, simulated: result.simulated, ...themeInfo } });
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
      summary: i18n.tr(lang, 'Weekly writing allowance reached — {{skipped}} of {{total}} posts were not created. Resets Monday.', { skipped: unaffordable, total: draft.posts.length }),
    });
  }

  return {
    posts: draft.posts.length, published, scheduled, queued, errors, unaffordable,
    autoPublish: cfg.autoPublish,
    slotAt: slotTime,
    theme: theme ? theme.key : null,
  };
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

module.exports = { runAutonomousTick, runProfileAutopilot, nextRunFrom, recentAutopilotMemory };
