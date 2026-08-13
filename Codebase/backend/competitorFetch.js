const config = require('./config');
// DISABLED: SEO/Meta temporarily off — see 2026-08-13
// const meta = require('./connectors/meta');

// ===========================================================================
// Competitor Intelligence — per-platform public-content readers.
//
// There is no official, sanctioned API for reading a STRANGER's posts on
// Instagram, TikTok, or Facebook (their APIs only expose accounts the caller
// owns/manages). YouTube is the one exception — its Data API v3 supports
// public read access with a plain API key. So:
//   - youtube: real API when YOUTUBE_DATA_API_KEY is set, else a page scrape.
//   - instagram / tiktok / facebook: always a best-effort public-page GET +
//     parse (no login, no session) — sometimes yields real recent posts
//     (TikTok often embeds them server-side), sometimes only a bio/follower
//     count, sometimes nothing at all if the platform serves a login wall.
//
// Every fetcher mirrors places.js#sniffSocialLinks: it NEVER throws, caps how
// much it reads, times out, and degrades to an honest `{ found: false }`-ish
// shape rather than faking data. `partial: true` means "some real data, but
// not full post history" — the UI must say so, not pretend it's complete.
// ===========================================================================

const FETCH_MAX_BYTES = 600_000;

async function safeGet(url, { fetchImpl = fetch, timeoutMs = config.competitorFetchTimeoutMs } = {}) {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarkivoBot/1.0; +https://trymarkivo.com)',
        Accept: 'text/html,application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = (await res.text()).slice(0, FETCH_MAX_BYTES);
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

const normalizeResult = (overrides = {}) => ({
  found: false, handle: null, displayName: null, followerCount: null,
  posts: [], partial: true, error: null,
  ...overrides,
});

// "12.3K" / "1,234" / "4.1M" -> a plain integer. Returns null on anything else.
function parseCompactNumber(raw) {
  if (!raw) return null;
  const m = String(raw).trim().replace(/,/g, '').match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  return Math.round(n * mult);
}

// Meta-tag content is an HTML attribute, so platform names/bios routinely
// arrive HTML-entity-encoded (e.g. "&#064;" for "@", "&#x2022;" for "•").
function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const metaTag = (html, prop) => {
  const m = html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`, 'i'));
  return m ? decodeHtmlEntities(m[1]) : null;
};

// --- Instagram -------------------------------------------------------------
// Real per-post content IS available here, but only through the official
// Business Discovery API (connectors/meta.js) — which requires the CALLING
// business to have their own Instagram connected via the Facebook-Login
// "Meta" connector (not the bespoke Instagram-Login flow, which is a
// different OAuth product without this feature). When that's wired up
// (opts.metaIgUserId + opts.metaAccessToken, looked up per-profile by the
// caller), we get real captions/engagement for target accounts that are
// themselves Business/Creator accounts. Otherwise — and whenever Business
// Discovery fails for any reason (target is a personal account, rate limit,
// scope issue) — we fall back to the same public-page scrape as before:
// og:description still carries "X Followers, Y Following, Z Posts" even
// when the post grid itself is behind a login wall.
async function fetchInstagram(url, opts = {}) {
  const handle = url.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/i)?.[1] || null;

  // DISABLED: SEO/Meta temporarily off — see 2026-08-13
  // The Business Discovery branch below is the only way to get real captions and
  // engagement for an Instagram competitor. With it off, this function always
  // degrades to the public-page scrape further down (follower count from
  // og:description only, partial: true).
  // if (handle && opts.metaIgUserId && opts.metaAccessToken) {
  //   try {
  //     const bd = await meta.businessDiscovery(opts.metaIgUserId, handle, opts.metaAccessToken, { fetchImpl: opts.fetchImpl });
  //     return normalizeResult({
  //       found: true,
  //       handle: bd.username || handle,
  //       displayName: bd.name || null,
  //       followerCount: Number.isFinite(+bd.followers_count) ? +bd.followers_count : null,
  //       posts: (bd.media?.data || []).map((m) => {
  //         const kind = /video|reel/i.test(m.media_type || '') ? 'video' : 'photo';
  //         return {
  //           externalId: m.id || null,
  //           kind,
  //           caption: m.caption || '',
  //           thumbnailUrl: m.thumbnail_url || m.media_url || null,
  //           postedAt: m.timestamp || null,
  //           likeCount: Number.isFinite(+m.like_count) ? +m.like_count : null,
  //           commentCount: Number.isFinite(+m.comments_count) ? +m.comments_count : null,
  //           viewCount: null,
  //         };
  //       }),
  //       partial: false,
  //     });
  //   } catch (err) {
  //     console.warn(`Instagram Business Discovery failed for ${url}, falling back to page scrape:`, err.message);
  //   }
  // }

  const res = await safeGet(url, opts);
  if (!res.ok) return normalizeResult({ handle, error: res.error || `Instagram responded ${res.status}` });

  const desc = metaTag(res.text, 'og:description') || '';
  const title = metaTag(res.text, 'og:title');
  const followerCount = parseCompactNumber(desc.match(/([\d.,]+[KMB]?)\s+Followers/i)?.[1]);

  // og:title is "Display Name (@handle) • Instagram photos and videos" —
  // take everything before the first "(" or "•", whichever comes first.
  const displayName = title ? title.split(/\s*[•(]/)[0].trim() || null : null;

  return normalizeResult({
    found: !!(followerCount != null || title),
    handle,
    displayName,
    followerCount,
    partial: true,
  });
}

// --- TikTok ------------------------------------------------------------
// TikTok profile pages are server-rendered enough to sometimes embed a JSON
// state blob (SIGI_STATE, or the newer __UNIVERSAL_DATA_FOR_REHYDRATION__)
// carrying the user's recent videos with real stats. TikTok changes this
// markup without notice, so every dig is wrapped and any miss just falls
// through to a bio-only partial result instead of throwing.
async function fetchTikTok(url, opts = {}) {
  const handle = url.match(/tiktok\.com\/@([A-Za-z0-9_.]{2,30})/i)?.[1] || null;
  const res = await safeGet(url, opts);
  if (!res.ok) return normalizeResult({ handle, error: res.error || `TikTok responded ${res.status}` });

  let displayName = null;
  let followerCount = null;
  let posts = [];
  try {
    const blob =
      res.text.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i) ||
      res.text.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i);
    if (blob) {
      const data = JSON.parse(blob[1]);
      const scope = data.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
      const userModule = data.UserModule;
      const userInfo = scope?.user || (userModule?.users ? Object.values(userModule.users)[0] : null);
      const stats = scope?.stats || (userModule?.stats ? Object.values(userModule.stats)[0] : null);
      if (userInfo) displayName = userInfo.nickname || null;
      if (stats && Number.isFinite(+stats.followerCount)) followerCount = +stats.followerCount;

      const itemModule = data.ItemModule || {};
      posts = Object.values(itemModule).slice(0, 30).map((it) => ({
        externalId: it.id,
        kind: 'video',
        caption: it.desc || '',
        thumbnailUrl: it.video?.cover || it.video?.originCover || null,
        postedAt: it.createTime ? new Date(Number(it.createTime) * 1000).toISOString() : null,
        likeCount: Number.isFinite(+it.stats?.diggCount) ? +it.stats.diggCount : null,
        commentCount: Number.isFinite(+it.stats?.commentCount) ? +it.stats.commentCount : null,
        viewCount: Number.isFinite(+it.stats?.playCount) ? +it.stats.playCount : null,
      }));
    }
  } catch (err) {
    console.warn(`TikTok markup parse fallback for ${url}:`, err.message);
  }

  return normalizeResult({
    found: !!(displayName || followerCount != null || posts.length),
    handle, displayName, followerCount, posts,
    partial: posts.length === 0,
  });
}

// --- YouTube -----------------------------------------------------------
// The one platform with a real, sanctioned public API (Data API v3, API-key
// auth, no OAuth needed for public read). With a key: resolve the channel,
// then list its uploads with real per-video stats. Without one: degrade to a
// meta-tag scrape of the channel page (name + subscriber count only).
async function fetchYouTubeViaApi(url, { fetchImpl = fetch, timeoutMs = config.competitorFetchTimeoutMs } = {}) {
  const key = config.youtubeDataApiKey;
  const handle = url.match(/youtube\.com\/@([A-Za-z0-9_.-]{2,60})/i)?.[1] || null;
  const channelId = url.match(/youtube\.com\/channel\/([A-Za-z0-9_-]{10,40})/i)?.[1] || null;
  const idParam = channelId ? `id=${encodeURIComponent(channelId)}` : `forHandle=${encodeURIComponent('@' + (handle || ''))}`;

  const chRes = await fetchImpl(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&${idParam}&key=${key}`,
    { signal: AbortSignal.timeout(timeoutMs) }
  );
  if (!chRes.ok) throw new Error(`YouTube channels.list responded ${chRes.status}`);
  const chData = await chRes.json();
  const channel = chData.items?.[0];
  if (!channel) return normalizeResult({ handle, found: false, partial: true, error: 'Channel not found' });

  let posts = [];
  const uploadsPlaylist = channel.contentDetails?.relatedPlaylists?.uploads;
  if (uploadsPlaylist) {
    const plRes = await fetchImpl(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=20&playlistId=${uploadsPlaylist}&key=${key}`,
      { signal: AbortSignal.timeout(timeoutMs) }
    );
    if (plRes.ok) {
      const plData = await plRes.json();
      const items = plData.items || [];
      const videoIds = items.map((it) => it.contentDetails?.videoId).filter(Boolean);
      let statsById = {};
      if (videoIds.length) {
        const vRes = await fetchImpl(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds.join(',')}&key=${key}`,
          { signal: AbortSignal.timeout(timeoutMs) }
        );
        if (vRes.ok) {
          const vData = await vRes.json();
          statsById = Object.fromEntries((vData.items || []).map((v) => [v.id, v.statistics || {}]));
        }
      }
      posts = items.map((it) => {
        const vid = it.contentDetails?.videoId;
        const st = statsById[vid] || {};
        return {
          externalId: vid || null,
          kind: 'video',
          caption: it.snippet?.title || '',
          thumbnailUrl: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || null,
          postedAt: it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt || null,
          likeCount: Number.isFinite(+st.likeCount) ? +st.likeCount : null,
          commentCount: Number.isFinite(+st.commentCount) ? +st.commentCount : null,
          viewCount: Number.isFinite(+st.viewCount) ? +st.viewCount : null,
        };
      });
    }
  }

  return normalizeResult({
    found: true,
    handle: channel.snippet?.customUrl || handle,
    displayName: channel.snippet?.title || null,
    followerCount: Number.isFinite(+channel.statistics?.subscriberCount) ? +channel.statistics.subscriberCount : null,
    posts,
    partial: false,
  });
}

