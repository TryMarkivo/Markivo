// Connector registry — the single place the rest of the app reaches platforms.
//
// server.js / the worker / the agent never import an adapter directly; they ask
// the registry to list connectors or dispatch an action to one. Adding a
// platform = writing one adapter file and registering it here.

const telegram = require('./telegram');
// Platform adapters land here as they are built (each self-contained, sandbox
// fallback included). Until added, the framework still runs with Telegram only.
const meta = require('./meta');
// DISABLED: YouTube temporarily off — see 2026-08-15. Uncomment the require
// and add youtube back to ADAPTERS below to restore it; connectors/youtube.js
// itself is untouched (still fully commented-out-and-restorable in one go).
// const youtube = require('./youtube');
const googleBusiness = require('./googleBusiness');
// TikTok removed — see 2026-08-15. connectors/tiktok.js was deleted along
// with its competitor-tracking scraper, validator, voice rules, and post
// limit; there is nothing left to restore it from.

// Registration order doubles as display order in the dashboard.
const ADAPTERS = [telegram, meta.instagram, meta.facebook, googleBusiness];

const byKey = new Map(ADAPTERS.map((a) => [a.key, a]));

const get = (key) => byKey.get(key) || null;
const has = (key) => byKey.has(key);
const list = () => ADAPTERS.slice();

// Public, non-secret descriptor for the dashboard / API. Includes the adapter's
// owner-facing connect guidance so the Connections screen can explain HOW to
// connect any platform without the frontend hardcoding per-platform copy.
const describe = (a) => ({
  key: a.key,
  label: a.label,
  group: a.group || a.key,
  live: a.isLive(),
  authType: a.authType || 'oauth',
  docsUrl: a.docsUrl || null,
  requirements: a.requirements || [],
  howToConnect: a.howToConnect || [],
});
const catalogue = () => ADAPTERS.map(describe);

// Status for every platform for one profile (connect screen + dashboard).
async function statusAll({ db, profile }) {
  const out = {};
  for (const a of ADAPTERS) {
    try {
      out[a.key] = await a.status({ db, profile });
    } catch (err) {
      out[a.key] = { platform: a.key, label: a.label, connected: false, error: err.message };
    }
  }
  return out;
}

module.exports = { get, has, list, catalogue, describe, statusAll, ADAPTERS };
