const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const createDb = require('./db');
const { validateRegister, validateLogin } = require('./validators');

const db = createDb(config.dbPath);
const app = express();

// --- CORS ---
const corsOptions = config.corsOrigins.includes('*')
  ? {}
  : { origin: config.corsOrigins };
app.use(cors(corsOptions));
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
//   NOTE: still a simulated crawl — real Google Places / social APIs land in
//   the "platform integrations" milestone.
// ==========================================
app.post('/api/discovery/scan', verifyToken, (req, res) => {
  const { businessName, location } = req.body;
  if (!businessName) return res.status(400).json({ error: 'Business name is required' });

  const cleanName = businessName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'business';
  const searchLoc = location || 'Tashkent';

  setTimeout(() => {
    res.json({
      googleBusiness: { found: true, name: `${businessName} on Google Maps`, rating: 4.8, reviewsCount: 14, address: `${searchLoc}, Uzbekistan`, verified: true },
      instagram: { found: true, handle: `@${cleanName}_uz`, followers: 1050, postsCount: 23, url: `https://instagram.com/${cleanName}_uz` },
      telegram: { found: true, channel: `@${cleanName}`, subscribers: 720, url: `https://t.me/${cleanName}` },
      aiSearchPresence: { chatgptMentioned: true, perplexityMentioned: false, perplexityScore: 72 },
    });
  }, 1200);
});

// ==========================================
// 3.3 GUIDED SETUP WIZARD ROUTER (/api/onboarding)
// ==========================================
app.post('/api/onboarding/slogans', verifyToken, (req, res) => {
  const { category, tone, description } = req.body;
  const templates = {
    'Cozy & Warm': [`Your cozy corner for all things ${category || 'delicious'}.`, `Where local flavor meets heartfelt warmth.`, `Handcrafted comfort in every single detail.`],
    'Modern & Minimalist': [`Simplicity, refined.`, `The future of ${category || 'quality'}, today.`, `Clean aesthetics. Superior standards.`],
    'Energetic & Fast-paced': [`Fueling your day, the ${category || 'right'} way!`, `Fast. Fresh. Bold.`, `Zero compromises. Peak energy.`],
    'Professional & Trustworthy': [`Excellence you can rely on.`, `Certified quality for our local community.`, `Your trusted partner in professional ${category || 'solutions'}.`],
    'Playful & Fun': [`Adding a splash of happiness to your day!`, `Smile first, ask questions later.`, `Your daily dose of fun and ${category || 'treats'}.`],
    'Luxury & Premium': [`The luxury you deserve.`, `Crafted for those who appreciate the finest things.`, `Indulge in premium ${category || 'sophistication'}.`],
  };
  const slogans = (templates[tone] || templates['Cozy & Warm']).map((slogan) =>
    description && description.toLowerCase().includes('coffee')
      ? slogan.replace('delicious', 'coffee').replace('quality', 'espresso')
      : slogan
  );
  setTimeout(() => res.json({ slogans }), 800);
});

