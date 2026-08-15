const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const createDb = require('./db');
const ai = require('./ai');
const brand = require('./brand');
const gemini = require('./gemini');
const billing = require('./billing');
const tg = require('./telegram');
const ig = require('./instagram');
const places = require('./places');
const competitorSources = require('./competitorSources');
const { computeGaps } = require('./gaps');
const research = require('./research');
const profileQuestions = require('./profileQuestions');
const mediagen = require('./mediagen');
const connectors = require('./connectors/registry');
const autonomous = require('./autonomous');
const metaDeletion = require('./metaDeletion');
const { limitFor } = require('./postLimits');
const { validateRegister, validateLogin, validateScan, validateCompetitors, validateCompetitorInput, validateProfileUpdate, validateMeUpdate, numOrNull } = require('./validators');

const db = createDb(config.dbPath);
const app = express();
// Trust the first proxy hop (TRUST_PROXY=true) so req.ip — and therefore the
// rate-limiter keys — reflect the real client, not the nginx/platform proxy.
if (config.trustProxy) app.set('trust proxy', 1);

// --- CORS ---
const corsOptions = config.corsOrigins.includes('*')
  ? {}
  : { origin: config.corsOrigins };
app.use(cors(corsOptions));
// Media uploads arrive as base64 data URLs — route-scoped larger JSON limit.
// Must be mounted BEFORE the global 1mb parser (the first parser to run wins;
// later body-parsers skip an already-parsed body).
app.use('/api/media/upload', express.json({ limit: '12mb' }));
// `verify` keeps the raw request bytes on req.rawBody — Stripe webhook
// signatures are computed over the exact payload, not the parsed JSON.
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

// --- AUTH HELPERS ---
const signAccessToken = (user) =>
  jwt.sign({ id: user.id, email: user.email, tier: user.tier }, config.jwtSecret, {
    expiresIn: config.accessTokenTtl,
  });

const issueRefreshToken = (userId) => {
  const raw = config.newRefreshToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86400000).toISOString();
  db.refreshTokens.store({ userId, tokenHash: config.hashToken(raw), expiresAt });
  return raw;
};

const publicUser = (u) => ({ id: u.id, email: u.email, fullName: u.fullName, tier: u.tier });

// Express 4 does not catch errors from async handlers — without this wrapper
// any thrown error becomes an unhandled rejection and kills the process.
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Preference-memory signal: if the owner changed Mark's draft before publishing,
// that edit is the strongest taste signal ('edited'); otherwise they endorsed it
// as-is ('approved'). Whitespace-insensitive so trivial spacing isn't an "edit".
const normText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const feedbackSignal = (draft, final) => (draft && normText(draft) !== normText(final) ? 'edited' : 'approved');

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Authorization header is missing' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Bearer token is missing' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired session token' });
  }
};

// --- AI GENERATION BUDGET (per pricing tier, monthly) ---
// Content, slogans, and agent queries all draw from one allowance. Template
// (keyless) generations count too — tiers sell generations, not API spend.
const usageInfo = (user) => {
  // Tier comes from the DB, never the JWT claim — a billing upgrade must
  // raise the allowance instantly for sessions issued before the upgrade.
  const dbUser = db.users.findById(user.id) || user;
  const tier = config.aiTierLimits[dbUser.tier] != null ? dbUser.tier : 'freemium';
  const limit = config.aiTierLimits[tier];
  const used = db.usage.countThisMonth(user.id);
  const nowD = new Date();
  const resetsAt = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() + 1, 1)).toISOString();
  return { tier, used, limit, remaining: Math.max(0, limit - used), resetsAt };
};

const checkAiBudget = (req, res, next) => {
  const usage = usageInfo(req.user);
  if (usage.used >= usage.limit) {
    return res.status(429).json({
      error: `You've used all ${usage.limit} AI generations on your ${usage.tier} plan this month. ` +
        `Your allowance resets on ${usage.resetsAt.slice(0, 10)} — or upgrade for more.`,
      usage,
    });
  }
  next();
};

// --- HEALTH ---
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'markivo-api' }));

// ==========================================
// 3.1 AUTHENTICATION ROUTER (/api/auth)
// ==========================================
const authLimiter = rateLimit({
  windowMs: config.authRateWindowMs,
  max: config.authRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);

app.post('/api/auth/register', (req, res) => {
  const error = validateRegister(req.body);
  if (error) return res.status(400).json({ error });

  const { email, password, fullName, preferredLang } = req.body;
  if (db.users.findByEmail(email)) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
  const user = db.users.create({ email: email.toLowerCase(), passwordHash, fullName, preferredLang });

  const accessToken = signAccessToken(user);
  const refreshToken = issueRefreshToken(user.id);
  res.json({ token: accessToken, accessToken, refreshToken, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const error = validateLogin(req.body);
  if (error) return res.status(400).json({ error });

  const { email, password } = req.body;
  const user = db.users.findByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: 'Incorrect email or password' });
  }

  const accessToken = signAccessToken(user);
  const refreshToken = issueRefreshToken(user.id);
  res.json({ token: accessToken, accessToken, refreshToken, user: publicUser(user) });
});

app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token is required' });

  const row = db.refreshTokens.find(config.hashToken(refreshToken));
  if (!row || row.revoked || new Date(row.expires_at) < new Date()) {
    return res.status(403).json({ error: 'Refresh token is invalid or expired' });
  }

  const user = db.users.findById(row.user_id);
  if (!user) return res.status(403).json({ error: 'Account no longer exists' });

  // Rotate: revoke the used token, issue a fresh pair.
  db.refreshTokens.revoke(config.hashToken(refreshToken));
  const accessToken = signAccessToken(user);
  const newRefresh = issueRefreshToken(user.id);
  res.json({ token: accessToken, accessToken, refreshToken: newRefresh, user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) db.refreshTokens.revoke(config.hashToken(refreshToken));
  res.json({ success: true });
});

app.get('/api/auth/me', verifyToken, (req, res) => {
  const user = db.users.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User session not found' });
  res.json({ id: user.id, email: user.email, fullName: user.fullName, tier: user.tier, preferredLang: user.preferredLang });
});

// ==========================================
// 3.2 DISCOVERY & SCAN ROUTER (/api/discovery)
//   Real Google Places (New) lookup when GOOGLE_MAPS_API_KEY is set; the same
//   deterministic mock as before when it isn't (see backend/places.js).
//   Instagram detection and AI-search presence are later milestones.
// ==========================================
const scanLimiter = rateLimit({
  windowMs: config.scanRateWindowMs,
  max: config.scanRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many scans from this device. Please wait a few minutes and try again.' },
});

app.post('/api/discovery/scan', verifyToken, scanLimiter, asyncRoute(async (req, res) => {
  const error = validateScan(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const result = await places.scanBusiness({
      businessName: req.body.businessName.trim(),
      location: (typeof req.body.location === 'string' && req.body.location.trim()) || 'Tashkent',
    });
    res.json(result);
  } catch (err) {
    // Upstream outage/misconfig must surface as an error, never as a fake
    // "your business was not found" answer.
    console.error('Places scan failed:', err.status || '', err.message);
    res.status(502).json({ error: 'Business discovery is temporarily unavailable. Please try again shortly.' });
  }
}));

// Competitor lookup around a confirmed business location (Nearby Search).
// Keyless mode answers honestly with an empty list — the mock scan already
// seeds benchmark competitors via /api/onboarding/construct.
app.post('/api/discovery/competitors', verifyToken, scanLimiter, asyncRoute(async (req, res) => {
  const error = validateCompetitors(req.body);
  if (error) return res.status(400).json({ error });

  if (!places.isLive()) return res.json({ competitors: [] });

  try {
    const competitors = await places.findCompetitors({
      lat: req.body.lat,
      lng: req.body.lng,
      primaryType: req.body.primaryType.trim(),
      excludePlaceId: typeof req.body.excludePlaceId === 'string' ? req.body.excludePlaceId : undefined,
    });
    res.json({ competitors });
  } catch (err) {
    console.error('Competitor lookup failed:', err.status || '', err.message);
    res.status(502).json({ error: 'Business discovery is temporarily unavailable. Please try again shortly.' });
  }
}));

// ==========================================
// 3.3 GUIDED SETUP WIZARD ROUTER (/api/onboarding)
// ==========================================
app.post('/api/onboarding/slogans', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const { businessName, category, tone, description } = req.body;
  const slogans = await ai.generateSlogans({ businessName, category, tone, description });
  db.usage.record({ userId: req.user.id, kind: 'slogans' });
  res.json({ slogans });
}));

// Brand logo variants for the wizard — deterministic SVG engine (logogen)
// without a key, Claude-designed (strictly sanitized) with one.
app.post('/api/onboarding/logos', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const businessName = typeof req.body.businessName === 'string' ? req.body.businessName.trim() : '';
  if (businessName.length < 2 || businessName.length > 100) {
    return res.status(400).json({ error: 'Business name must be 2-100 characters' });
  }
  const logos = await ai.generateLogos({
    businessName,
    category: typeof req.body.category === 'string' ? req.body.category.slice(0, 120) : undefined,
    tone: typeof req.body.tone === 'string' ? req.body.tone.slice(0, 120) : undefined,
  });
  db.usage.record({ userId: req.user.id, kind: 'logo' });
  res.json({ logos });
}));

// Cap + type-coerce competitor rows arriving from the client (Path A passes
// real Places results through; anything malformed degrades to nothing).
//
// Every number goes through numOrNull, which keeps an unknown value null. The
// scan hands us explicit nulls for followersCount/postsPerWeek — Places cannot
// measure either — and coercing those to 0 would publish a cadence the owner
// might act on. See validators.numOrNull.
const sanitizeCompetitors = (list) => (Array.isArray(list) ? list : [])
  .slice(0, 10)
  .filter((c) => c && typeof (c.competitorName || c.name) === 'string')
  .map((c) => ({
    competitorName: String(c.competitorName || c.name).slice(0, 120),
    rating: numOrNull(c.rating),
    followersCount: numOrNull(c.followersCount),
    postsPerWeek: numOrNull(c.postsPerWeek),
    platformsDetected: Array.isArray(c.platformsDetected)
      ? c.platformsDetected.slice(0, 6).map(String)
      : ['google'],
    // Kept so a later refresh can match this row instead of duplicating it,
    // and so the UI can badge where the row came from.
    placeId: typeof c.placeId === 'string' ? c.placeId.slice(0, 128) : null,
    address: typeof c.address === 'string' ? c.address.slice(0, 200) : null,
    source: 'google_places',
  }));

app.post('/api/onboarding/construct', verifyToken, asyncRoute(async (req, res) => {
  const { businessName, category, description, location, isOnline, audience, tone, slogan, logo, platforms } = req.body;
  if (!businessName) return res.status(400).json({ error: 'Business name is required' });

  const g = (req.body.google && typeof req.body.google === 'object') ? req.body.google : {};
  const safeCategory = category || 'Business';
  const profile = db.profiles.create({
    userId: req.user.id,
    businessName,
    category: safeCategory,
    description,
    location: isOnline ? 'Online / Remote' : (location || 'Tashkent'),
    isOnline: !!isOnline,
    targetAudience: audience,
    // Tone and logo are deferred questions now (profileQuestions.js), so a
    // default here would answer them on the owner's behalf: the panel would
    // show tone as already chosen, and every business would carry the same
    // coffee cup. Null means "not asked yet" — consumers already fall back.
    brandTone: tone || null,
    slogan,
    logoMetadata: logo || null,
    onboardPath: req.body.onboardPath || 'B (Scratch)',
    googlePlaceId: typeof g.placeId === 'string' ? g.placeId.slice(0, 128) : null,
    // Same null-preserving rule as the competitor rows: places.js maps an
    // unrated business to `rating: null`, and a brand-new business with no
    // reviews is exactly the case here — "★ 0" would be a rating we invented.
    googleRating: numOrNull(g.rating),
    googleReviewsCount: numOrNull(g.reviewsCount),
    // Where the business physically is, and what Google calls it. Persisted so
    // a competitor refresh can re-run the nearby search directly.
    googleLat: numOrNull(g.lat),
    googleLng: numOrNull(g.lng),
    googlePrimaryType: typeof g.primaryType === 'string' ? g.primaryType.slice(0, 60) : null,
  });

  // Platform connections selected in the wizard.
  const selected = platforms || { googleBusiness: true, instagram: true, telegram: true };
  Object.keys(selected).forEach((key) => {
    if (selected[key]) {
      db.platforms.add({
        profileId: profile.id,
        platformName: key,
        isConnected: true,
        accountHandle: `@${businessName.toLowerCase().replace(/ /g, '')}`,
        // No follower count: nobody has measured one yet. This used to seed a
        // random number between 200 and 700, which then appeared in the
        // dashboard as though it were the business's real audience.
        followersCount: null,
      });
    }
  });

  // Competitors: only the real nearby businesses the discovery scan found.
  //
  // This used to fall back to three invented benchmarks ('Local Competitor A',
  // 'District Roasters B', 'Global Competitor C') carrying invented follower
  // counts and cadences, which the dashboard then presented as this owner's
  // actual local competition. Path B and keyless mode now start empty and the
  // tab shows a real empty state with an "add" and a "find nearby" action —
  // an honest blank beats a populated fiction.
  sanitizeCompetitors(req.body.competitors)
    .forEach((c) => db.competitors.add({ profileId: profile.id, ...c }));

  // Target search phrases, derived from the real category and audience.
  //
  // The PHRASES are legitimate — they come from this business's own category,
  // location and audience. The rankings are not: avgPosition and volume used to
  // be seeded with invented numbers (#8, "Very High") that no one measured, and
  // the dashboard presented them as this business's actual standing. Rank
  // tracking is not wired, so both stay null and the UI says so. Competitor
  // Intel measures what IS knowable instead: whether our own published posts
  // ever use these phrases (see gaps.js keywordsUnused).
  const cat = safeCategory.toLowerCase();
  const audiencePhrase = (typeof audience === 'string' && audience.trim())
    ? `${cat} for ${audience.trim().toLowerCase().slice(0, 60)}`
    : `top rated ${cat}`;
  [
    `best ${cat} in tashkent`,
    `${cat} near me`,
    `${audiencePhrase} ${location || 'tashkent'}`,
  ].forEach((keywordPhrase) => db.keywords.add({
    profileId: profile.id, keywordPhrase, avgPosition: null, volume: null,
  }));

  // Seed an inaugural scheduled post — a generic welcome from the business
  // name + category (uz/ru flavour kept, no business-type assumptions).
  db.calendar.add({
    profileId: profile.id,
    platform: 'instagram',
    postText: `🇺🇿 O'zbekcha: #${businessName} endi shu yerda! ${safeCategory} bo'yicha eng yaxshi taklif va yangiliklarni shu sahifada kuzatib boring. ✨\n🇷🇺 Русский: Добро пожаловать в #${businessName}! Следите за нашими новостями и лучшими предложениями здесь.`,
    scheduledTime: new Date(Date.now() + 86400000).toISOString(),
    status: 'scheduled',
  });

  // Brand Identity Brief — the foundation every AI generator reads from so
  // output is specific to THIS business. Keyless: an instant template brief;
  // live: one Claude call. Never blocks onboarding — degrades to the template
  // on any failure.
  let brandBrief = null;
  try {
    brandBrief = await brand.generateBrandBrief({
      businessName,
      category: safeCategory,
      description,
      brandTone: tone || 'Cozy & Warm',
      audience,
      location: isOnline ? 'Online / Remote' : (location || 'Tashkent'),
    });
    if (brandBrief) db.profiles.update(profile.id, { brandBrief });
  } catch (err) {
    console.error('Brand brief generation failed at onboarding (non-fatal):', err.message);
  }

  // Return the profile WITH a platforms map so the dashboard can render
  // immediately without a follow-up fetch.
  const platformsMap = {};
  db.platforms.listByProfile(profile.id).forEach((pl) => { platformsMap[pl.platformName] = pl.isConnected; });
  res.json({ success: true, profile: { ...profile, brandBrief, platforms: platformsMap } });
}));

