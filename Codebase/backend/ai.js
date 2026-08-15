const config = require('./config');
const logogen = require('./logogen');
const anthropic = require('./providers/anthropic');
const brand = require('./brand');
const frameworks = require('./marketing/frameworks');
const rubric = require('./marketing/rubric');
const marketing = require('./marketing/prompts');
const preferences = require('./preferences');
const gemini = require('./gemini');
const providers = require('./providers/textEngine');
const profileQuestions = require('./profileQuestions');

// Shared Anthropic client (constructed once in providers/anthropic.js). Null in
// keyless mode, so every function falls back to a smart template.
const client = anthropic.client;

const textOf = anthropic.textOf;

// ${placeholder} interpolation for the authored pipeline prompt templates.
const fill = (tmpl, vars) =>
  String(tmpl).replace(/\$\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));

const cleanTag = (name) => `#${(name || 'business').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

// ===========================================================================
// FALLBACK TEMPLATES (used when no API key, or if a live call fails)
// The language blocks come out in the ORDER the owner selected — the same
// contract the live engines follow (gemini.langInstructionFor).
// ===========================================================================
function templateContent({ platform, topic, businessName, category, description, languages, previousText, feedback }) {
  // Keyless mode has no reasoning engine to act on a follow-up instruction —
  // returning the draft unchanged is more honest than silently rewriting it
  // in a way that ignores what was actually asked for.
  if (previousText && feedback) return { post: previousText, mediaTip: '', hashtags: [] };

  const name = businessName || 'Our Spot';
  // No explicit selection (the language picker is gone) means "match the
  // topic's own language" — the offline engine has no model to read the
  // topic with, so it falls back to a Cyrillic/keyword sniff instead.
  const langs = languages == null ? [gemini.detectLanguage(topic)] : gemini.normalizeLanguages(languages);

  // No topic? Lead with the owner's own business description so the fallback
  // is personalised to ANY business, not a generic (or cafe-flavoured) line.
  const lines = {
    en: topic
      ? `${topic}`
      : (description && description.trim()
        ? description.trim().slice(0, 180)
        : `We've prepared something special for you. Come by, relax, and enjoy real local quality.`),
    uz: `🇺🇿 ${topic || "Sizlar uchun maxsus taklif tayyorladik. Keling, dam oling va sifatli xizmatdan bahra oling."}`,
    ru: `🇷🇺 ${topic || 'Мы приготовили для вас нечто особенное. Приходите и насладитесь качеством.'}`,
  };
  // One message, the selected languages stacked in the selected order.
  const body = langs.map((l) => lines[l]).join('\n\n');

  const mocks = {
    instagram: {
      post: `✨ Something special at ${name}! ✨\n\n${body}\n\n📍 Visit us — link in bio.`,
      mediaTip: '📸 Close-up of your signature item in warm natural window light.',
      hashtags: ['#SupportLocal', '#Tashkent', cleanTag(name)],
    },
    telegram: {
      post: `📢 ${name}\n\n${body}\n\n👉 Follow this channel for updates!`,
      mediaTip: '📱 Square image with minimal text overlay for chat readability.',
      hashtags: ['#Tashkent', cleanTag(name)],
    },
    tiktok: {
      post: `POV: you found the best ${topic || (category ? category.toLowerCase() : 'spot')} in town 🤫\n\n${name}`,
      hashtags: ['#tashkent', '#fyp', '#smallbusiness', cleanTag(name)],
      mediaTip: '🎬 3-5s vertical clip, quick focus pull from product to happy customer.',
    },
  };
  return mocks[(platform || 'instagram').toLowerCase()] || mocks.instagram;
}

function templateSlogans({ category, tone, description }) {
  const templates = {
    'Cozy & Warm': [`Your cozy corner for all things ${category || 'delicious'}.`, `Where local flavor meets heartfelt warmth.`, `Handcrafted comfort in every detail.`],
    'Modern & Minimalist': [`Simplicity, refined.`, `The future of ${category || 'quality'}, today.`, `Clean aesthetics. Superior standards.`],
    'Energetic & Fast-paced': [`Fueling your day, the ${category || 'right'} way!`, `Fast. Fresh. Bold.`, `Zero compromises. Peak energy.`],
    'Professional & Trustworthy': [`Excellence you can rely on.`, `Certified quality for our community.`, `Your trusted partner in ${category || 'solutions'}.`],
    'Playful & Fun': [`Adding a splash of happiness to your day!`, `Smile first, ask questions later.`, `Your daily dose of fun.`],
    'Luxury & Premium': [`The luxury you deserve.`, `Crafted for those who appreciate the finest.`, `Indulge in premium ${category || 'sophistication'}.`],
  };
  return (templates[tone] || templates['Cozy & Warm']).map((s) =>
    description && description.toLowerCase().includes('coffee') ? s.replace('delicious', 'coffee').replace('quality', 'espresso') : s
  );
}

// The five canned agent replies, localized (en / ru / uz-Latin). The EN
// coming-soon line must keep matching /coming soon/i — tests pin it.
const AGENT_CANNED = {
  en: {
    comingSoon: () =>
      `Telegram publishing is coming soon — it isn't enabled in this version yet. Meanwhile I can draft the post text for you: just tell me the topic, or use the Content Engine tab.`,
    notConnected: () =>
      `I'd love to post that for you, but your Telegram isn't connected yet. Open the Telegram card on your dashboard — it takes about a minute: create a bot with @BotFather, paste the token, and add the bot to your channel. Then just ask me again!`,
    drafted: ({ name, tone }) =>
      `I've drafted a post for ${name} in the Content Engine, matched to your "${tone}" tone. Want me to publish it to Telegram?`,
    competitors: () =>
      `Local competitors average 8-10 posts/week; you're at ~3. Closing that cadence gap will lift your organic reach.`,
    greeting: () =>
      `Hi, I'm Markiv 🤖 — your marketing agent. I can draft content, track competitors, plan campaigns, and post straight to your Telegram channel. Try: "Post our weekend offer to Telegram".`,
  },
  ru: {
    comingSoon: () =>
      `Публикация в Telegram появится совсем скоро — в этой версии она ещё не включена. А пока я могу подготовить текст поста: просто назовите тему или откройте вкладку «Контент».`,
    notConnected: () =>
      `Я бы с радостью это опубликовал, но Telegram ещё не подключён. Откройте карточку Telegram на дашборде — это займёт около минуты: создайте бота через @BotFather, вставьте токен и добавьте бота в канал. Потом просто попросите меня снова!`,
    drafted: ({ name, tone }) =>
      `Я подготовил пост для ${name} во вкладке «Контент», в вашем тоне «${tone}». Опубликовать его в Telegram?`,
    competitors: () =>
      `Местные конкуренты публикуют в среднем 8-10 постов в неделю; у вас ~3. Сократив этот разрыв, вы заметно поднимете органический охват.`,
    greeting: () =>
      `Привет, я Markiv 🤖 — ваш маркетинговый агент. Я пишу контент, слежу за конкурентами, планирую кампании и публикую посты в ваш Telegram-канал. Например: «Опубликуй наше предложение выходного дня в Telegram».`,
  },
  uz: {
    comingSoon: () =>
      `Telegramga joylash tez orada qo'shiladi — bu versiyada hali yoqilmagan. Hozircha men siz uchun post matnini tayyorlab beraman: mavzuni ayting yoki "Kontent" bo'limidan foydalaning.`,
    notConnected: () =>
      `Buni siz uchun joylagan bo'lardim, lekin Telegram hali ulanmagan. Dashboard'dagi Telegram kartasini oching — bir daqiqa kifoya: @BotFather orqali bot yarating, tokenni kiriting va botni kanalingizga qo'shing. Keyin yana so'rang!`,
    drafted: ({ name, tone }) =>
      `Men ${name} uchun "Kontent" bo'limida, "${tone}" ohangingizga mos post tayyorladim. Uni Telegramga joylaymi?`,
    competitors: () =>
      `Mahalliy raqobatchilar haftasiga o'rtacha 8-10 ta post joylaydi; sizda ~3 ta. Bu farqni yopsangiz, organik qamrovingiz sezilarli oshadi.`,
    greeting: () =>
      `Salom! Men Markiv 🤖 — sizning marketing agentingizman. Men siz uchun kontent yozaman, raqobatchilarni kuzataman, kampaniyalar rejalashtiraman va Telegram kanalingizga post joylayman. Masalan: "Hafta oxiri taklifimizni Telegramga joyla".`,
  },
};

