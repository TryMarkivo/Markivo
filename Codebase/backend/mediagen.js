const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./config');

// ===========================================================================
// Media generation engine for the Media Studio. Two interchangeable engines:
//   - fal.ai FLUX schnell, when MEDIA_API_KEY is set (takes priority — the
//     dedicated, purpose-built engine).
//   - Gemini's image-generation model, when GEMINI_API_KEY is set instead
//     (same key gemini.js already uses for copy — no separate media key
//     needed). Raw REST via global fetch, mirroring gemini.js's callGemini.
//
// Mirrors the ai.js / places.js / gemini.js keyless pattern — except
// rendering has no honest offline fallback (a fake image would be a lie), so
// fully keyless mode throws MediaEngineError(501) and the route surfaces
// "engine pending". Either engine's output is persisted under
// backend/uploads/, next to the owner's manual uploads.
// ===========================================================================

const FAL_FLUX_URL = 'https://fal.run/fal-ai/flux/schnell';
const GEMINI_API_HOST = 'https://generativelanguage.googleapis.com/v1beta';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TIMEOUT_MS = 30000;

class MediaEngineError extends Error {
  constructor(status, message) {
    super(message || `Media engine request failed (${status})`);
    this.name = 'MediaEngineError';
    this.status = status;
  }
}

const isLive = () => !!(config.mediaApiKey || config.geminiApiKey);

const saveImage = (buf, ext) => {
  if (!buf.length) throw new MediaEngineError(502, 'Media engine returned an empty image');
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const file = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), buf);
  return { filePath: `/uploads/${file}` };
};

// fal.ai FLUX schnell: one generation POST, then one download of the result.
async function renderImageFal({ prompt }, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(FAL_FLUX_URL, {
      method: 'POST',
      headers: {
        Authorization: `Key ${config.mediaApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, image_size: 'square_hd' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new MediaEngineError(502, `Media engine unreachable: ${err.message}`);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new MediaEngineError(502, `Media engine answered ${res.status}`);
  }

  const data = await res.json();
  const url = Array.isArray(data?.images) && data.images[0] && data.images[0].url;
  if (!url) throw new MediaEngineError(502, 'Media engine returned no image');

  let imgRes;
  try {
    imgRes = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new MediaEngineError(502, `Image download failed: ${err.message}`);
  }
  if (imgRes.status < 200 || imgRes.status >= 300) {
    throw new MediaEngineError(502, `Image download answered ${imgRes.status}`);
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  return saveImage(buf, 'jpg');
}

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// Gemini image-generation model via generateContent: the model returns the
// image as an inline base64 part alongside (optional) text. Same REST shape
// as gemini.js's callGemini, minus responseSchema (not used for images).
async function renderImageGemini({ prompt }, { fetchImpl = fetch } = {}) {
  const url = `${GEMINI_API_HOST}/models/${encodeURIComponent(config.geminiImageModel)}:generateContent`;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `Generate one photorealistic square image for a small-business social post: ${prompt}` }],
        }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new MediaEngineError(502, `Media engine unreachable: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status < 200 || res.status >= 300) {
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    throw new MediaEngineError(502, `Media engine answered ${res.status}: ${msg}`);
  }

  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const imgPart = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!imgPart) throw new MediaEngineError(502, 'Media engine returned no image');

  const buf = Buffer.from(imgPart.inlineData.data, 'base64');
  const ext = MIME_EXT[imgPart.inlineData.mimeType] || 'jpg';
  return saveImage(buf, ext);
}

// Generate one square image from a prompt and save it locally.
// Returns { filePath: '/uploads/<uuid>.<ext>' } (the public URL path).
async function renderImage({ prompt }, { fetchImpl = fetch } = {}) {
  if (config.mediaApiKey) return renderImageFal({ prompt }, { fetchImpl });
  if (config.geminiApiKey) return renderImageGemini({ prompt }, { fetchImpl });
  throw new MediaEngineError(501, 'Media engine pending — add MEDIA_API_KEY or GEMINI_API_KEY');
}

module.exports = { renderImage, isLive, MediaEngineError };