app.get('/api/onboarding/active', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(200).json({ onboarded: false });

  const platformsMap = {};
  db.platforms.listByProfile(profile.id).forEach((pl) => { platformsMap[pl.platformName] = pl.isConnected; });
  res.json({ onboarded: true, ...profile, platforms: platformsMap });
});

// ==========================================
// 3.35 SETTINGS ROUTER (/api/profile, /api/me)
// ==========================================
app.put('/api/profile', verifyToken, (req, res) => {
  const error = validateProfileUpdate(req.body);
  if (error) return res.status(400).json({ error });

  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Business profile not found — complete onboarding first' });

  const { businessName, category, description, location, isOnline, brandTone, slogan } = req.body;
  const updated = db.profiles.update(profile.id, {
    businessName: typeof businessName === 'string' ? businessName.trim() : businessName,
    category,
    description,
    location,
    isOnline,
    targetAudience: req.body.targetAudience !== undefined ? req.body.targetAudience : req.body.audience,
    brandTone,
    slogan,
    logoMetadata: req.body.logoMetadata !== undefined ? req.body.logoMetadata : req.body.logo,
  });

  // Return the profile WITH a platforms map so the dashboard can render
  // immediately without a follow-up fetch (same shape as construct).
  const platformsMap = {};
  db.platforms.listByProfile(updated.id).forEach((pl) => { platformsMap[pl.platformName] = pl.isConnected; });
  res.json({ success: true, profile: { ...updated, platforms: platformsMap } });
});

// ==========================================
// 3.36 DEFERRED ONBOARDING (/api/profile/completion, /api/profile/answers)
//   Signup asks only the essentials. The rest are asked here (the profile
//   panel's "!" badge) and by Markiv in conversation. Answers route into real
//   columns and brandBrief.businessFacts, so answering one immediately changes
//   what the content pipeline writes — see profileQuestions.js.
// ==========================================

// Deliberately NOT behind checkAiBudget: this is a single small generation once
// per profile lifetime, and a budget block here would leave the panel with no
// questions at all. The result is cached on the profile, so a second visit
// costs nothing and — just as importantly — shows the SAME questions.
app.get('/api/profile/completion', verifyToken, asyncRoute(async (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Business profile not found — complete onboarding first' });

  let current = profile;
  if (!Array.isArray(current.profileQuestions) || !current.profileQuestions.length) {
    const questions = await profileQuestions.generateQuestions(current);
    current = db.profiles.update(current.id, {
      profileQuestions: questions,
      profileQuestionsAt: new Date().toISOString(),
    });
  }

  const state = profileQuestions.completion(current);
  res.json({
    total: state.total,
    answered: state.answered,
    pendingCount: state.pendingCount,
    complete: state.complete,
    questions: profileQuestions.view(current),
    // 'gemini' when the personalised set is live, 'template' when it was
    // generated keyless — the panel labels which one the owner is looking at.
    engine: (current.profileQuestions[0] && current.profileQuestions[0].source) || 'template',
  });
}));

app.post('/api/profile/answers', verifyToken, (req, res) => {
  const answers = req.body && typeof req.body.answers === 'object' && !Array.isArray(req.body.answers)
    ? req.body.answers
    : null;
  if (!answers) return res.status(400).json({ error: 'An answers object is required' });

  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Business profile not found — complete onboarding first' });

  const fields = profileQuestions.applyAnswers(profile, answers, 'panel');
  if (!fields) return res.status(400).json({ error: 'No known question keys were supplied' });

  const updated = db.profiles.update(profile.id, fields);
  const state = profileQuestions.completion(updated);
  const platformsMap = {};
  db.platforms.listByProfile(updated.id).forEach((pl) => { platformsMap[pl.platformName] = pl.isConnected; });
  res.json({
    success: true,
    profile: { ...updated, platforms: platformsMap },
    pendingCount: state.pendingCount,
    complete: state.complete,
    questions: profileQuestions.view(updated),
  });
});

app.put('/api/me', verifyToken, (req, res) => {
  const error = validateMeUpdate(req.body);
  if (error) return res.status(400).json({ error });

  const { fullName, preferredLang } = req.body;
  const user = db.users.updateProfile(req.user.id, {
    fullName: typeof fullName === 'string' ? fullName.trim() : fullName,
    preferredLang,
  });
  if (!user) return res.status(404).json({ error: 'User session not found' });
  res.json({ id: user.id, email: user.email, fullName: user.fullName, tier: user.tier, preferredLang: user.preferredLang });
});

// ==========================================
// 3.38 BRAND IDENTITY ENGINE (/api/brand)
//   The brand brief is the foundation every AI generator reads from so output
//   is specific to THIS business. Generated at onboarding; viewable, editable,
//   and regenerable here. businessFacts (signature items, prices, hours,
//   booking link, offer) are owner-entered and the ONLY source of real numbers.
// ==========================================
app.get('/api/brand', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Business profile not found — complete onboarding first' });
  res.json({ brandBrief: profile.brandBrief || null, fields: brand.fields });
});

// Regenerate the brief from the current profile. Counts as an AI generation.
// Preserves any owner-entered businessFacts across the regenerate.
app.post('/api/brand/generate', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Business profile not found — complete onboarding first' });

  const brandBrief = await brand.generateBrandBrief({
    businessName: profile.businessName,
    category: profile.category,
    description: profile.description,
    brandTone: profile.brandTone,
    audience: profile.targetAudience,
    location: profile.location,
  });
  if (brandBrief && profile.brandBrief && profile.brandBrief.businessFacts) {
    brandBrief.businessFacts = profile.brandBrief.businessFacts;
  }
  const updated = db.profiles.update(profile.id, { brandBrief });
  db.usage.record({ userId: req.user.id, kind: 'brand' });
  res.json({ success: true, brandBrief: updated.brandBrief });
}));

// Partial edit: merge the posted fields (incl. businessFacts) into the brief.
app.put('/api/brand', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Business profile not found — complete onboarding first' });

  const incoming = req.body && typeof req.body.brandBrief === 'object' && req.body.brandBrief
    ? req.body.brandBrief
    : req.body;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'A brandBrief object is required' });
  }
  const merged = { ...(profile.brandBrief || {}), ...incoming };
  const updated = db.profiles.update(profile.id, { brandBrief: merged });
  res.json({ success: true, brandBrief: updated.brandBrief });
});

// What Mark has learned from this owner — the posts they've published/approved
// that now steer future drafts. Powers a "Mark has learned from N posts" UI.
app.get('/api/preferences', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Business profile not found — complete onboarding first' });
  res.json({
    count: db.feedback.countByProfile(profile.id),
    examples: db.feedback.recentExamples(profile.id, 5),
  });
});

// ==========================================
// 3.4 AI CONTENT ENGINE ROUTER (/api/content)
//   Copy now runs the staged marketing pipeline (strategy -> draft -> quality
//   gate -> refine) grounded in the brand brief; keyless falls back to a smart
//   template.
// ==========================================
app.post('/api/content/copywrite', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const { platform, topic, languages } = req.body;
  const profile = db.profiles.findByUserId(req.user.id);

  const result = await ai.generateContent({
    platform,
    topic,
    // Precedence: an explicit list from the request, then the languages the
    // owner said their CUSTOMERS read (a deferred profile question). Only when
    // neither exists is this left undefined, which is what triggers the
    // "write it back in whatever language the topic is written in" path.
    languages: Array.isArray(languages) && languages.length
      ? languages
      : (profile?.audienceLanguages?.length ? profile.audienceLanguages : undefined),
    businessName: req.body.businessName || profile?.businessName,
    category: profile?.category,
    description: profile?.description,
    brandTone: profile?.brandTone,
    audience: profile?.targetAudience,
    location: profile?.location,
    brief: profile?.brandBrief,
    preferences: profile ? db.feedback.recentExamples(profile.id) : [],
    // A follow-up prompt revises the draft already on screen ("shorter",
    // "add emojis") instead of writing a fresh one from the topic alone.
    previousText: typeof req.body.previousText === 'string' ? req.body.previousText : undefined,
    feedback: typeof req.body.feedback === 'string' ? req.body.feedback : undefined,
  });
  db.usage.record({ userId: req.user.id, kind: 'content' });

  // Surface hashtags in the post body so the existing UI shows them.
  const tags = (result.hashtags || []).filter(Boolean);
  const post = tags.length ? `${result.post}\n\n${tags.join(' ')}` : result.post;
  res.json({ post, mediaTip: result.mediaTip, hashtags: tags });
}));

// Current month's AI generation usage for the signed-in user.
app.get('/api/usage', verifyToken, (req, res) => {
  res.json(usageInfo(req.user));
});

app.get('/api/content/calendar', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.json([]);
  res.json(db.calendar.listByProfile(profile.id));
});

const REPEAT_RULES = new Set(['daily', 'weekly', 'monthly']);

app.post('/api/content/schedule', verifyToken, (req, res) => {
  const { platform, postText, scheduledTime } = req.body;
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const key = (platform || 'instagram').toLowerCase();
  const text = typeof postText === 'string' ? postText : '';
  const limit = limitFor(key);
  if (text.length > limit) {
    return res.status(400).json({ error: `Post text must be ${limit} characters or fewer for this platform.` });
  }
  const repeatRule = REPEAT_RULES.has(req.body.repeatRule) ? req.body.repeatRule : null;

  const post = db.calendar.add({
    profileId: profile.id,
    platform: key,
    postText,
    // Carried so the scheduled-post worker can publish the same photo/video the
    // owner attached in the composer, hours later.
    mediaId: typeof req.body.mediaId === 'string' ? req.body.mediaId : null,
    scheduledTime: scheduledTime || new Date(Date.now() + 86400000).toISOString(),
    // The composer's "Save as Draft" sends status:'draft' — same row shape,
    // just excluded from the worker's listDue('scheduled') queue.
    status: req.body.status === 'draft' ? 'draft' : 'scheduled',
    tag: typeof req.body.tag === 'string' ? req.body.tag.trim().slice(0, 40) || null : null,
    // Repeat only makes sense for a post that's actually going to go out on a
    // schedule — a draft has no fixed date to repeat from yet.
    repeatRule: req.body.status === 'draft' ? null : repeatRule,
  });
  // Preference memory: scheduling endorses this text; if it differs from Mark's
  // original draft (req.body.draftText), the edit is the stronger taste signal.
  const schedDraft = typeof req.body.draftText === 'string' ? req.body.draftText : null;
  db.feedback.record({
    profileId: profile.id, platform: (platform || 'instagram').toLowerCase(),
    signal: feedbackSignal(schedDraft, postText), draftText: schedDraft, finalText: postText, topic: req.body.topic,
  });
  res.json(post);
});

