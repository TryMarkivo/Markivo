// Telegram Bot API client (no SDK — plain HTTPS via global fetch).
//
// Design note: Telegram has NO API for creating bots — only @BotFather can do
// that, manually. So Markivo's flow is: the owner creates a bot in BotFather
// (~60 seconds, guided in the UI), pastes the token, and from that point on
// everything is automated — Markivo brands the bot with the business details,
// detects the channel/group the owner adds it to, and publishes posts to it.

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
  return { chatId: String(chat.id), chatTitle: chat.title || chat.username, chatType: chat.type };
}

const sendMessage = (token, chatId, text) =>
  call(token, 'sendMessage', { chat_id: chatId, text });

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
  getChatMemberCount,
};
