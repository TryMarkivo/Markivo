// Telegram adapter — wraps the existing, battle-tested Telegram integration
// (backend/telegram.js client + db.telegram store) in the uniform connector
// contract. Telegram is special: it has no OAuth and no API to create bots, so
// connecting still happens through the dedicated /api/telegram/* routes
// (BotFather token paste + channel detection). This adapter therefore exposes
// status / publish / disconnect for the registry, and reports getAuthUrl=null.

const config = require('../config');
const tg = require('../telegram');
const { ConnectorError, connected, notConnected } = require('./base');

const adapter = {
  key: 'telegram',
  label: 'Telegram',
  group: 'telegram',

  // Owner-facing connect guidance, surfaced through /api/connect/status so the
  // dashboard can explain HOW to connect each platform without hardcoding
  // per-platform copy in the frontend.
  authType: 'token',
  docsUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
  requirements: ['A Telegram account', 'A channel or group where your bot is an admin'],
  howToConnect: [
    'Open Telegram and start a chat with @BotFather.',
    'Send /newbot and follow the prompts to name your bot.',
    'Copy the bot token BotFather gives you and paste it here.',
    'Add the bot as an ADMIN of your channel or group.',
    'Post any message in that channel, then press "Detect channel".',
  ],

  // "Live" = the feature flag is on. Telegram uses per-business bot tokens
  // rather than a platform-wide OAuth credential, so there is no sandbox key.
  isLive: () => config.telegramEnabled,

  // Telegram is not OAuth — connection is handled by the Telegram card UI.
  getAuthUrl: () => null,

  handleCallback() {
    throw new ConnectorError('telegram', 'Telegram connects via the Telegram card (BotFather token), not OAuth.', 400);
  },

  async status({ db, profile }) {
    if (!config.telegramEnabled) return notConnected(adapter, { comingSoon: true });
    const conn = db.telegram.findByProfile(profile.id);
    if (!conn) return notConnected(adapter);
    return connected(adapter, {
      accountHandle: conn.botUsername ? `@${conn.botUsername}` : null,
      botName: conn.botName,
      chat: conn.chatId ? { chatId: conn.chatId, chatTitle: conn.chatTitle, chatType: conn.chatType } : null,
      ready: !!conn.chatId,
    });
  },

  // Send via the Bot API. Calendar bookkeeping is the caller's job (the generic
  // executor / worker), so this method only performs the platform action.
  async publish({ db, profile, text }) {
    if (!config.telegramEnabled) throw new ConnectorError('telegram', 'Telegram publishing is not enabled in this version.', 503);
    const conn = db.telegram.findByProfile(profile.id);
    if (!conn) throw new ConnectorError('telegram', 'Telegram is not connected.', 400);
    if (!conn.chatId) throw new ConnectorError('telegram', 'No channel or group linked yet — finish the Telegram setup on your dashboard.', 400);
    const sent = await tg.sendMessage(conn.botToken, conn.chatId, text);
    return { simulated: false, platform: 'telegram', externalId: sent.message_id, target: conn.chatTitle || conn.chatId };
  },

  async disconnect({ db, profile }) {
    db.telegram.remove(profile.id);
    db.platforms.setConnected(profile.id, 'telegram', null, false);
  },

  async metrics({ db, profile }) {
    const conn = config.telegramEnabled ? db.telegram.findByProfile(profile.id) : null;
    if (!conn || !conn.chatId) return null;
    try {
      return { subscribers: await tg.getChatMemberCount(conn.botToken, conn.chatId) };
    } catch {
      return null;
    }
  },
};

module.exports = adapter;
