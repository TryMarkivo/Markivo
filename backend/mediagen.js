const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./config');

// ===========================================================================
// Media generation engine (fal.ai FLUX schnell) for the Media Studio.
//
// Mirrors the ai.js / places.js keyless pattern — except rendering has no
// honest offline fallback (a fake image would be a lie), so keyless mode
// throws MediaEngineError(501) and the route surfaces "engine pending".
// With MEDIA_API_KEY set, renderImage performs exactly TWO upstream calls:
// one generation POST to fal.run, one download of the produced image, which
// is persisted under backend/uploads/ next to the owner's manual uploads.
// ===========================================================================

const FAL_FLUX_URL = 'https://fal.run/fal-ai/flux/schnell';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TIMEOUT_MS = 30000;

class MediaEngineError extends Error {
  constructor(status, message) {
    super(message || `Media engine request failed (${status})`);
    this.name = 'MediaEngineError';
    this.status = status;
  }
}

const isLive = () => !!config.mediaApiKey;

// Generate one square image from a prompt and save it locally.
// Returns { filePath: '/uploads/<uuid>.jpg' } (the public URL path).
async function renderImage({ prompt }, { fetchImpl = fetch } = {}) {
  if (!config.mediaApiKey) {
    throw new MediaEngineError(501, 'Media engine pending — add MEDIA_API_KEY');
  }

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

  // Download the produced image and persist it under uploads/.
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
  if (!buf.length) throw new MediaEngineError(502, 'Image download was empty');

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const file = `${crypto.randomUUID()}.jpg`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), buf);
  return { filePath: `/uploads/${file}` };
}

module.exports = { renderImage, isLive, MediaEngineError };
