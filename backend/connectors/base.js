// Shared contract + helpers for platform connectors.
//
// A connector adapter is a stateless module that teaches Markivo how to connect
// to, and publish on, one social platform — always through that platform's
// OFFICIAL API and on the user's behalf (never by impersonating an account).
// Every adapter implements the same surface so the server, worker, and agent
// can treat all platforms uniformly:
//
//   key, label, group
//   isLive()                              -> boolean   (real creds configured?)
//   getAuthUrl({ profile, state })        -> string|null  (OAuth consent URL)
//   handleCallback({ db, profile, query })-> Promise<status>  (persist tokens)
//   status({ db, profile })               -> Promise<status>
//   publish({ db, profile, text, mediaUrl })-> Promise<result>  (throws on real failure)
//   disconnect({ db, profile })           -> Promise<void>
//   metrics?({ db, profile })             -> Promise<object>    (optional)
//
// Markivo rule: a BLANK credential must never break the app or the tests. So
// every adapter falls back to a deterministic SANDBOX mode when its platform
// keys are absent — connect is simulated, publish is recorded as a simulated
// post, and status reports `sandbox: true`. Live behaviour engages only once
// real OAuth credentials are configured.

class ConnectorError extends Error {
  constructor(platform, message, code = 400) {
    super(message);
    this.name = 'ConnectorError';
    this.platform = platform;
    this.code = code;
  }
}

// A uniform "not connected" status object.
const notConnected = (adapter, extra = {}) => ({
  platform: adapter.key,
  label: adapter.label,
  connected: false,
  live: adapter.isLive(),
  sandbox: !adapter.isLive(),
  ...extra,
});

// A uniform "connected" status object.
const connected = (adapter, fields = {}) => ({
  platform: adapter.key,
  label: adapter.label,
  connected: true,
  live: adapter.isLive(),
  sandbox: !adapter.isLive(),
  ...fields,
});

// Sandbox publish result — used when no live credentials are configured. The
// caller (server/worker) records the simulated calendar entry; the adapter just
// reports that the post was accepted in simulation. Never throws.
const simulatedPublish = (adapter, extra = {}) => ({
  simulated: true,
  platform: adapter.key,
  message: `Simulated publish to ${adapter.label} (sandbox — connect live credentials to post for real).`,
  ...extra,
});

module.exports = { ConnectorError, notConnected, connected, simulatedPublish };