function templateAgentAct({ query, profile, telegram, lang, history }) {
  const lower = (query || '').toLowerCase();
  const name = profile?.businessName || 'your business';
  const t = AGENT_CANNED[lang] || AGENT_CANNED.en;
  // Conversation memory: the last thing the owner said is the best topic hint
  // when the current message doesn't carry one itself.
  const lastUserText = Array.isArray(history)
    ? [...history].reverse().find((m) => m && m.sender === 'user' && m.text)?.text
    : undefined;

  // Publish intent → hand back a drafted post for the approval gate.
  // (uz/ru keywords ride alongside the EN word-boundary forms; \b is
  // ASCII-only in JS, so non-Latin words match as plain substrings.)
  const wantsPublish = /\b(post|publish|announce|share|send)\b|joyla|chiqar|yubor|e'lon|опубликов|разместить|отправ|выложи/.test(lower);
  const mentionsTelegram = /telegram|channel|group|kanal|guruh|телеграм|канал|групп/.test(lower);
  if (wantsPublish && mentionsTelegram) {
    if (telegram?.comingSoon) return { type: 'reply', reply: t.comingSoon() };
    if (!telegram?.connected) return { type: 'reply', reply: t.notConnected() };
    const topic = query
      .replace(/\b(post|publish|announce|share|send)\b/gi, '')
      .replace(/\b(to|on|in|my)\s+(telegram|channel|group)\b/gi, '')
      .trim() || lastUserText || undefined;
    const draft = templateContent({
      platform: 'telegram',
      topic,
      businessName: name,
      languages: lang === 'ru' ? ['en', 'ru'] : lang === 'uz' ? ['en', 'uz'] : ['en'],
    });
    return { type: 'telegram_post', text: `${draft.post}\n\n${draft.hashtags.join(' ')}` };
  }

  if (/instagram|post|copy|reklama|реклам|kontent|контент/.test(lower)) {
    return { type: 'reply', reply: t.drafted({ name, tone: profile?.brandTone || 'brand' }) };
  }
  if (/competitor|gap|raqobat|konkurent|конкурент/.test(lower)) {
    return { type: 'reply', reply: t.competitors() };
  }
  return { type: 'reply', reply: t.greeting() };
}

// Media Studio fallback: a concrete, profile-tailored brief without any key.
function templateMediaBrief({ kind = 'image', mode = 'guided', topic, profile, trends }) {
  const name = profile?.businessName || 'your business';
  const category = (profile?.category || 'business').toLowerCase();
  const tone = profile?.brandTone || 'Cozy & Warm';
  const subject = (topic && topic.trim()) || `your ${category}`;
  const trendTip = trends ? [`Trend note: ${String(trends).slice(0, 160)}`] : [];

  // Guided = the owner is holding the camera, so the fallback still has to be a
  // real production brief. Shape matches the Gemini guided schemas exactly
  // (gemini.js), so the UI renders identically with or without a key.
  if (mode === 'guided') {
    const camera = {
      device: 'Any modern smartphone works — a mirrorless camera only pays off if you already own one.',
      lens: kind === 'video'
        ? 'Main (1x) lens for everything; switch to 0.5x only for the wide establishing shot.'
        : 'Main (1x) lens for hero frames, 2x for detail shots — avoid digital zoom beyond that.',
      settings: kind === 'video'
        ? '4K at 30fps, exposure and focus LOCKED before each take (long-press to lock), gridlines on.'
        : 'HDR on, gridlines on, tap-to-focus on the subject then lock, burst mode for any movement.',
      whiteBalance: 'Lock white balance to your main light so colour does not shift between shots.',
      stabilisation: kind === 'video'
        ? 'Brace both elbows against your ribs; slide your whole body rather than twisting your wrists.'
        : 'Brace against a wall or table edge; use the volume button or a 2s timer to avoid shake.',
    };
    const setup = [
      `Clear everything from the frame that is not ${subject} or part of the ${category} story.`,
      `Position ${subject} about 60-80cm from the lens with a clean, uncluttered background behind it.`,
      'Put your largest window at 45° to the subject — side light gives shape, front light flattens it.',
      `Add one small ${tone.toLowerCase()} prop from your own space so the frame reads as ${name}, not a stock photo.`,
      'Wipe the lens, then shoot one test frame and check the edges for clutter before the real takes.',
    ];
    const tips = [
      'Wipe the lens first — it is the cheapest quality upgrade there is.',
      `Shoot 3 takes of every shot so you can pick the best ${subject} moment.`,
      'Never shoot into the light source — put it beside or behind you.',
      `Stay consistent with your "${tone}" brand tone: colours, pace, and framing should all match it.`,
    ];

    if (kind === 'video') {
      return {
        mode,
        kind,
        scenario:
          `A 20-30 second look at ${subject} at ${name}: someone arrives, discovers it, and reacts. ` +
          `One person, one place, one payoff — no narration needed if the visuals carry it.`,
        flow:
          'Hook in the first 1.5 seconds with the strongest frame, hold attention with movement and ' +
          'detail through the middle, then land the brand and a single call to action at the end.',
        scene: `The real ${category} setting at ${name}, with ${subject} as the hero of every frame.`,
        setup,
        camera,
        lighting: 'Shoot near a window or outdoors within 2 hours of sunrise/sunset; avoid mixed overhead lighting and never shoot against the light source.',
        composition: `Vertical 9:16. Keep ${subject} on a rule-of-thirds line with headroom above for platform UI.`,
        // The subject is whatever the owner typed, so it only ever appears as a
        // standalone line — never inlined into a sentence that assumes a noun.
        script: [
          { time: '0:00-0:02', spoken: '', onScreenText: `${subject} — at ${name}` },
          { time: '0:02-0:08', spoken: 'Here is how we do it.', onScreenText: '' },
          { time: '0:08-0:18', spoken: 'Let the visuals carry it — no voice needed here.', onScreenText: 'Made fresh, right here' },
          { time: '0:18-0:25', spoken: 'Come see for yourself.', onScreenText: `${name} — open today` },
        ],
        shotList: [
          { name: 'Establishing', framing: 'Wide', angle: 'Eye level', movement: 'Slow push in', duration: '3s', direction: `Start at the door of ${name} and walk one step forward.` },
          { name: 'Hero reveal', framing: 'Medium', angle: 'Slightly high', movement: 'Static', duration: '3s', direction: `Center ${subject} and hold completely still.` },
          { name: 'Detail pass', framing: 'Macro', angle: '45° down', movement: 'Slow slide left to right', duration: '4s', direction: 'Move the phone, not the subject; keep focus locked.' },
          { name: 'Hands in frame', framing: 'Close', angle: 'Over the shoulder', movement: 'Follow the hands', duration: '4s', direction: `Film someone actually handling ${subject}.` },
          { name: 'Reaction', framing: 'Medium close', angle: 'Eye level', movement: 'Static', duration: '3s', direction: 'A real customer or team member responding — genuine, not posed.' },
          { name: 'Brand out', framing: 'Medium', angle: 'Eye level', movement: 'Slow pull back', duration: '3s', direction: `End with ${subject} and the ${name} signage both in frame.` },
        ],
        bRoll: [
          `Ambient shot of the ${category} space filling up`,
          'Hands preparing or arranging something, no faces',
          `Texture close-up of ${subject} with shallow depth`,
        ],
        transitions: [
          'Hard cut on movement — cut while the hand or camera is still moving',
          'Match cut from the detail pass into the hands-in-frame shot',
          'Cut on the beat if you add music',
        ],
        audio: 'Capture clean ambient sound close to the subject; add trending or licensed music in the platform editor afterwards, and duck it under any spoken line.',
        postProcessing: 'Trim every clip to its strongest 2-4 seconds, lift shadows slightly, add burned-in captions, export vertical 9:16 at 1080x1920.',
        tips: [...tips, 'Keep each clip under 5 seconds; fast cuts hold attention.', ...trendTip],
      };
    }

    return {
      mode,
      kind,
      scene: `${subject}, styled in the real ${category} setting at ${name} so it reads as your place, not a stock shot.`,
      setup,
      camera,
      lighting: 'Shoot near a window or outdoors within 2 hours of sunrise/sunset; avoid mixed overhead lighting and never shoot against the light source.',
      composition: `Rule-of-thirds with ${subject} on an intersection and clean negative space left for a text overlay.`,
      shotList: [
        { name: 'Hero frame', framing: 'Medium close', angle: 'Eye level', direction: `Center ${subject}, background 1-2m behind it so it falls out of focus.` },
        { name: 'Overhead flat lay', framing: 'Wide', angle: '90° straight down', direction: 'Stand directly above; keep the phone parallel to the surface using the level guide.' },
        { name: 'Detail macro', framing: 'Macro', angle: '45°', direction: `Fill the frame with the texture of ${subject}; tap to focus on the nearest edge.` },
        { name: 'In context', framing: 'Wide', angle: 'Eye level', direction: `Show ${subject} in the room so the viewer sees where it lives.` },
        { name: 'Human element', framing: 'Close', angle: 'Over the shoulder', direction: 'Hands reaching for or holding it — movement makes a still photo feel alive.' },
      ],
      postProcessing: 'Straighten, crop to 4:5 for feed, lift shadows and add a touch of warmth; keep the edit consistent across every photo in the set.',
      tips: [...tips, ...trendTip],
    };
  }

  // mode === 'full' — a generation-ready creative brief for the media engine.
  return {
    mode,
    kind,
    concept:
      `A scroll-stopping ${kind} built around ${subject}: the ${tone.toLowerCase()} world of ${name}, ` +
      `told through one bold ${category} moment that makes viewers want to visit.` +
      (trends ? ` Inspired by a current trend: ${String(trends).slice(0, 140)}.` : ''),
    caption: `✨ ${subject} — now at ${name}! Come see it for yourself. ${cleanTag(name)} ${cleanTag(category)}`,
    visualSpec: {
      composition: `Rule-of-thirds with ${subject} on the right intersection and clean negative space left for a text overlay`,
      palette: `Drawn from the "${tone}" brand tone with one strong accent colour pop`,
      mood: `${tone}, unmistakably ${category}`,
    },
    engineStatus: 'awaiting_media_api',
    note: 'Rendering activates once a media-generation API key is configured.',
  };
}

