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
const tg = require('./telegram');
const places = require('./places');
const { validateRegister, validateLogin, validateScan, validateCompetitors, validateProfileUpdate, validateMeUpdate } = require('./validators');

const db = createDb(config.dbPath);
const app = express();

// --- CORS ---
const corsOptions = config.corsOrigins.includes('*')
  ? {}
  : { origin: config.corsOrigins };
app.use(cors(corsOptions));
// Media uploads arrive as base64 data URLs — route-scoped larger JSON limit.
// Must be mounted BEFORE the global 1mb parser (the first parser to run wins;
// later body-parsers skip an already-parsed body).
app.use('/api/media/upload', express.json({ limit: '12mb' }));
app.use(express.json({ limit: '1mb' }));

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
  const tier = config.aiTierLimits[user.tier] != null ? user.tier : 'freemium';
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
const sanitizeCompetitors = (list) => (Array.isArray(list) ? list : [])
  .slice(0, 10)
  .filter((c) => c && typeof (c.competitorName || c.name) === 'string')
  .map((c) => ({
    competitorName: String(c.competitorName || c.name).slice(0, 120),
    rating: Number.isFinite(+c.rating) ? +c.rating : null,
    followersCount: Number.isFinite(+c.followersCount) ? +c.followersCount : null,
    postsPerWeek: Number.isFinite(+c.postsPerWeek) ? +c.postsPerWeek : null,
    platformsDetected: Array.isArray(c.platformsDetected)
      ? c.platformsDetected.slice(0, 6).map(String)
      : ['google'],
  }));

