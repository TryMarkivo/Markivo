const { test } = require('node:test');
const assert = require('node:assert');

// Pin a FAKE Gemini key and NO Anthropic key BEFORE requiring anything (config
// reads env at load) — this suite specifically exercises the Gemini path of
// ai.js's provider dispatcher (providers/textEngine.js), which only every
// other test file deliberately avoids (they all pin GEMINI_API_KEY='').
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = 'fake_test_key_123';

const gemini = require('../gemini');
const ai = require('../ai');

const realFetch = global.fetch;
// Every test sets its own mock and restores the real fetch afterward so no
// stray mock leaks into another test file's require cache (gemini.js reads
// config.geminiApiKey once, but `fetch` is looked up fresh on each call).
const withMockFetch = async (impl, fn) => {
  global.fetch = impl;
  try {
    await fn();
  } finally {
    global.fetch = realFetch;
  }
};

// A completed Interaction whose answer is `payload` as JSON text.
const geminiJsonRes = (payload) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(payload) }] }],
  }),
});

// ---------------------------------------------------------------------------
// toJsonSchema — pure conversion, no network
// ---------------------------------------------------------------------------

test('toJsonSchema normalises both schema dialects into plain JSON Schema', () => {
  const lowercase = {
    type: 'object',
    properties: {
      analysis: { type: 'string' },
      posts: {
        type: 'array',
        items: {
          type: 'object',
          properties: { platform: { type: 'string' }, text: { type: 'string' } },
          required: ['platform', 'text'],
          additionalProperties: false,
        },
      },
    },
    required: ['analysis', 'posts'],
    additionalProperties: false,
  };
  const out = gemini.toJsonSchema(lowercase);
  assert.strictEqual(out.type, 'object');
  assert.strictEqual(out.additionalProperties, undefined);
  assert.deepStrictEqual(Object.keys(out.properties), ['analysis', 'posts'], 'key order carries field order');
  assert.strictEqual(out.properties.posts.type, 'array');
  assert.deepStrictEqual(out.properties.posts.items.required, ['platform', 'text']);

  // The OpenAPI-subset constants in gemini.js come out identical.
  const upper = gemini.toJsonSchema({
    type: 'OBJECT',
    properties: { kind: { type: 'STRING', enum: ['a', 'b'] }, tags: { type: 'ARRAY', items: { type: 'STRING' } } },
    required: ['kind'],
    propertyOrdering: ['kind', 'tags'],
  });
  assert.deepStrictEqual(upper, {
    type: 'object',
    properties: { kind: { type: 'string', enum: ['a', 'b'] }, tags: { type: 'array', items: { type: 'string' } } },
    required: ['kind'],
  });
});

// ---------------------------------------------------------------------------
// Single-turn JSON completions via providers/textEngine.js -> gemini.js
// ---------------------------------------------------------------------------

test('analyzeAndPlan uses Gemini (not the template) when only a Gemini key is configured', async () => {
  await withMockFetch(
    geminiJsonRes({ analysis: 'Gemini-generated analysis text', posts: [{ platform: 'meta_instagram', topic: 'promo', text: 'Real gemini post text' }] }),
    async () => {
      const result = await ai.analyzeAndPlan({
        platforms: ['meta_instagram'], businessName: 'Noir Cafe', category: 'Cafe',
        recentPosts: [], competitors: [], ownExternalActivity: [], competitorHighlights: [],
      });
      assert.strictEqual(result.analysis, 'Gemini-generated analysis text');
      assert.strictEqual(result.posts[0].text, 'Real gemini post text');
    }
  );
});

test('analyzeCompetitorTrends uses Gemini for the narrative when real competitor data exists', async () => {
  await withMockFetch(
    geminiJsonRes({ analysis: 'Gemini competitor narrative', themes: ['Video is trending'], recommendation: 'Post a video' }),
    async () => {
      const result = await ai.analyzeCompetitorTrends({
        businessName: 'Noir Cafe',
        competitorStats: [{ competitorName: 'Rival Cafe', postCount: 5, postsPerWeek: 3, videoSharePercent: 40 }],
        sampleCaptions: [],
      });
      assert.strictEqual(result.analysis, 'Gemini competitor narrative');
      assert.deepStrictEqual(result.themes, ['Video is trending']);
    }
  );
});