// Publish immediately. Telegram (when enabled + a chat is linked) publishes
// for real via the Bot API; every other platform is recorded as a simulated
// "posted" calendar entry until those integrations land.
app.post('/api/content/post-now', verifyToken, asyncRoute(async (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const platform = String(req.body.platform || 'instagram').toLowerCase();
  const postText = typeof req.body.postText === 'string' ? req.body.postText.trim() : '';
  if (!postText) return res.status(400).json({ error: 'Post text is required' });
  if (postText.length > 4000) return res.status(400).json({ error: 'Post text must be 4000 characters or fewer' });

  // Preference memory: publishing now endorses this text; an edit vs the
  // original draft (req.body.draftText) is the stronger taste signal.
  const nowDraft = typeof req.body.draftText === 'string' ? req.body.draftText : null;
  db.feedback.record({ profileId: profile.id, platform, signal: feedbackSignal(nowDraft, postText), draftText: nowDraft, finalText: postText, topic: req.body.topic });

  if (platform === 'telegram' && config.telegramEnabled) {
    const conn = db.telegram.findByProfile(profile.id);
    if (conn && conn.chatId) {
      try {
        const result = await executeTelegramPost(profile, postText, req.body.mediaId);
        return res.json({ success: true, simulated: false, ...result });
      } catch (err) {
        return res.status(400).json({ error: err.description || err.message });
      }
    }
  }

  // Instagram publishes for real when connected AND media is supplied (imageUrl,
  // videoUrl, or mediaId) — Instagram has no text-only post type.
  if (platform === 'instagram' && config.instagramEnabled) {
    const conn = db.instagram.findByProfile(profile.id);
    if (conn && conn.igUserId) {
      const media = resolveInstagramMedia(profile, req.body);
      if (media.imageUrl || media.videoUrl) {
        try {
          const result = await executeInstagramPost(profile, { ...media, caption: postText });
          return res.json({ success: true, simulated: false, ...result });
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }
      // Connected but unpublishable. Silently filing this as a "posted" calendar
      // row is how the composer used to look broken — the owner pressed Post and
      // nothing ever reached Instagram. Say exactly what is missing instead.
      if (!config.publicBaseUrl) {
        return res.status(400).json({
          error: 'Instagram fetches post media from a public URL, and PUBLIC_BASE_URL is not configured on the server, so publishing is unavailable.',
          reason: 'no_public_base_url',
        });
      }
      return res.status(400).json({
        error: 'Instagram posts must include a photo or video — attach one and post again.',
        reason: 'media_required',
      });
    }
  }

  const post = db.calendar.add({
    profileId: profile.id,
    platform,
    postText,
    mediaId: typeof req.body.mediaId === 'string' ? req.body.mediaId : null,
    scheduledTime: new Date().toISOString(),
    status: 'posted',
  });
  res.json({ success: true, simulated: true, post });
}));

// ==========================================
// 3.41 AUTOMATIONS CALENDAR (/api/calendar)
//   Everything Markivo has scheduled or done for a business, on one timeline:
//   scheduled + published posts and Autopilot runs.
//
//   The payload deliberately COPIES the Google Calendar Events resource shape
//   (kind/items/summary/start.dateTime/status/extendedProperties) rather than
//   inventing a private one. That buys a well-understood contract for free, and
//   means swapping in — or syncing out to — a real Google Calendar later is a
//   transport change, not a rewrite of the UI.
//   Reference: https://developers.google.com/calendar/api/v3/reference/events
// ==========================================

// Markivo ids are namespaced so one flat event list can carry two record types
// and the mutation routes can tell an editable post from read-only history.
const EVENT_PREFIX = { post: 'post_', autopilot: 'auto_' };

// Calendar status vocabulary is Google's: confirmed | tentative | cancelled.
const POST_STATUS_TO_EVENT = {
  scheduled: 'confirmed',
  posted: 'confirmed',
  failed: 'cancelled',
  cancelled: 'cancelled',
  // A draft is not yet committed to go out — 'tentative' is Google's word for
  // exactly that, and the worker never picks up anything but 'scheduled' rows.
  draft: 'tentative',
};

const postToEvent = (post) => {
  const start = post.scheduled_time;
  // Posts are points in time, not spans; give them a nominal 30-minute block so
  // week/day grids in any calendar client have something to lay out.
  const end = new Date(new Date(start).getTime() + 30 * 60000).toISOString();
  const text = post.post_text || '';
  return {
    kind: 'calendar#event',
    id: `${EVENT_PREFIX.post}${post.id}`,
    status: POST_STATUS_TO_EVENT[post.status] || 'tentative',
    summary: `${post.platform || 'post'} · ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
    description: text,
    start: { dateTime: start },
    end: { dateTime: end },
    extendedProperties: {
      private: {
        source: 'scheduled_post',
        platform: post.platform || '',
        markivoStatus: post.status,
        mediaId: post.mediaId || '',
        tag: post.tag || '',
        repeatRule: post.repeatRule || '',
      },
    },
  };
};

const activityToEvent = (a) => ({
  kind: 'calendar#event',
  id: `${EVENT_PREFIX.autopilot}${a.id}`,
  status: a.kind === 'error' ? 'cancelled' : 'confirmed',
  summary: `Autopilot · ${a.kind}`,
  description: a.summary || '',
  start: { dateTime: a.created_at },
  end: { dateTime: a.created_at },
  // Autopilot history is a record of what happened — never editable.
  extendedProperties: { private: { source: 'autopilot', activityKind: a.kind, readOnly: 'true' } },
});

// GET /api/calendar/events?timeMin=&timeMax=  (Google's parameter names)
app.get('/api/calendar/events', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.json({ kind: 'calendar#events', items: [] });

  const parseBound = (v) => {
    const d = v ? new Date(String(v)) : null;
    return d && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  };
  const min = parseBound(req.query.timeMin);
  const max = parseBound(req.query.timeMax);
  const inWindow = (iso) => {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    return (min === null || t >= min) && (max === null || t <= max);
  };

  const items = [
    ...db.calendar.listByProfile(profile.id).filter((p) => inWindow(p.scheduled_time)).map(postToEvent),
    ...db.autonomous.listActivity(profile.id, 200).filter((a) => inWindow(a.created_at)).map(activityToEvent),
  ].sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));

  res.json({
    kind: 'calendar#events',
    summary: `Markivo — ${profile.businessName || 'your business'}`,
    timeZone: 'UTC',
    updated: new Date().toISOString(),
    items,
  });
});

// Resolve an event id back to an editable scheduled post owned by the caller.
const ownedPostEvent = (req, res) => {
  const id = String(req.params.id || '');
  if (!id.startsWith(EVENT_PREFIX.post)) {
    res.status(400).json({ error: 'Only scheduled posts can be changed — Autopilot history is read-only.' });
    return null;
  }
  const profile = db.profiles.findByUserId(req.user.id);
  const post = profile ? db.calendar.findById(id.slice(EVENT_PREFIX.post.length)) : null;
  if (!post || post.profileId !== profile.id) {
    res.status(404).json({ error: 'Event not found' });
    return null;
  }
  return post;
};

// A post the owner hasn't committed to yet (draft) or has queued (scheduled)
// can still be changed; once it has gone out (posted/failed) it's history.
const isEditablePost = (post) => post.status === 'scheduled' || post.status === 'draft';

// PATCH — the calendar's drag-to-reschedule (Google's "move an event" is a
// start.dateTime-only change) AND the Edit Post composer's full save, which
// may also carry postText/mediaId/tag/repeatRule/status.
app.patch('/api/calendar/events/:id', verifyToken, (req, res) => {
  const post = ownedPostEvent(req, res);
  if (!post) return;
  if (!isEditablePost(post)) {
    return res.status(400).json({ error: 'This post has already gone out — it can no longer be changed.' });
  }

  const patch = {};
  if (req.body.start && req.body.start.dateTime !== undefined) {
    const d = new Date(String(req.body.start.dateTime));
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'start.dateTime must be a valid date' });
    patch.scheduledTime = d.toISOString();
  }
  if (typeof req.body.postText === 'string') {
    const limit = limitFor(post.platform);
    if (req.body.postText.length > limit) {
      return res.status(400).json({ error: `Post text must be ${limit} characters or fewer for this platform.` });
    }
    patch.postText = req.body.postText;
  }
  if ('mediaId' in req.body) {
    patch.mediaId = typeof req.body.mediaId === 'string' ? req.body.mediaId : null;
  }
  if ('tag' in req.body) {
    patch.tag = typeof req.body.tag === 'string' ? req.body.tag.trim().slice(0, 40) || null : null;
  }
  if ('repeatRule' in req.body) {
    patch.repeatRule = REPEAT_RULES.has(req.body.repeatRule) ? req.body.repeatRule : null;
  }
  if (req.body.status === 'draft' || req.body.status === 'scheduled') {
    patch.status = req.body.status;
  }

  res.json(postToEvent(db.calendar.update(post.id, patch)));
});

// DELETE — remove a post that has not gone out yet (draft or scheduled).
app.delete('/api/calendar/events/:id', verifyToken, (req, res) => {
  const post = ownedPostEvent(req, res);
  if (!post) return;
  if (!isEditablePost(post)) {
    return res.status(400).json({ error: 'This post has already gone out — it can no longer be cancelled.' });
  }
  db.calendar.remove(post.id);
  res.json({ success: true });
});

// ==========================================
// 3.42 MESSAGE TEMPLATES (/api/templates)
//   Businesses re-send the same message shape all day ("Stadium No:141, 9
//   spots left ✅"). Gemini reads one real example and returns it with the
//   changing parts turned into {{variables}}; the owner can then add or remove
//   variables by hand, because the extraction is a suggestion, not a verdict.
//   Keyless, the heuristic parser in gemini.js does the same job offline.
// ==========================================

// Which text engine is actually answering — surfaced so the UI can label a
// result "Gemini" vs "Offline parser" honestly instead of guessing.
app.get('/api/templates/engine', verifyToken, (req, res) => {
  res.json({
    engine: config.textEngine,
    gemini: config.geminiEnabled,
    model: config.geminiEnabled ? config.geminiTextModel : null,
  });
});

// Analyze a sample message. Returns a DRAFT template — nothing is saved until
// the owner reviews the variables and posts to /api/templates.
app.post('/api/templates/analyze', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const sample = typeof req.body.sample === 'string' ? req.body.sample.trim() : '';
  if (!sample) return res.status(400).json({ error: 'Paste a message to turn into a template' });
  if (sample.length > 2000) return res.status(400).json({ error: 'Message must be 2000 characters or fewer' });

  const draft = await gemini.analyzeTemplate({
    sample,
    platform: String(req.body.platform || 'instagram').toLowerCase(),
    businessName: profile.businessName,
    category: profile.category,
  });
  db.usage.record({ userId: req.user.id, kind: 'template' });

  res.json({
    ...draft,
    sampleText: sample,
    // Variables reconciled against the text so the UI never shows a chip for a
    // placeholder that isn't there (or miss one that is).
    variables: gemini.reconcileVariables(draft.templateText, draft.variables),
    preview: gemini.blankPreview(draft.templateText),
  });
}));

// A stored mediaId is only an id; the UI needs a URL and the kind to render a
// thumbnail. Decorating here keeps that lookup out of every client.
const withMedia = (tpl) => {
  if (!tpl) return tpl;
  const m = tpl.mediaId ? db.media.findById(tpl.mediaId) : null;
  return {
    ...tpl,
    mediaUrl: m && m.filePath ? `/${m.filePath.replace(/^\/+/, '')}` : null,
    mediaKind: m ? m.kind : null,
  };
};

app.get('/api/templates', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.json([]);
  const platform = req.query.platform ? String(req.query.platform) : null;
  res.json(db.templates.listByProfile(profile.id, platform).map(withMedia));
});

// Save a template. The TEXT is authoritative: whatever {{placeholders}} the
// owner left in it define the variables, so hand-added and hand-removed
// variables are honoured exactly as edited.
app.post('/api/templates', verifyToken, (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const templateText = typeof req.body.templateText === 'string' ? req.body.templateText.trim() : '';
  if (!templateText) return res.status(400).json({ error: 'Template text is required' });
  if (templateText.length > 4000) return res.status(400).json({ error: 'Template must be 4000 characters or fewer' });

  const saved = db.templates.create({
    profileId: profile.id,
    platform: String(req.body.platform || 'instagram').toLowerCase(),
    name: typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 60) : '',
    sampleText: typeof req.body.sampleText === 'string' ? req.body.sampleText.slice(0, 2000) : '',
    templateText,
    variables: gemini.reconcileVariables(templateText, req.body.variables),
    source: ['gemini', 'heuristic', 'manual'].includes(req.body.source) ? req.body.source : 'manual',
    // Optional photo/video that ships with every post made from this template.
    mediaId: typeof req.body.mediaId === 'string' && req.body.mediaId ? req.body.mediaId : null,
  });
  res.json(withMedia(saved));
});

// Load a template owned by the caller's profile, or answer 404. Shared by the
// update / delete / render routes so ownership is checked in exactly one place.
const ownedTemplate = (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  const tpl = profile ? db.templates.findById(req.params.id) : null;
  if (!tpl || tpl.profileId !== profile.id) {
    res.status(404).json({ error: 'Template not found' });
    return null;
  }
  return tpl;
};

app.put('/api/templates/:id', verifyToken, (req, res) => {
  const tpl = ownedTemplate(req, res);
  if (!tpl) return;

  const fields = {};
  if (typeof req.body.name === 'string') fields.name = req.body.name.trim().slice(0, 60);
  if (typeof req.body.platform === 'string') fields.platform = req.body.platform;
  if (typeof req.body.templateText === 'string') {
    const text = req.body.templateText.trim();
    if (!text) return res.status(400).json({ error: 'Template text is required' });
    if (text.length > 4000) return res.status(400).json({ error: 'Template must be 4000 characters or fewer' });
    fields.templateText = text;
  }
  // An explicit null/'' detaches the attached photo/video.
  if (req.body.mediaId !== undefined) fields.mediaId = req.body.mediaId || null;
  // Variables always follow the text they belong to (new text if it changed).
  const text = fields.templateText || tpl.templateText;
  fields.variables = gemini.reconcileVariables(text, req.body.variables || tpl.variables);
  res.json(withMedia(db.templates.update(tpl.id, fields)));
});

app.delete('/api/templates/:id', verifyToken, (req, res) => {
  const tpl = ownedTemplate(req, res);
  if (!tpl) return;
  db.templates.remove(tpl.id);
  res.json({ success: true });
});

// Fill a template with the owner's values. Deterministic string substitution —
// no model involved, so it costs nothing and never surprises.
app.post('/api/templates/:id/render', verifyToken, (req, res) => {
  const tpl = ownedTemplate(req, res);
  if (!tpl) return;
  const values = req.body.values && typeof req.body.values === 'object' ? req.body.values : {};
  const decorated = withMedia(tpl);
  res.json({
    text: gemini.renderTemplate(tpl.templateText, values),
    platform: tpl.platform,
    // The attached media rides along so "use this template" lands in the
    // composer with its photo/video already set.
    mediaId: decorated.mediaId || null,
    mediaUrl: decorated.mediaUrl,
    mediaKind: decorated.mediaKind,
  });
});

// ==========================================
// 3.45 TELEGRAM INTEGRATION (/api/telegram)
//   Real Bot API integration. Telegram has no API to create bots, so the
//   owner creates one via @BotFather (guided, ~60s) and pastes the token;
//   everything after that — branding, channel detection, posting — is
//   automated.
// ==========================================
const requireProfile = (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) res.status(404).json({ error: 'Business profile not found — complete onboarding first' });
  return profile;
};

// Telegram is de-scoped from the MVP: the integration below stays intact but
// is gated off until TELEGRAM_ENABLED=true (see config.js feature flags).
const telegramGate = (req, res, next) => {
  if (!config.telegramEnabled) {
    return res.status(503).json({
      error: 'Telegram integration is coming soon — it is not part of the current MVP.',
      comingSoon: true,
    });
  }
  next();
};

app.post('/api/telegram/connect', verifyToken, telegramGate, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const botToken = String(req.body.botToken || '').trim();
  if (!tg.isValidTokenFormat(botToken)) {
    return res.status(400).json({ error: 'That does not look like a bot token. It should look like 1234567890:ABC... — copy it from @BotFather.' });
  }

  try {
    const me = await tg.getMe(botToken);
    // Auto-brand the new bot with the business identity (best-effort).
    const branding = await tg.configureBot(botToken, profile);
    db.telegram.upsertBot({
      profileId: profile.id,
      botToken,
      botUserId: me.id,
      botUsername: me.username,
      botName: `${profile.businessName} Assistant`,
    });
    db.platforms.setConnected(profile.id, 'telegram', `@${me.username}`);
    res.json({ success: true, botUsername: me.username, branding });
  } catch (err) {
    const msg = err instanceof tg.TelegramError && err.code === 401
      ? 'Telegram rejected this token. Double-check it in @BotFather (/mybots → API Token).'
      : `Could not connect the bot: ${err.description || err.message}`;
    res.status(400).json({ error: msg });
  }
}));

app.post('/api/telegram/detect-chat', verifyToken, telegramGate, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const conn = db.telegram.findByProfile(profile.id);
  if (!conn) return res.status(400).json({ error: 'Connect your bot first' });

  try {
    const found = await tg.detectChat(conn.botToken, conn.botUserId);
    if (!found) {
      return res.status(404).json({
        error: `No channel or group found yet. Add @${conn.botUsername} to your channel as an administrator (with "Post messages" permission), then try again — or enter your @channel handle manually.`,
      });
    }
    const verified = await tg.verifyPostAccess(conn.botToken, found.chatId, conn.botUserId);
    db.telegram.setChat(profile.id, verified);
    res.json({ success: true, chat: verified });
  } catch (err) {
    res.status(400).json({ error: err.description || err.message });
  }
}));

app.post('/api/telegram/channel', verifyToken, telegramGate, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const conn = db.telegram.findByProfile(profile.id);
  if (!conn) return res.status(400).json({ error: 'Connect your bot first' });

  let chat = String(req.body.chat || '').trim();
  if (!chat) return res.status(400).json({ error: 'Enter your channel handle (e.g. @mybusiness) or chat ID' });
  if (!chat.startsWith('@') && !/^-?\d+$/.test(chat)) chat = `@${chat}`;

  try {
    const verified = await tg.verifyPostAccess(conn.botToken, chat, conn.botUserId);
    db.telegram.setChat(profile.id, verified);
    res.json({ success: true, chat: verified });
  } catch (err) {
    res.status(400).json({ error: err.description || err.message });
  }
}));

app.get('/api/telegram/status', verifyToken, (req, res) => {
  if (!config.telegramEnabled) return res.json({ connected: false, comingSoon: true });
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.json({ connected: false });
  const conn = db.telegram.findByProfile(profile.id);
  if (!conn) return res.json({ connected: false });
  res.json({
    connected: true,
    botUsername: conn.botUsername,
    botName: conn.botName,
    chat: conn.chatId ? { chatId: conn.chatId, chatTitle: conn.chatTitle, chatType: conn.chatType } : null,
  });
});

// A stored mediaId -> the public URL Telegram/Instagram must fetch it from.
// Returns null when the media is missing, not ours, or unreachable publicly.
function resolvePublicMedia(profile, mediaId) {
  if (!mediaId) return null;
  const m = db.media.findById(String(mediaId));
  if (!m || m.profileId !== profile.id || !m.filePath || !config.publicBaseUrl) return null;
  return { url: `${config.publicBaseUrl}/${m.filePath.replace(/^\/+/, '')}`, kind: m.kind };
}

// Shared executor — used by the direct post route AND the agent approval gate.
// Media is optional: Telegram, unlike Instagram, publishes text on its own.
async function executeTelegramPost(profile, text, mediaId) {
  const conn = db.telegram.findByProfile(profile.id);
  if (!conn) throw new Error('Telegram is not connected');
  if (!conn.chatId) throw new Error('No channel or group linked yet — finish the Telegram setup on your dashboard');
  const media = resolvePublicMedia(profile, mediaId);
  const sent = await tg.sendPost(conn.botToken, conn.chatId, text, media);
  db.calendar.add({
    profileId: profile.id,
    platform: 'telegram',
    postText: text,
    mediaId: mediaId || null,
    scheduledTime: new Date().toISOString(),
    status: 'posted',
  });
  return { messageId: sent.message_id, chatTitle: conn.chatTitle || conn.chatId };
}

app.post('/api/telegram/post', verifyToken, telegramGate, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Post text is required' });

  try {
    const result = await executeTelegramPost(profile, text, req.body.mediaId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.description || err.message });
  }
}));

// ==========================================
// 3.4 INSTAGRAM (Meta Graph) OAUTH CONNECT
// ------------------------------------------
//   Owner clicks "Connect Instagram" → we mint a signed `state` and hand back
//   Meta's auth-dialog URL; the browser goes to Meta, authorizes, and Meta
//   redirects to our callback with ?code=&state=. The callback (a top-level
//   browser navigation with NO auth header) recovers identity from `state`,
//   exchanges the code for a long-lived token, and stores it encrypted.
// ==========================================
const instagramGate = (req, res, next) => {
  if (!config.instagramEnabled) {
    return res.status(503).json({
      error: 'Instagram connection is coming soon — Meta credentials are not configured yet.',
      comingSoon: true,
    });
  }
  next();
};

// Signed, short-lived state carrying the user/profile through the OAuth round
// trip (doubles as CSRF protection — the callback rejects anything it didn't
// sign). Reuses the JWT machinery already used for access tokens.
const signOauthState = (user, profile) =>
  jwt.sign({ uid: user.id, pid: profile.id, purpose: 'ig_oauth' }, config.jwtSecret, { expiresIn: '10m' });

const verifyOauthState = (state) => {
  const payload = jwt.verify(state, config.jwtSecret);
  if (payload.purpose !== 'ig_oauth') throw new Error('wrong token purpose');
  return payload;
};

app.get('/api/instagram/connect', verifyToken, instagramGate, (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const authUrl = ig.buildAuthUrl(signOauthState(req.user, profile));
  res.json({ authUrl });
});

// PUBLIC (no verifyToken) — Meta redirects the browser here. Identity rides in
// `state`. Always ends in a redirect back to the SPA; never leaks raw errors.
app.get('/api/instagram/oauth/callback', asyncRoute(async (req, res) => {
  const back = (params) => res.redirect(`${config.appUrl}/?${new URLSearchParams(params).toString()}`);

  if (!config.instagramEnabled) return back({ instagram: 'error', reason: 'not_configured' });
  if (req.query.error) return back({ instagram: 'error', reason: 'denied' });

  const { code, state } = req.query;
  if (!code || !state) return back({ instagram: 'error', reason: 'missing_code' });

  let payload;
  try {
    payload = verifyOauthState(String(state));
  } catch {
    return back({ instagram: 'error', reason: 'bad_state' });
  }

  const profile = db.profiles.findById(payload.pid);
  if (!profile) return back({ instagram: 'error', reason: 'no_profile' });

  try {
    const short = await ig.exchangeCodeForToken(String(code));
    const long = await ig.exchangeForLongLivedToken(short.accessToken);
    const account = await ig.resolveAccount(long.accessToken);
    const tokenExpiresAt = long.expiresIn
      ? new Date(Date.now() + long.expiresIn * 1000).toISOString()
      : null;

    db.instagram.upsert({ profileId: profile.id, accessToken: long.accessToken, tokenExpiresAt, ...account });
    db.platforms.setConnected(profile.id, 'instagram', account.igUsername ? `@${account.igUsername}` : (account.accountName || null));
    return back({ instagram: 'connected' });
  } catch (err) {
    console.warn(`Instagram callback failed: ${err.message}`);
    return back({ instagram: 'error', reason: 'exchange_failed' });
  }
}));

app.get('/api/instagram/status', verifyToken, (req, res) => {
  if (!config.instagramEnabled) return res.json({ connected: false, comingSoon: true });
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.json({ connected: false });
  const conn = db.instagram.findByProfile(profile.id);
  if (!conn) return res.json({ connected: false });
  res.json({
    connected: true,
    username: conn.igUsername,
    accountName: conn.accountName,
    expiresAt: conn.tokenExpiresAt,
  });
});

app.post('/api/instagram/disconnect', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Business profile not found' });
  db.instagram.remove(profile.id);
  db.platforms.setConnected(profile.id, 'instagram', null, false);
  res.json({ success: true });
});

// Resolve post media to a PUBLIC URL Instagram can fetch server-side. Accepts an
// explicit imageUrl/videoUrl (used as-is) or a mediaId whose uploaded/rendered
// file we expose via the public base (the dev tunnel). The media row's `kind`
// decides image vs video. Returns { imageUrl, videoUrl, mediaType } — all '' when
// nothing is resolvable.
function resolveInstagramMedia(profile, body = {}) {
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl.trim() : '';
  if (imageUrl) return { imageUrl, videoUrl: '', mediaType: '' };
  if (videoUrl) return { imageUrl: '', videoUrl, mediaType: 'REELS' };
  if (body.mediaId) {
    const m = db.media.findById(String(body.mediaId));
    if (m && m.profileId === profile.id && m.filePath && config.publicBaseUrl) {
      const url = `${config.publicBaseUrl}/${m.filePath.replace(/^\/+/, '')}`;
      if (m.kind === 'video') return { imageUrl: '', videoUrl: url, mediaType: 'REELS' };
      return { imageUrl: url, videoUrl: '', mediaType: '' };
    }
  }
  return { imageUrl: '', videoUrl: '', mediaType: '' };
}

// Shared executor — used by the direct post route AND /api/content/post-now.
// Publishes an image OR video (Reels) post for real and records it. Video
// containers are polled to FINISHED inside ig.publishMediaPost before publishing.
async function executeInstagramPost(profile, { imageUrl, videoUrl, mediaType, caption }) {
  const conn = db.instagram.findByProfile(profile.id);
  if (!conn) throw new Error('Instagram is not connected');
  if (!conn.igUserId) throw new Error('This Instagram connection has no linked account id — reconnect Instagram');
  if (!imageUrl && !videoUrl) throw new Error('An image or video is required — Instagram does not support text-only posts');
  const { mediaId, permalink } = await ig.publishMediaPost(conn, { imageUrl, videoUrl, mediaType, caption });
  db.calendar.add({
    profileId: profile.id,
    platform: 'instagram',
    postText: caption || '',
    scheduledTime: new Date().toISOString(),
    status: 'posted',
  });
  return { mediaId, permalink, username: conn.igUsername };
}

// Generic connector executor — used by the approval gate AND Autopilot to
// publish a post to ANY registered platform (Instagram/Facebook/TikTok/Google
// Business/YouTube) through its adapter. Adapters with no live credentials
// return a simulated result; either way the post is recorded as a posted
// calendar row so the dashboard reflects the activity (mirrors
// executeInstagramPost). mediaUrl is optional — some platforms require it.
async function executePlatformPost(profile, platform, text, mediaUrl) {
  const adapter = connectors.get(platform);
  if (!adapter) throw new Error(`Unknown platform "${platform}"`);
  const result = await adapter.publish({ db, profile, text, mediaUrl });
  db.calendar.add({
    profileId: profile.id,
    platform,
    postText: text || '',
    scheduledTime: new Date().toISOString(),
    status: 'posted',
  });
  return result;
}

// ==========================================
// 3.55 PLATFORM CONNECTORS (/api/connect)
//   The generic connect surface every adapter in connectors/* was built
//   against: one catalogue endpoint the Connections screen renders from, and
//   start/callback/disconnect that work identically for Facebook, Instagram,
//   TikTok, Google Business, and YouTube. Adapters with no live credentials
//   return a null auth URL, so `start` connects them in sandbox instead —
//   keyless still gets a working, honest flow.
// ==========================================

// Same signed-state trick as the Instagram flow (see signOauthState), plus the
// connector key so a state minted for one platform cannot finish another's
// callback.
const signConnectState = (user, profile, key) =>
  jwt.sign({ uid: user.id, pid: profile.id, key, purpose: 'connect_oauth' }, config.jwtSecret, { expiresIn: '10m' });

const verifyConnectState = (state) => {
  const payload = jwt.verify(state, config.jwtSecret);
  if (payload.purpose !== 'connect_oauth') throw new Error('wrong token purpose');
  return payload;
};

// Every platform Markivo knows about, plus this business's status for each.
// Always returns the FULL catalogue — the dashboard shows unconnected
// platforms too (dimmed), so the owner can see what is available.
app.get('/api/connect/status', verifyToken, asyncRoute(async (req, res) => {
  const catalogue = connectors.catalogue();
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.json({ catalogue, status: {} });
  res.json({ catalogue, status: await connectors.statusAll({ db, profile }) });
}));

app.post('/api/connect/:key/start', verifyToken, asyncRoute(async (req, res) => {
  const adapter = connectors.get(req.params.key);
  if (!adapter) return res.status(404).json({ error: `Unknown platform "${req.params.key}"` });
  const profile = requireProfile(req, res);
  if (!profile) return;

  if (adapter.authType === 'token') {
    return res.status(400).json({
      error: `${adapter.label} connects with its own setup card, not OAuth.`,
      authType: 'token',
      howToConnect: adapter.howToConnect || [],
    });
  }

  const url = adapter.getAuthUrl({ profile, state: signConnectState(req.user, profile, adapter.key) });
  if (url) return res.json({ mode: 'oauth', url });

  // No live credentials for this platform — connect in sandbox so the rest of
  // the product (agent, Autopilot, approvals) is exercisable end to end.
  db.connections.upsert({
    profileId: profile.id,
    platform: adapter.key,
    status: 'sandbox',
    accountHandle: `${adapter.label} (sandbox)`,
  });
  res.json({ mode: 'sandbox', status: await adapter.status({ db, profile }) });
}));

// PUBLIC (no verifyToken) — the platform redirects the browser here. Identity
// rides in the signed `state`. Always ends in a redirect back to the SPA with
// ?connected=<key> or ?connect_error=<label>; never leaks raw errors.
app.get('/api/connect/:key/callback', asyncRoute(async (req, res) => {
  const back = (params) => res.redirect(`${config.appUrl}/?${new URLSearchParams(params).toString()}`);
  const adapter = connectors.get(req.params.key);
  if (!adapter) return back({ connect_error: req.params.key });
  if (req.query.error) return back({ connect_error: adapter.label });

  let payload;
  try {
    payload = verifyConnectState(String(req.query.state || ''));
  } catch {
    return back({ connect_error: adapter.label });
  }
  // A state signed for Instagram must not be replayed against TikTok.
  if (payload.key !== adapter.key) return back({ connect_error: adapter.label });

  const profile = db.profiles.findById(payload.pid);
  if (!profile) return back({ connect_error: adapter.label });

  try {
    await adapter.handleCallback({ db, profile, query: req.query });
    return back({ connected: adapter.key });
  } catch (err) {
    console.warn(`Connector ${adapter.key} callback failed: ${err.message}`);
    return back({ connect_error: adapter.label });
  }
}));

app.post('/api/connect/:key/disconnect', verifyToken, asyncRoute(async (req, res) => {
  const adapter = connectors.get(req.params.key);
  if (!adapter) return res.status(404).json({ error: `Unknown platform "${req.params.key}"` });
  const profile = requireProfile(req, res);
  if (!profile) return;
  await adapter.disconnect({ db, profile });
  res.json({ success: true, status: await adapter.status({ db, profile }) });
}));

app.post('/api/instagram/post', verifyToken, instagramGate, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() : '';
  if (caption.length > 2200) return res.status(400).json({ error: 'Caption must be 2200 characters or fewer' });
  const media = resolveInstagramMedia(profile, req.body);
  if (!media.imageUrl && !media.videoUrl) {
    return res.status(400).json({ error: 'Provide an imageUrl, videoUrl, or a mediaId with an uploaded file — Instagram posts require an image or video.' });
  }
  try {
    const result = await executeInstagramPost(profile, { ...media, caption });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// ==========================================
// 3.45 COMPETITOR INTEL
// ==========================================
// Competitor rows come from two sources and the difference is load-bearing.
// Google Places supplies a name, rating and address for nearby businesses; it
// does NOT supply follower counts or posting cadence, and no API we can call
// will hand those over for an arbitrary business. So those two are either
// owner-entered, enriched from a channel the competitor makes public (see
// competitorSources), or genuinely unknown — and unknown travels all the way
// to the UI as null, which renders "not reported" rather than a zero.

// Request body -> db fields. Keys absent from the body are omitted entirely so
// db.competitors.update writes only what the caller actually sent; an explicit
// null is preserved, because that is how an owner says "I no longer claim to
// know this".
const competitorFields = (body = {}) => {
  const out = {};
  const setStr = (key, v, max) => {
    if (v === undefined) return;
    out[key] = v == null ? null : (String(v).trim().slice(0, max) || null);
  };
  if (body.competitorName !== undefined || body.name !== undefined) {
    out.competitorName = String(body.competitorName ?? body.name).trim().slice(0, 120);
  }
  for (const key of ['rating', 'followersCount', 'postsPerWeek']) {
    if (body[key] !== undefined) out[key] = numOrNull(body[key]);
  }
  setStr('address', body.address, 200);
  setStr('notes', body.notes, 500);
  setStr('website', body.website, 200);
  setStr('instagramHandle', body.instagramHandle, 30);
  setStr('telegramChannel', body.telegramChannel, 64);
  if (body.platformsDetected !== undefined) {
    out.platformsDetected = Array.isArray(body.platformsDetected)
      ? body.platformsDetected.slice(0, 6).map((p) => String(p).slice(0, 30))
      : [];
  }
  return out;
};

// `unavailable` uses the same field name and shape as
// /api/dashboard/platform/:key, so the UI's existing `new Set(unavailable)`
// idiom works here unchanged.
const competitorRow = (c) => ({
  id: c.id,
  name: c.competitorName,
  rating: c.rating,
  followers: c.followersCount,
  postsPerWeek: c.postsPerWeek,
  platforms: c.platformsDetected || [],
  platformCount: (c.platformsDetected || []).length,
  address: c.address,
  placeId: c.placeId,
  website: c.website,
  instagramHandle: c.instagramHandle,
  telegramChannel: c.telegramChannel,
  source: c.source,
  metricSources: c.metricSources || {},
  notes: c.notes,
  unavailable: [
    c.rating == null && 'rating',
    c.followersCount == null && 'followers',
    c.postsPerWeek == null && 'postsPerWeek',
  ].filter(Boolean),
  created_at: c.created_at,
  refreshed_at: c.refreshed_at,
});

// Why the "Find nearby" button is or is not usable, as a CODE the UI
// translates — never a prebuilt English sentence.
const discoveryState = (profile, rows) => {
  const stamps = rows.map((c) => c.refreshed_at).filter(Boolean).sort();
  let reason = null;
  if (!places.isLive()) reason = 'no_api_key';
  else if (!profile) reason = 'no_profile';
  else if (!Number.isFinite(profile.googleLat) || !Number.isFinite(profile.googleLng) || !profile.googlePrimaryType) {
    reason = 'no_location';
  }
  return { available: reason === null, reason, lastRefreshedAt: stamps.length ? stamps[stamps.length - 1] : null };
};

// How far back "your" cadence is measured. Four weeks smooths a quiet week
// without averaging away a business that only recently started posting.
const YOU_SAMPLE_DAYS = 28;

/**
 * Real follower/subscriber counts from the connected platforms, or null.
 *
 * /api/dashboard/stats substitutes demo numbers when a platform is not
 * connected. The competitor benchmark must NOT: a made-up "you" figure sitting
 * in a row beside real competitors is a direct comparison an owner would act
 * on. So this returns the raw truth and each caller decides what to do with a
 * null — stats keeps its demo fallback, the benchmark says "not reported".
 */
async function liveFollowers(profile) {
  const out = { instagram: { value: null, live: false }, telegram: { value: null, live: false } };

  if (config.telegramEnabled) {
    const conn = db.telegram.findByProfile(profile.id);
    if (conn && conn.chatId) {
      try {
        const n = await tg.getChatMemberCount(conn.botToken, conn.chatId);
        if (Number.isFinite(n)) out.telegram = { value: n, live: true };
      } catch (err) {
        console.warn('getChatMemberCount failed:', err.message);
      }
    }
  }

  if (config.instagramEnabled) {
    const conn = db.instagram.findByProfile(profile.id);
    if (conn && conn.accessToken) {
      try {
        const acct = await ig.getAccountStats(conn.accessToken);
        if (Number.isFinite(acct.followers)) out.instagram = { value: acct.followers, live: true };
      } catch (err) {
        console.warn('getAccountStats failed:', err.message);
      }
    }
  }
  return out;
}

/**
 * The "you" row of the benchmark, measured entirely from our own records.
 *
 * postsPerWeek counts what MARKIVO published — a zero here is a fact, not an
 * unknown, which is the opposite of a competitor's null. "Connected" means we
 * hold working credentials, not that a box was ticked in the setup wizard.
 */
async function buildYou(profile) {
  const followers = await liveFollowers(profile);

  const keys = [];
  const tgConn = db.telegram.findByProfile(profile.id);
  if (config.telegramEnabled && tgConn && tgConn.chatId) keys.push('telegram');
  const igConn = db.instagram.findByProfile(profile.id);
  if (config.instagramEnabled && igConn && igConn.accessToken) keys.push('instagram');
  for (const c of db.connections.listByProfile(profile.id)) {
    if (c.status === 'connected' && !keys.includes(c.platform)) keys.push(c.platform);
  }

  const since = Date.now() - YOU_SAMPLE_DAYS * 86400000;
  const posts = db.calendar.listByProfile(profile.id);
  const published = posts.filter((p) => p.status === 'posted' && Date.parse(p.scheduled_time) >= since);
  const upcoming = posts.filter((p) => p.status === 'scheduled' && Date.parse(p.scheduled_time) >= Date.now());

  // Whichever connected platform actually reports a number; null if none does.
  const followerValue = followers.instagram.live ? followers.instagram.value
    : (followers.telegram.live ? followers.telegram.value : null);

  return {
    name: profile.businessName,
    channels: {
      connected: keys.length,
      keys,
      selectedAtSetup: db.platforms.listByProfile(profile.id).filter((p) => p.isConnected).length,
    },
    postsPerWeek: Math.round((published.length / YOU_SAMPLE_DAYS) * 7 * 100) / 100,
    postsPerWeekBasis: 'markivo',
    publishedCount: published.length,
    sampleDays: YOU_SAMPLE_DAYS,
    scheduledUpcoming: upcoming.length,
    followers: followerValue,
    followersLive: followerValue != null,
    rating: profile.googleRating ?? null,
    unavailable: [
      followerValue == null && 'followers',
      profile.googleRating == null && 'rating',
    ].filter(Boolean),
  };
}

// Ownership in one place, mirroring ownedTemplate.
const ownedCompetitor = (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  const row = profile ? db.competitors.findById(req.params.id) : null;
  if (!row || row.profileId !== profile.id) {
    res.status(404).json({ error: 'Competitor not found' });
    return null;
  }
  return row;
};

// Which metrics the owner has personally vouched for. Recorded per field so
// the UI can badge a typed-in number differently from a measured one.
const applyManualSources = (existing, fields) => {
  const sources = { ...(existing || {}) };
  for (const [srcKey, field] of [['rating', 'rating'], ['followers', 'followersCount'], ['postsPerWeek', 'postsPerWeek']]) {
    if (fields[field] === undefined) continue;
    if (fields[field] == null) delete sources[srcKey];
    else sources[srcKey] = 'manual';
  }
  return sources;
};

// No profile yet (pre-onboarding) is not an error — answer an empty envelope,
// the same way GET /api/templates does.
app.get('/api/competitors', verifyToken, asyncRoute(async (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) {
    return res.json({ competitors: [], you: null, gaps: [], discovery: discoveryState(null, []) });
  }
  const rows = db.competitors.listByProfile(profile.id);
  const competitors = rows.map(competitorRow);
  const you = await buildYou(profile);

  const posts = db.calendar.listByProfile(profile.id);
  res.json({
    competitors,
    you,
    gaps: computeGaps({
      you,
      competitors,
      keywordPhrases: db.keywords.listByProfile(profile.id).map((k) => k.keyword_phrase).filter(Boolean),
      // Coverage is measured against what we actually published, so the answer
      // is always true regardless of what any ranking API would claim.
      publishedTexts: posts.filter((p) => p.status === 'posted').map((p) => p.post_text),
    }),
    discovery: discoveryState(profile, rows),
  });
}));

// Re-query Google Places for nearby businesses and merge them in.
//
// Registered BEFORE /api/competitors/:id so the literal path wins the match.
//
// Cost envelope: ONE upstream call in steady state. A profile onboarded before
// lat/lng were persisted needs one extra searchText to re-resolve itself, and
// that answer is stored, so the second refresh is back to a single call. Same
// guardrail places.js documents at the top of the file.
app.post('/api/competitors/refresh', verifyToken, scanLimiter, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const answer = (extra) => {
    const rows = db.competitors.listByProfile(profile.id);
    res.json({
      refreshed: 0, added: 0, updated: 0, reason: null, ...extra,
      competitors: rows.map(competitorRow),
      discovery: discoveryState(db.profiles.findById(profile.id), rows),
    });
  };

  // A missing key is not an error: the tab keeps working on manual entries and
  // discovery simply reports why the button is disabled.
  if (!places.isLive()) return answer({ reason: 'no_api_key' });

  let { googleLat: lat, googleLng: lng, googlePrimaryType: primaryType } = profile;
  let excludePlaceId = profile.googlePlaceId || undefined;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !primaryType) {
    try {
      const data = await places.searchText({
        textQuery: [profile.businessName, profile.location].filter(Boolean).join(', '),
      });
      const top = Array.isArray(data.places) && data.places.length ? places.mapPlace(data.places[0]) : null;
      if (top && top.location && top.primaryType) {
        lat = top.location.lat;
        lng = top.location.lng;
        primaryType = top.primaryType;
        excludePlaceId = excludePlaceId || top.placeId;
        db.profiles.update(profile.id, {
          googleLat: lat, googleLng: lng, googlePrimaryType: primaryType,
          ...(profile.googlePlaceId ? {} : { googlePlaceId: top.placeId }),
        });
      }
    } catch (err) {
      console.error('Competitor refresh: business re-resolve failed:', err.status || '', err.message);
      return res.status(502).json({ error: 'Business discovery is temporarily unavailable. Please try again shortly.' });
    }
  }

  // Still unresolved — the business is not findable on Maps. Honest no-op.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !primaryType) {
    return answer({ reason: 'no_location' });
  }

  let found;
  try {
    found = await places.findCompetitors({ lat, lng, primaryType, excludePlaceId });
  } catch (err) {
    console.error('Competitor refresh failed:', err.status || '', err.message);
    return res.status(502).json({ error: 'Business discovery is temporarily unavailable. Please try again shortly.' });
  }

  let added = 0;
  let updated = 0;
  for (const c of found) {
    if (!c.placeId) continue; // without a placeId there is nothing to dedup on
    const { created } = db.competitors.upsertByPlaceId({
      profileId: profile.id,
      placeId: c.placeId,
      competitorName: c.competitorName,
      rating: c.rating,
      address: c.address,
      platformsDetected: c.platformsDetected || ['google'],
      source: 'google_places',
    });
    if (created) added += 1; else updated += 1;
  }
  answer({ refreshed: found.length, added, updated });
}));

// The cached local-market brief. Free, and never generates — reading what was
// already produced must not cost the owner an AI generation.
app.get('/api/competitors/insights', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.json({ brief: null, generatedAt: null });
  res.json({ brief: profile.marketBrief || null, generatedAt: profile.marketBriefAt || null });
});

// Generate (or regenerate) it. Behind checkAiBudget and an explicit user
// action, never on page load.
//
// This is INFERENCE about the category and location — the research prompt
// forbids naming competitors — so the UI renders it apart from the measured
// gaps, and groundingFlags are shown rather than hidden.
app.post('/api/competitors/insights', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const competitors = db.competitors.listByProfile(profile.id).map(competitorRow);
  const you = await buildYou(profile);
  const posts = db.calendar.listByProfile(profile.id);
  const gaps = computeGaps({
    you,
    competitors,
    keywordPhrases: db.keywords.listByProfile(profile.id).map((k) => k.keyword_phrase).filter(Boolean),
    publishedTexts: posts.filter((p) => p.status === 'posted').map((p) => p.post_text),
  });

  const brief = await research.generateMarketBrief({
    name: profile.businessName,
    category: profile.category,
    location: profile.location,
    topic: typeof req.body.topic === 'string' ? req.body.topic.trim().slice(0, 200) : '',
    // Passed so the offline template's content gaps are derived from real
    // arithmetic over this profile rather than invented.
    gaps,
  });

  db.profiles.update(profile.id, { marketBrief: brief, marketBriefAt: brief.generatedAt });
  db.usage.record({ userId: req.user.id, kind: 'research' });
  res.json({ brief, generatedAt: brief.generatedAt });
}));

app.post('/api/competitors', verifyToken, (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const error = validateCompetitorInput(req.body);
  if (error) return res.status(400).json({ error });

  const fields = competitorFields(req.body);
  if (db.competitors.findByName(profile.id, fields.competitorName)) {
    return res.status(409).json({ error: 'That competitor is already being tracked' });
  }

  const saved = db.competitors.add({
    profileId: profile.id,
    ...fields,
    source: 'manual',
    metricSources: applyManualSources({}, fields),
  });
  res.json(competitorRow(saved));
});

app.put('/api/competitors/:id', verifyToken, (req, res) => {
  const row = ownedCompetitor(req, res);
  if (!row) return;

  // Validate the MERGED row: a partial body that omits the name must still be
  // checked against the stored one rather than failing the required-name rule.
  const error = validateCompetitorInput({ ...row, ...req.body });
  if (error) return res.status(400).json({ error });

  const fields = competitorFields(req.body);
  if (fields.competitorName) {
    const clash = db.competitors.findByName(row.profileId, fields.competitorName);
    if (clash && clash.id !== row.id) {
      return res.status(409).json({ error: 'That competitor is already being tracked' });
    }
  }

  const saved = db.competitors.update(row.id, {
    ...fields,
    metricSources: applyManualSources(row.metricSources, fields),
  });
  res.json(competitorRow(saved));
});

app.delete('/api/competitors/:id', verifyToken, (req, res) => {
  const row = ownedCompetitor(req, res);
  if (!row) return;
  db.competitors.remove(row.id);
  res.json({ success: true });
});

// Read whatever a competitor has actually made public on a channel we already
// hold credentials for. Today that is a public Telegram channel via the owner's
// own bot; Instagram reports 'auth_upgrade_required' (see competitorSources).
//
// Always 200: the per-source `report` carries reason CODES, because "we could
// not read this" is information the owner needs, not an error.
app.post('/api/competitors/:id/enrich', verifyToken, asyncRoute(async (req, res) => {
  const row = ownedCompetitor(req, res);
  if (!row) return;

  const profile = db.profiles.findById(row.profileId);
  const { fields, sources, report } = await competitorSources.enrich(row, { profile, db });

  const saved = Object.keys(fields).length
    ? db.competitors.update(row.id, {
      ...fields,
      metricSources: { ...(row.metricSources || {}), ...sources },
      refreshedAt: new Date().toISOString(),
    })
    : row;

  res.json({ competitor: competitorRow(saved), report });
}));

// ==========================================
// 3.5 DASHBOARD METRICS ROUTER
// ==========================================
app.get('/api/dashboard/stats', verifyToken, asyncRoute(async (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Active profile not found' });

  const competitors = db.competitors.listByProfile(profile.id);
  const keywords = db.keywords.listByProfile(profile.id);
  const cat = (profile.category || 'business').toLowerCase();

  // REAL counts when a platform is connected; the demo numbers otherwise. The
  // lookup itself lives in liveFollowers so /api/competitors can share it — but
  // the benchmark there reports a null as "not reported" rather than falling
  // back to a demo figure, because a fabricated "you" row would invite a
  // direct comparison against real competitors.
  const live = await liveFollowers(profile);
  const telegramSubscribers = live.telegram.live
    ? { current: live.telegram.value, change: 0, live: true }
    : { current: 980, change: 11.2 };
  const instagramFollowers = live.instagram.live
    ? { current: live.instagram.value, change: 0, live: true }
    : { current: 1542, change: 15.6 };

  const metrics = {
    googleViews: { current: 4320, change: 12.4, live: false },
    googleCalls: { current: 148, change: 8.2, live: false },
    instagramFollowers,
    telegramSubscribers,
    tiktokFollowers: { current: 0, change: 0, live: false },
  };

  // Record today's reading, then hand back the recorded series so the dashboard
  // sparklines plot REAL movement. Metrics whose integrations have not landed
  // yet are still fixed demo numbers, so their series is honestly flat — the UI
  // says "collecting data" rather than drawing an invented curve.
  const day = new Date().toISOString().slice(0, 10);
  for (const [key, m] of Object.entries(metrics)) {
    db.metricHistory.record({ profileId: profile.id, metric: key, day, value: m.current });
    m.history = db.metricHistory.series(profile.id, key, 30);
  }

  res.json({
    metrics,
    // No demo substitution: an empty list means this business has no
    // competitors on file, and Competitor Intel says so directly.
    competitors: competitors.map((c) => ({
      name: c.competitorName,
      platformCount: (c.platformsDetected || []).length,
      postsPerWeek: c.postsPerWeek,
      rating: c.rating,
      followers: c.followersCount,
    })),
    // Phrases are real; positions are not tracked, so they stay null rather
    // than carrying a rank nobody measured.
    seoKeywords: keywords.length ? keywords : [
      { keyword_phrase: `best ${cat} in tashkent`, avg_position: null, volume: null },
    ],
    aiPresence: { perplexityScore: 78, chatgptRank: 'Top 5', sourcesCitedCount: 4 },
  });
}));

// ------------------------------------------------------------------
// Per-platform drill-down, opened by clicking a metric's chart.
//
// Two independent sources are merged and kept distinguishable:
//   • the PLATFORM's own numbers (real, only where an integration exists)
//   • what MARKIVO scheduled/published for it (always real — our own rows)
//
// Every block carries `live`. Nothing is invented to fill a gap: a figure the
// platform does not report comes back null and the UI says so, and
// `unavailable` names what this channel structurally cannot provide.
//
// `notice` is a CODE plus params, never a sentence — the interface ships in
// three languages and a hardcoded English string here would surface untranslated
// inside an Uzbek panel.
// ------------------------------------------------------------------
const PLATFORM_METRIC = {
  instagram: 'instagramFollowers',
  telegram: 'telegramSubscribers',
  google: 'googleViews',
  tiktok: 'tiktokFollowers',
};

app.get('/api/dashboard/platform/:key', verifyToken, asyncRoute(async (req, res) => {
  const key = String(req.params.key || '').toLowerCase();
  if (!PLATFORM_METRIC[key]) return res.status(404).json({ error: 'Unknown platform' });

  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Active profile not found' });

  // Our own record of this channel — always real, whatever the integration does.
  const ours = db.calendar.listByProfile(profile.id)
    .filter((r) => String(r.platform || '').toLowerCase() === key)
    .sort((a, b) => new Date(b.scheduled_time) - new Date(a.scheduled_time));

  const counts = ours.reduce((acc, r) => {
    const s = r.status === 'posted' ? 'posted' : r.status === 'failed' ? 'failed' : 'scheduled';
    acc[s] += 1;
    return acc;
  }, { posted: 0, scheduled: 0, failed: 0 });

  const payload = {
    platform: key,
    connected: false,
    live: false,
    account: null,
    headline: [],
    history: db.metricHistory.series(profile.id, PLATFORM_METRIC[key], 30),
    posts: [],
    ourPosts: ours.slice(0, 25).map((r) => ({
      id: r.id,
      text: r.post_text || '',
      when: r.scheduled_time,
      status: r.status,
      hasMedia: !!r.mediaId,
    })),
    counts,
    unavailable: [],
    notice: null,
  };

  if (key === 'instagram') {
    const conn = config.instagramEnabled ? db.instagram.findByProfile(profile.id) : null;
    if (!conn || !conn.accessToken) {
      payload.notice = { code: 'connectInstagram' };
      payload.unavailable = ['followers', 'engagement'];
    } else {
      payload.connected = true;
      try {
        const [acct, media] = await Promise.all([
          ig.getAccountStats(conn.accessToken),
          ig.getRecentMedia(conn.accessToken, 12),
        ]);
        payload.live = true;
        payload.account = {
          name: acct.accountName || conn.accountName,
          handle: acct.username || conn.igUsername,
          url: acct.username ? `https://instagram.com/${acct.username}` : null,
          type: acct.accountType,
        };
        payload.headline = [
          { key: 'followers', value: acct.followers },
          { key: 'following', value: acct.following },
          { key: 'posts', value: acct.mediaCount },
        ];
        payload.posts = media;
        // Personal accounts do not report these; say which, do not zero them.
        const missing = payload.headline.filter((h) => h.value === null).map((h) => h.key);
        if (missing.length) payload.unavailable = missing;
        if (media.some((m) => m.likes === null)) payload.unavailable.push('engagement');
      } catch (err) {
        // A dead/expired token must not blank the panel — our own rows still show.
        payload.notice = { code: 'instagramError', error: err.message };
        payload.unavailable = ['followers', 'engagement'];
      }
    }
  } else if (key === 'telegram') {
    const conn = config.telegramEnabled ? db.telegram.findByProfile(profile.id) : null;
    if (!conn || !conn.chatId) {
      payload.notice = { code: 'linkTelegram' };
      payload.unavailable = ['engagement'];
    } else {
      payload.connected = true;
      payload.account = { name: conn.chatTitle, handle: conn.botUsername ? `@${conn.botUsername}` : null, url: null };
      try {
        const members = await tg.getChatMemberCount(conn.botToken, conn.chatId);
        payload.live = true;
        payload.headline = [{ key: 'members', value: members }];
      } catch (err) {
        payload.notice = { code: 'telegramError', error: err.message };
      }
      // The Bot API cannot read a channel's history or its per-post reactions,
      // so engagement is structurally unavailable here — not merely unwired.
      payload.unavailable = ['engagement', 'postHistory'];
    }
  } else {
    // Google Business and TikTok have no integration yet. Our own queue rows are
    // the only real thing about them, and the response says exactly that.
    payload.notice = { code: 'noIntegration' };
    payload.unavailable = ['followers', 'engagement', 'postHistory'];
  }

  res.json(payload);
}));

