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

test('fetchOwnContent(meta_instagram) reads own media via Graph API', async () => {
  const conn = { accessToken: 'tok', accountId: 'ig123', meta: { igUserId: 'ig123' } };
  const media = [
    { id: 'm1', caption: 'Hello IG', media_type: 'IMAGE', timestamp: '2026-08-01T10:00:00+0000', like_count: 50, comments_count: 5 },
  ];
  const result = await ownContentFetch.fetchOwnContent('meta_instagram', conn, null, { fetchImpl: jsonRes({ data: media }) });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.posts.length, 1);
  assert.strictEqual(result.posts[0].caption, 'Hello IG');
  assert.strictEqual(result.posts[0].likeCount, 50);
});

test('fetchOwnContent(meta_facebook) reads own page posts via Graph API', async () => {
  const conn = { accessToken: 'tok', accountId: 'page123', meta: { pageId: 'page123' } };
  const posts = [
    { id: 'p1', message: 'Hello FB', created_time: '2026-08-01T10:00:00+0000', likes: { summary: { total_count: 30 } }, comments: { summary: { total_count: 2 } } },
  ];
  const result = await ownContentFetch.fetchOwnContent('meta_facebook', conn, null, { fetchImpl: jsonRes({ data: posts }) });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.posts.length, 1);
  assert.strictEqual(result.posts[0].caption, 'Hello FB');
  assert.strictEqual(result.posts[0].likeCount, 30);
});

// DISABLED: YouTube temporarily off — see 2026-08-15. connectors/youtube.js
// exports {} while disabled, so fetchYouTube always degrades honestly
// regardless of connection state — there is no live/error-path to exercise
// here until YouTube is re-enabled.
test('fetchOwnContent(youtube) degrades honestly while YouTube is disabled', async () => {
  const conn = { accessToken: 'ytok' };
  const result = await ownContentFetch.fetchOwnContent('youtube', conn, null, {});
  assert.strictEqual(result.found, false);
  assert.match(result.error, /temporarily disabled/);
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