app.post('/api/onboarding/construct', verifyToken, (req, res) => {
  const { businessName, category, description, location, isOnline, audience, tone, slogan, logo, platforms } = req.body;
  if (!businessName) return res.status(400).json({ error: 'Business name is required' });

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

  // Seed benchmark competitors.
  [
    { competitorName: 'Local Competitor A', rating: 4.5, followersCount: 2400, postsPerWeek: 10, platformsDetected: ['instagram', 'telegram'] },
    { competitorName: 'District Roasters B', rating: 4.7, followersCount: 4100, postsPerWeek: 8, platformsDetected: ['google', 'instagram'] },
    { competitorName: 'Global Competitor C', rating: 4.8, followersCount: 95000, postsPerWeek: 22, platformsDetected: ['google', 'instagram', 'telegram', 'tiktok'] },
  ].forEach((c) => db.competitors.add({ profileId: profile.id, ...c }));

  // Seed SEO keywords.
  const cat = safeCategory.toLowerCase();
  [
    { keywordPhrase: `best ${cat} in tashkent`, avgPosition: 8, volume: 'High' },
    { keywordPhrase: `${cat} near me`, avgPosition: 12, volume: 'Very High' },
    { keywordPhrase: `cozy study workspace ${location || 'tashkent'}`, avgPosition: 4, volume: 'Medium' },
  ].forEach((k) => db.keywords.add({ profileId: profile.id, ...k }));

  // Seed an inaugural scheduled post.
  db.calendar.add({
    profileId: profile.id,
    platform: 'instagram',
    postText: `🇺🇿 O'zbekcha: #${businessName} eshiklari ochiq! Sizga yoqimli muhit va ajoyib ta'mni taqdim etamiz. ☕\n🇷🇺 Русский: Добро пожаловать в #${businessName}! Прекрасная атмосфера и незабываемый вкус.`,
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
// 3.4 AI CONTENT ENGINE ROUTER (/api/content)
//   NOTE: copy is still templated. Real Claude generation is the "AI core"
//   milestone.
// ==========================================
app.post('/api/content/copywrite', verifyToken, (req, res) => {
  const { platform, topic } = req.body;
  const name = req.body.businessName || 'Our Spot';
  const mocks = {
    instagram: {
      post: `✨ **Something special is brewing at #${name}!** ✨\n\n🇺🇿 *O'zbekcha:* \nAjoyib yangilik! ${topic || 'Sizlar uchun maxsus taklif tayyorladik. Do‘stlaringiz bilan shinam muhitimizda dam oling va sifatli ta’mlardan bahra oling.'}\n\n🇷🇺 *Русский:* \nОтличные новости! ${topic || 'Мы приготовили для вас нечто особенное. Приходите с друзьями, расслабьтесь в нашей уютной атмосфере и насладитесь качественным вкусом.'}\n\n🇬🇧 *English:* \nGreat news! ${topic || 'We have handcrafted something special for you. Chill with your friends in our cozy space and enjoy pure local quality.'}\n\n📍 Toshkent, Amir Temur Ave.\n#SupportLocal #TashkentSpots #CozyVibes`,
      mediaTip: '📸 Recommendation Frame: Close-up capture of double espresso pours or honey cakes with warm natural sunlight casting soft window reflections.',
    },
    telegram: {
      post: `📢 **${name} Telegram Subscribers Alert!**\n\n🇺🇿 Yangi e'lon: ${topic || 'Biz dam olish kunlari chegirma va ajoyib desertlar bilan sizni kutamiz!'}\n\n🇷🇺 Объявление: ${topic || 'Ждем вас в выходные с отличными скидками и свежими десертами!'}\n\n📍 Manzilimiz: Amir Temur ko'chasi.\n📞 Aloqa: +998 90 123 45 67\n👉 Kanalga obuna bo'ling!`,
      mediaTip: '📱 Square landscape frame featuring minimal typography overlay to ensure clear readability on Telegram chats.',
    },
    tiktok: {
      post: `POV: You found the absolute best cozy workspace spot in Tashkent 🤫☕ Honey cake + high speed Wi-Fi hits different. \n\n#tashkentplaces #studygram #aestheticspots #uzb #chillspots #${name.toLowerCase().replace(/ /g, '')}`,
      mediaTip: '🎬 3-5s looping phone clip showing a close-up texture scoop, shifting focus to a busy laptop monitor.',
    },
  };
  res.json(mocks[(platform || 'instagram').toLowerCase()] || mocks.instagram);
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

// ==========================================
// 3.5 DASHBOARD METRICS ROUTER
// ==========================================
app.get('/api/dashboard/stats', verifyToken, (req, res) => {
  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Active profile not found' });

  const competitors = db.competitors.listByProfile(profile.id);
  const keywords = db.keywords.listByProfile(profile.id);
  const cat = (profile.category || 'business').toLowerCase();

  res.json({
    metrics: {
      googleViews: { current: 4320, change: 12.4 },
      googleCalls: { current: 148, change: 8.2 },
      instagramFollowers: { current: 1542, change: 15.6 },
      telegramSubscribers: { current: 980, change: 11.2 },
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
});

// ==========================================
// 3.6 AI AGENT & APPROVAL GATES (/api/agent)
//   NOTE: keyword-matched replies for now. Real Claude routing is the
//   "AI core" milestone; the approval-gate plumbing here is real.
// ==========================================
app.post('/api/agent/query', verifyToken, (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'A query is required' });

  const profile = db.profiles.findByUserId(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const lower = query.toLowerCase();
  if (lower.includes('ad') || lower.includes('campaign') || lower.includes('meta') || lower.includes('budget')) {
    const approval = db.approvals.create({
      profileId: profile.id,
      actionType: 'ad_creation',
      actionPayload: {
        action: 'Create Meta Ad Campaign',
        cost: '$5.00 / day',
        target: 'Tashkent local workers radius',
        creative: `🎯 Preview: "Experience the ultimate ${(profile.category || 'business').toLowerCase()} vibe at #${profile.businessName}! High-speed Wi-Fi, handcrafted coffee, and quiet study booths ready for you."`,
      },
    });
    return res.json({ triggerApproval: true, approvalId: approval.id, payload: approval.action_payload });
  }

  let reply;
  if (lower.includes('instagram') || lower.includes('post') || lower.includes('copy')) {
    reply = `I have successfully constructed an Instagram post copy optimized for #${profile.businessName} under the Content Engine tab. It emphasizes your tone "${profile.brandTone}". Would you like me to schedule it?`;
  } else if (lower.includes('competitor') || lower.includes('gap')) {
    reply = `I reviewed local benchmarks. Competitors average 8-10 postings per week. You post 3 times per week. Closing this cadence gap will optimize your organic search positioning.`;
  } else {
    reply = `I am your active Markivo Marketing Agent. 🤖 I can draft captions, monitor local competitors, or structure paid search campaigns. Try asking 'create ad campaign' to test ad launch authorisations.`;
  }
  res.json({ reply });
});

app.post('/api/agent/approve', verifyToken, (req, res) => {
  const { approvalId } = req.body;
  const approval = db.approvals.findById(approvalId);
  if (!approval) return res.status(404).json({ error: 'Pending authorization request not found' });

  const updated = db.approvals.updateStatus(approvalId, 'approved');
  res.json({
    success: true,
    message: `Campaign nodes authorized! Launched localized ad campaign costing ${updated.action_payload.cost}.`,
  });
});

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