// Media Studio fallback: a concrete edit plan the future engine can execute.
function templateEditPlan({ instructions, media, profile }) {
  const kind = media?.kind || 'media';
  const tone = profile?.brandTone || 'Cozy & Warm';
  const want = (instructions || 'polish it').trim();
  return {
    steps: [
      `Review the raw ${kind} and mark the strongest 3-5 seconds or single best frame`,
      `Apply the owner's request first: ${want}`,
      'Trim dead air from the start — the subject must appear within the first second',
      `Balance exposure and white point so the result matches the "${tone}" brand feel`,
      'Add a subtle vignette and sharpen the subject by ~10% to draw the eye',
      'Place captions inside the platform-safe area (keep the top and bottom 15% clear)',
      'Export one master, then derive each platform aspect ratio from it',
    ],
    crop: 'Centre the subject, then crop per platform from the master — never stretch.',
    colorGrade: `One consistent grade matching the "${tone}" tone — slightly lifted shadows, gentle warmth, no heavy filters.`,
    captions: 'Short, high-contrast captions (max 6 words per line) synced to cuts; include them for sound-off viewing.',
    audio: 'Normalise voice to -14 LUFS; duck music -8dB under speech; fade out over the last second.',
    exportSpec: {
      instagram: '1080x1350 (4:5) feed / 1080x1920 (9:16) reels & stories',
      telegram: '1280x1280 (1:1), under 10MB for instant preview',
      tiktok: '1080x1920 (9:16), 30fps',
      googleBusiness: '1200x900 (4:3) photo posts',
    },
    engineStatus: 'awaiting_media_api',
  };
}

// ===========================================================================
// LIVE GENERATION (Claude) — each wraps a fallback so callers never throw
// ===========================================================================
const CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    post: { type: 'string' },
    mediaTip: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
  required: ['post', 'mediaTip', 'hashtags'],
  additionalProperties: false,
};

// Autopilot: analyze a business + its recent activity, then draft one ready-to-
// publish ORGANIC promotional post per target platform. Keyless -> templates.
function templateAutonomousPlan(ctx) {
  const { platforms = ['instagram'], businessName, category, description } = ctx;
  const list = platforms.length ? platforms : ['instagram'];
  const posts = list.map((platform) => {
    const c = templateContent({ platform, businessName, category, description });
    const tags = (c.hashtags || []).join(' ');
    return {
      platform: String(platform).toLowerCase(),
      topic: '',
      text: `${c.post}${tags ? `\n\n${tags}` : ''}`.slice(0, 4000),
    };
  });
  const analysis = `Drafted ${posts.length} promotional post${posts.length === 1 ? '' : 's'} for ${businessName || 'your business'} from your profile${description ? ' and description' : ''}.`;
  return { analysis, posts };
}

// Strategy step output — the creative plan the copywriter then executes.
const STRATEGY_SCHEMA = {
  type: 'object',
  properties: {
    objective: { type: 'string' },
    audiencePersona: { type: 'string' },
    customerMoment: { type: 'string' },
    angle: { type: 'string' },
    singleMessage: { type: 'string' },
    hook: { type: 'string' },
    cta: { type: 'string' },
    proofPoint: { type: 'string' },
    mediaDirection: { type: 'string' },
    toneNote: { type: 'string' },
    avoid: { type: 'string' },
  },
  required: ['objective', 'audiencePersona', 'customerMoment', 'angle', 'singleMessage',
    'hook', 'cta', 'proofPoint', 'mediaDirection', 'toneNote', 'avoid'],
  additionalProperties: false,
};

