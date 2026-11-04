// Demo mode for preview builds (VITE_DEMO=1): answers every API call in the
// browser from sample data, so a page can be clicked through with no backend
// and no sign-in. Never active in a normal build. State lives in memory and
// resets on reload.
import api from './api';
import fixtures from './demoFixtures.json';

let seq = 100;

const at = (dayOffset, h, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const post = (dayOffset, h, m, platform, status, text, extra = {}) => ({
  id: `post_demo${seq++}`, platform, status, text, time: at(dayOffset, h, m), mediaId: '', repeatRule: '', ...extra,
});

const posts = [
  post(-6, 9, 0, 'instagram', 'posted', 'Monday mornings are better with cardamom buns. Fresh from the oven at 8.'),
  post(-4, 18, 30, 'telegram', 'posted', 'Tonight: live acoustic set from 7 pm. Tables by the window are first come, first served.'),
  post(-3, 12, 0, 'instagram', 'failed', 'Lunch combo: soup, sandwich and coffee for 45,000 sum.'),
  post(-1, 10, 0, 'instagram', 'posted', 'Rainy day? Hot chocolate is 20% off until we close.'),
  post(0, 9, 0, 'instagram', 'posted', 'Warm pastries, a proper espresso and a quiet corner to work in. We open at 8.'),
  post(0, 18, 0, 'telegram', 'scheduled', 'Every Wednesday after 4 pm, the second coffee is on us.', { repeatRule: 'weekly' }),
  post(1, 12, 0, 'instagram', 'scheduled', 'Meet Aziz, our head barista. Ask him for his favourite pour-over this week.', { mediaId: 'media_demo2' }),
  post(2, 10, 0, 'instagram', 'draft', 'New on the menu: pistachio croissant. Baked this morning, gone by lunch.', { mediaId: 'media_demo1' }),
  post(2, 17, 0, 'telegram', 'scheduled', 'Weekend brunch is back: shakshuka, granola bowls and our own sourdough.'),
  post(3, 11, 0, 'instagram', 'scheduled', 'Saturday tasting: three single-origin coffees, 15 minutes, free.', { mediaId: 'media_demo2' }),
  post(5, 9, 30, 'instagram', 'scheduled', 'New week, new seasonal drink: pumpkin spice latte with real pumpkin.'),
  post(9, 10, 0, 'instagram', 'scheduled', 'Thank you for 1,000 followers! Show this post for a free cookie.'),
  post(12, 19, 0, 'telegram', 'draft', 'Board game night every second Thursday. Bring friends.'),
];

let approvals = [
  {
    id: 'appr_demo1', action_type: 'platform_post', status: 'pending',
    action_payload: { platform: 'instagram', text: 'It’s getting colder. Our ginger-honey tea is back on the menu, and it pairs perfectly with a slice of medovik. ☕🍯' },
  },
  {
    id: 'appr_demo2', action_type: 'telegram_post', status: 'pending',
    action_payload: { text: 'This Friday we stay open until midnight. Come for late coffee, stay for the music.' },
  },
  {
    id: 'appr_demo3', action_type: 'ad_creation', status: 'pending',
    action_payload: { action: 'Create Meta Ad Campaign', cost: '$5.00 / day', target: 'Students and office workers near Tashkent', creative: 'Discover Noir Coffee: a quiet corner, proper espresso, pastries baked every morning.' },
  },
];

const toEvent = (p) => ({
  kind: 'calendar#event',
  id: p.id,
  status: p.status === 'draft' ? 'tentative' : p.status === 'failed' ? 'cancelled' : 'confirmed',
  summary: `${p.platform} · ${p.text.slice(0, 60)}`,
  description: p.text,
  start: { dateTime: p.time },
  end: { dateTime: new Date(new Date(p.time).getTime() + 30 * 60000).toISOString() },
  extendedProperties: { private: { source: 'scheduled_post', platform: p.platform, markivoStatus: p.status, mediaId: p.mediaId, tag: '', repeatRule: p.repeatRule } },
});

// Sample "photos" for the media library: flat drawings, so the preview has
// something to attach without any real upload.
const svgPhoto = (bg, fg, shape) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><rect width='600' height='600' fill='${bg}'/>${shape.replace(/FG/g, fg)}</svg>`,
)}`;
const DEMO_MEDIA = [
  { id: 'media_demo1', kind: 'image', topic: 'Croissant', filePath: svgPhoto('#ead2bd', '#b07a45', "<ellipse cx='300' cy='320' rx='190' ry='110' fill='FG'/><ellipse cx='300' cy='300' rx='120' ry='70' fill='#c99363'/>") },
  { id: 'media_demo2', kind: 'image', topic: 'Espresso', filePath: svgPhoto('#d9e3d4', '#4b3426', "<circle cx='300' cy='310' r='150' fill='#f4f1ea'/><circle cx='300' cy='310' r='105' fill='FG'/>") },
  { id: 'media_demo3', kind: 'image', topic: 'Window seat', filePath: svgPhoto('#cfd8e3', '#8a6a4f', "<rect x='120' y='110' width='360' height='260' rx='12' fill='#eef2f6'/><rect x='150' y='400' width='300' height='40' rx='8' fill='FG'/>") },
];

const DEMO_STYLES = [
  { id: 'style_demo1', name: 'Short and friendly' },
  { id: 'style_demo2', name: 'Like our Telegram channel' },
];

// What "AI" writes in the demo: a fixed, plausible post for a new topic, and a
// visible change for a rewrite, so the flow can be tried end to end.
const demoWrite = (body) => {
  if (body.previousText) {
    const f = String(body.feedback || '').toLowerCase();
    if (f.includes('shorter')) return body.previousText.split(/(?<=[.!?])\s/)[0];
    if (f.includes('russian')) return 'Новинка в меню: фисташковый круассан. Испекли утром, к обеду разберут. 🥐';
    if (f.includes('uzbek')) return 'Menyuda yangilik: pistali kruassan. Ertalab pishdi, tushlikkacha tugaydi. 🥐';
    return `${body.previousText.trim()} See you soon!`;
  }
  const topic = String(body.topic || 'something new').trim().replace(/\.$/, '');
  return `${topic[0].toUpperCase()}${topic.slice(1)}. Come by Noir Coffee this week and see for yourself. ☕\n\n#NoirCoffee #Tashkent`;
};

let tgLinked = true;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function handle(method, url, body) {
  const path = url.pathname;

  if (path === '/api/calendar/events' && method === 'GET') {
    const min = url.searchParams.get('timeMin');
    const max = url.searchParams.get('timeMax');
    const items = posts
      .filter((p) => (!min || p.time >= new Date(min).toISOString()) && (!max || p.time <= new Date(max).toISOString()))
      .sort((a, b) => a.time.localeCompare(b.time))
      .map(toEvent);
    return json({ kind: 'calendar#events', summary: 'Markivo — Noir Coffee', items });
  }
  const eventMatch = path.match(/^\/api\/calendar\/events\/(.+)$/);
  if (eventMatch) {
    const p = posts.find((x) => x.id === eventMatch[1]);
    if (!p) return json({ error: 'Event not found' }, 404);
    if (p.status !== 'scheduled' && p.status !== 'draft') return json({ error: 'This post has already gone out — it can no longer be changed.' }, 400);
    if (method === 'DELETE') {
      posts.splice(posts.indexOf(p), 1);
      return json({ success: true });
    }
    if (body.start?.dateTime) p.time = new Date(body.start.dateTime).toISOString();
    if (typeof body.postText === 'string') p.text = body.postText;
    if ('mediaId' in body) p.mediaId = body.mediaId || '';
    if ('repeatRule' in body) p.repeatRule = body.repeatRule || '';
    if (body.status) p.status = body.status;
    return json(toEvent(p));
  }
  if (path === '/api/content/schedule') {
    const p = post(0, 0, 0, body.platform || 'instagram', body.status === 'draft' ? 'draft' : 'scheduled', body.postText || '', { time: body.scheduledTime, repeatRule: body.repeatRule || '', mediaId: body.mediaId || '' });
    posts.push(p);
    return json(p);
  }
  if (path === '/api/content/post-now') {
    posts.push(post(0, 0, 0, body.platform || 'instagram', 'posted', body.postText || '', { time: new Date().toISOString() }));
    return json({ success: true, simulated: true });
  }
  if (path === '/api/content/copywrite') return json({ post: demoWrite(body), hashtags: [] });

  if (path === '/api/autonomous/approvals') return json({ approvals });
  if (path === '/api/agent/approve' || path === '/api/agent/reject') {
    const a = approvals.find((x) => x.id === body.approvalId);
    approvals = approvals.filter((x) => x.id !== body.approvalId);
    if (path === '/api/agent/approve' && a && a.action_type !== 'ad_creation') {
      const platform = a.action_type === 'telegram_post' ? 'telegram' : a.action_payload.platform;
      posts.push(post(0, 0, 0, platform, 'posted', body.editedText || a.action_payload.text, { time: new Date().toISOString() }));
    }
    return json({ success: true, message: path === '/api/agent/approve' ? 'Approved. (Demo: nothing was really posted.)' : 'Skipped.' });
  }

  if (path === '/api/instagram/status') return json({ connected: true, username: 'noircoffee', accountName: 'Noir Coffee' });
  // Telegram through the shared Markivo bot. Disconnecting shows the connect
  // flow; its link points at a placeholder bot.
  if (path === '/api/telegram/status') {
    return json(tgLinked
      ? { connected: true, mode: 'shared', sharedAvailable: true, linking: null, botUsername: 'markivo_bot', chat: { chatId: '-100', chatTitle: 'Noir Coffee', chatType: 'channel', chatUsername: 'noircoffee' } }
      : { connected: false, sharedAvailable: true, linking: null });
  }
  if (path === '/api/telegram/link/start') return json({ url: 'https://t.me/markivo_bot?start=demo', botUsername: 'markivo_bot', expiresAt: new Date(Date.now() + 1800000).toISOString() });
  if (path === '/api/connect/telegram/disconnect') { tgLinked = false; return json({ success: true }); }
  if (path === '/api/styles') return json(DEMO_STYLES);
  if (path === '/api/media') return json({ items: DEMO_MEDIA });
  if (path === '/api/templates') return json([]);
  if (path === '/api/auth/refresh') return json({ accessToken: 'demo', refreshToken: 'demo' });

  if (fixtures[path]) return json(fixtures[path]);
  return json(method === 'GET' ? {} : { success: true });
}

export function installDemo() {
  try {
    localStorage.setItem('markivo_token', 'demo');
    localStorage.setItem('markivo_refresh', 'demo');
  } catch { /* storage blocked: the app still renders from memory */ }
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input.url;
    if (!raw.startsWith(api.base)) return realFetch(input, init);
    const url = new URL(raw);
    const method = (init.method || 'GET').toUpperCase();
    let body;
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
    await new Promise((r) => setTimeout(r, method === 'GET' ? 120 : 350));
    return handle(method, url, body);
  };
}

export const DEMO = import.meta.env.VITE_DEMO === '1';
