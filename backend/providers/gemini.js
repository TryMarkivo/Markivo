const config = require('../config');

/**
 * Gemini (Google) provider — Markivo's SECOND model.
 *
 * Role split: Claude does strategy / brand voice / copy / critique; Gemini does
 * grounded local-market research, trends, and seasonal hooks that feed the
 * marketing pipeline's strategy step.
 *
 * KEYLESS-SAFE by design (mirrors backend/ai.js + places.js): with no
 * GEMINI_API_KEY — or if the @google/generative-ai package isn't installed —
 * every export degrades to a no-op (returns null), so callers transparently
 * fall back to Claude or a template. A blank key NEVER breaks the app or tests.
 */

// Lazily construct the client only when a key is present AND the SDK is
// installed. A missing package in keyless mode is fine; in live mode we log
// once and stay disabled rather than crash.
let client = null;
let disabledReason = null;

if (config.geminiEnabled) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    client = new GoogleGenerativeAI(config.geminiApiKey);
  } catch (err) {
    disabledReason = err.message;
    console.warn(
      '⚠️  GEMINI_API_KEY is set but the Gemini SDK is unavailable — research ' +
      'features fall back to Claude. Run `npm i @google/generative-ai` to enable. ' +
      `(${err.message})`
    );
  }
}

const isLive = !!client;

/**
 * Generate plain text from Gemini. Returns the text, or null on keyless mode
 * or any failure (so the caller falls back). Never throws.
 *
 * @param {object}  opts
 * @param {string}  opts.system     System instruction.
 * @param {string}  opts.prompt     User prompt.
 * @param {number} [opts.maxTokens] Output cap.
 * @param {number} [opts.temperature]
 */
async function generateText({ system, prompt, maxTokens = 1024, temperature = 0.7 } = {}) {
  if (!client) return null;
  try {
    const model = client.getGenerativeModel({
      model: config.geminiModel,
      systemInstruction: system || undefined,
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    });
    const result = await model.generateContent(prompt || '');
    const text = result?.response?.text?.();
    return text && text.trim() ? text.trim() : null;
  } catch (err) {
    console.error('Gemini generateText failed, falling back:', err.message);
    return null;
  }
}

module.exports = { isLive, disabledReason, generateText };