// ==========================================
// 3.55 MEDIA STUDIO ROUTER (/api/media)
//   AI filming briefs, uploads, and edit plans today; actual image/video
//   rendering + auto-editing engage once a media-generation API key lands
//   (MEDIA_API_KEY — coming soon).
// ==========================================
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/=\s]+)$/;
const EXT_FOR = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

app.post('/api/media/brief', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const kind = String(req.body.kind || '').toLowerCase();
  const mode = String(req.body.mode || '').toLowerCase();
  const topic = typeof req.body.topic === 'string' ? req.body.topic.trim() : '';
  if (!['image', 'video'].includes(kind)) return res.status(400).json({ error: 'Kind must be "image" or "video"' });
  if (!['full', 'guided'].includes(mode)) return res.status(400).json({ error: 'Mode must be "full" or "guided"' });
  if (topic.length < 2 || topic.length > 200) return res.status(400).json({ error: 'Topic must be 2-200 characters' });

  // The customer-facing words in a brief — the caption, the spoken script, the
  // on-screen lines — are written in the audience's languages. The directing
  // instructions to the owner are not; see ai.generateMediaBrief.
  const brief = await ai.generateMediaBrief({
    kind, mode, topic, profile,
    languages: profile.audienceLanguages?.length ? profile.audienceLanguages : undefined,
  });
  const row = db.media.add({ profileId: profile.id, kind, mode, topic, brief, status: 'brief' });
  db.usage.record({ userId: req.user.id, kind: 'media' });
  res.json({ id: row.id, brief });
}));

