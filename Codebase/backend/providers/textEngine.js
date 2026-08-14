const config = require('../config');
const anthropic = require('./anthropic');
const gemini = require('../gemini');

/**
 * Unified single-turn JSON-completion dispatcher for ai.js — provider order:
 * Gemini -> Anthropic -> null (keyless). Named after config.textEngine, which
 * already tracks this same preference for the codebase's other AI paths
 * (generateContent, generateMediaBrief).
 *
 * Contract matches providers/anthropic.js#completeJSON: null only when NEITHER
 * provider is configured; throws (after trying both) on an actual API
 * failure, so callers' existing try/catch -> template fallback is unchanged.
 */
const isLive = config.geminiEnabled || anthropic.isLive;

async function completeJSON({ model, system, prompt, schema, maxTokens, temperature } = {}) {
  if (config.geminiEnabled) {
    try {
      return await gemini.callGeminiJSON({ system, prompt, schema, maxTokens, temperature });
    } catch (err) {
      console.warn('Gemini completeJSON failed, falling back to Anthropic:', err.message);
    }
  }
  return anthropic.completeJSON({ model, system, prompt, schema, maxTokens, temperature });
}

module.exports = { isLive, completeJSON };