// One refine pass — only when the local quality gate trips (e.g. a banned
// cliche slips through). Reuses CONTENT_SCHEMA so multi-language copy stays
// inside `post`, matching the existing UI contract.
async function refineDraft({ platform, draft, ctx, langNames }) {
  try {
    const out = await providers.completeJSON({
      model: config.aiContentModel,
      system: rubric.refineSystemPrompt +
        '\n\nOUTPUT OVERRIDE: Return ONLY JSON {"post": string, "mediaTip": string, "hashtags": string[]}. ' +
        'Put every requested language INSIDE `post`, English first, clearly separated — no separate ' +
        'translations field, no changeLog.',
      prompt:
        `Business: ${ctx.businessName || 'a local business'}\n` +
        `Category: ${ctx.category || 'general'}\n` +
        `Brand tone: ${ctx.brandTone || 'Cozy & Warm'}\n` +
        `Location: ${ctx.location || 'n/a'}\n` +
        `Platform: ${platform}\n` +
        `Languages: ${langNames || 'English'}\n\n` +
        `ORIGINAL DRAFT:\n${draft.post}\n\n` +
        `Hashtags: ${(draft.hashtags || []).join(' ')}\n\n` +
        'Rewrite it to remove every cliche and clear the quality bar. Keep it ready-to-publish.',
      schema: CONTENT_SCHEMA,
      maxTokens: 1200,
    });
    if (!out || !out.post) return null;
    return { post: out.post, mediaTip: out.mediaTip || draft.mediaTip, hashtags: out.hashtags || draft.hashtags };
  } catch (err) {
    console.error('AI refineDraft failed, keeping draft:', err.message);
    return null;
  }
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    analysis: { type: 'string' },
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string' },
          topic: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['platform', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['analysis', 'posts'],
  additionalProperties: false,
};

async function analyzeAndPlan(ctx) {
  if (!providers.isLive) return templateAutonomousPlan(ctx);
  const {
    platforms = ['instagram'], businessName, category, description,
    brandTone, audience, location, recentPosts = [], competitors = [],
    ownExternalActivity = [], competitorHighlights = [],
  } = ctx;
  const targets = platforms.length ? platforms : ['instagram'];
  try {
    const parsed = await providers.completeJSON({
      model: config.aiContentModel,
      system:
        "You are Markivo's autonomous marketing strategist for a small business. " +
        'Briefly analyze the business and its recent activity, then write platform-native ' +
        'promotional posts — exactly one per requested platform. Each post must match the brand ' +
        'tone, be ready to publish as-is, include a light call to action, and avoid repeating the ' +
        'recent posts. Respond as JSON only.',
      prompt:
        `Business: ${businessName || 'a local business'}\n` +
        `Category: ${category || 'general'}\n` +
        `Description: ${description || 'n/a'}\n` +
        `Brand tone: ${brandTone || 'Cozy & Warm'}\n` +
        `Audience: ${audience || 'local customers'}\n` +
        `Location: ${location || 'Tashkent'}\n` +
        `Recent posts (do NOT repeat): ${recentPosts.slice(0, 5).map((p) => `- ${String(p).slice(0, 80)}`).join('\n') || 'none yet'}\n` +
        `Recently posted organically on your own channels, outside Markivo (do NOT repeat, but stay consistent with it): ${ownExternalActivity.slice(0, 5).join(' | ') || 'none found'}\n` +
        `Competitor signals: ${competitors.slice(0, 5).join(', ') || 'n/a'}\n` +
        `Real recent competitor posts (for inspiration, never copy): ${competitorHighlights.slice(0, 5).join(' | ') || 'none tracked with content yet'}\n` +
        `Target platforms: ${targets.join(', ')}\n\n` +
        `Return a short "analysis" (2-3 sentences on what to post and why) and a "posts" array ` +
        `with exactly one post per target platform ({platform, topic, text}).`,
      schema: PLAN_SCHEMA,
      maxTokens: 2000,
    });
    if (!parsed) return templateAutonomousPlan(ctx);
    const posts = (parsed.posts || [])
      .filter((p) => p && p.text)
      .map((p) => ({
        platform: String(p.platform || 'instagram').toLowerCase(),
        topic: p.topic || '',
        text: String(p.text).slice(0, 4000),
      }));
    return {
      analysis: parsed.analysis || '',
      posts: posts.length ? posts : templateAutonomousPlan(ctx).posts,
    };
  } catch (err) {
    console.error('AI analyzeAndPlan failed, using template:', err.message);
    return templateAutonomousPlan(ctx);
  }
}

// Competitor Intelligence: turn real (deterministic) competitor posting stats
// plus a sample of their captions into a short trend narrative + one concrete
// recommendation. The NUMBERS (cadence, video share) always come from
// competitorAnalytics.js, computed straight from stored posts — this function
// only adds the qualitative read a model is good at, and is skipped entirely
// (falls to the template) when there is no competitor data to reason about,
// so it never invents a trend from nothing.
const COMPETITOR_TRENDS_SCHEMA = {
  type: 'object',
  properties: {
    analysis: { type: 'string' },
    themes: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
  required: ['analysis', 'themes', 'recommendation'],
  additionalProperties: false,
};

function templateCompetitorTrends(ctx) {
  const { businessName, competitorStats = [], trackedCompetitors = [] } = ctx;
  const withData = competitorStats.filter((s) => s.postCount > 0);
  if (!withData.length) {
    // Nothing tracked at all yet.
    if (!trackedCompetitors.length) {
      return {
        analysis: `No competitors tracked yet for ${businessName || 'your business'} — add one in Competitor Intel to start tracking trends.`,
        themes: [],
        recommendation: 'Add a competitor by pasting their Instagram, TikTok, YouTube, or Facebook profile link.',
      };
    }
    // Tracked, but no platform returned real post content yet. Reasons
    // differ by platform: Facebook structurally never exposes posts publicly
    // (no discovery API exists for it here); Instagram CAN return real posts
    // via Business Discovery, but only once this business has its own
    // Instagram connected via Settings → Connections (Meta) AND the
    // competitor is a public Business/Creator account — so it needs a
    // "how to fix" message, not a flat "impossible" one. Anything else (TikTok/
    // YouTube) not returning data is just a fetch that failed or was blocked.
    const names = trackedCompetitors.map((c) => c.name).filter(Boolean).slice(0, 3).join(', ');
    const platformsSeen = new Set(trackedCompetitors.flatMap((c) => c.platforms || []));
    const onlyFacebook = platformsSeen.size > 0 && [...platformsSeen].every((p) => p === 'facebook');
    const hasInstagram = platformsSeen.has('instagram');
    const prefix = `${trackedCompetitors.length} competitor${trackedCompetitors.length === 1 ? ' is' : 's are'} tracked` +
      `${names ? ` (${names})` : ''}, but none of their linked platforms have returned post content yet.`;

    if (onlyFacebook) {
      return {
        analysis: `${prefix} Facebook only exposes profile info publicly (no captions or videos), so content trends aren't available from that alone.`,
        themes: [],
        recommendation: 'For real content-trend analysis, also track this competitor on Instagram (once your own Instagram is connected via Settings → Connections), YouTube, or TikTok.',
      };
    }
    if (hasInstagram) {
      return {
        analysis: `${prefix} For Instagram specifically, real post content needs YOUR OWN Instagram connected via Settings → Connections (Meta) — once it is, captions and engagement become available for competitors that are public Business or Creator accounts.`,
        themes: [],
        recommendation: 'Connect your Instagram via Settings → Connections (Meta), or track this competitor on YouTube or TikTok instead.',
      };
    }
    return {
      analysis: `${prefix} A fetch may have failed or been blocked — try refreshing, or track the same competitor on another platform.`,
      themes: [],
      recommendation: 'Try "Refresh" on the tracked competitor, or add their YouTube or TikTok profile as a second source.',
    };
  }
  const avgCadence = Math.round((withData.reduce((sum, s) => sum + (s.postsPerWeek || 0), 0) / withData.length) * 10) / 10;
  const avgVideoShare = Math.round(withData.reduce((sum, s) => sum + (s.videoSharePercent || 0), 0) / withData.length);
  const videoLeaning = avgVideoShare >= 50;
  return {
    analysis:
      `Across ${withData.length} tracked competitor${withData.length === 1 ? '' : 's'}, average posting cadence is ` +
      `${avgCadence} posts/week and about ${avgVideoShare}% of their content is video.`,
    themes: [videoLeaning ? 'Short-form video is the dominant format among your competitors' : 'A mix of photo and video content is common among your competitors'],
    recommendation: videoLeaning
      ? 'Consider a short filmable video this week — your competitors are leaning heavily on video.'
      : 'A strong photo post is a safe next move — most of your competitors are not out-posting you on video yet.',
  };
}

async function analyzeCompetitorTrends(ctx) {
  const { businessName, category, brandTone, competitorStats = [], sampleCaptions = [] } = ctx;
  const withData = competitorStats.filter((s) => s.postCount > 0);
  if (!providers.isLive || !withData.length) return templateCompetitorTrends(ctx);
  try {
    const parsed = await providers.completeJSON({
      model: config.aiContentModel,
      system:
        "You are Markivo's competitive-intelligence analyst for a small business. Given REAL posting-cadence " +
        'and content-type data for its tracked competitors, plus sample captions, identify the dominant content ' +
        'trends and recommend ONE concrete next move for this business. Be specific and grounded only in the data ' +
        'given — never invent statistics not present in it. Respond as JSON only.',
      prompt:
        `Business: ${businessName || 'a local business'}\n` +
        `Category: ${category || 'general'}\n` +
        `Brand tone: ${brandTone || 'Cozy & Warm'}\n\n` +
        `Competitor stats:\n${withData.map((s) =>
          `- ${s.competitorName || 'Competitor'}: ${s.postsPerWeek ?? 'unknown'} posts/week, ${s.videoSharePercent}% video, ${s.postCount} posts tracked`
        ).join('\n')}\n\n` +
        `Sample recent captions:\n${sampleCaptions.slice(0, 15).map((c) =>
          `- [${c.competitorName || 'competitor'} / ${c.platform}] ${String(c.caption || '').slice(0, 140)}`
        ).join('\n') || 'none'}\n\n` +
        'Return a short "analysis" (2-3 sentences), a "themes" array (2-4 short bullet phrases), and one ' +
        'concrete "recommendation" sentence for what this business should post next.',
      schema: COMPETITOR_TRENDS_SCHEMA,
      maxTokens: 900,
    });
    if (!parsed || !parsed.analysis) return templateCompetitorTrends(ctx);
    return {
      analysis: String(parsed.analysis).slice(0, 1000),
      themes: (parsed.themes || []).slice(0, 6).map((t) => String(t).slice(0, 200)),
      recommendation: String(parsed.recommendation || '').slice(0, 500),
    };
  } catch (err) {
    console.error('AI analyzeCompetitorTrends failed, using template:', err.message);
    return templateCompetitorTrends(ctx);
  }
}

// Social post copy, in provider order: Gemini -> Claude -> smart template.
// Gemini is preferred for social copy; it returns null (never throws) when it
// is unconfigured or the call fails, so the chain below degrades quietly.
/**
 * Pro content pipeline: STRATEGY -> DRAFT -> local quality gate -> (refine).
 * Reads the brand brief (ctx.brief) so copy is specific to THIS business.
 * Keyless mode or any failure falls back to the smart template — callers and
 * the return shape ({ post, mediaTip, hashtags }) are unchanged.
 */
async function generateContent(ctx) {
  const viaGemini = await gemini.generateContent(ctx);
  if (viaGemini) return viaGemini;
  if (!providers.isLive) return templateContent(ctx);
  const platform = ctx.platform || 'instagram';
  const langs = (ctx.languages && ctx.languages.length ? ctx.languages : ['en']).filter((l) => LANG_NAMES[l]);
  const langNames = (langs.length ? langs : ['en']).map((l) => LANG_NAMES[l]).join(', ');
  const digest = brand.briefDigest(ctx.brief, ctx);
  const rule = frameworks.rulesFor(platform);
  const topic = ctx.topic || 'a friendly general promotion that drives a visit';
  // Preference memory: what this owner has actually published (per-business taste).
  const prefBlock = preferences.preferenceDigest(ctx.preferences);

  try {
    // 1. Strategy — decide angle, hook, single message, one CTA (cheap model).
    const strategy = await providers.completeJSON({
      model: config.aiContentModel,
      system: marketing.pipeline.strategySystemPrompt +
        (rule ? `\n\nPLATFORM-NATIVE RULES for ${platform}:\n${JSON.stringify(rule)}` : '') +
        (prefBlock ? `\n\n${prefBlock}` : ''),
      prompt: fill(marketing.pipeline.strategyUserTemplate, { platform, brief: digest, topic }),
      schema: STRATEGY_SCHEMA,
      maxTokens: 900,
    });

    // 2. Draft — execute the strategy into a final platform-native post.
    const draft = await providers.completeJSON({
      model: config.aiContentModel,
      system: marketing.pipeline.draftSystemPrompt + (prefBlock ? `\n\n${prefBlock}` : ''),
      prompt: fill(marketing.pipeline.draftUserTemplate, {
        platform, brief: digest, strategy: JSON.stringify(strategy), topic, languages: langNames,
      }),
      schema: CONTENT_SCHEMA,
      maxTokens: 1300,
    });
    if (!draft || !draft.post) return templateContent(ctx);

    let out = { post: draft.post, mediaTip: draft.mediaTip, hashtags: draft.hashtags || [] };

    // 3. Local quality gate — if a banned cliche slipped through, one refine pass.
    if (rubric.hasCliche(out.post)) {
      const refined = await refineDraft({ platform, draft: out, ctx, langNames });
      if (refined) out = refined;
    }
    return out;
  } catch (err) {
    console.error('AI generateContent pipeline failed, using template:', err.message);
    return templateContent(ctx);
  }
}

const SLOGAN_SCHEMA = {
  type: 'object',
  properties: { slogans: { type: 'array', items: { type: 'string' } } },
  required: ['slogans'],
  additionalProperties: false,
};

// Slogans are grounded in the business's STORED context cell when one exists
// (`ctx.digest`, from businessContextService.contextDigest) rather than being
// re-derived from raw profile columns. Same provider chain as generateContent:
// Gemini -> keyless template -> Claude -> template on any failure.
async function generateSlogans(ctx) {
  // Dedicated Gemini-native prompt (business-context digest) first, same
  // provider-preference pattern as generateContent/generateMediaBrief; the
  // dispatcher below is the fallback layer (Gemini again if the above failed
  // for some reason, else Anthropic, else the template).
  const viaGemini = await gemini.generateSlogans({ digest: ctx.digest, businessName: ctx.businessName });
  if (viaGemini) return viaGemini;

  if (!providers.isLive) return templateSlogans(ctx);
  const { businessName, category, description, tone } = ctx;
  try {
    const parsed = await providers.completeJSON({
      model: config.aiContentModel,
      system: 'You are a brand strategist. Generate exactly 3 short, memorable, original English brand slogans (max 6 words each). Respond as JSON only.',
      prompt:
        (ctx.digest ? `${ctx.digest}\n\n` : '') +
        `Business: ${businessName || 'a local business'}\n` +
        `Category: ${category || 'general'}\n` +
        `Description: ${description || 'n/a'}\n` +
        `Desired tone: ${tone || 'Cozy & Warm'}\n\n` +
        'Return 3 slogans in the "slogans" array.',
      schema: SLOGAN_SCHEMA,
      maxTokens: 400,
    });
    const slogans = (parsed?.slogans || []).slice(0, 3);
    return slogans.length ? slogans : templateSlogans(ctx);
  } catch (err) {
    console.error('AI generateSlogans failed, using template:', err.message);
    return templateSlogans(ctx);
  }
}

const AGENT_LANG_RULE = {
  en: 'Always reply in English.',
  ru: 'Always reply in Russian.',
  uz: 'Always reply in Uzbek (Latin script).',
};

/**
 * Markiv, the in-app agent. Returns one of:
 *   { type: 'reply', reply }                — plain chat answer
 *   { type: 'telegram_post', text, note? }  — a drafted post Markiv wants to
 *                                             publish; the SERVER routes it
 *                                             through the human approval gate.
 * Markiv never spends money or publishes itself — those only happen behind
 * the approval gate. Scheduling/drafting/reading are free and run directly
 * via the `actions` closures the server passes in (ai.js stays db-free):
 *   actions = { snapshot, listScheduled, schedulePost, draftContent }
 */
async function agentAct(ctx) {
  if (!providers.isLive) return templateAgentAct(ctx);
  const { query, history = [], lang = 'en', profile, telegram, platforms = [], snapshot, actions = {}, preferences: ownerExamples = [] } = ctx;
  const agentPrefBlock = preferences.preferenceDigest(ownerExamples);

  const tools = [];
  if (telegram?.connected) {
    tools.push({
      name: 'post_to_telegram',
      description:
        `Publish a post to the owner's connected Telegram ${telegram.chatType || 'channel'}` +
        `${telegram.chatTitle ? ` ("${telegram.chatTitle}")` : ''}. ` +
        'Call this whenever the owner asks to post, publish, announce, or share something on Telegram. ' +
        'Write the final, polished, ready-to-publish post text in the "text" field. ' +
        'Do NOT ask the owner for confirmation first — every publish already goes through an approval screen.',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The complete, final post text, ready to publish.' },
          note: { type: 'string', description: 'One short sentence to show the owner about this draft.' },
        },
        required: ['text'],
      },
    });
  }
  if (platforms && platforms.length) {
    const names = platforms.map((p) => p.label).join(', ');
    const keys = platforms.map((p) => p.key).join(', ');
    tools.push({
      name: 'publish_post',
      description:
        `Publish a post to one of the owner's connected platforms (${names}). ` +
        'Call this whenever the owner asks to post, publish, announce, or share something on one of those platforms. ' +
        'Pick the right platform key and write the final, polished, ready-to-publish text. ' +
        'Do NOT ask the owner for confirmation first — every publish already goes through an approval screen.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: `Which platform to publish to. One of: ${keys}.` },
          text: { type: 'string', description: 'The complete, final post text, ready to publish.' },
          note: { type: 'string', description: 'One short sentence to show the owner about this draft.' },
        },
        required: ['platform', 'text'],
      },
    });
  }
  if (actions.snapshot || snapshot) {
    tools.push({
      name: 'get_business_snapshot',
      description:
        "Get the owner's live business snapshot: competitor count, top SEO keywords, scheduled/posted " +
        'post counts, and AI plan usage. Call this when the owner asks about stats, performance, ' +
        'competitors, keywords, or their remaining plan allowance.',
      input_schema: { type: 'object', properties: {} },
    });
  }
  if (actions.listScheduled) {
    tools.push({
      name: 'list_scheduled_posts',
      description:
        "List up to 10 upcoming scheduled posts on the owner's content calendar. " +
        'Call this when the owner asks what is scheduled, planned, or coming up.',
      input_schema: { type: 'object', properties: {} },
    });
  }
  if (actions.schedulePost) {
    tools.push({
      name: 'schedule_post',
      description:
        "Schedule a post on the owner's content calendar for later publication. Scheduling is free " +
        'and needs NO approval — call it directly when the owner asks to schedule, plan, or queue a post. ' +
        'Write the complete, final post text yourself.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: "Target platform, e.g. 'instagram', 'telegram', 'tiktok'." },
          text: { type: 'string', description: 'The complete, final post text to schedule.' },
          scheduledTime: { type: 'string', description: 'ISO 8601 datetime to publish at, e.g. 2026-06-12T10:00:00Z.' },
        },
        required: ['text'],
      },
    });
  }
  // Only offered when the caller can actually persist the answer. Asking for a
  // fact we cannot record would make the owner repeat it forever, so the tool
  // and the question block below stand or fall together.
  const askBlock = actions.saveBusinessDetail ? profileQuestions.agentPromptBlock(profile) : '';
  if (askBlock) {
    tools.push({
      name: 'save_business_detail',
      description:
        'Save a fact the owner has just told you about their business, so they are never asked for it twice. ' +
        'Call this the moment they state one of the details listed under MISSING BUSINESS DETAILS — including when ' +
        'they mention it in passing while asking for something else. ' +
        'Save ONLY what they actually said: never a guess, an inference, or a detail you wrote into a draft yourself.',
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The detail key, exactly as listed under MISSING BUSINESS DETAILS.' },
          value: { type: 'string', description: "The owner's answer in their own words, kept to one short line." },
        },
        required: ['key', 'value'],
      },
    });
  }
  if (actions.draftContent) {
    tools.push({
      name: 'draft_content',
      description:
        'Draft a platform-native social-media post (with a media tip and hashtags) using the content engine. ' +
        'Call this when the owner asks for post copy or content ideas on a specific topic.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: "Target platform, e.g. 'instagram', 'telegram', 'tiktok'." },
          topic: { type: 'string', description: 'What the post should be about.' },
        },
        required: ['topic'],
      },
    });
  }

  const runTool = async (name, input = {}) => {
    switch (name) {
      case 'get_business_snapshot':
        return actions.snapshot ? actions.snapshot() : snapshot;
      case 'list_scheduled_posts':
        return actions.listScheduled();
      case 'schedule_post':
        return actions.schedulePost({
          platform: input.platform,
          text: input.text,
          scheduledTime: input.scheduledTime,
        });
      case 'draft_content':
        return actions.draftContent({ platform: input.platform, topic: input.topic });
      case 'save_business_detail':
        return actions.saveBusinessDetail({ key: input.key, value: input.value });
      default:
        return { error: `Unknown tool: ${name}` };
    }
  };

  // Prior turns become alternating chat messages; the API requires the first
  // message to be role "user", so any leading agent rows are dropped.
  const messages = [];
  for (const m of history) {
    if (m && m.text) messages.push({ role: m.sender === 'agent' ? 'assistant' : 'user', content: m.text });
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();
  messages.push({ role: 'user', content: query || 'Hello' });

  const system =
    marketing.pipeline.agentSystemPrompt + ' ' +
    `${AGENT_LANG_RULE[lang] || AGENT_LANG_RULE.en}` +
    (profile
      ? `\n\nBRAND BRIEF for this business (${profile.businessName}):\n` +
        `${brand.briefDigest(profile.brandBrief, profile)}`
      : '') +
    (agentPrefBlock ? `\n\n${agentPrefBlock}` : '') +
    (askBlock ? `\n${askBlock}` : '') +
    (snapshot
      ? '\n\nLive business snapshot:' +
        `\n- Competitors tracked: ${snapshot.stats?.competitorCount ?? 0}` +
        `\n- Top keywords: ${(snapshot.stats?.keywords || []).join(', ') || 'n/a'}` +
        `\n- Scheduled posts: ${snapshot.stats?.scheduledPosts ?? 0}; published posts: ${snapshot.stats?.postedPosts ?? 0}` +
        (snapshot.usage
          ? `\n- AI generations used this month: ${snapshot.usage.used}/${snapshot.usage.limit} (${snapshot.usage.tier} plan)`
          : '')
      : '') +
    (telegram?.connected
      ? `\nTelegram: connected (${telegram.chatTitle || 'channel'}).`
      : telegram?.comingSoon
        ? '\nTelegram: COMING SOON — the integration is not enabled in this version. If the owner asks to post to Telegram, say it is coming soon and offer to draft the post text meanwhile. Do not tell them to connect a bot.'
        : '\nTelegram: NOT connected. If the owner asks to post to Telegram, explain they can connect it from the dashboard Telegram card in about a minute (create a bot with @BotFather, paste the token, add the bot to their channel).');

  // Provider order: Gemini -> Anthropic -> template, same convention used
  // everywhere else in this file. Each provider gets its own try/catch so a
  // Gemini failure falls through to Anthropic (if configured) rather than
  // going straight to the template.
  if (config.geminiEnabled) {
    try {
      const result = await runAgentGemini({ tools, messages, system, runTool });
      if (result) return result;
    } catch (err) {
      console.warn('Gemini agentAct failed, falling back:', err.message);
    }
  }
  if (client) {
    try {
      const result = await runAgentAnthropic({ tools, messages, system, runTool });
      if (result) return result;
    } catch (err) {
      console.error('AI agentAct failed, using template:', err.message);
    }
  }
  return templateAgentAct(ctx);
}