app.post('/api/media/upload', verifyToken, (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const { mediaId, filename, dataUrl } = req.body || {};
  const match = typeof dataUrl === 'string' ? dataUrl.match(DATA_URL_RE) : null;
  if (!match) {
    return res.status(400).json({ error: 'Only PNG, JPEG, or WebP images and MP4 or WebM videos are accepted (as a base64 data URL).' });
  }
  const mime = match[1];
  const buf = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buf.length) return res.status(400).json({ error: 'The uploaded file is empty' });
  if (buf.length > MAX_UPLOAD_BYTES) return res.status(400).json({ error: 'File is too large — 8MB maximum' });

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const file = `${crypto.randomUUID()}.${EXT_FOR[mime]}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), buf);

  const filePath = `uploads/${file}`;
  const originalName = typeof filename === 'string' ? filename.slice(0, 200) : null;
  const existing = mediaId ? db.media.findById(String(mediaId)) : null;
  const row = (existing && existing.profileId === profile.id)
    ? db.media.update(existing.id, { status: 'uploaded', filePath, originalName })
    : db.media.add({
        profileId: profile.id,
        kind: mime.startsWith('video/') ? 'video' : 'image',
        status: 'uploaded',
        filePath,
        originalName,
      });

  res.json({ id: row.id, url: `/uploads/${file}` });
});

app.post('/api/media/:id/edit', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const row = db.media.findById(req.params.id);
  if (!row || row.profileId !== profile.id) return res.status(404).json({ error: 'Media item not found' });

  const instructions = typeof req.body.instructions === 'string' ? req.body.instructions.trim() : '';
  if (instructions.length < 2 || instructions.length > 500) {
    return res.status(400).json({ error: 'Instructions must be 2-500 characters' });
  }

  const plan = await ai.generateEditPlan({ instructions, media: row, profile });
  db.media.update(row.id, { brief: { ...(row.brief || {}), editPlan: plan }, status: 'edit_plan' });
  db.usage.record({ userId: req.user.id, kind: 'media' });
  res.json({ id: row.id, plan });
}));

// Render a full-mode AI image brief into a real image (fal.ai FLUX). Keyless
// mode answers 501 "engine pending"; video rendering is a later milestone.
app.post('/api/media/:id/render', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;

  const row = db.media.findById(req.params.id);
  if (!row || row.profileId !== profile.id) return res.status(404).json({ error: 'Media item not found' });
  if (row.mode !== 'full') {
    return res.status(400).json({ error: 'Only full-mode AI briefs can be rendered — guided briefs are filmed by you.' });
  }
  if (row.kind === 'video') return res.status(501).json({ error: 'Video rendering is coming soon — image rendering is available now.' });
  if (row.kind !== 'image') return res.status(400).json({ error: 'Only image briefs can be rendered' });

  // Build the generation prompt from the stored creative brief + the owner's
  // business context (concept first, then the visual spec fields).
  const brief = row.brief || {};
  const spec = brief.visualSpec || {};
  const prompt = [
    brief.concept || `A scroll-stopping marketing image for ${profile.businessName}${row.topic ? ` about ${row.topic}` : ''}`,
    spec.composition && `Composition: ${spec.composition}`,
    spec.palette && `Palette: ${spec.palette}`,
    spec.mood && `Mood: ${spec.mood}`,
    `Professional social-media photo for ${profile.businessName}, a ${(profile.category || 'business').toLowerCase()}` +
      `${profile.location ? ` in ${profile.location}` : ''}. Photorealistic, no text, no watermark.`,
  ].filter(Boolean).join('\n');

  try {
    const { filePath } = await mediagen.renderImage({ prompt });
    // Stored without the leading slash (same convention as /api/media/upload).
    const updated = db.media.update(row.id, { filePath: filePath.replace(/^\//, ''), status: 'rendered' });
    db.usage.record({ userId: req.user.id, kind: 'media' });
    res.json({ id: updated.id, url: filePath });
  } catch (err) {
    if (err instanceof mediagen.MediaEngineError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

app.get('/api/media', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.json({ items: [] });
  res.json({ items: db.media.listByProfile(profile.id) });
});

// ==========================================
// 3.6 AI AGENT & APPROVAL GATES (/api/agent)
//   Markiv now has conversation memory (agent_messages), language-aware
//   replies, and read/act tools (snapshot, calendar, drafting) passed into
//   ai.js as closures. Money actions still always hit the approval gate.
// ==========================================
app.post('/api/agent/query', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'A query is required' });
  const lang = ['en', 'uz', 'ru'].includes(req.body.lang) ? req.body.lang : 'en';

  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  db.usage.record({ userId: req.user.id, kind: 'agent' });

  // Conversation memory: load the recent turns BEFORE recording the new
  // message, so the model sees prior context without a duplicate of it.
  const history = db.agentMessages.listByProfile(profile.id, 12);
  db.agentMessages.add({ profileId: profile.id, sender: 'user', text: query });
  const recordAgentReply = (text) => {
    if (text) db.agentMessages.add({ profileId: profile.id, sender: 'agent', text });
  };

  const lower = query.toLowerCase();
  // Deterministic safety gate — anything touching ad spend / money always
  // requires explicit human approval, regardless of what the model would say.
  // Word-boundary regex so words like "upload" or "add" don't false-trigger.
  if (/\b(ads?|advert\w*|campaigns?|budgets?)\b/.test(lower)) {
    // Ad creative is built from the owner's own profile (description first,
    // category as the generic fallback) — no business-type assumptions.
    const adCat = (profile.category || 'business').toLowerCase();
    const adPitch = (profile.description && String(profile.description).trim())
      ? String(profile.description).trim().replace(/\.+$/, '').slice(0, 140)
      : `the ${adCat} experience your neighbourhood keeps coming back for`;
    const approval = db.approvals.create({
      profileId: profile.id,
      actionType: 'ad_creation',
      actionPayload: {
        action: 'Create Meta Ad Campaign',
        cost: '$5.00 / day',
        target: `${profile.targetAudience || 'Local customers'} near ${profile.location || 'Tashkent'}`,
        creative: `🎯 Preview: "Discover #${profile.businessName} — ${adPitch}."`,
      },
    });
    return res.json({ triggerApproval: true, approvalId: approval.id, payload: approval.action_payload });
  }

  // What Markiv can SEE (snapshot) and DO (calendar/drafting closures) —
  // passed into the AI layer as plain functions so ai.js stays db-free.
  const calendarRows = db.calendar.listByProfile(profile.id);
  const snapshot = {
    stats: {
      competitorCount: db.competitors.listByProfile(profile.id).length,
      keywords: db.keywords.listByProfile(profile.id).slice(0, 3).map((k) => k.keyword_phrase),
      scheduledPosts: calendarRows.filter((p) => p.status === 'scheduled').length,
      postedPosts: calendarRows.filter((p) => p.status === 'posted').length,
    },
    usage: usageInfo(req.user),
  };
  const actions = {
    snapshot: () => snapshot,
    listScheduled: () =>
      db.calendar.listByProfile(profile.id)
        .filter((p) => p.status === 'scheduled')
        .slice(0, 10)
        .map((p) => ({
          platform: p.platform,
          post_text: (p.post_text || '').slice(0, 80),
          scheduled_time: p.scheduled_time,
          status: p.status,
        })),
    schedulePost: ({ platform, text, scheduledTime }) => {
      const row = db.calendar.add({
        profileId: profile.id,
        platform: String(platform || 'instagram').toLowerCase(),
        postText: String(text || '').slice(0, 4000),
        scheduledTime: scheduledTime || new Date(Date.now() + 86400000).toISOString(),
        status: 'scheduled',
      });
      return { scheduled: true, id: row.id, platform: row.platform, scheduledTime: row.scheduled_time };
    },
    draftContent: ({ platform, topic }) => ai.generateContent({
      platform,
      topic,
      businessName: profile.businessName,
      category: profile.category,
      description: profile.description,
      brandTone: profile.brandTone,
      audience: profile.targetAudience,
      location: profile.location,
      brief: profile.brandBrief,
      preferences: db.feedback.recentExamples(profile.id),
      // Markiv drafts in the customers' languages, not the owner's chat
      // language — the post is read by one and written for the other.
      languages: profile.audienceLanguages?.length ? profile.audienceLanguages : undefined,
    }),
    // Deferred onboarding: a fact the owner mentioned in conversation lands in
    // the same place the profile panel writes to, so the "!" badge drops by one
    // and nobody is asked twice. Re-reads the profile because earlier turns in
    // this same request may already have saved something.
    saveBusinessDetail: ({ key, value }) => {
      // An empty value means "skip" on the panel path, where the owner chose
      // it. Coming from the model it can only be a malformed call, and
      // silencing a question nobody answered is the one outcome to avoid.
      if (!value || !String(value).trim()) return { saved: false, error: 'A non-empty value is required' };
      const current = db.profiles.findById(profile.id);
      const fields = profileQuestions.applyAnswers(current, { [key]: value }, 'markiv');
      if (!fields) return { saved: false, error: `Unknown detail key: ${key}` };
      const updated = db.profiles.update(profile.id, fields);
      return { saved: true, key, remaining: profileQuestions.completion(updated).pendingCount };
    },
  };

  const conn = config.telegramEnabled ? db.telegram.findByProfile(profile.id) : null;
  // Connected non-Telegram platforms Markiv may publish to (via the approval
  // gate). Empty when nothing is connected — Markiv then offers only Telegram.
  const connectedPlatforms = db.connections.listByProfile(profile.id)
    .map((c) => connectors.get(c.platform))
    .filter(Boolean)
    .map((a) => ({ key: a.key, label: a.label }));
  const action = await ai.agentAct({
    query,
    history,
    lang,
    profile,
    telegram: conn
      ? { connected: true, chatTitle: conn.chatTitle, chatType: conn.chatType, hasChat: !!conn.chatId }
      : { connected: false, comingSoon: !config.telegramEnabled },
    platforms: connectedPlatforms,
    snapshot,
    actions,
    preferences: db.feedback.recentExamples(profile.id),
  });

  // Markiv proposed a Telegram publish → route through the human approval gate.
  if (action.type === 'telegram_post') {
    if (!config.telegramEnabled) {
      const reply = 'Telegram publishing is coming soon — it is not enabled in this version yet. Meanwhile I can draft the post text for you in the Content Engine.';
      recordAgentReply(reply);
      return res.json({ reply });
    }
    if (!conn || !conn.chatId) {
      const reply = conn
        ? `Your bot @${conn.botUsername} is connected, but no channel is linked yet. Open the Telegram card on your dashboard, add the bot to your channel as admin, and click Detect — then I can post for you.`
        : `Your Telegram isn't connected yet. Open the Telegram card on your dashboard — it takes about a minute — and then I can post for you.`;
      recordAgentReply(reply);
      return res.json({ reply });
    }
    const approval = db.approvals.create({
      profileId: profile.id,
      actionType: 'telegram_post',
      actionPayload: {
        action: 'Publish Telegram Post',
        cost: 'Free — organic post',
        target: `${conn.chatTitle || conn.chatId} (${conn.chatType || 'channel'})`,
        creative: action.text,
        text: action.text,
      },
    });
    const reply = action.note || 'I drafted this post for your Telegram channel — review and approve to publish.';
    recordAgentReply(reply);
    return res.json({
      triggerApproval: true,
      approvalId: approval.id,
      payload: approval.action_payload,
      reply,
    });
  }

  // Markiv proposed a publish to a connected platform → route through the gate.
  if (action.type === 'platform_post') {
    const adapter = connectors.get(action.platform);
    if (!adapter) {
      const reply = "I couldn't tell which platform to post to — could you name it (e.g. Instagram, TikTok)?";
      recordAgentReply(reply);
      return res.json({ reply });
    }
    const approval = db.approvals.create({
      profileId: profile.id,
      actionType: 'platform_post',
      actionPayload: {
        action: `Publish ${adapter.label} Post`,
        cost: 'Free — organic post',
        target: adapter.label,
        creative: action.text,
        text: action.text,
        platform: adapter.key,
      },
    });
    const reply = action.note || `I drafted this post for your ${adapter.label} — review and approve to publish.`;
    recordAgentReply(reply);
    return res.json({ triggerApproval: true, approvalId: approval.id, payload: approval.action_payload, reply });
  }

  recordAgentReply(action.reply);
  res.json({ reply: action.reply });
}));

