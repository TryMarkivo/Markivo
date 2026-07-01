const { test } = require('node:test');
const assert = require('node:assert');

// No ANTHROPIC_API_KEY in the test env → the AI layer runs in fallback mode.
const ai = require('../ai');

test('AI layer is disabled without an API key', () => {
  assert.strictEqual(ai.enabled, false);
});

test('generateContent falls back to an English-first template', async () => {
  const out = await ai.generateContent({ platform: 'instagram', topic: 'weekend discount', businessName: 'Noir Cafe' });
  assert.ok(typeof out.post === 'string' && out.post.length > 0);
  assert.ok(typeof out.mediaTip === 'string' && out.mediaTip.length > 0);
  assert.ok(Array.isArray(out.hashtags));
  // English-only by default — no Uzbek/Russian language markers.
  assert.doesNotMatch(out.post, /🇺🇿|🇷🇺/);
});

test('generateContent adds uz/ru lines when those languages are requested', async () => {
  const out = await ai.generateContent({ platform: 'instagram', businessName: 'Noir', languages: ['en', 'uz', 'ru'] });
  assert.match(out.post, /🇺🇿/);
  assert.match(out.post, /🇷🇺/);
});

test('generateContent defaults unknown platforms to instagram', async () => {
  const out = await ai.generateContent({ platform: 'unknown-net', businessName: 'X' });
  assert.ok(out.post.length > 0);
});

test('generateSlogans returns exactly 3 slogans', async () => {
  const slogans = await ai.generateSlogans({ businessName: 'Noir', category: 'Cafe', tone: 'Modern & Minimalist' });
  assert.strictEqual(slogans.length, 3);
  slogans.forEach((s) => assert.ok(typeof s === 'string' && s.length > 0));
});

test('agentAct replies in plain-chat mode', async () => {
  const action = await ai.agentAct({
    query: 'how are my competitors doing?',
    profile: { businessName: 'Noir', brandTone: 'Cozy & Warm' },
    telegram: { connected: false },
  });
  assert.strictEqual(action.type, 'reply');
  assert.ok(action.reply.length > 0);
});

test('agentAct proposes a telegram post when connected and asked to publish', async () => {
  const action = await ai.agentAct({
    query: 'Post our weekend discount to my telegram channel',
    profile: { businessName: 'Noir', brandTone: 'Cozy & Warm' },
    telegram: { connected: true, chatTitle: 'Noir News' },
  });
  assert.strictEqual(action.type, 'telegram_post');
  assert.ok(action.text.length > 0);
});

test('agentAct explains how to connect when telegram is not connected', async () => {
  const action = await ai.agentAct({
    query: 'Publish an announcement to telegram',
    profile: { businessName: 'Noir' },
    telegram: { connected: false },
  });
  assert.strictEqual(action.type, 'reply');
  assert.match(action.reply, /connect/i);
});
