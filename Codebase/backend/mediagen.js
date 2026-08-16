const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./config');

// ===========================================================================
// Media generation engine — Gemini for images, Veo for video.
//
// Both ride the same GEMINI_API_KEY as the text engines: one credential, one
// bill, one failure mode.
//
// Mirrors the ai.js / places.js keyless pattern — except rendering has no
// honest offline fallback (a fabricated image would be a lie), so keyless mode
// throws MediaEngineError(501) and the route surfaces "engine pending".
//
// The two media types have fundamentally different shapes and that is reflected
// here rather than hidden:
//   image — one synchronous call, seconds, ~$0.03. renderImage/editImage return
//           a saved file.
//   video — a long-running operation, minutes, ~$0.30. startVideo returns a
//           handle, pollVideo reports progress, downloadVideo saves the result.
//           Pretending this is synchronous would mean holding an HTTP request
//           open for minutes.
// ===========================================================================

const API_HOST = 'https://generativelanguage.googleapis.com/v1beta';
const UPLOADS_DIR = path.join(__dirname, 'uploads');

class MediaEngineError extends Error {
  constructor(status, message) {
    super(message || `Media engine request failed (${status})`);
    this.name = 'MediaEngineError';
    this.status = status;
  }
}

const isLive = () => !!config.geminiApiKey;

const requireKey = () => {
  if (!config.geminiApiKey) {
    throw new MediaEngineError(501, 'Media engine pending — add GEMINI_API_KEY');
  }
};

const EXT_FOR_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

/** Persist bytes under uploads/ and return the public URL path. */
function save(buf, mime, fallbackExt) {
  if (!buf || !buf.length) throw new MediaEngineError(502, 'Media engine returned an empty file');
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const file = `${crypto.randomUUID()}.${EXT_FOR_MIME[mime] || fallbackExt}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, file), buf);
  return { filePath: `/uploads/${file}` };
}

/**
 * One JSON call to the Gemini media API, with the upstream failure modes
 * normalised into MediaEngineError so the route can map them to a status.
 */
async function callJson(url, { method = 'POST', body, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: {
        'x-goog-api-key': config.geminiApiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(config.mediaTimeoutMs),
    });
  } catch (err) {
    throw new MediaEngineError(502, `Media engine unreachable: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status < 200 || res.status >= 300) {
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    throw new MediaEngineError(502, `Media engine answered ${res.status}: ${msg}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// IMAGE
// ---------------------------------------------------------------------------

/**
 * Generate one image from a prompt, or EDIT `sourceImage` when supplied.
 *
 * The image API takes an `input` array, so generation and editing differ only
 * by whether an image part rides alongside the text — which is why editing gets
 * no separate transport here.
 *
 * @returns {{filePath: string}} public URL path of the saved image
 */
async function renderImage({ prompt, sourceImage, aspectRatio = '1:1' }, { fetchImpl = fetch } = {}) {
  requireKey();

  const input = [{ type: 'text', text: prompt }];
  if (sourceImage && sourceImage.data) {
    input.push({ type: 'image', mime_type: sourceImage.mimeType || 'image/png', data: sourceImage.data });
  }

  const data = await callJson(`${API_HOST}/interactions`, {
    body: {
      model: config.geminiImageModel,
      input,
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspectRatio, image_size: '1K' },
    },
    fetchImpl,
  });

  const out = data.output_image;
  if (!out || !out.data) throw new MediaEngineError(502, 'Media engine returned no image');
  return save(Buffer.from(out.data, 'base64'), out.mime_type || 'image/jpeg', 'jpg');
}

/** Apply an edit to an image already on disk. Path is a stored `file_path`. */
async function editImage({ prompt, filePath }, { fetchImpl = fetch } = {}) {
  requireKey();
  const abs = path.join(UPLOADS_DIR, path.basename(filePath || ''));
  if (!fs.existsSync(abs)) throw new MediaEngineError(404, 'The image to edit is no longer on disk');

  const ext = path.extname(abs).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return renderImage(
    { prompt, sourceImage: { data: fs.readFileSync(abs).toString('base64'), mimeType } },
    { fetchImpl }
  );
}

// ---------------------------------------------------------------------------
// VIDEO (long-running operation: submit -> poll -> download)
// ---------------------------------------------------------------------------

/**
 * Submit a video generation job. Returns the operation handle to poll.
 *
 * Duration and resolution are the cost dials — price is per SECOND, so a 6s
 * clip costs three quarters of an 8s one. Both come from config so they can be
 * tuned without a deploy.
 */
async function startVideo({ prompt }, { fetchImpl = fetch } = {}) {
  requireKey();
  const data = await callJson(
    `${API_HOST}/models/${encodeURIComponent(config.veoModel)}:predictLongRunning`,
    {
      body: {
        instances: [{ prompt }],
        parameters: {
          aspectRatio: '9:16',        // social video is vertical
          resolution: config.veoResolution,
          durationSeconds: config.veoDurationSeconds,
        },
      },
      fetchImpl,
    }
  );
  if (!data.name) throw new MediaEngineError(502, 'Media engine returned no operation handle');
  return { operationId: data.name };
}

/**
 * Check a submitted job.
 *
 * @returns {{done: boolean, uri?: string, error?: string}} — `error` is a
 *   FAILED job (terminal, refundable), distinct from a thrown MediaEngineError
 *   which means we could not ask.
 */
async function pollVideo({ operationId }, { fetchImpl = fetch } = {}) {
  requireKey();
  if (!operationId) throw new MediaEngineError(502, 'No operation to poll');

  const data = await callJson(`${API_HOST}/${operationId}`, { method: 'GET', fetchImpl });
  if (!data.done) return { done: false };
  if (data.error) return { done: true, error: data.error.message || 'Video generation failed' };

  const sample = data.response?.generateVideoResponse?.generatedSamples?.[0];
  const uri = sample && sample.video && sample.video.uri;
  if (!uri) return { done: true, error: 'Video generation finished without producing a file' };
  return { done: true, uri };
}

/** Fetch the finished video and persist it under uploads/. */
async function downloadVideo({ uri }, { fetchImpl = fetch } = {}) {
  requireKey();
  let res;
  try {
    res = await fetchImpl(uri, {
      headers: { 'x-goog-api-key': config.geminiApiKey },
      signal: AbortSignal.timeout(config.mediaTimeoutMs),
    });
  } catch (err) {
    throw new MediaEngineError(502, `Video download failed: ${err.message}`);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new MediaEngineError(502, `Video download answered ${res.status}`);
  }
  return save(Buffer.from(await res.arrayBuffer()), 'video/mp4', 'mp4');
}

module.exports = {
  renderImage,
  editImage,
  startVideo,
  pollVideo,
  downloadVideo,
  isLive,
  MediaEngineError,
};
