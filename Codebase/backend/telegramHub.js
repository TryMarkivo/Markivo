// The shared Markivo bot (TELEGRAM_BOT_TOKEN): one bot every business can use,
// so nobody has to visit @BotFather.
//
// How a business connects:
//  1. The dashboard asks for a one-time link: t.me/<bot>?start=<code>.
//  2. The owner presses Start. That tells us which Telegram user owns this
//     Markivo profile, and the bot answers with a "Choose a channel" button.
//  3. The owner picks a channel; Telegram adds the bot there as an admin.
//     The bot checks it can post AND that this Telegram user is an admin of
//     the channel, then links the channel to the profile.
// Step 3 also works when the owner adds the bot to the channel by hand.
// The binding to a Telegram user is what stops anyone linking someone else's
// channel: a channel is only linked for the user who opened the link.
//
// The same bot also works for Autopilot once a channel is linked:
//  - every new post in the channel (the bot is an admin there, so Telegram
//    sends them) and every post the owner forwards to the bot is saved as the
//    business's own content, so Autopilot learns the channel's style even for
//    a private channel, whose history no public page shows;
//  - Autopilot sends the owner the posts waiting for their OK, with Post and
//    Skip buttons, and tells them when it needs answers (notifyOwner).
//
// Messages arrive by long polling (no public URL needed). handleUpdate() is
// separate from the loop so tests can feed it updates directly.

const crypto = require('crypto');
const tg = require('./telegram');
const config = require('./config');

const LINK_TTL_MS = 30 * 60 * 1000;
const LINKABLE = ['channel', 'group', 'supergroup'];

// The admin rights the bot asks for in a channel: post, and edit its own
// posts. Every other right is listed as false because Telegram rejects a
// partial rights object.
const BOT_RIGHTS = {
  is_anonymous: false,
  can_manage_chat: false,
  can_delete_messages: false,
  can_manage_video_chats: false,
  can_restrict_members: false,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: false,
  can_post_stories: false,
  can_edit_stories: false,
  can_delete_stories: false,
  can_post_messages: true,
  can_edit_messages: true,
};