test('generateSlogans, generateEditPlan, and generateLogos all route through the same Gemini dispatch path', async () => {
  await withMockFetch(geminiJsonRes({ slogans: ['Gemini slogan one', 'Gemini slogan two', 'Gemini slogan three'] }), async () => {
    const slogans = await ai.generateSlogans({ businessName: 'Noir', category: 'Cafe', tone: 'Modern & Minimalist' });
    assert.deepStrictEqual(slogans, ['Gemini slogan one', 'Gemini slogan two', 'Gemini slogan three']);
  });

  await withMockFetch(geminiJsonRes({
    steps: ['Trim', 'Color grade'], crop: '9:16', colorGrade: 'warm', captions: 'burned-in', audio: 'upbeat',
    exportSpec: { instagram: '1080x1920', telegram: '1080x1920', googleBusiness: '1080x1080' },
  }), async () => {
    const plan = await ai.generateEditPlan({ instructions: 'make it punchier', media: { kind: 'video', topic: 'latte art' }, profile: { businessName: 'Noir' } });
    assert.deepStrictEqual(plan.steps, ['Trim', 'Color grade']);
    assert.strictEqual(plan.engineStatus, 'awaiting_media_api');
  });

  await withMockFetch(geminiJsonRes({
    logos: [{ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><circle r="10"/></svg>', style: 'Circle monogram', palette: { bg: '#fff', fg: '#000', accent: '#f00' } }],
  }), async () => {
    const logos = await ai.generateLogos({ businessName: 'Noir', category: 'Cafe', tone: 'Modern & Minimalist' });
    assert.strictEqual(logos.length, 4); // always exactly 4 — unfilled slots keep the deterministic fallback
    assert.strictEqual(logos[0].style, 'Circle monogram');
  });
});

// ---------------------------------------------------------------------------
// agentAct via the Interactions API's function-calling steps. Stateless calls
// must echo the model's thought + function_call steps back exactly as
// received — the thought signature is what the API validates.
// ---------------------------------------------------------------------------

test('agentAct (Gemini) short-circuits immediately on a post_to_telegram function call', async () => {
  let calls = 0;
  await withMockFetch(async () => {
    calls += 1;
    return {
      ok: true, status: 200,
      json: async () => ({
        status: 'requires_action',
        steps: [
          { type: 'thought', signature: 'sig123' },
          { type: 'function_call', id: 'call_1', name: 'post_to_telegram', arguments: { text: 'Weekend discount is live!', note: 'drafted' } },
        ],
      }),
    };
  }, async () => {
    const action = await ai.agentAct({
      query: 'Post our weekend discount to my telegram channel',
      profile: { businessName: 'Noir', brandTone: 'Cozy & Warm' },
      telegram: { connected: true, chatTitle: 'Noir News' },
    });
    assert.strictEqual(action.type, 'telegram_post');
    assert.strictEqual(action.text, 'Weekend discount is live!');
    assert.strictEqual(calls, 1, 'post_to_telegram must exit on the first call, never loop further');
  });
});

test('agentAct (Gemini) runs a generic tool call then returns the final text reply', async () => {
  const bodies = [];
  const modelSteps = [
    { type: 'thought', signature: 'sig456' },
    { type: 'function_call', id: 'call_2', name: 'get_business_snapshot', arguments: {} },
  ];
  await withMockFetch(async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    if (bodies.length === 1) {
      return { ok: true, status: 200, json: async () => ({ status: 'requires_action', steps: modelSteps }) };
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        status: 'completed',
        steps: [
          { type: 'thought', summary: [{ type: 'text', text: 'reading the snapshot' }] },
          { type: 'model_output', content: [{ type: 'text', text: 'You have 2 competitors tracked.' }] },
        ],
      }),
    };
  }, async () => {
    const action = await ai.agentAct({
      query: 'how are my competitors doing?',
      profile: { businessName: 'Noir', brandTone: 'Cozy & Warm' },
      telegram: { connected: false },
      snapshot: { stats: { competitorCount: 2 } },
    });
    assert.strictEqual(action.type, 'reply');
    assert.strictEqual(action.reply, 'You have 2 competitors tracked.', 'thought summaries are not part of the reply');
    assert.strictEqual(bodies.length, 2, 'expected one tool-call round-trip then a final text turn');
  });

  const [first, second] = bodies;
  assert.strictEqual(first.store, false, 'stateless: history lives in our DB, not Google\'s');
  assert.deepStrictEqual(first.input, [{ type: 'user_input', content: [{ type: 'text', text: 'how are my competitors doing?' }] }]);
  assert.ok(first.tools.some((t) => t.type === 'function' && t.name === 'get_business_snapshot'));

  // Turn 2 = turn 1's input + the model's steps verbatim + the tool's result.
  assert.deepStrictEqual(second.input.slice(0, 3), [...first.input, ...modelSteps]);
  const result = second.input[3];
  assert.strictEqual(result.type, 'function_result');
  assert.strictEqual(result.call_id, 'call_2');
  assert.strictEqual(result.name, 'get_business_snapshot');
  assert.deepStrictEqual(JSON.parse(result.result[0].text), { stats: { competitorCount: 2 } });
});
