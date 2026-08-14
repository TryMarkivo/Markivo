const { test } = require('node:test');
const assert = require('node:assert');

// Pure unit tests, no server/db needed — ownContentFetch.js only routes to
// mocked fetchImpl closures. Isolate env the same way the other suites do so
// requiring config never touches real credentials.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.NODE_ENV = 'test';

const ownContentFetch = require('../ownContentFetch');

const jsonRes = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });
const htmlRes = (text, ok = true, status = 200) => async () => ({ ok, status, text: async () => text });

// DISABLED: SEO/Meta temporarily off — see 2026-08-13. connectors/meta.js
// exports {} while disabled, so meta_instagram/meta_facebook always degrade
// honestly regardless of connection state — there is no live/error-path to
// exercise here until Meta is re-enabled.
test('fetchOwnContent(meta_instagram) degrades honestly while Meta is disabled', async () => {
  const conn = { accessToken: 'tok', accountId: 'ig123', meta: { igUserId: 'ig123' } };
  const result = await ownContentFetch.fetchOwnContent('meta_instagram', conn, null, {});
  assert.strictEqual(result.found, false);
  assert.match(result.error, /temporarily disabled/);
});

test('fetchOwnContent(meta_facebook) degrades honestly while Meta is disabled', async () => {
  const conn = { accessToken: 'tok', accountId: 'page123', meta: { pageId: 'page123' } };
  const result = await ownContentFetch.fetchOwnContent('meta_facebook', conn, null, {});
  assert.strictEqual(result.found, false);
  assert.match(result.error, /temporarily disabled/);
});

test('fetchOwnContent(youtube) reads real uploads via the OAuth-authenticated Data API', async () => {
  const conn = { accessToken: 'ytok' };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/channels')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'PLxyz' } } }] }) };
    }
    if (u.includes('/playlistItems')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ contentDetails: { videoId: 'v1', videoPublishedAt: '2026-08-01T00:00:00Z' }, snippet: { title: 'New video drop' } }] }) };
    }
    if (u.includes('/videos')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'v1', statistics: { likeCount: '20', commentCount: '4', viewCount: '500' } }] }) };
    }
    throw new Error(`unexpected URL ${u}`);
  };
  const result = await ownContentFetch.fetchOwnContent('youtube', conn, null, { fetchImpl });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.posts.length, 1);
  assert.strictEqual(result.posts[0].caption, 'New video drop');
  assert.strictEqual(result.posts[0].viewCount, 500);
});

test('fetchOwnContent(tiktok) reuses the public-scrape competitor fetcher against the account\'s own handle', async () => {
  const state = {
    UserModule: { users: { somebrand: { nickname: 'Some Brand' } }, stats: { somebrand: { followerCount: 900 } } },
    ItemModule: { v1: { id: 'v1', desc: 'Our own video', createTime: '1700000000', video: {}, stats: { diggCount: 10, commentCount: 1, playCount: 200 } } },
  };
  const html = `<script id="SIGI_STATE" type="application/json">${JSON.stringify(state)}</script>`;
  const conn = { accountHandle: '@somebrand' };
  const result = await ownContentFetch.fetchOwnContent('tiktok', conn, null, { fetchImpl: htmlRes(html) });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.posts.length, 1);
  assert.strictEqual(result.posts[0].caption, 'Our own video');
});

test('fetchOwnContent(tiktok) degrades honestly with no handle on file', async () => {
  const result = await ownContentFetch.fetchOwnContent('tiktok', { accountHandle: null }, null, {});
  assert.strictEqual(result.found, false);
  assert.ok(result.error);
});

test('fetchOwnContent(telegram) reuses the public t.me/s/ scrape against the linked channel\'s username', async () => {
  const html = `
    <div class="tgme_channel_info_header_title"><span dir="auto">Sunrise Cafe</span></div>
    <div class="tgme_widget_message_wrap js-widget_message_wrap">
      <div class="tgme_widget_message" data-post="sunrisecafe/55">
        <div class="tgme_widget_message_text js-message_text" dir="auto">Our own channel post.</div>
        <span class="tgme_widget_message_views">900</span>
        <a class="tgme_widget_message_date"><time datetime="2026-08-01T10:00:00+00:00">10:00</time></a>
      </div>
    </div>`;
  const tgConn = { chatUsername: 'sunrisecafe' };
  const result = await ownContentFetch.fetchOwnContent('telegram', null, tgConn, { fetchImpl: htmlRes(html) });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.posts[0].caption, 'Our own channel post.');
});

test('fetchOwnContent(telegram) degrades honestly for a channel with no public username', async () => {
  const result = await ownContentFetch.fetchOwnContent('telegram', null, { chatUsername: null }, {});
  assert.strictEqual(result.found, false);
  assert.ok(result.error);
});

test('fetchOwnContent degrades to a normalized result for an unsupported platform', async () => {
  const result = await ownContentFetch.fetchOwnContent('twitter', null, null, {});
  assert.strictEqual(result.found, false);
  assert.ok(result.error);
});