// What the bot says, in the owner's Telegram language (Uzbek, Russian, or
// English for everyone else).
const TEXT = {
  pick: {
    uz: 'Salom! Markivo post joylaydigan kanalni tanlang. Telegram meni u yerga admin qilib qo‘shishni so‘raydi — ruxsat bering.',
    ru: 'Здравствуйте! Выберите канал, куда Markivo будет публиковать посты. Telegram попросит добавить меня туда админом — разрешите.',
    en: 'Hi! Pick the channel Markivo should post to. Telegram will ask to add me there as an admin — allow it.',
  },
  channel: { uz: 'Kanalni tanlash', ru: 'Выбрать канал', en: 'Choose a channel' },
  group: { uz: 'Guruhni tanlash', ru: 'Выбрать группу', en: 'Choose a group' },
  expired: {
    uz: 'Bu havola eskirgan. Yangisini olish uchun Markivoda Telegram kartasini oching.',
    ru: 'Ссылка устарела. Чтобы получить новую, откройте в Markivo карточку Telegram.',
    en: 'This link has expired. Open the Telegram card in Markivo to get a new one.',
  },
  about: {
    uz: 'Men Markivodan foydalanadigan bizneslar uchun post joylayman. Kanalingizni ulash uchun Markivoda Telegram kartasini oching.',
    ru: 'Я публикую посты для бизнесов, которые пользуются Markivo. Чтобы подключить канал, откройте в Markivo карточку Telegram.',
    en: 'I publish posts for businesses that use Markivo. To connect your channel, open the Telegram card in Markivo.',
  },
  linked: {
    uz: 'Tayyor. Endi «{title}» ga post joylayman. Markivoga qaytishingiz mumkin.',
    ru: 'Готово. Теперь я публикую в «{title}». Можно вернуться в Markivo.',
    en: 'Done. I’ll post to “{title}”. You can go back to Markivo.',
  },
  cantPost: {
    uz: '«{title}» ga hali post joylay olmayman: menga «Xabar joylash» huquqi bilan admin kerak. Shuni to‘g‘rilab, kanalni qayta tanlang.',
    ru: 'Пока не могу публиковать в «{title}»: нужны права админа с «Публикацией сообщений». Исправьте это и выберите канал снова.',
    en: 'I can’t post to “{title}” yet: I need to be an admin with the “Post messages” right. Fix that, then pick the channel again.',
  },
  learned: {
    uz: 'Saqlandi. Autopilot shu postdan o‘rganadi (jami {count} ta post).',
    ru: 'Сохранено. Autopilot будет учиться на этом посте (всего постов: {count}).',
    en: 'Saved. Autopilot will learn from this post ({count} posts so far).',
  },
  learnNoLink: {
    uz: 'Avval kanalingizni ulang: Markivoda Telegram kartasini oching. Keyin postlaringizni shu yerga uzatsangiz, Autopilot ulardan o‘rganadi.',
    ru: 'Сначала подключите канал: откройте в Markivo карточку Telegram. Потом пересылайте сюда свои посты — Autopilot будет на них учиться.',
    en: 'Connect your channel first: open the Telegram card in Markivo. Then forward your posts here and Autopilot will learn from them.',
  },
  approvalAsk: {
    uz: 'Autopilot «{title}» uchun post yozdi{when}:\n\n{text}',
    ru: 'Autopilot написал пост для «{title}»{when}:\n\n{text}',
    en: 'Autopilot wrote a post for “{title}”{when}:\n\n{text}',
  },
  approvalWhen: { uz: ' — {time} da chiqadi', ru: ' — выйдет {time}', en: ' — it goes out {time}' },
  approveBtn: { uz: '✅ Joylash', ru: '✅ Опубликовать', en: '✅ Post it' },
  skipBtn: { uz: '⏭ O‘tkazib yuborish', ru: '⏭ Пропустить', en: '⏭ Skip' },
  editBtn: { uz: '✏️ Markivoda tahrirlash', ru: '✏️ Изменить в Markivo', en: '✏️ Edit in Markivo' },
  skipped: { uz: 'O‘tkazib yuborildi — joylanmaydi.', ru: 'Пропущено — публиковаться не будет.', en: 'Skipped — it won’t be posted.' },
  already: { uz: 'Bu allaqachon hal qilingan.', ru: 'Это уже обработано.', en: 'This was already handled.' },
  notYours: { uz: 'Buni faqat kanalni ulagan kishi tasdiqlay oladi.', ru: 'Подтвердить может только тот, кто подключил канал.', en: 'Only the person who connected the channel can approve this.' },
  questions: {
    uz: 'Autopilot to‘xtab turibdi: keyingi postdan oldin bir nechta qisqa savolga javob kerak — nima, qanday va qachon joylash haqida.',
    ru: 'Autopilot на паузе: перед следующим постом ему нужно несколько коротких ответов — что, как и когда публиковать.',
    en: 'Autopilot is paused: it needs a few quick answers before the next post — what, how and when to post.',
  },
  answerBtn: { uz: 'Markivoda javob berish', ru: 'Ответить в Markivo', en: 'Answer in Markivo' },
  notAdmin: {
    uz: '«{title}» ni faqat uning admini ulay oladi.',
    ru: 'Подключить «{title}» может только его админ.',
    en: 'Only an admin of “{title}” can connect it.',
  },
};

const langOf = (user) => {
  const code = String(user?.language_code || '').slice(0, 2);
  return code === 'uz' || code === 'ru' ? code : 'en';
};
const say = (key, user, vars = {}) =>
  TEXT[key][langOf(user)].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

const newLinkCode = () => crypto.randomBytes(12).toString('base64url');
const linkExpiry = (now = Date.now()) => new Date(now + LINK_TTL_MS).toISOString();

// getMe for the shared bot, cached per token. A failed lookup is not cached,
// so a Telegram outage at boot doesn't stick.
const botCache = new Map();
function getSharedBot(token) {
  if (!botCache.has(token)) {
    const p = tg.getMe(token).catch((err) => { botCache.delete(token); throw err; });
    botCache.set(token, p);
  }
  return botCache.get(token);
}

const linkUrl = (botUsername, code) => `https://t.me/${botUsername}?start=${code}`;
// Telegram's own "add this bot to a channel as admin" link — the fallback the
// bot offers next to the channel picker.
const addToChannelUrl = (botUsername) =>
  `https://t.me/${botUsername}?startchannel&admin=post_messages+edit_messages`;