// Markiv's conversation memory for the signed-in user's profile.
app.get('/api/agent/history', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.json({ messages: [] });
  res.json({
    messages: db.agentMessages.listByProfile(profile.id, 40)
      .map((m) => ({ sender: m.sender, text: m.text, created_at: m.created_at })),
  });
});

app.delete('/api/agent/history', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (profile) db.agentMessages.clearByProfile(profile.id);
  res.json({ success: true });
});

app.post('/api/agent/approve', verifyToken, asyncRoute(async (req, res) => {
  const { approvalId } = req.body;
  const approval = db.approvals.findById(approvalId);
  if (!approval) return res.status(404).json({ error: 'Pending authorization request not found' });
  if (approval.status !== 'pending') {
    return res.status(400).json({ error: 'This request was already processed' });
  }

  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile || profile.id !== approval.profileId) {
    return res.status(403).json({ error: 'This approval belongs to a different business' });
  }

  // The owner may tweak Mark's draft at the gate before approving — publish the
  // edit and record it as the stronger 'edited' taste signal.
  const gateEdited = typeof req.body.editedText === 'string' && req.body.editedText.trim()
    ? req.body.editedText.trim()
    : null;

  // Approved Telegram posts are executed for real via the Bot API.
  if (approval.action_type === 'telegram_post') {
    if (!config.telegramEnabled) {
      return res.status(503).json({ error: 'Telegram publishing is coming soon — it is not part of the current MVP.' });
    }
    try {
      const tgText = gateEdited || approval.action_payload.text;
      const result = await executeTelegramPost(profile, tgText);
      db.approvals.updateStatus(approvalId, 'approved');
      db.feedback.record({
        profileId: profile.id, platform: 'telegram',
        signal: feedbackSignal(gateEdited ? approval.action_payload.text : null, tgText),
        draftText: gateEdited ? approval.action_payload.text : null, finalText: tgText,
      });
      return res.json({
        success: true,
        message: `✅ Published to ${result.chatTitle}! Your subscribers can see it now.`,
      });
    } catch (err) {
      db.approvals.updateStatus(approvalId, 'failed');
      return res.status(400).json({ error: `Publishing failed: ${err.description || err.message}` });
    }
  }

  // Approved platform posts (Instagram/Facebook/TikTok/Google Business/YouTube)
  // publish via the connector — sandbox connectors return a simulated result.
  if (approval.action_type === 'platform_post') {
    const platform = approval.action_payload.platform;
    const adapter = connectors.get(platform);
    try {
      const ppText = gateEdited || approval.action_payload.text;
      const result = await executePlatformPost(profile, platform, ppText, approval.action_payload.mediaUrl);
      db.approvals.updateStatus(approvalId, 'approved');
      db.feedback.record({
        profileId: profile.id, platform,
        signal: feedbackSignal(gateEdited ? approval.action_payload.text : null, ppText),
        draftText: gateEdited ? approval.action_payload.text : null, finalText: ppText,
      });
      return res.json({
        success: true,
        message: result.simulated
          ? `✅ Drafted & queued for ${adapter ? adapter.label : platform} (sandbox — connect live credentials to publish for real).`
          : `✅ Published to ${adapter ? adapter.label : platform}!`,
      });
    } catch (err) {
      db.approvals.updateStatus(approvalId, 'failed');
      return res.status(err.code || 400).json({ error: `Publishing failed: ${err.message}` });
    }
  }

  // Ad campaigns remain simulated until the Ads APIs land.
  const updated = db.approvals.updateStatus(approvalId, 'approved');
  res.json({
    success: true,
    message: `Campaign authorized! Launched localized ad campaign costing ${updated.action_payload.cost}. (Simulation — Meta Ads integration coming soon.)`,
  });
}));

