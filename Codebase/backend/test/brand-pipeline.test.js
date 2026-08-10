const { test } = require('node:test');
const assert = require('node:assert');

// Force keyless mode BEFORE requiring anything that reads config (config caches
// env at load). '' is "defined", so dotenv will NOT override it → deterministic
// template paths, no network. This pins the brand engine's keyless behaviour and
// the critic's structural fixes (no-fabrication guard, both-shape digest).
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';

const brand = require('../brand');
const ai = require('../ai');
const frameworks = require('../marketing/frameworks');
const rubric = require('../marketing/rubric');
const exemplars = require('../marketing/exemplars');
const prompts = require('../marketing/prompts');

const PROFILE = {
  businessName: 'Chashka Coffee',
  category: 'Coffee Shop',
  brandTone: 'Cozy & Warm',
  description: 'A tiny single-origin espresso bar in Chilonzor',
  targetAudience: 'young professionals',
  location: 'Tashkent',
};

test('marketing knowledge modules load with the expected surface', () => {
  assert.ok(frameworks.rulesFor('instagram'), 'instagram platform rules present');
  assert.ok(frameworks.rulesFor('google_business'), 'google_business rules present');
  assert.ok(Array.isArray(rubric.dimensions) && rubric.dimensions.length >= 5);
  assert.ok(Array.isArray(rubric.bannedCliches) && rubric.bannedCliches.length >= 20);
  assert.ok(exemplars.forPlatform('tiktok'), 'tiktok exemplars present');
  assert.ok(prompts.pipeline.strategySystemPrompt && prompts.pipeline.draftSystemPrompt);
  assert.ok(prompts.pipeline.agentSystemPrompt.length > 200);
});

test('templateBrief personalises ${placeholders} to the business', () => {
  const b = brand.templateBrief(PROFILE);
  assert.ok(b.positioning.includes('Chashka Coffee'), 'name substituted into positioning');
  assert.ok(!/\$\{/.test(JSON.stringify(b)), 'no leftover ${} placeholders anywhere');
  for (const k of ['positioning', 'valueProposition', 'usp', 'voiceDo', 'voiceDont', 'tagline']) {
    assert.ok(b[k], `template brief has ${k}`);
  }
});

test('generateBrandBrief returns the template brief in keyless mode', async () => {
  const b = await brand.generateBrandBrief(PROFILE);
  assert.ok(b && typeof b === 'object');
  assert.ok(b.positioning.includes('Chashka Coffee'));
});

test('briefDigest falls back to the profile and always guards against fabrication', () => {
  const d = brand.briefDigest(null, PROFILE);
  assert.ok(d.includes('Chashka Coffee'));
  assert.match(d, /never invent/i);
});

test('briefDigest renders the flat (template) brief with a FACTS guard', () => {
  const d = brand.briefDigest(brand.templateBrief(PROFILE), PROFILE);
  assert.match(d, /Positioning:/);
  assert.match(d, /Voice:/);
  assert.match(d, /FACTS: none provided/i);
});

test('briefDigest tolerates the rich (object) brief shape without crashing', () => {
  const rich = {
    positioning: 'X', valueProposition: 'Y', usp: ['a', 'b'], archetype: 'Everyman',
    voiceAdjectives: ['warm'], voiceDo: ['do'], voiceDont: ["don't"],
    persona: { name: 'The Local', context: 'morning commute', motivations: 'reliable coffee', objections: 'might be slow' },
    contentPillars: [{ name: 'The Signature', purpose: 'awareness' }],
    visualDirection: { palette: ['#111'], imageryStyle: 'phone photos in window light' },
  };
  const d = brand.briefDigest(rich, PROFILE);
  assert.match(d, /Persona: The Local/);
  assert.match(d, /Content pillars: The Signature/);
  assert.match(d, /Imagery: phone photos/);
});

test("briefDigest always includes the owner's onboarding words, even with a rich brief", () => {
  const rich = { positioning: 'X', valueProposition: 'Y', usp: ['a'] };
  const d = brand.briefDigest(rich, PROFILE);
  assert.match(d, /Owner's own words \(from onboarding\)/);
  assert.match(d, /single-origin espresso bar in Chilonzor/);
});

test('briefDigest surfaces owner-entered businessFacts as the only number source', () => {
  const b = brand.templateBrief(PROFILE);
  b.businessFacts = { signatureItems: ['cardamom bun'], hours: '8-20 daily', offer: { type: 'discount', value: '20%', deadline: 'Fri' } };
  const d = brand.briefDigest(b, PROFILE);
  assert.match(d, /use ONLY these/i);
  assert.match(d, /cardamom bun/);
  assert.match(d, /20%/);
});

test('rubric.hasCliche flags banned filler and clears clean copy', () => {
  assert.equal(rubric.hasCliche('We have prepared something special for you'), true);
  assert.equal(rubric.hasCliche('Cardamom buns, pulled at 8am sharp in Chilonzor.'), false);
});

test('generateContent keeps its keyless template shape', async () => {
  const out = await ai.generateContent({ platform: 'instagram', topic: 'weekend offer', ...PROFILE });
  assert.ok(out.post && typeof out.post === 'string');
  assert.ok(typeof out.mediaTip === 'string');
  assert.ok(Array.isArray(out.hashtags));
});
