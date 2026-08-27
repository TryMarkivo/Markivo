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

const geminiJsonRes = (payload) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
});

// ---------------------------------------------------------------------------
// toGeminiSchema — pure conversion, no network
// ---------------------------------------------------------------------------

test('toGeminiSchema converts a nested lowercase JSON schema into Gemini\'s OpenAPI-subset dialect', () => {
  const schema = {
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
  const out = gemini.toGeminiSchema(schema);
  assert.strictEqual(out.type, 'OBJECT');
  assert.strictEqual(out.additionalProperties, undefined);
  assert.deepStrictEqual(out.propertyOrdering, ['analysis', 'posts']);
  assert.strictEqual(out.properties.analysis.type, 'STRING');
  assert.strictEqual(out.properties.posts.type, 'ARRAY');
  assert.strictEqual(out.properties.posts.items.type, 'OBJECT');
  assert.deepStrictEqual(out.properties.posts.items.required, ['platform', 'text']);
  assert.strictEqual(out.properties.posts.items.properties.platform.type, 'STRING');
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
// agentAct via Gemini's function-calling wire format (verified live against
// the real API before writing this: a functionCall part carries a
// thoughtSignature that must round-trip verbatim on the next turn).
// ---------------------------------------------------------------------------

test('agentAct (Gemini) short-circuits immediately on a post_to_telegram function call', async () => {
  let calls = 0;
  await withMockFetch(async () => {
    calls += 1;
    return {
      ok: true, status: 200,
      json: async () => ({
        candidates: [{
          content: {
            role: 'model',
            parts: [{ functionCall: { name: 'post_to_telegram', args: { text: 'Weekend discount is live!', note: 'drafted' }, id: 'call_1' }, thoughtSignature: 'sig123' }],
          },
          finishReason: 'STOP',
        }],
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
  let calls = 0;
  await withMockFetch(async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true, status: 200,
        json: async () => ({
          candidates: [{
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'get_business_snapshot', args: {}, id: 'call_2' }, thoughtSignature: 'sig456' }],
            },
            finishReason: 'STOP',
          }],
        }),
      };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'You have 2 competitors tracked.' }] }, finishReason: 'STOP' }] }),
    };
  }, async () => {
    const action = await ai.agentAct({
      query: 'how are my competitors doing?',
      profile: { businessName: 'Noir', brandTone: 'Cozy & Warm' },
      telegram: { connected: false },
      snapshot: { stats: { competitorCount: 2 } },
    });
    assert.strictEqual(action.type, 'reply');
    assert.strictEqual(action.reply, 'You have 2 competitors tracked.');
    assert.strictEqual(calls, 2, 'expected one tool-call round-trip then a final text turn');
  });
});