// Anthropic tool-use loop (max 4 iterations). post_to_telegram/publish_post
// EXIT immediately — they must go through the human approval gate, never a
// tool_result. Returns the action object, or null for "no usable reply"
// (caller falls through to the next provider / template).
async function runAgentAnthropic({ tools, messages, system, runTool }) {
  const request = () =>
    client.messages.create({
      model: config.aiAgentModel,
      max_tokens: 1000,
      system,
      messages,
      tools: tools.length ? tools : undefined,
    });

  let msg = await request();

  for (let i = 0; i < 4 && msg.stop_reason === 'tool_use'; i++) {
    const toolUses = (msg.content || []).filter((b) => b.type === 'tool_use');
    const tgUse = toolUses.find((b) => b.name === 'post_to_telegram');
    if (tgUse && tgUse.input?.text) {
      return { type: 'telegram_post', text: tgUse.input.text, note: tgUse.input.note };
    }
    const ppUse = toolUses.find((b) => b.name === 'publish_post');
    if (ppUse && ppUse.input?.text && ppUse.input?.platform) {
      return { type: 'platform_post', platform: ppUse.input.platform, text: ppUse.input.text, note: ppUse.input.note };
    }

    messages.push({ role: 'assistant', content: msg.content });
    const results = [];
    for (const tu of toolUses) {
      let out;
      try {
        out = await runTool(tu.name, tu.input || {});
      } catch (err) {
        out = { error: err.message };
      }
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: typeof out === 'string' ? out : JSON.stringify(out ?? null),
      });
    }
    messages.push({ role: 'user', content: results });
    msg = await request();
  }

  const toolUse = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === 'post_to_telegram');
  if (toolUse && toolUse.input?.text) {
    return { type: 'telegram_post', text: toolUse.input.text, note: toolUse.input.note };
  }
  const ppFinal = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === 'publish_post');
  if (ppFinal && ppFinal.input?.text && ppFinal.input?.platform) {
    return { type: 'platform_post', platform: ppFinal.input.platform, text: ppFinal.input.text, note: ppFinal.input.note };
  }
  const reply = textOf(msg);
  return reply ? { type: 'reply', reply } : null;
}

