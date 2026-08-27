// Parses a Telegram Desktop "Export chat history" file into a plain-text
// sample usable by /api/styles/analyze — lets an owner clone a competitor's
// voice straight from an exported channel instead of hand-pasting messages.
// Pure regex/JSON extraction, no AI, no new dependency — same philosophy as
// the fetchers in competitorFetch.js.
//
// Telegram offers two export formats:
//   - JSON (result.json): { messages: [ { type, text, ... }, ... ] }, where
//     `text` is either a plain string or an array mixing plain strings and
//     { type, text } "entity" runs (bold/italic/link/etc.) that need flattening.
//   - HTML (messages.html / messages2.html / ...): a styled page where each
//     message body's text lives in a `<div class="text">...</div>` block,
//     possibly with nested formatting tags to strip.

const SAMPLE_CHAR_CAP = 2000;
const MAX_MESSAGES_CONSIDERED = 400;

const ENTITY_MAP = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

function decodeEntities(s) {
  return String(s || '').replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITY_MAP[m] || m);
}

const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, '')).trim();

// A JSON export's `text` field is a string, or an array of strings / entity
// objects ({ type, text }) — flatten either shape into plain text.
function flattenText(text) {
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) {
    return text.map((part) => (typeof part === 'string' ? part : String(part?.text || ''))).join('');
  }
  return '';
}

function parseJsonExport(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('That file is not valid JSON — export it again from Telegram Desktop and try the new file.');
  }
  const messages = Array.isArray(data.messages) ? data.messages : [];
  if (!messages.length) throw new Error('No messages found in that export.');

  const texts = messages
    .slice(-MAX_MESSAGES_CONSIDERED)
    .map((m) => flattenText(m.text).trim())
    .filter((t) => t.length >= 8); // skip near-empty/media-only messages

  return { texts, messageCount: messages.length };
}

function parseHtmlExport(content) {
  const blocks = [...String(content || '').matchAll(/<div class="text">([\s\S]*?)<\/div>/g)];
  if (!blocks.length) throw new Error('No message text found in that export — is this a Telegram "messages.html" file?');

  const texts = blocks
    .slice(0, MAX_MESSAGES_CONSIDERED)
    .map((m) => stripTags(m[1]))
    .filter((t) => t.length >= 8);

  return { texts, messageCount: blocks.length };
}

// Join the longest handful of messages (the most representative of an actual
// writing voice) up to the same 2000-char cap /api/styles/analyze enforces.
function joinSample(texts) {
  const ranked = [...texts].sort((a, b) => b.length - a.length).slice(0, 8);
  let out = '';
  for (const t of ranked) {
    const next = out ? `${out}\n\n${t}` : t;
    if (next.length > SAMPLE_CHAR_CAP) break;
    out = next;
  }
  return out || ranked[0]?.slice(0, SAMPLE_CHAR_CAP) || '';
}

function parseTelegramExport({ format, content }) {
  const fmt = String(format || '').toLowerCase();
  const { texts, messageCount } = fmt === 'json' ? parseJsonExport(content) : parseHtmlExport(content);
  if (!texts.length) throw new Error('That export has no usable text messages to learn a style from.');
  return { sample: joinSample(texts), messageCount };
}

module.exports = { parseTelegramExport };