// ==========================================
// 3.65 AUTOPILOT (autonomous marketing agent) (/api/autonomous)
//   Per-business opt-in. When enabled, a background worker analyzes the profile
//   and auto-generates + publishes ORGANIC promotional posts on a cadence (or
//   queues them for one-tap approval). Paid ad campaigns are NEVER run here —
//   money spend always goes through the deterministic approval gate above.
// ==========================================
const autonomousGate = (req, res, next) => {
  if (!config.autonomousEnabled) {
    return res.status(503).json({ error: 'Autopilot is not enabled in this deployment.', comingSoon: true });
  }
  next();
};

// Publisher closures injected into the Autopilot worker so it can publish
// organic posts through the same helpers the rest of the server uses, without
// autonomous.js reaching into Express internals.
const autopilotPublishers = {
  publishTelegram: (profile, text) => executeTelegramPost(profile, text),
  publishPlatform: (profile, platform, text) => executePlatformPost(profile, platform, text),
  telegramReady: (profile) => {
    if (!config.telegramEnabled) return false;
    const conn = db.telegram.findByProfile(profile.id);
    return !!(conn && conn.chatId);
  },
};
const runAutopilotTick = (opts = {}) =>
  autonomous.runAutonomousTick({ db, ai, connectors, config, publishers: autopilotPublishers, ...opts });

// Current Autopilot config + recent activity for the signed-in business.
app.get('/api/autonomous/status', verifyToken, (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  res.json({
    enabled: config.autonomousEnabled,
    config: db.autonomous.getConfig(profile.id) || { enabled: false, platforms: [], frequency: 'daily', autoPublish: true },
    activity: db.autonomous.listActivity(profile.id, 30),
  });
});

