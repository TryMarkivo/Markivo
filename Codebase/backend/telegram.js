// Telegram Bot API client (no SDK — plain HTTPS via global fetch).
//
// Design note: Telegram has NO API for creating bots — only @BotFather can do
// that, manually. So Markivo's flow is: the owner creates a bot in BotFather
// (~60 seconds, guided in the UI), pastes the token, and from that point on
// everything is automated — Markivo brands the bot with the business details,
// detects the channel/group the owner adds it to, and publishes posts to it.

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.telegram.org';

class TelegramError extends Error {
  constructor(method, description, code) {
    super(`Telegram ${method} failed: ${description}`);
    this.method = method;
    this.code = code;
    this.description = description;
  }
}

async function call(token, method, params = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (err) {
    throw new TelegramError(method, `network error (${err.message})`, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new TelegramError(method, data.description || `HTTP ${res.status}`, data.error_code || res.status);
  }
  return data.result;
}

// Same as call(), but uploads one file as multipart form data. Used when the
// photo/video lives only on this server (no public URL Telegram could fetch).
async function callWithFile(token, method, params, field, filePath) {
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    throw new TelegramError(method, `media file unreadable (${err.message})`, 0);
  }
  form.append(field, new Blob([bytes]), path.basename(filePath));
  let res;
  try {
    res = await fetch(`${API_BASE}/bot${token}/${method}`, { method: 'POST', body: form });
  } catch (err) {
    throw new TelegramError(method, `network error (${err.message})`, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new TelegramError(method, data.description || `HTTP ${res.status}`, data.error_code || res.status);
  }
  return data.result;
}

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{30,}$/;
const isValidTokenFormat = (token) => TOKEN_RE.test(String(token || '').trim());

const getMe = (token) => call(token, 'getMe');

/**
 * Brand a freshly created bot with the business identity. Each setting is
 * best-effort: Telegram rate-limits some of these (setMyName especially), so
 * a failure on one must not abort the rest.
 */
async function configureBot(token, profile) {
  const results = {};
  const attempts = [
    ['name', 'setMyName', { name: `${profile.businessName} Assistant`.slice(0, 64) }],
    ['description', 'setMyDescription', {
      description:
        `Official assistant bot of ${profile.businessName}` +
        (profile.category ? ` — ${profile.category}` : '') +
        (profile.location ? `. ${profile.location}` : '') +
        '. Powered by Markivo.',
    }],
    ['shortDescription', 'setMyShortDescription', {
      short_description: (profile.slogan || `${profile.businessName} — powered by Markivo`).slice(0, 120),
    }],
    ['commands', 'setMyCommands', {
      commands: [
        { command: 'start', description: `Welcome to ${profile.businessName}`.slice(0, 256) },
        { command: 'help', description: 'How to reach us' },
      ],
    }],
  ];

  for (const [key, method, params] of attempts) {
    try {
      await call(token, method, params);
      results[key] = true;
    } catch (err) {
      results[key] = false;
      console.warn(`Telegram branding step ${method} skipped: ${err.description || err.message}`);
    }
  }
  return results;
}

const getChat = (token, chatId) => call(token, 'getChat', { chat_id: chatId });

const getChatMember = (token, chatId, userId) =>
  call(token, 'getChatMember', { chat_id: chatId, user_id: userId });

/**
 * Auto-detect the channel/group the owner just added the bot to, by scanning
 * recent updates for my_chat_member events. Returns null when nothing found.
 */
async function detectChat(token, botUserId) {
  const updates = await call(token, 'getUpdates', {
    allowed_updates: ['my_chat_member', 'message', 'channel_post'],
    limit: 100,
  });

  for (let i = updates.length - 1; i >= 0; i--) {
    const u = updates[i];
    const mcm = u.my_chat_member;
    if (
      mcm &&
      mcm.new_chat_member &&
      mcm.new_chat_member.user?.id === botUserId &&
      ['administrator', 'member', 'creator'].includes(mcm.new_chat_member.status) &&
      ['channel', 'group', 'supergroup'].includes(mcm.chat?.type)
    ) {
      return { chatId: String(mcm.chat.id), chatTitle: mcm.chat.title || mcm.chat.username, chatType: mcm.chat.type };
    }
    const post = u.channel_post || u.message;
    if (post && ['channel', 'group', 'supergroup'].includes(post.chat?.type)) {
      return { chatId: String(post.chat.id), chatTitle: post.chat.title || post.chat.username, chatType: post.chat.type };
    }
  }
  return null;
}

/**
 * Verify the bot can actually post to the chat. Channels require admin with
 * post rights; groups only require membership.
 */
async function verifyPostAccess(token, chatId, botUserId) {
  const chat = await getChat(token, chatId);
  const member = await getChatMember(token, chat.id, botUserId);
  const isChannel = chat.type === 'channel';
  const canPost =
    member.status === 'creator' ||
    (member.status === 'administrator' && (!isChannel || member.can_post_messages !== false)) ||
    (!isChannel && member.status === 'member');

  if (!canPost) {
    throw new TelegramError(
      'verifyPostAccess',
      isChannel
        ? 'The bot must be an administrator with "Post messages" permission in this channel.'
        : 'The bot must be a member of this group.',
      403
    );
  }
  return { chatId: String(chat.id), chatTitle: chat.title || chat.username, chatType: chat.type, chatUsername: chat.username || null };
}

const sendMessage = (token, chatId, text) =>
  call(token, 'sendMessage', { chat_id: chatId, text });

// Media is either a public URL Telegram fetches itself, or { path } to a file
// on this server, which is uploaded directly. The upload means photo posts
// work even where the server has no public address.
const sendMedia = (method, field) => (token, chatId, media, caption) => (
  media && typeof media === 'object' && media.path
    ? callWithFile(token, method, { chat_id: chatId, caption }, field, media.path)
    : call(token, method, { chat_id: chatId, [field]: media, caption })
);
const sendPhoto = sendMedia('sendPhoto', 'photo');
const sendVideo = sendMedia('sendVideo', 'video');

// Captions are capped at 1024 characters while a plain message allows 4096.
// Rather than truncate the owner's copy, a long post is sent as media first and
// the full text second — both land in the channel, nothing is lost.
const CAPTION_MAX = 1024;

/**
 * Publish one post, with or without media. Returns the Telegram message that
 * carries the text, so callers keep a single message id to record.
 */
async function sendPost(token, chatId, text, media) {
  if (!media || (!media.url && !media.path)) return sendMessage(token, chatId, text);
  const send = media.kind === 'video' ? sendVideo : sendPhoto;
  const source = media.url || { path: media.path };
  if (text.length <= CAPTION_MAX) return send(token, chatId, source, text);
  await send(token, chatId, source, '');
  return sendMessage(token, chatId, text);
}

// Live subscriber/member count for the linked chat (dashboard metric).
const getChatMemberCount = (token, chatId) =>
  call(token, 'getChatMemberCount', { chat_id: chatId });

module.exports = {
  TelegramError,
  isValidTokenFormat,
  getMe,
  configureBot,
  getChat,
  getChatMember,
  detectChat,
  verifyPostAccess,
  sendMessage,
  sendPhoto,
  sendVideo,
  sendPost,
  getChatMemberCount,
};