// Gemini's tool-calling equivalent, same short-circuit/loop contract as
// runAgentAnthropic above, built on Gemini's functionCall/functionResponse
// wire format. `messages` is the SAME provider-agnostic flat turn list
// ([{role:'user'|'assistant', content: string}]) agentAct already built for
// Anthropic — converted here to Gemini's {role, parts} shape.
//
// Verified live against the real API: a functionCall part carries a
// thoughtSignature that MUST be echoed back verbatim in the next turn's
// parts, or the API rejects the request — so the model's raw `content.parts`
// is pushed back unmodified rather than reconstructed field-by-field.
async function runAgentGemini({ tools, messages, system, runTool }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  let content = await gemini.callGeminiWithTools({ system, contents, tools });

  for (let i = 0; i < 4; i++) {
    const calls = (content.parts || []).filter((p) => p.functionCall);
    if (!calls.length) break;

    const tgCall = calls.find((c) => c.functionCall.name === 'post_to_telegram');
    if (tgCall && tgCall.functionCall.args?.text) {
      return { type: 'telegram_post', text: tgCall.functionCall.args.text, note: tgCall.functionCall.args.note };
    }
    const ppCall = calls.find((c) => c.functionCall.name === 'publish_post');
    if (ppCall && ppCall.functionCall.args?.text && ppCall.functionCall.args?.platform) {
      return { type: 'platform_post', platform: ppCall.functionCall.args.platform, text: ppCall.functionCall.args.text, note: ppCall.functionCall.args.note };
    }

    contents.push({ role: 'model', parts: content.parts });
    const responses = [];
    for (const c of calls) {
      let out;
      try {
        out = await runTool(c.functionCall.name, c.functionCall.args || {});
      } catch (err) {
        out = { error: err.message };
      }
      responses.push({
        functionResponse: {
          name: c.functionCall.name,
          id: c.functionCall.id,
          response: (out !== null && typeof out === 'object') ? out : { result: out ?? null },
        },
      });
    }
    contents.push({ role: 'user', parts: responses });
    content = await gemini.callGeminiWithTools({ system, contents, tools });
  }

  const reply = (content.parts || []).filter((p) => p.text).map((p) => p.text).join('').trim();
  return reply ? { type: 'reply', reply } : null;
}

