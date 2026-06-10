const config = require('./config');

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
function templateContent({ platform, topic, businessName, languages }) {
  const name = businessName || 'Our Spot';
  const langs = languages && languages.length ? languages : ['en'];
  const multi = langs.includes('uz') || langs.includes('ru');

  const enLine = topic
    ? `${topic}`
    : `We've prepared something special for you. Come by, relax, and enjoy real local quality.`;
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
      post: `POV: you found the best ${topic || 'spot'} in town 🤫\n\n${name}`,
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
  const { platform = 'instagram', topic, businessName, category, brandTone, audience } = ctx;
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
            `tone: ${profile.brandTone}; location: ${profile.location}; slogan: ${profile.slogan || 'n/a'}.`
          : '') +
        (telegram?.connected
          ? `\nTelegram: connected (${telegram.chatTitle || 'channel'}).`
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

module.exports = {
  enabled: config.aiEnabled,
  generateContent,
  generateSlogans,
  agentAct,
  // exported for tests
  templateContent,
  templateSlogans,
  templateAgentAct,
};
