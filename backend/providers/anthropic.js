const config = require('../config');

/**
 * Anthropic (Claude) provider — Markivo's primary model: strategy, brand voice,
 * copywriting, and quality critique.
 *
 * Keyless-safe: with no ANTHROPIC_API_KEY the client is null and every helper
 * returns null, so callers fall back to templates. A blank key never throws.
 *
 * This is the single place the Anthropic SDK is constructed; ai.js and brand.js
 * share this one client.
 */
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

/**
 * Structured JSON completion. Returns the parsed object, or null in keyless
 * mode. Throws on API/parse failure (callers catch and fall back to templates).
 */
async function completeJSON({ model, system, prompt, schema, maxTokens = 1200, temperature } = {}) {
  if (!client) return null;
  const req = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: { type: 'json_schema', schema } },
  };
  if (temperature != null) req.temperature = temperature;
  const msg = await client.messages.create(req);
  return JSON.parse(textOf(msg));
}

/** Plain-text completion. Returns trimmed text, or null (keyless/empty). */
async function completeText({ model, system, prompt, maxTokens = 800, temperature } = {}) {
  if (!client) return null;
  const req = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] };
  if (temperature != null) req.temperature = temperature;
  const msg = await client.messages.create(req);
  const t = textOf(msg);
  return t || null;
}

module.exports = { client, isLive: !!client, textOf, completeJSON, completeText };