// ===========================================================================
// MEDIA STUDIO (briefs + edit plans) and LOGO GENERATION
// ===========================================================================
// Guided briefs mirror the Gemini schemas in gemini.js so the Media Studio
// renders the same document whichever engine answered (or neither).
const CAMERA_SCHEMA = {
  type: 'object',
  properties: {
    device: { type: 'string' },
    lens: { type: 'string' },
    settings: { type: 'string' },
    whiteBalance: { type: 'string' },
    stabilisation: { type: 'string' },
  },
  required: ['device', 'lens', 'settings', 'whiteBalance', 'stabilisation'],
  additionalProperties: false,
};

const MEDIA_BRIEF_GUIDED_PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    scene: { type: 'string' },
    setup: { type: 'array', items: { type: 'string' } },
    camera: CAMERA_SCHEMA,
    lighting: { type: 'string' },
    composition: { type: 'string' },
    shotList: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          framing: { type: 'string' },
          angle: { type: 'string' },
          direction: { type: 'string' },
        },
        required: ['name', 'framing', 'angle', 'direction'],
        additionalProperties: false,
      },
    },
    postProcessing: { type: 'string' },
    tips: { type: 'array', items: { type: 'string' } },
  },
  required: ['scene', 'setup', 'camera', 'lighting', 'composition', 'shotList', 'postProcessing', 'tips'],
  additionalProperties: false,
};

const MEDIA_BRIEF_GUIDED_VIDEO_SCHEMA = {
  type: 'object',
  properties: {
    scenario: { type: 'string' },
    flow: { type: 'string' },
    scene: { type: 'string' },
    setup: { type: 'array', items: { type: 'string' } },
    camera: CAMERA_SCHEMA,
    lighting: { type: 'string' },
    composition: { type: 'string' },
    script: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          time: { type: 'string' },
          spoken: { type: 'string' },
          onScreenText: { type: 'string' },
        },
        required: ['time', 'spoken', 'onScreenText'],
        additionalProperties: false,
      },
    },
    shotList: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          framing: { type: 'string' },
          angle: { type: 'string' },
          movement: { type: 'string' },
          duration: { type: 'string' },
          direction: { type: 'string' },
        },
        required: ['name', 'framing', 'angle', 'movement', 'duration', 'direction'],
        additionalProperties: false,
      },
    },
    bRoll: { type: 'array', items: { type: 'string' } },
    transitions: { type: 'array', items: { type: 'string' } },
    audio: { type: 'string' },
    postProcessing: { type: 'string' },
    tips: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'scenario', 'flow', 'scene', 'setup', 'camera', 'lighting', 'composition',
    'script', 'shotList', 'bRoll', 'transitions', 'audio', 'postProcessing', 'tips',
  ],
  additionalProperties: false,
};

const MEDIA_BRIEF_FULL_SCHEMA = {
  type: 'object',
  properties: {
    concept: { type: 'string' },
    caption: { type: 'string' },
    visualSpec: {
      type: 'object',
      properties: { composition: { type: 'string' }, palette: { type: 'string' }, mood: { type: 'string' } },
      required: ['composition', 'palette', 'mood'],
      additionalProperties: false,
    },
  },
  required: ['concept', 'caption', 'visualSpec'],
  additionalProperties: false,
};

const profileLines = (profile) =>
  `Business: ${profile?.businessName || 'a local business'}\n` +
  `Category: ${profile?.category || 'general'}\n` +
  `Business description: ${profile?.description || 'n/a'}\n` +
  `Target audience: ${profile?.targetAudience || 'local customers'}\n` +
  `Brand tone: ${profile?.brandTone || 'Cozy & Warm'}\n` +
  // The brand brief is the single source of truth — Media Studio matches it for
  // voice/visuals and never invents facts not present in it (same guard the
  // content pipeline and the agent use).
  (profile?.brandBrief
    ? `\nBRAND BRIEF (match this exactly; never invent prices, hours, products, or numbers not stated here):\n${brand.briefDigest(profile.brandBrief, profile)}\n`
    : '');

// Short digest line for an optional competitor-trend recommendation (from
// ai.js#analyzeCompetitorTrends, or a caller-supplied string). Instructs the
// model to use it as inspiration, not to quote it back verbatim.
const trendsLine = (trends) =>
  trends
    ? `\nCOMPETITOR TREND CONTEXT (real data from this business's tracked competitors — let it inform the ` +
      `concept and shot choices, do not quote it back verbatim):\n${String(trends).slice(0, 600)}\n`
    : '';