async function fetchYouTubePage(url, opts = {}) {
  const handle = url.match(/youtube\.com\/@([A-Za-z0-9_.-]{2,60})/i)?.[1] || null;
  const res = await safeGet(url, opts);
  if (!res.ok) return normalizeResult({ handle, error: res.error || `YouTube responded ${res.status}` });
  const title = metaTag(res.text, 'og:title');
  const subText =
    res.text.match(/"subscriberCountText":\{"simpleText":"([\d.,]+[KMB]?)/i)?.[1] ||
    res.text.match(/([\d.,]+[KMB]?)\s+subscribers/i)?.[1];
  return normalizeResult({
    found: !!title,
    handle,
    displayName: title,
    followerCount: parseCompactNumber(subText),
    partial: true,
  });
}

async function fetchYouTube(url, opts = {}) {
  if (config.youtubeDataApiEnabled) {
    try {
      return await fetchYouTubeViaApi(url, opts);
    } catch (err) {
      console.warn(`YouTube Data API fetch failed for ${url}, falling back to page scrape:`, err.message);
    }
  }
  return fetchYouTubePage(url, opts);
}

// --- Facebook ----------------------------------------------------------
// The most locked-down of the four without Meta's Page Public Content Access
// (App Review) — stays bio-only via meta tags, and is expected to often
// return found:false when Facebook serves a login wall instead of the page.
async function fetchFacebook(url, opts = {}) {
  const handle = url.match(/facebook\.com\/([A-Za-z0-9.]{2,60})/i)?.[1] || null;
  const res = await safeGet(url, opts);
  if (!res.ok) return normalizeResult({ handle, error: res.error || `Facebook responded ${res.status}` });
  const title = metaTag(res.text, 'og:title');
  const desc = metaTag(res.text, 'og:description') || '';
  const followerCount = parseCompactNumber(desc.match(/([\d.,]+[KMB]?)\s+(?:followers|likes)/i)?.[1]);
  return normalizeResult({
    found: !!title,
    handle,
    displayName: title,
    followerCount,
    partial: true,
  });
}

const FETCHERS = { instagram: fetchInstagram, tiktok: fetchTikTok, youtube: fetchYouTube, facebook: fetchFacebook };

// Single entry point used by the routes. Never throws — a fetcher failing
// (bad markup, network error, unknown platform) degrades to a normalized
// "not found" result rather than breaking the add/refresh request.
async function fetchCompetitorSource(platform, url, opts = {}) {
  const fn = FETCHERS[String(platform || '').toLowerCase()];
  if (!fn) return normalizeResult({ error: `Unsupported platform: ${platform}` });
  try {
    return await fn(url, opts);
  } catch (err) {
    console.warn(`Competitor fetch failed for ${platform} ${url}:`, err.message);
    return normalizeResult({ error: err.message });
  }
}

module.exports = {
  fetchCompetitorSource,
  parseCompactNumber,
  SUPPORTED_PLATFORMS: Object.keys(FETCHERS),
};