function pickKeyboard(user) {
  return {
    keyboard: [
      [{ text: say('channel', user), request_chat: { request_id: 1, chat_is_channel: true, bot_administrator_rights: BOT_RIGHTS, user_administrator_rights: BOT_RIGHTS } }],
      [{ text: say('group', user), request_chat: { request_id: 2, chat_is_channel: false, bot_is_member: true } }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

const reply = (ctx, user, key, vars, extra) =>
  tg.sendMessage(ctx.token, user.id, say(key, user, vars), extra).catch((err) => {
    ctx.log?.warn?.(`Markivo bot reply failed: ${err.description || err.message}`);
  });

/**
 * Link `chatId` to the profile behind `link`, for Telegram user `user`.
 * Returns true when linked. Replies to the user either way.
 */
async function linkChat(ctx, link, chatId, user) {
  const { db, token, me } = ctx;
  let verified;
  try {
    verified = await tg.verifyPostAccess(token, chatId, me.id);
  } catch (err) {
    const title = await tg.getChat(token, chatId).then((c) => c.title || c.username).catch(() => '');
    await reply(ctx, user, 'cantPost', { title: title || String(chatId) });
    ctx.log?.warn?.(`Markivo bot cannot post to ${chatId}: ${err.description || err.message}`);
    return false;
  }
  // Only an admin of the chat may hand it to a Markivo profile.
  const member = await tg.getChatMember(token, verified.chatId, user.id).catch(() => null);
  if (!member || !['creator', 'administrator'].includes(member.status)) {
    await reply(ctx, user, 'notAdmin', { title: verified.chatTitle });
    return false;
  }
  db.telegram.upsertShared({
    profileId: link.profileId,
    botUserId: me.id,
    botUsername: me.username,
    ownerTgUserId: user.id,
    chat: verified,
  });
  db.platforms.setConnected(link.profileId, 'telegram', verified.chatUsername ? `@${verified.chatUsername}` : verified.chatTitle);
  db.telegram.links.remove(link.profileId);
  await reply(ctx, user, 'linked', { title: verified.chatTitle }, { reply_markup: { remove_keyboard: true } });
  return true;
}

/** Handle one update from the shared bot. ctx = { db, token, me, now?, log?, learnFrom? } */
// A channel post as an own-content row. The message id is the same id the
// public t.me/s/ preview uses, so a later scrape adds views to the same row.
function contentRow(m, externalId) {
  const text = m.text || m.caption || '';
  return {
    externalId,
    caption: text,
    postedAt: new Date((m.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    kind: m.photo ? 'photo' : (m.video || m.animation) ? 'video' : 'text',
  };
}

// Where a forwarded message came from (Bot API 7+ forward_origin, or the
// older forward_from_chat fields).
function forwardOf(msg) {
  const o = msg.forward_origin;
  if (o) return { chatId: o.chat ? o.chat.id : null, messageId: o.message_id || null, date: o.date || msg.date };
  if (msg.forward_from_chat || msg.forward_date) {
    return { chatId: msg.forward_from_chat ? msg.forward_from_chat.id : null, messageId: msg.forward_from_message_id || null, date: msg.forward_date || msg.date };
  }
  return null;
}

async function handleUpdate(update, ctx) {
  const { db } = ctx;
  const nowIso = new Date(ctx.now ?? Date.now()).toISOString();
  const msg = update.message;

  // Where Autopilot learns from (config.autopilotLearnFrom): 'forwarded'
  // means only the posts the owner forwards, so channel posts are not kept.
  const forwardedOnly = (ctx.learnFrom || config.autopilotLearnFrom) === 'forwarded';

  // A post in a linked channel (new or edited): Autopilot's own-content.
  const cp = update.channel_post || update.edited_channel_post;
  if (cp) {
    if (forwardedOnly) return 'ignored';
    const profiles = cp.chat ? db.telegram.sharedProfilesForChat(cp.chat.id) : [];
    if (!profiles.length || !(cp.text || cp.caption)) return 'ignored';
    for (const profileId of profiles) {
      db.ownContent.mergePosts(profileId, 'telegram', [contentRow(cp, String(cp.message_id))], { source: 'bot' });
    }
    return 'learned';
  }

  // The owner pressed Post / Skip under a post Autopilot sent them.
  const cq = update.callback_query;
  if (cq) {
    const m = /^apv:([0-9a-f-]{36}):(y|n)$/.exec(cq.data || '');
    if (!m || !ctx.actions || !ctx.actions.decideApproval) {
      await tg.call(ctx.token, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      return 'ignored';
    }
    const result = await ctx.actions.decideApproval({ approvalId: m[1], approve: m[2] === 'y', tgUserId: cq.from.id });
    const text = result.key ? say(result.key, cq.from) : String(result.text || '').slice(0, 190);
    await tg.call(ctx.token, 'answerCallbackQuery', { callback_query_id: cq.id, text: text.slice(0, 190), show_alert: !result.ok }).catch(() => {});
    if (cq.message && result.key !== 'notYours') {
      // Buttons off, and the outcome under the post so the chat reads as a log.
      await tg.call(ctx.token, 'editMessageReplyMarkup', {
        chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      await tg.sendMessage(ctx.token, cq.message.chat.id, text, { reply_to_message_id: cq.message.message_id }).catch(() => {});
    }
    return result.ok ? (m[2] === 'y' ? 'approved' : 'skipped') : 'refused';
  }

  if (msg?.migrate_to_chat_id) {
    db.telegram.moveChat(msg.chat.id, msg.migrate_to_chat_id);
    return 'moved';
  }

  if (msg && msg.chat?.type === 'private' && msg.from) {
    const user = msg.from;

    // The owner picked a chat with the keyboard button.
    if (msg.chat_shared) {
      const chatId = msg.chat_shared.chat_id;
      const link = db.telegram.links.latestForUser(user.id, nowIso);
      if (!link) {
        // Already linked by the membership update that arrives alongside it.
        if (db.telegram.sharedProfilesForChat(chatId).length) return 'already';
        await reply(ctx, user, 'about');
        return 'unlinked';
      }
      return (await linkChat(ctx, link, chatId, user)) ? 'linked' : 'refused';
    }

    // A post the owner forwarded: something Autopilot should learn from.
    const fwd = forwardOf(msg);
    if (fwd && (msg.text || msg.caption)) {
      const profiles = db.telegram.sharedProfilesForOwner(user.id);
      if (!profiles.length) {
        await reply(ctx, user, 'learnNoLink');
        return 'unlinked';
      }
      for (const profileId of profiles) {
        const conn = db.telegram.findByProfile(profileId);
        // From the linked channel itself: the channel's own message id, so it
        // merges with what the bot or the public preview already saved.
        const sameChat = conn && fwd.chatId != null && String(conn.chatId) === String(fwd.chatId) && fwd.messageId;
        const externalId = sameChat ? String(fwd.messageId) : `fwd:${fwd.chatId || 'user'}:${fwd.messageId || msg.message_id}`;
        db.ownContent.mergePosts(profileId, 'telegram', [contentRow({ ...msg, date: fwd.date }, externalId)], { source: 'forwarded' });
      }
      const count = db.ownContent.countByProfile(profiles[0], forwardedOnly ? { source: 'forwarded' } : {});
      await reply(ctx, user, 'learned', { count });
      return 'learned';
    }

    const start = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{8,64}))?\s*$/.exec(msg.text || '');
    if (start && start[1]) {
      const link = db.telegram.links.findByCode(start[1]);
      if (!link || link.expiresAt <= nowIso) {
        await reply(ctx, user, 'expired');
        return 'expired';
      }
      db.telegram.links.setUser(link.profileId, user.id);
      try {
        await tg.sendMessage(ctx.token, user.id, say('pick', user), { reply_markup: pickKeyboard(user) });
      } catch (err) {
        // Picker refused (an old Telegram app, or an API change): fall back to
        // Telegram's plain "add this bot to a channel" link. The membership
        // update then links the channel the same way.
        ctx.log?.warn?.(`Channel picker refused, sending the add-to-channel link: ${err.description || err.message}`);
        await reply(ctx, user, 'pick', {}, {
          reply_markup: { inline_keyboard: [[{ text: say('channel', user), url: addToChannelUrl(ctx.me.username) }]] },
        });
      }
      return 'started';
    }

    await reply(ctx, user, 'about', {}, {
      reply_markup: { inline_keyboard: [[{ text: say('channel', user), url: addToChannelUrl(ctx.me.username) }]] },
    });
    return 'about';
  }

  const mcm = update.my_chat_member;
  if (mcm && mcm.new_chat_member?.user?.id === ctx.me.id && LINKABLE.includes(mcm.chat?.type)) {
    const status = mcm.new_chat_member.status;
    if (status === 'left' || status === 'kicked') {
      // The bot was removed: the connection can no longer post, so drop it and
      // let the dashboard ask the owner to connect again.
      for (const profileId of db.telegram.sharedProfilesForChat(mcm.chat.id)) {
        db.telegram.remove(profileId);
        db.platforms.setConnected(profileId, 'telegram', null, false);
      }
      return 'removed';
    }
    if (['administrator', 'member', 'creator'].includes(status) && mcm.from) {
      const link = db.telegram.links.latestForUser(mcm.from.id, nowIso);
      if (!link) return 'ignored';
      return (await linkChat(ctx, link, mcm.chat.id, mcm.from)) ? 'linked' : 'refused';
    }
  }
  return 'ignored';
}

/**
 * Long-poll the shared bot and feed every update to handleUpdate. Returns a
 * handle with stop(). One process per token: Telegram answers 409 when two
 * pollers share a bot.
 */
function startPolling({ db, token, log = console, actions = null }) {
  let stopped = false;
  let offset = 0;
  let warned409 = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  (async () => {
    let me = null;
    while (!stopped) {
      try {
        if (!me) {
          me = await getSharedBot(token);
          // A webhook left over from elsewhere would block getUpdates.
          await tg.call(token, 'deleteWebhook', {});
          log.log(`📨 Markivo Telegram bot @${me.username} listening`);
        }
        const updates = await tg.call(token, 'getUpdates', {
          offset,
          timeout: 50,
          allowed_updates: ['message', 'my_chat_member', 'channel_post', 'edited_channel_post', 'callback_query'],
        });
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            await handleUpdate(u, { db, token, me, log, actions });
          } catch (err) {
            log.warn(`Markivo bot update ${u.update_id} failed: ${err.message}`);
          }
        }
      } catch (err) {
        if (err.code === 409) {
          if (!warned409) log.warn('Markivo Telegram bot: another process is reading this bot (HTTP 409). Run one server per TELEGRAM_BOT_TOKEN.');
          warned409 = true;
        } else if (err.code === 401) {
          log.warn('Markivo Telegram bot: TELEGRAM_BOT_TOKEN was rejected by Telegram. Listener stopped.');
          return;
        } else {
          log.warn(`Markivo Telegram bot: ${err.description || err.message}`);
        }
        await sleep(5000);
      }
    }
  })();

  return { stop() { stopped = true; } };
}

const LOCALES = { uz: 'uz-Latn-UZ', ru: 'ru-RU', en: 'en-GB' };
function formatWhen(iso, lang, timeZone) {
  try {
    return new Intl.DateTimeFormat(LOCALES[lang] || 'en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * A private message from the shared bot to the owner who linked the channel.
 * kind 'approval': the post with Post / Skip buttons (and Edit when the app
 * has a public https address). kind 'questions': Autopilot is waiting for
 * answers. `lang` = the owner's Markivo language. Throws on Telegram errors;
 * the caller decides whether that matters.
 */
async function notifyOwner({ token, tgUserId, lang = 'en', kind, approval, chatTitle, timezone, appUrl }) {
  const user = { language_code: lang };
  const appLink = /^https:\/\//.test(appUrl || '') ? `${appUrl.replace(/\/+$/, '')}/?tab=autopilot` : null;
  if (kind === 'approval' && approval) {
    const p = approval.action_payload || {};
    const when = p.scheduledFor ? say('approvalWhen', user, { time: formatWhen(p.scheduledFor, lang, timezone) }) : '';
    const text = say('approvalAsk', user, { title: chatTitle || p.target || 'Telegram', when, text: String(p.text || '').slice(0, 3500) });
    const keyboard = [[
      { text: say('approveBtn', user), callback_data: `apv:${approval.id}:y` },
      { text: say('skipBtn', user), callback_data: `apv:${approval.id}:n` },
    ]];
    if (appLink) keyboard.push([{ text: say('editBtn', user), url: appLink }]);
    return tg.sendMessage(token, tgUserId, text, { reply_markup: { inline_keyboard: keyboard } });
  }
  if (kind === 'questions') {
    const extra = appLink ? { reply_markup: { inline_keyboard: [[{ text: say('answerBtn', user), url: appLink }]] } } : {};
    return tg.sendMessage(token, tgUserId, say('questions', user), extra);
  }
  return null;
}

module.exports = {
  notifyOwner,
  formatWhen,
  LINK_TTL_MS,
  BOT_RIGHTS,
  getSharedBot,
  newLinkCode,
  linkExpiry,
  linkUrl,
  addToChannelUrl,
  handleUpdate,
  startPolling,
};