// Media briefs, in provider order: Gemini -> Claude -> deterministic template.
// Gemini leads here because the guided brief is a big structured document
// (staging, camera, script, movements) and its schema support handles it well.
async function generateMediaBrief(ctx) {
  const { kind, mode, topic, profile, trends } = ctx;
  const guided = mode === 'guided';
  // Customer-facing words (caption, spoken script, on-screen text) follow the
  // audience's languages; the directions to the owner stay in English. Empty
  // string when the owner has not answered that question yet.
  const langRule = gemini.mediaLangRule(ctx.languages);
  // Full-mode briefs carry the render-engine status whichever engine wrote
  // them, so the Media Studio's render section behaves identically.
  const withEngineStatus = (brief) => (guided ? brief : {
    ...brief,
    engineStatus: 'awaiting_media_api',
    note: 'Rendering activates once a media-generation API key is configured.',
  });

  const viaGemini = await gemini.generateMediaBrief(ctx);
  if (viaGemini) return withEngineStatus(viaGemini);
  if (!providers.isLive) return templateMediaBrief(ctx);
  try {
    const parsed = await providers.completeJSON({
      model: config.aiContentModel,
      system: (guided
        ? (kind === 'video'
          ? 'You are a professional videographer directing a small-business owner who is filming this ' +
            'themselves. Deliver the brief a real director would hand over on the day: the scenario, how ' +
            'the finished video flows start to finish, how to stage the scene, exact camera setup, a ' +
            'timed spoken script with on-screen text, and a shot list where EVERY shot names its framing, ' +
            'angle, camera MOVEMENT, and duration. Be concrete and physical: real distances, real angles, ' +
            'real seconds. No vague advice. Respond as JSON only.'
          : 'You are a professional photographer directing a small-business owner shooting this ' +
            'themselves. Deliver the brief a real photographer would work from: how to stage and style ' +
            'the scene, exact camera setup, lighting, composition, and a shot list where EVERY shot ' +
            'names its framing, angle, and direction to the person holding the camera. Be concrete and ' +
            'physical: real distances, real angles. No vague advice. Respond as JSON only.')
        : "You are Markivo's creative director. Produce a generation-ready creative brief for an AI media engine: " +
          'a concept, a caption that includes hashtags derived from the business name and category, ' +
          'and a visual spec. Respond as JSON only.') + langRule,
      prompt: profileLines(profile) + trendsLine(trends) + `Media kind: ${kind}\nWhat they want to shoot: ${topic}`,
      schema: guided
        ? (kind === 'video' ? MEDIA_BRIEF_GUIDED_VIDEO_SCHEMA : MEDIA_BRIEF_GUIDED_PHOTO_SCHEMA)
        : MEDIA_BRIEF_FULL_SCHEMA,
      maxTokens: 4000,
    });
    if (!parsed) return templateMediaBrief(ctx);
    return withEngineStatus({ mode, kind, ...parsed });
  } catch (err) {
    console.error('AI generateMediaBrief failed, using template:', err.message);
    return templateMediaBrief(ctx);
  }
}

const EDIT_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    steps: { type: 'array', items: { type: 'string' } },
    crop: { type: 'string' },
    colorGrade: { type: 'string' },
    captions: { type: 'string' },
    audio: { type: 'string' },
    exportSpec: {
      type: 'object',
      properties: {
        instagram: { type: 'string' },
        telegram: { type: 'string' },
        tiktok: { type: 'string' },
        googleBusiness: { type: 'string' },
      },
      required: ['instagram', 'telegram', 'tiktok', 'googleBusiness'],
      additionalProperties: false,
    },
  },
  required: ['steps', 'crop', 'colorGrade', 'captions', 'audio', 'exportSpec'],
  additionalProperties: false,
};

async function generateEditPlan(ctx) {
  if (!providers.isLive) return templateEditPlan(ctx);
  const { instructions, media, profile } = ctx;
  try {
    const parsed = await providers.completeJSON({
      model: config.aiContentModel,
      system:
        "You are Markivo's photo/video editor. Produce a concrete edit plan an editing engine can execute: " +
        '5-8 numbered steps, crop guidance, a colour grade, caption treatment, audio treatment, ' +
        'and per-platform export specs. Respond as JSON only.',
      prompt:
        profileLines(profile) +
        `Media kind: ${media?.kind || 'video'}\n` +
        `Original topic: ${media?.topic || 'n/a'}\n` +
        `Owner's edit instructions: ${instructions}`,
      schema: EDIT_PLAN_SCHEMA,
      maxTokens: 1200,
    });
    if (!parsed) return templateEditPlan(ctx);
    return { ...parsed, engineStatus: 'awaiting_media_api' };
  } catch (err) {
    console.error('AI generateEditPlan failed, using template:', err.message);
    return templateEditPlan(ctx);
  }
}

const LOGO_SCHEMA = {
  type: 'object',
  properties: {
    logos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          svg: { type: 'string' },
          style: { type: 'string' },
          palette: {
            type: 'object',
            properties: { bg: { type: 'string' }, fg: { type: 'string' }, accent: { type: 'string' } },
            required: ['bg', 'fg', 'accent'],
            additionalProperties: false,
          },
        },
        required: ['svg', 'palette', 'style'],
        additionalProperties: false,
      },
    },
  },
  required: ['logos'],
  additionalProperties: false,
};

// Strict SVG sanitation: anything suspicious is replaced by the deterministic
// logogen variant — model output is never trusted into the DOM as-is.
const DANGEROUS_SVG = /<script|<foreignObject|javascript:|on[a-z]+=|href=/i;
const isSafeSvg = (svg) =>
  typeof svg === 'string' &&
  svg.trim().startsWith('<svg') &&
  svg.length < 20000 &&
  !DANGEROUS_SVG.test(svg);

async function generateLogos(ctx) {
  const fallback = logogen.generateLogoVariants(ctx);
  if (!providers.isLive) return fallback;
  const { businessName, category, tone } = ctx;
  try {
    const parsed = await providers.completeJSON({
      model: config.aiContentModel,
      system:
        'You are a senior logo designer producing safe, self-contained SVG. Generate exactly 4 distinct logo variants. ' +
        'Each svg must be a complete <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"> document using ONLY ' +
        'rect, circle, polygon, path, text, and g elements — no scripts, no event handlers, no links, no foreignObject, ' +
        'no external references. Respond as JSON only.',
      prompt:
        `Business: ${businessName || 'a local business'}\n` +
        `Category: ${category || 'general'}\n` +
        `Brand tone: ${tone || 'n/a'}\n\n` +
        'Return 4 variants in "logos": a circle monogram, a rounded-square monogram with a category glyph, ' +
        'a hexagon badge, and a wordmark bar. Include the palette {bg, fg, accent} actually used and a short style name for each.',
      schema: LOGO_SCHEMA,
      maxTokens: 4000,
    });
    const candidates = Array.isArray(parsed?.logos) ? parsed.logos : [];
    // Always exactly 4: per-slot, a candidate that fails sanitation is
    // replaced by the deterministic variant for that slot.
    return fallback.map((fb, i) => {
      const c = candidates[i];
      if (!c || !isSafeSvg(c.svg)) return fb;
      const p = c.palette && typeof c.palette === 'object' ? c.palette : {};
      return {
        svg: c.svg.trim(),
        palette: {
          bg: typeof p.bg === 'string' ? p.bg.slice(0, 30) : fb.palette.bg,
          fg: typeof p.fg === 'string' ? p.fg.slice(0, 30) : fb.palette.fg,
          accent: typeof p.accent === 'string' ? p.accent.slice(0, 30) : fb.palette.accent,
        },
        style: typeof c.style === 'string' && c.style.trim() ? c.style.trim().slice(0, 60) : fb.style,
      };
    });
  } catch (err) {
    console.error('AI generateLogos failed, using logogen:', err.message);
    return fallback;
  }
}

module.exports = {
  enabled: config.aiEnabled,
  generateContent,
  generateSlogans,
  agentAct,
  analyzeAndPlan,
  analyzeCompetitorTrends,
  generateMediaBrief,
  generateEditPlan,
  generateLogos,
  // exported for tests
  templateContent,
  templateSlogans,
  templateAgentAct,
  templateAutonomousPlan,
  templateCompetitorTrends,
  templateMediaBrief,
  templateEditPlan,
};
