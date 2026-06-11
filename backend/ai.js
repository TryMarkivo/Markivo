const config = require('./config');
const logogen = require('./logogen');

// Lazily construct the Anthropic client only when a key is present, so the app
// runs with zero AI config (every function falls back to a smart template).
let client = null;
if (config.aiEnabled) {
  const Anthropic = require('@anthropic-ai/sdk');
  client = new Anthropic({ apiKey: config.anthropicApiKey });
}

const textOf = (msg) =>
  (msg.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

const cleanTag = (name) => `#${(name || 'business').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

// ===========================================================================
// FALLBACK TEMPLATES (used when no API key, or if a live call fails)
// English-first; Uzbek/Russian lines are appended only when requested.
// ===========================================================================
function templateContent({ platform, topic, businessName, category, description, languages }) {
  const name = businessName || 'Our Spot';
  const langs = languages && languages.length ? languages : ['en'];
  const multi = langs.includes('uz') || langs.includes('ru');

  // No topic? Lead with the owner's own business description so the fallback
  // is personalised to ANY business, not a generic (or cafe-flavoured) line.
  const enLine = topic
    ? `${topic}`
    : (description && description.trim()
      ? description.trim().slice(0, 180)
      : `We've prepared something special for you. Come by, relax, and enjoy real local quality.`);
  const uzLine = `\n\n🇺🇿 ${topic || "Sizlar uchun maxsus taklif tayyorladik. Keling, dam oling va sifatli xizmatdan bahra oling."}`;
  const ruLine = `\n\n🇷🇺 ${topic || 'Мы приготовили для вас нечто особенное. Приходите и насладитесь качеством.'}`;
  const extras = multi ? `${langs.includes('uz') ? uzLine : ''}${langs.includes('ru') ? ruLine : ''}` : '';

  const mocks = {
    instagram: {
      post: `✨ Something special at ${name}! ✨\n\n${enLine}${extras}\n\n📍 Visit us — link in bio.`,
      mediaTip: '📸 Close-up of your signature item in warm natural window light.',
      hashtags: ['#SupportLocal', '#Tashkent', cleanTag(name)],
    },
    telegram: {
      post: `📢 ${name}\n\n${enLine}${extras}\n\n👉 Follow this channel for updates!`,
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

function templateAgentAct({ query, profile, telegram }) {
  const lower = (query || '').toLowerCase();
  const name = profile?.businessName || 'your business';

  // Publish intent → hand back a drafted post for the approval gate.
  if (/\b(post|publish|announce|share|send)\b/.test(lower) && /telegram|channel|group/.test(lower)) {
    if (telegram?.comingSoon) {
      return {
        type: 'reply',
        reply: `Telegram publishing is coming soon — it isn't enabled in this version yet. Meanwhile I can draft the post text for you: just tell me the topic, or use the Content Engine tab.`,
      };
    }
    if (!telegram?.connected) {
      return {
        type: 'reply',
        reply: `I'd love to post that for you, but your Telegram isn't connected yet. Open the Telegram card on your dashboard — it takes about a minute: create a bot with @BotFather, paste the token, and add the bot to your channel. Then just ask me again!`,
      };
    }
    const draft = templateContent({ platform: 'telegram', topic: query.replace(/\b(post|publish|announce|share|send)\b/gi, '').replace(/\b(to|on|in|my)\s+(telegram|channel|group)\b/gi, '').trim() || undefined, businessName: name });
    return { type: 'telegram_post', text: `${draft.post}\n\n${draft.hashtags.join(' ')}` };
  }

  if (lower.includes('instagram') || lower.includes('post') || lower.includes('copy')) {
    return { type: 'reply', reply: `I've drafted a post for ${name} in the Content Engine, matched to your "${profile?.brandTone || 'brand'}" tone. Want me to publish it to Telegram?` };
  }
  if (lower.includes('competitor') || lower.includes('gap')) {
    return { type: 'reply', reply: `Local competitors average 8-10 posts/week; you're at ~3. Closing that cadence gap will lift your organic reach.` };
  }
  return {
    type: 'reply',
    reply: `Hi, I'm Markiv 🤖 — your marketing agent. I can draft content, track competitors, plan campaigns, and post straight to your Telegram channel. Try: "Post our weekend offer to Telegram".`,
  };
}

// Media Studio fallback: a concrete, profile-tailored brief without any key.
function templateMediaBrief({ kind = 'image', mode = 'guided', topic, profile }) {
  const name = profile?.businessName || 'your business';
  const category = (profile?.category || 'business').toLowerCase();
  const tone = profile?.brandTone || 'Cozy & Warm';
  const subject = (topic && topic.trim()) || `your ${category}`;

  if (mode === 'guided') {
    return {
      mode,
      kind,
      script:
        `Open with ${subject} front and centre — it is the hero of this ${kind}. ` +
        `Show the real ${category} setting at ${name} so viewers instantly recognise where they are. ` +
        `Keep the energy ${tone.toLowerCase()} throughout: let people, hands, and details do the talking. ` +
        `Close on your strongest frame of ${subject} and hold it for two seconds so the brand lands.`,
      shotList: [
        `Wide establishing shot of ${name} (2-3s) to set the scene`,
        `Medium shot introducing ${subject} in its natural spot`,
        `Slow close-up detail pass over ${subject} — texture and colour`,
        `Hands-in-frame action shot: someone interacting with ${subject}`,
        `Reaction shot: a real customer or team member responding to ${subject}`,
        `Final hero frame of ${subject} with the ${name} branding visible`,
      ],
      camera: {
        device: 'any modern smartphone',
        settings: kind === 'video'
          ? '4K at 30fps, exposure locked, gridlines on, hold or stabilise each shot for 3-5 seconds'
          : 'main lens (1x), HDR on, tap-to-focus on the subject, burst mode for action moments',
      },
      lighting: 'Shoot near a window or outdoors within 2 hours of sunrise/sunset; avoid mixed overhead lighting and never shoot against the light source.',
      audio: kind === 'video'
        ? 'Capture clean ambient sound close to the subject; add trending or licensed music in the platform editor afterwards.'
        : 'Not applicable for photos — put the effort into light instead.',
      tips: [
        'Wipe the lens first — it is the cheapest quality upgrade there is.',
        `Shoot 3 takes of every shot so you can pick the best ${subject} moment.`,
        'Keep each clip under 5 seconds; fast cuts hold attention.',
        `Stay consistent with your "${tone}" brand tone — colours, pace, and framing should all match it.`,
      ],
    };
  }

  // mode === 'full' — a generation-ready creative brief for the media engine.
  return {
    mode,
    kind,
    concept:
      `A scroll-stopping ${kind} built around ${subject}: the ${tone.toLowerCase()} world of ${name}, ` +
      `told through one bold ${category} moment that makes viewers want to visit.`,
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

const LANG_NAMES = { en: 'English', uz: 'Uzbek (Latin script)', ru: 'Russian' };

async function generateContent(ctx) {
  if (!client) return templateContent(ctx);
  const { platform = 'instagram', topic, businessName, category, description, brandTone, audience } = ctx;
  const langs = (ctx.languages && ctx.languages.length ? ctx.languages : ['en']).filter((l) => LANG_NAMES[l]);
  const langInstruction =
    langs.length <= 1
      ? 'Write the post in English only.'
      : `Write the same message in each of these languages, English first, clearly separated: ${langs.map((l) => LANG_NAMES[l]).join(', ')}.`;
  try {
    const msg = await client.messages.create({
      model: config.aiContentModel,
      max_tokens: 1500,
      system:
        "You are Markivo's expert social-media copywriter for small businesses. " +
        `${langInstruction} Write a single platform-native post that matches the brand tone. ` +
        'Keep hashtags OUT of the post body — return them separately. Respond as JSON only.',
      messages: [
        {
          role: 'user',
          content:
            `Business: ${businessName || 'a local business'}\n` +
            `Category: ${category || 'general'}\n` +
            `Business description: ${description || 'n/a'}\n` +
            `Brand tone: ${brandTone || 'Cozy & Warm'}\n` +
            `Target audience: ${audience || 'local customers'}\n` +
            `Platform: ${platform}\n` +
            `Post topic: ${topic || 'a friendly general promotion'}\n\n` +
            'Write the post, a one-line phone photography/video tip, and 4-6 relevant hashtags.',
        },
      ],
      output_config: { format: { type: 'json_schema', schema: CONTENT_SCHEMA } },
    });
    const parsed = JSON.parse(textOf(msg));
    return { post: parsed.post, mediaTip: parsed.mediaTip, hashtags: parsed.hashtags || [] };
  } catch (err) {
    console.error('AI generateContent failed, using template:', err.message);
    return templateContent(ctx);
  }
}

const SLOGAN_SCHEMA = {
  type: 'object',
  properties: { slogans: { type: 'array', items: { type: 'string' } } },
  required: ['slogans'],
  additionalProperties: false,
};

async function generateSlogans(ctx) {
  if (!client) return templateSlogans(ctx);
  const { businessName, category, description, tone } = ctx;
  try {
    const msg = await client.messages.create({
      model: config.aiContentModel,
      max_tokens: 400,
      system: 'You are a brand strategist. Generate exactly 3 short, memorable, original English brand slogans (max 6 words each). Respond as JSON only.',
      messages: [
        {
          role: 'user',
          content:
            `Business: ${businessName || 'a local business'}\n` +
            `Category: ${category || 'general'}\n` +
            `Description: ${description || 'n/a'}\n` +
            `Desired tone: ${tone || 'Cozy & Warm'}\n\n` +
            'Return 3 slogans in the "slogans" array.',
        },
      ],
      output_config: { format: { type: 'json_schema', schema: SLOGAN_SCHEMA } },
    });
    const parsed = JSON.parse(textOf(msg));
    const slogans = (parsed.slogans || []).slice(0, 3);
    return slogans.length ? slogans : templateSlogans(ctx);
  } catch (err) {
    console.error('AI generateSlogans failed, using template:', err.message);
    return templateSlogans(ctx);
  }
}

/**
 * Markiv, the in-app agent. Returns one of:
 *   { type: 'reply', reply }                — plain chat answer
 *   { type: 'telegram_post', text, note? }  — a drafted post Markiv wants to
 *                                             publish; the SERVER routes it
 *                                             through the human approval gate.
 * Markiv never executes actions itself — it only proposes them.
 */
async function agentAct(ctx) {
  if (!client) return templateAgentAct(ctx);
  const { query, profile, telegram } = ctx;

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

  try {
    const msg = await client.messages.create({
      model: config.aiAgentModel,
      max_tokens: 1000,
      system:
        'You are Markiv, the AI marketing agent inside Markivo, helping a small business owner. ' +
        'Default to English; if the owner writes in Uzbek or Russian, reply in their language. ' +
        'Be concise, practical, and encouraging. You can draft content, analyse competitors, plan campaigns, ' +
        'and publish to the connected Telegram channel via your tool. You never spend money or publish without ' +
        'the approval gate the app provides — so when asked to post, call the tool with your best draft instead of asking for permission. ' +
        'Reply with ONLY the final answer — no exploratory reasoning or meta-commentary. ' +
        (profile
          ? `\n\nBusiness context — name: ${profile.businessName}; category: ${profile.category}; ` +
            `tone: ${profile.brandTone}; location: ${profile.location}; slogan: ${profile.slogan || 'n/a'}; ` +
            `description: ${profile.description || 'n/a'}; target audience: ${profile.targetAudience || 'n/a'}.`
          : '') +
        (telegram?.connected
          ? `\nTelegram: connected (${telegram.chatTitle || 'channel'}).`
          : telegram?.comingSoon
            ? '\nTelegram: COMING SOON — the integration is not enabled in this version. If the owner asks to post to Telegram, say it is coming soon and offer to draft the post text meanwhile. Do not tell them to connect a bot.'
            : '\nTelegram: NOT connected. If the owner asks to post to Telegram, explain they can connect it from the dashboard Telegram card in about a minute (create a bot with @BotFather, paste the token, add the bot to their channel).'),
      messages: [{ role: 'user', content: query || 'Hello' }],
      tools: tools.length ? tools : undefined,
    });

    const toolUse = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === 'post_to_telegram');
    if (toolUse && toolUse.input?.text) {
      return { type: 'telegram_post', text: toolUse.input.text, note: toolUse.input.note };
    }
    const reply = textOf(msg);
    return reply ? { type: 'reply', reply } : templateAgentAct(ctx);
  } catch (err) {
    console.error('AI agentAct failed, using template:', err.message);
    return templateAgentAct(ctx);
  }
}

// ===========================================================================
// MEDIA STUDIO (briefs + edit plans) and LOGO GENERATION
// ===========================================================================
const MEDIA_BRIEF_GUIDED_SCHEMA = {
  type: 'object',
  properties: {
    script: { type: 'string' },
    shotList: { type: 'array', items: { type: 'string' } },
    camera: {
      type: 'object',
      properties: { device: { type: 'string' }, settings: { type: 'string' } },
      required: ['device', 'settings'],
      additionalProperties: false,
    },
    lighting: { type: 'string' },
    audio: { type: 'string' },
    tips: { type: 'array', items: { type: 'string' } },
  },
  required: ['script', 'shotList', 'camera', 'lighting', 'audio', 'tips'],
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
  `Brand tone: ${profile?.brandTone || 'Cozy & Warm'}\n`;

async function generateMediaBrief(ctx) {
  if (!client) return templateMediaBrief(ctx);
  const { kind, mode, topic, profile } = ctx;
  const guided = mode === 'guided';
  try {
    const msg = await client.messages.create({
      model: config.aiContentModel,
      max_tokens: 1500,
      system: guided
        ? "You are Markivo's media production coach for small business owners filming on their own phones. " +
          'Produce a practical, concrete filming brief: a short script (3-5 sentences), 6 specific shots, ' +
          'smartphone camera settings, lighting, audio, and 4 tips. Respond as JSON only.'
        : "You are Markivo's creative director. Produce a generation-ready creative brief for an AI media engine: " +
          'a concept, a caption that includes hashtags derived from the business name and category, ' +
          'and a visual spec. Respond as JSON only.',
      messages: [
        {
          role: 'user',
          content: profileLines(profile) + `Media kind: ${kind}\nTopic: ${topic}`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: guided ? MEDIA_BRIEF_GUIDED_SCHEMA : MEDIA_BRIEF_FULL_SCHEMA } },
    });
    const parsed = JSON.parse(textOf(msg));
    return guided
      ? { mode, kind, ...parsed }
      : {
          mode,
          kind,
          ...parsed,
          engineStatus: 'awaiting_media_api',
          note: 'Rendering activates once a media-generation API key is configured.',
        };
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
  if (!client) return templateEditPlan(ctx);
  const { instructions, media, profile } = ctx;
  try {
    const msg = await client.messages.create({
      model: config.aiContentModel,
      max_tokens: 1200,
      system:
        "You are Markivo's photo/video editor. Produce a concrete edit plan an editing engine can execute: " +
        '5-8 numbered steps, crop guidance, a colour grade, caption treatment, audio treatment, ' +
        'and per-platform export specs. Respond as JSON only.',
      messages: [
        {
          role: 'user',
          content:
            profileLines(profile) +
            `Media kind: ${media?.kind || 'video'}\n` +
            `Original topic: ${media?.topic || 'n/a'}\n` +
            `Owner's edit instructions: ${instructions}`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: EDIT_PLAN_SCHEMA } },
    });
    const parsed = JSON.parse(textOf(msg));
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
  if (!client) return fallback;
  const { businessName, category, tone } = ctx;
  try {
    const msg = await client.messages.create({
      model: config.aiContentModel,
      max_tokens: 4000,
      system:
        'You are a senior logo designer producing safe, self-contained SVG. Generate exactly 4 distinct logo variants. ' +
        'Each svg must be a complete <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"> document using ONLY ' +
        'rect, circle, polygon, path, text, and g elements — no scripts, no event handlers, no links, no foreignObject, ' +
        'no external references. Respond as JSON only.',
      messages: [
        {
          role: 'user',
          content:
            `Business: ${businessName || 'a local business'}\n` +
            `Category: ${category || 'general'}\n` +
            `Brand tone: ${tone || 'n/a'}\n\n` +
            'Return 4 variants in "logos": a circle monogram, a rounded-square monogram with a category glyph, ' +
            'a hexagon badge, and a wordmark bar. Include the palette {bg, fg, accent} actually used and a short style name for each.',
        },
      ],
      output_config: { format: { type: 'json_schema', schema: LOGO_SCHEMA } },
    });
    const parsed = JSON.parse(textOf(msg));
    const candidates = Array.isArray(parsed.logos) ? parsed.logos : [];
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
  generateMediaBrief,
  generateEditPlan,
  generateLogos,
  // exported for tests
  templateContent,
  templateSlogans,
  templateAgentAct,
  templateMediaBrief,
  templateEditPlan,
};