app.post('/api/onboarding/construct', verifyToken, (req, res) => {
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
    brandTone: tone || 'Cozy & Warm',
    slogan,
    logoMetadata: logo || { text: businessName, color: '#D4A373', bgColor: '#1A1816', shape: 'circle', icon: '☕' },
    onboardPath: req.body.onboardPath || 'B (Scratch)',
    googlePlaceId: typeof g.placeId === 'string' ? g.placeId.slice(0, 128) : null,
    googleRating: Number.isFinite(+g.rating) ? +g.rating : null,
    googleReviewsCount: Number.isFinite(+g.reviewsCount) ? +g.reviewsCount : null,
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
        followersCount: Math.floor(Math.random() * 500) + 200,
      });
    }
  });

  // Competitors: real nearby businesses from the discovery scan when Path A
  // provides them; otherwise the benchmark seeds (Path B / keyless mode).
  const realCompetitors = sanitizeCompetitors(req.body.competitors);
  const competitorRows = realCompetitors.length ? realCompetitors : [
    { competitorName: 'Local Competitor A', rating: 4.5, followersCount: 2400, postsPerWeek: 10, platformsDetected: ['instagram', 'telegram'] },
    { competitorName: 'District Roasters B', rating: 4.7, followersCount: 4100, postsPerWeek: 8, platformsDetected: ['google', 'instagram'] },
    { competitorName: 'Global Competitor C', rating: 4.8, followersCount: 95000, postsPerWeek: 22, platformsDetected: ['google', 'instagram', 'telegram', 'tiktok'] },
  ];
  competitorRows.forEach((c) => db.competitors.add({ profileId: profile.id, ...c }));

  // Seed SEO keywords. (Still mocked — real rank tracking is a future
  // milestone; the phrases improve automatically now that Path A passes the
  // real Google category in.) The third phrase derives from the profile's
  // audience/category instead of a hardcoded niche.
  const cat = safeCategory.toLowerCase();
  const audiencePhrase = (typeof audience === 'string' && audience.trim())
    ? `${cat} for ${audience.trim().toLowerCase().slice(0, 60)}`
    : `top rated ${cat}`;
  [
    { keywordPhrase: `best ${cat} in tashkent`, avgPosition: 8, volume: 'High' },
    { keywordPhrase: `${cat} near me`, avgPosition: 12, volume: 'Very High' },
    { keywordPhrase: `${audiencePhrase} ${location || 'tashkent'}`, avgPosition: 4, volume: 'Medium' },
  ].forEach((k) => db.keywords.add({ profileId: profile.id, ...k }));

  // Seed an inaugural scheduled post — a generic welcome from the business
  // name + category (uz/ru flavour kept, no business-type assumptions).
  db.calendar.add({
    profileId: profile.id,
    platform: 'instagram',
    postText: `🇺🇿 O'zbekcha: #${businessName} endi shu yerda! ${safeCategory} bo'yicha eng yaxshi taklif va yangiliklarni shu sahifada kuzatib boring. ✨\n🇷🇺 Русский: Добро пожаловать в #${businessName}! Следите за нашими новостями и лучшими предложениями здесь.`,
    scheduledTime: new Date(Date.now() + 86400000).toISOString(),
    status: 'scheduled',
  });

  // Return the profile WITH a platforms map so the dashboard can render
  // immediately without a follow-up fetch.
  const platformsMap = {};
  db.platforms.listByProfile(profile.id).forEach((pl) => { platformsMap[pl.platformName] = pl.isConnected; });
  res.json({ success: true, profile: { ...profile, platforms: platformsMap } });
});

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
// 3.4 AI CONTENT ENGINE ROUTER (/api/content)
//   NOTE: copy is still templated. Real Claude generation is the "AI core"
//   milestone.
// ==========================================
app.post('/api/content/copywrite', verifyToken, checkAiBudget, asyncRoute(async (req, res) => {
  const { platform, topic, languages } = req.body;
  const profile = db.profiles.findByUserId(req.user.id);

  const result = await ai.generateContent({
    platform,
    topic,
    languages: Array.isArray(languages) ? languages : ['en'],
    businessName: req.body.businessName || profile?.businessName,
    category: profile?.category,
    description: profile?.description,
    brandTone: profile?.brandTone,
    audience: profile?.targetAudience,
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

app.post('/api/content/schedule', verifyToken, (req, res) => {
  const { platform, postText, scheduledTime } = req.body;
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const post = db.calendar.add({
    profileId: profile.id,
    platform: (platform || 'instagram').toLowerCase(),
    postText,
    scheduledTime: scheduledTime || new Date(Date.now() + 86400000).toISOString(),
    status: 'scheduled',
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

  if (platform === 'telegram' && config.telegramEnabled) {
    const conn = db.telegram.findByProfile(profile.id);
    if (conn && conn.chatId) {
      try {
        const result = await executeTelegramPost(profile, postText);
        return res.json({ success: true, simulated: false, ...result });
      } catch (err) {
        return res.status(400).json({ error: err.description || err.message });
      }
    }
  }

  const post = db.calendar.add({
    profileId: profile.id,
    platform,
    postText,
    scheduledTime: new Date().toISOString(),
    status: 'posted',
  });
  res.json({ success: true, simulated: true, post });
}));

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

// Shared executor — used by the direct post route AND the agent approval gate.
async function executeTelegramPost(profile, text) {
  const conn = db.telegram.findByProfile(profile.id);
  if (!conn) throw new Error('Telegram is not connected');
  if (!conn.chatId) throw new Error('No channel or group linked yet — finish the Telegram setup on your dashboard');
  const sent = await tg.sendMessage(conn.botToken, conn.chatId, text);
  db.calendar.add({
    profileId: profile.id,
    platform: 'telegram',
    postText: text,
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
    const result = await executeTelegramPost(profile, text);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.description || err.message });
  }
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

  // Telegram subscribers: REAL count when the integration is on and a chat is
  // linked; the demo number otherwise (other metrics await their integrations).
  let telegramSubscribers = { current: 980, change: 11.2 };
  if (config.telegramEnabled) {
    const conn = db.telegram.findByProfile(profile.id);
    if (conn && conn.chatId) {
      try {
        telegramSubscribers = { current: await tg.getChatMemberCount(conn.botToken, conn.chatId), change: 0, live: true };
      } catch (err) {
        console.warn('getChatMemberCount failed, using demo number:', err.message);
      }
    }
  }

  res.json({
    metrics: {
      googleViews: { current: 4320, change: 12.4 },
      googleCalls: { current: 148, change: 8.2 },
      instagramFollowers: { current: 1542, change: 15.6 },
      telegramSubscribers,
      tiktokFollowers: { current: 0, change: 0 },
    },
    competitors: (competitors.length ? competitors : [
      { competitor_name: 'District Roasters B', platforms_detected: ['google', 'instagram', 'telegram', 'tiktok'], posts_per_week: 8, rating: 4.6, followers_count: 4100 },
    ]).map((c) => ({
      name: c.competitor_name,
      platformCount: (c.platforms_detected || []).length,
      postsPerWeek: c.posts_per_week,
      rating: c.rating,
      followers: c.followers_count,
    })),
    seoKeywords: keywords.length ? keywords : [
      { keyword_phrase: `best ${cat} in tashkent`, avg_position: 8, volume: 'High' },
    ],
    aiPresence: { perplexityScore: 78, chatgptRank: 'Top 5', sourcesCitedCount: 4 },
  });
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

  const brief = await ai.generateMediaBrief({ kind, mode, topic, profile });
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
    }),
  };

  const conn = config.telegramEnabled ? db.telegram.findByProfile(profile.id) : null;
  const action = await ai.agentAct({
    query,
    history,
    lang,
    profile,
    telegram: conn
      ? { connected: true, chatTitle: conn.chatTitle, chatType: conn.chatType, hasChat: !!conn.chatId }
      : { connected: false, comingSoon: !config.telegramEnabled },
    snapshot,
    actions,
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

  // Approved Telegram posts are executed for real via the Bot API.
  if (approval.action_type === 'telegram_post') {
    if (!config.telegramEnabled) {
      return res.status(503).json({ error: 'Telegram publishing is coming soon — it is not part of the current MVP.' });
    }
    try {
      const result = await executeTelegramPost(profile, approval.action_payload.text);
      db.approvals.updateStatus(approvalId, 'approved');
      return res.json({
        success: true,
        message: `✅ Published to ${result.chatTitle}! Your subscribers can see it now.`,
      });
    } catch (err) {
      db.approvals.updateStatus(approvalId, 'failed');
      return res.status(400).json({ error: `Publishing failed: ${err.description || err.message}` });
    }
  }

  // Ad campaigns remain simulated until the Ads APIs land.
  const updated = db.approvals.updateStatus(approvalId, 'approved');
  res.json({
    success: true,
    message: `Campaign authorized! Launched localized ad campaign costing ${updated.action_payload.cost}. (Simulation — Meta Ads integration coming soon.)`,
  });
}));

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
}

module.exports = { app, db };
