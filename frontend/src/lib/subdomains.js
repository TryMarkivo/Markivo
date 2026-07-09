// Section-based subdomain routing for Markivo.
//
// Each logical section of the app can live on its own subdomain:
//
//   markivo.io            -> landing   (also app. / www.)
//   login.markivo.io      -> auth      (login / register)
//   onboarding.markivo.io -> guided setup wizard (Path A / Path B)
//   dashboard.markivo.io  -> the product dashboard
//
// Routing is OFF unless VITE_ROOT_DOMAIN is set, so a single-origin deploy — or
// plain `localhost` dev — keeps working exactly as before. When it is ON, moving
// between sections crosses origins, so the auth session is handed off through the
// URL fragment (localStorage is per-origin and cannot otherwise be shared).
//
// Local testing: set VITE_ROOT_DOMAIN=localhost and open http://app.localhost:5173
// — Chromium/Firefox resolve any `*.localhost` name to 127.0.0.1 automatically.

const ROOT_DOMAIN = (import.meta.env.VITE_ROOT_DOMAIN || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');

export const ROUTING_ENABLED = ROOT_DOMAIN.length > 0;

// section -> subdomain label. An empty label means the root/apex domain itself.
const SECTION_LABEL = {
  landing: '',
  login: 'login',
  onboarding: 'onboarding',
  dashboard: 'dashboard',
};

// Labels that all resolve to the landing section on the root/apex.
const LANDING_LABELS = new Set(['', 'www', 'app']);

const ACCESS_KEY = 'markivo_token';
const REFRESH_KEY = 'markivo_refresh';
const HANDOFF_PARAM = 's'; // fragment key carrying the session on cross-origin nav

// Left-most label of the current host once the known root domain is stripped.
// Unknown hosts (root not a suffix) fall back to '' -> landing.
function labelFor(hostname) {
  const host = (hostname || '').toLowerCase();
  if (!ROOT_DOMAIN || host === ROOT_DOMAIN) return '';
  const suffix = '.' + ROOT_DOMAIN;
  if (host.endsWith(suffix)) return host.slice(0, -suffix.length).split('.')[0];
  return '';
}

// Which section is this browser currently showing? null when routing is off.
export function currentSection() {
  if (!ROUTING_ENABLED) return null;
  const label = labelFor(window.location.hostname);
  if (LANDING_LABELS.has(label)) return 'landing';
  const match = Object.entries(SECTION_LABEL).find(([, l]) => l && l === label);
  return match ? match[0] : 'landing';
}

// Absolute URL for a section, preserving protocol + port and adding query params.
export function sectionUrl(section, params = {}) {
  const label = SECTION_LABEL[section] ?? '';
  const host = label ? `${label}.${ROOT_DOMAIN}` : ROOT_DOMAIN;
  const port = window.location.port ? `:${window.location.port}` : '';
  const qs = new URLSearchParams(params).toString();
  return `${window.location.protocol}//${host}${port}/${qs ? '?' + qs : ''}`;
}

// --- Session hand-off across the origin boundary ---------------------------

function readSession() {
  const access = localStorage.getItem(ACCESS_KEY);
  if (!access) return null;
  return { access, refresh: localStorage.getItem(REFRESH_KEY) || undefined };
}

// A hand-off is only accepted within this window of being minted. It bounds the
// replay window for a leaked link (browser history, shoulder-surf). NOTE: this is
// not authentication — a fragment hand-off cannot be fully trusted. For a hardened
// deployment, issue the session as an httpOnly cookie scoped to `.<root>` from the
// backend (see DEPLOY.md) so no token ever travels through a URL.
const HANDOFF_TTL_MS = 120000; // 2 minutes — a redirect + page load takes seconds

// Encode the current session into a compact, URL-safe fragment payload.
function encodeHandoff() {
  const session = readSession();
  if (!session) return '';
  try {
    const payload = JSON.stringify({ ...session, ts: Date.now() });
    return btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

// On load: if the URL fragment carries a fresh handed-off session, import it into
// this origin's localStorage and scrub it from the address bar / history immediately.
export function consumeHandoff() {
  if (!ROUTING_ENABLED || !window.location.hash) return;
  const parts = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const payload = parts.get(HANDOFF_PARAM);
  if (payload) {
    try {
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      const { access, refresh, ts } = JSON.parse(json);
      const fresh = typeof ts === 'number' && Date.now() - ts >= 0 && Date.now() - ts <= HANDOFF_TTL_MS;
      if (fresh && access) {
        localStorage.setItem(ACCESS_KEY, access);
        if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
      }
    } catch {
      /* ignore a malformed hand-off */
    }
    // Remove the token from the URL so it does not linger in history or get shared.
    parts.delete(HANDOFF_PARAM);
    const rest = parts.toString();
    window.history.replaceState(null, '', window.location.pathname + window.location.search + (rest ? '#' + rest : ''));
  }
}

// Navigate to a section. Returns true when it triggered a cross-origin redirect
// (the caller should stop); false when the caller should handle it in-app (state).
export function goToSection(section, params = {}) {
  if (!ROUTING_ENABLED) return false;
  if (currentSection() === section && Object.keys(params).length === 0) return false;
  let url = sectionUrl(section, params);
  const handoff = encodeHandoff();
  if (handoff) url += `#${HANDOFF_PARAM}=${handoff}`;
  window.location.assign(url);
  return true;
}