// Save Autopilot settings. Enabling makes the business eligible on the next tick.
app.put('/api/autonomous/config', verifyToken, autonomousGate, (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const { enabled, platforms, frequency, autoPublish } = req.body;
  const validFreq = ['daily', 'weekly', 'test'].includes(frequency) ? frequency : 'daily';
  const validPlatforms = Array.isArray(platforms)
    ? [...new Set(platforms.map(String).filter((p) => connectors.has(p)))].slice(0, 8)
    : [];
  // Only (re)arm the timer on the disabled -> enabled transition. Saving other
  // settings while already enabled must NOT reset the cadence or trigger an
  // extra immediate run — preserve the existing next_run_at.
  const prev = db.autonomous.getConfig(profile.id);
  const nextRunAt = !enabled
    ? null
    : (prev && prev.enabled && prev.nextRunAt) ? prev.nextRunAt : new Date().toISOString();
  const cfg = db.autonomous.upsertConfig({
    profileId: profile.id,
    enabled: !!enabled,
    platforms: validPlatforms,
    frequency: validFreq,
    autoPublish: autoPublish !== false, // default true ("post by himself")
    nextRunAt,
  });
  res.json({ config: cfg });
});

// Paginated Autopilot activity log.
app.get('/api/autonomous/activity', verifyToken, (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  res.json({ activity: db.autonomous.listActivity(profile.id, limit) });
});

// "Run now" — user-initiated, budget-checked. Runs one Autopilot cycle for this
// business immediately (ignores the cadence timer).
app.post('/api/autonomous/run', verifyToken, autonomousGate, checkAiBudget, asyncRoute(async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const cfg = db.autonomous.getConfig(profile.id);
  if (!cfg || !cfg.enabled) return res.status(400).json({ error: 'Enable Autopilot first, then run it.' });
  const result = await autonomous.runProfileAutopilot({ db, ai, connectors, config, publishers: autopilotPublishers, profileId: profile.id, nowMs: Date.now(), force: true });
  res.json({ result, activity: db.autonomous.listActivity(profile.id, 30) });
}));

// ==========================================
// 3.7 BILLING ROUTER (/api/billing)
//   Stripe Checkout subscriptions when STRIPE_SECRET_KEY is set; simulated
//   instant upgrades when it isn't. Payme/Click follow after merchant
//   onboarding (see billing.PROVIDERS).
// ==========================================
app.post('/api/billing/checkout', verifyToken, asyncRoute(async (req, res) => {
  // The DB user, not the JWT claims — the claims carry a possibly-stale tier.
  const dbUser = db.users.findById(req.user.id);
  if (!dbUser) return res.status(404).json({ error: 'User session not found' });
  try {
    res.json(await billing.createCheckout(dbUser, req.body.tier));
  } catch (err) {
    if (err instanceof billing.BillingError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

app.get('/api/billing/status', verifyToken, asyncRoute(async (req, res) => {
  const dbUser = db.users.findById(req.user.id);
  if (!dbUser) return res.status(404).json({ error: 'User session not found' });
  res.json(billing.getStatus(dbUser));
}));

// Stripe calls this — no verifyToken; authenticity comes from the signature
// over the raw payload instead.
app.post('/api/billing/webhook', asyncRoute(async (req, res) => {
  if (!config.stripeWebhookSecret) return res.status(501).json({ error: 'webhook not configured' });
  let event;
  try {
    event = billing.constructWebhookEvent(req.rawBody, req.headers['stripe-signature']);
  } catch (err) {
    const status = err instanceof billing.BillingError ? err.status : 400;
    return res.status(status).json({ error: err.message });
  }
  billing.applyStripeEvent(event);
  res.json({ received: true });
}));

// ==========================================
// 3.75 ACCOUNT & DATA DELETION (/api/me, /api/meta/data-deletion)
//   Backs the published deletion policy at /data-deletion.html and the Data
//   Deletion Request URL registered in the Meta app dashboard.
// ==========================================

// Erase one account completely: DB rows cascade from users(id), and the
// uploaded files those rows referenced are unlinked from disk afterwards.
// Returns the number of files removed. Unlink failures are logged, not thrown —
// a missing file must not abort an erasure that already succeeded in the DB.
function eraseUser(userId) {
  const { deleted, mediaPaths } = db.users.delete(userId);
  if (!deleted) return { deleted: false, filesRemoved: 0 };

  let filesRemoved = 0;
  for (const rel of mediaPaths) {
    // Media paths are stored relative ("/uploads/<file>"); resolve to the real
    // file and refuse anything that escapes UPLOADS_DIR.
    const resolved = path.resolve(UPLOADS_DIR, path.basename(String(rel)));
    if (!resolved.startsWith(UPLOADS_DIR)) continue;
    try {
      fs.unlinkSync(resolved);
      filesRemoved += 1;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Could not unlink ${resolved}: ${err.message}`);
    }
  }
  return { deleted: true, filesRemoved };
}

// Self-serve account deletion. Irreversible and immediate.
app.delete('/api/me', verifyToken, (req, res) => {
  const user = db.users.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User session not found' });

  const code = metaDeletion.newConfirmationCode();
  const { filesRemoved } = eraseUser(user.id);
  db.deletionRequests.create({
    confirmationCode: code,
    source: 'account',
    status: 'completed',
    detail: `Self-serve deletion. ${filesRemoved} uploaded file(s) removed.`,
  });
  res.json({
    success: true,
    confirmationCode: code,
    statusUrl: `${config.appUrl}/data-deletion.html?code=${code}`,
    message: 'Your account and all associated data have been permanently deleted.',
  });
});

// PUBLIC — Meta POSTs a form-encoded `signed_request` here when a user removes
// the app. Authenticity is the HMAC signature over the payload, so no session
// is involved; `express.urlencoded` is mounted only on this route because the
// rest of the API is JSON.
//
// The signature is keyed by the app secret of whichever Meta app sent it — the
// Facebook app and the Instagram-login app have different secrets, so both are
// tried before rejecting.
app.post(
  '/api/meta/data-deletion',
  express.urlencoded({ extended: false }),
  (req, res) => {
    const secretsToTry = [
      config.connectors.meta.clientSecret,
      config.instagramAppSecret,
    ].filter(Boolean);

    if (secretsToTry.length === 0) {
      return res.status(501).json({ error: 'Data deletion callback is not configured' });
    }

    let payload = null;
    let lastError = null;
    for (const secret of secretsToTry) {
      try {
        payload = metaDeletion.parseSignedRequest(req.body.signed_request, secret);
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!payload) {
      // Do not echo the parser's reason back to the caller.
      console.warn(`Meta data-deletion callback rejected: ${lastError && lastError.message}`);
      return res.status(400).json({ error: 'Invalid signed_request' });
    }

    const metaUserId = payload.user_id ? String(payload.user_id) : '';
    const userIds = db.connections.findUserIdsByMetaUserId(metaUserId);

    let filesRemoved = 0;
    for (const userId of userIds) filesRemoved += eraseUser(userId).filesRemoved;

    // An unmatched id is a normal outcome — the person may have connected only
    // Telegram, or already deleted their account. Meta still requires a 200
    // with a trackable code, so the request is logged either way.
    const code = metaDeletion.newConfirmationCode();
    db.deletionRequests.create({
      confirmationCode: code,
      source: 'meta',
      externalUserId: metaUserId || null,
      status: userIds.length > 0 ? 'completed' : 'no_match',
      detail: userIds.length > 0
        ? `Erased ${userIds.length} account(s) and ${filesRemoved} uploaded file(s).`
        : 'No Markivo account is linked to this Meta user id — nothing was stored.',
    });

    res.json({
      url: `${config.appUrl}/data-deletion.html?code=${code}`,
      confirmation_code: code,
    });
  }
);

// PUBLIC — lets someone check a deletion by its confirmation code. Returns only
// the status and date; never the erased account's details.
app.get('/api/data-deletion/status', (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'A confirmation code is required' });
  const row = db.deletionRequests.findByCode(code);
  if (!row) return res.status(404).json({ error: 'Unknown confirmation code' });
  res.json({
    confirmationCode: row.confirmationCode,
    status: row.status,
    detail: row.detail,
    requestedAt: row.created_at,
  });
});

// ==========================================
// 3.8 SCHEDULED-POST WORKER
//   Publishes due calendar posts. Instagram and Telegram go out through their
//   dedicated, more complete real-publish paths (media resolution, video
//   polling); every other platform dispatches through the generic connector
//   adapter (sandbox-simulated until live credentials are configured — see
//   connectors/base.js). Runs every 60s when the server is started directly;
//   tests invoke the exported tick by hand.
// ==========================================
const REPEAT_STEP_MS = { daily: 86400000, weekly: 7 * 86400000, monthly: 30 * 86400000 };

// A post created with "Repeat Post Every…" set clones itself forward by one
// interval the moment it goes out, so the series keeps extending on its own
// instead of needing the owner to schedule each occurrence by hand.
function scheduleNextOccurrence(row) {
  const step = REPEAT_STEP_MS[row.repeatRule];
  if (!step) return;
  db.calendar.add({
    profileId: row.profileId,
    platform: row.platform,
    postText: row.post_text,
    mediaId: row.mediaId,
    scheduledTime: new Date(new Date(row.scheduled_time).getTime() + step).toISOString(),
    status: 'scheduled',
    tag: row.tag,
    repeatRule: row.repeatRule,
  });
}

async function runScheduledPostsTick() {
  const due = db.calendar.listDue(new Date().toISOString());
  let posted = 0;
  let failed = 0;

  for (const row of due) {
    // Instagram: publish for real when connected AND the row carries the media
    // the owner attached in the composer. Instagram has no text-only post type,
    // so a row without media can never publish — leave it scheduled rather than
    // flipping it to 'failed', since attaching media later makes it valid.
    if (row.platform === 'instagram') {
      if (!config.instagramEnabled || !row.mediaId) continue;
      const profile = db.profiles.findById(row.profileId);
      const conn = profile ? db.instagram.findByProfile(profile.id) : null;
      if (!profile || !conn || !conn.igUserId) continue;
      const media = resolveInstagramMedia(profile, { mediaId: row.mediaId });
      if (!media.imageUrl && !media.videoUrl) continue;
      try {
        // ig.publishMediaPost directly, NOT executeInstagramPost — that helper
        // inserts a NEW calendar row; here the row exists and just flips status.
        await ig.publishMediaPost(conn, { ...media, caption: row.post_text });
        db.calendar.setStatus(row.id, 'posted');
        scheduleNextOccurrence(row);
        posted += 1;
      } catch (err) {
        db.calendar.setStatus(row.id, 'failed');
        console.warn(`Scheduled instagram post ${row.id} failed:`, err.message);
        failed += 1;
      }
      continue;
    }

    if (row.platform === 'telegram') {
      // Flag off, or the profile hasn't linked a chat yet: leave it scheduled so
      // it publishes automatically once the setup completes.
      if (!config.telegramEnabled) continue;
      const conn = db.telegram.findByProfile(row.profileId);
      if (!conn || !conn.chatId) continue;

      // Send directly (NOT executeTelegramPost — that helper adds a NEW calendar
      // row for ad-hoc posts; here the row already exists and just flips status).
      try {
        const profile = row.mediaId ? db.profiles.findById(row.profileId) : null;
        const media = profile ? resolvePublicMedia(profile, row.mediaId) : null;
        await tg.sendPost(conn.botToken, conn.chatId, row.post_text, media);
        db.calendar.setStatus(row.id, 'posted');
        scheduleNextOccurrence(row);
        posted += 1;
      } catch (err) {
        db.calendar.setStatus(row.id, 'failed');
        console.warn(`Scheduled telegram post ${row.id} failed:`, err.description || err.message);
        failed += 1;
      }
      continue;
    }

    // Every other platform (Facebook/TikTok/Google Business/YouTube, and any
    // future connector) goes through the SAME generic adapter dispatch the
    // approval gate and Autopilot already use (executePlatformPost). An
    // adapter with no live credentials still publishes — as a recorded sandbox
    // simulation (connectors/base.js simulatedPublish) — so a scheduled post
    // never gets silently stuck at 'scheduled' forever just because the
    // platform hasn't gone live yet.
    const adapter = connectors.get(row.platform);
    if (!adapter) continue; // unknown platform key — leave the row alone, don't guess
    const profile = db.profiles.findById(row.profileId);
    if (!profile) continue;
    try {
      const media = row.mediaId ? resolvePublicMedia(profile, row.mediaId) : null;
      await adapter.publish({ db, profile, text: row.post_text, mediaUrl: media?.url });
      db.calendar.setStatus(row.id, 'posted');
      scheduleNextOccurrence(row);
      posted += 1;
    } catch (err) {
      db.calendar.setStatus(row.id, 'failed');
      console.warn(`Scheduled ${row.platform} post ${row.id} failed:`, err.message);
      failed += 1;
    }
  }

  return { due: due.length, posted, failed };
}

// --- Uploaded media files (Media Studio) ---
app.use('/uploads', express.static(UPLOADS_DIR));

// --- 404 + error handlers ---
app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Only listen when run directly (tests import the app without binding a port).
if (require.main === module) {
  console.log('📦 Markivo SQLite database ready at', config.dbPath);
  app.listen(config.port, () => {
    console.log(`🚀 Markivo API server running on port ${config.port}`);
  });
  // Scheduled-post worker: every 60s, publish due calendar posts.
  if (process.env.NODE_ENV !== 'test' && process.env.WORKER_ENABLED !== 'false') {
    setInterval(runScheduledPostsTick, 60000);
    console.log('⏱️  Scheduled-post worker running (60s tick)');

    // Autopilot worker: scan for due autonomous businesses and run each. A
    // re-entrancy guard skips a tick while the previous one is still running, so
    // a slow batch can't stack overlapping ticks.
    if (config.autonomousEnabled) {
      let autopilotTicking = false;
      setInterval(async () => {
        if (autopilotTicking) return;
        autopilotTicking = true;
        try { await runAutopilotTick(); }
        catch (e) { console.warn('Autopilot tick failed:', e.message); }
        finally { autopilotTicking = false; }
      }, config.autonomousTickMs);
      console.log(`🤖 Autopilot worker running (${Math.round(config.autonomousTickMs / 60000)}m tick)`);
    }
  }
}

module.exports = {
  app,
  db,
  runScheduledPostsTick,
  // Bound to the server's db/deps + publishers so tests can drive a cycle.
  runAutonomousTick: runAutopilotTick,
};
