const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB + secret BEFORE requiring the app (config reads env at load).
// No Stripe keys → billing runs in SIMULATED mode, webhook answers 501.
const TMP_DB = path.join(os.tmpdir(), `markivo-billing-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

const { app } = require('../server');
const billing = require('../billing');

let server, base, access, userId;

const post = (p, body) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify(body),
  });

const get = async (p) =>
  (await fetch(base + p, { headers: { Authorization: `Bearer ${access}` } })).json();

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `bill${Date.now()}@m.uz`, password: 'secret123', fullName: 'B' }),
  });
  const data = await reg.json();
  access = data.accessToken;
  userId = data.user.id;
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('keyless checkout to pro upgrades instantly in simulated mode', async () => {
  const res = await post('/api/billing/checkout', { tier: 'pro' });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.upgraded, true);
  assert.strictEqual(data.tier, 'pro');
  assert.strictEqual(data.simulated, true);
});

test('the upgrade raises the AI allowance instantly on the SAME access token', async () => {
  // The token was signed pre-upgrade with tier=freemium — usageInfo must
  // read the DB tier, not the stale JWT claim.
  const u = await get('/api/usage');
  assert.strictEqual(u.tier, 'pro');
  assert.strictEqual(u.limit, 100);
});

test('billing status reports the simulated pro subscription', async () => {
  const s = await get('/api/billing/status');
  assert.strictEqual(s.tier, 'pro');
  assert.strictEqual(s.provider, 'simulated');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.simulated, true);
  assert.strictEqual(typeof s.prices.pro, 'number');
  assert.strictEqual(s.limits.pro, 100);
});

test('checkout to the tier you are already on is rejected with 400', async () => {
  const res = await post('/api/billing/checkout', { tier: 'pro' });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /already on the pro plan/i);
});

test('checkout to freemium downgrades and the allowance drops back', async () => {
  const res = await post('/api/billing/checkout', { tier: 'freemium' });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.upgraded, true);
  assert.strictEqual(data.tier, 'freemium');

  const u = await get('/api/usage');
  assert.strictEqual(u.tier, 'freemium');
  assert.strictEqual(u.limit, 25);

  const s = await get('/api/billing/status');
  assert.strictEqual(s.tier, 'freemium');
  assert.strictEqual(s.status, 'canceled');
});

test('an unknown tier is rejected with 400', async () => {
  const res = await post('/api/billing/checkout', { tier: 'platinum' });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /unknown plan/i);
});

test('the webhook answers 501 when no signing secret is configured', async () => {
  const res = await fetch(`${base}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'checkout.session.completed' }),
  });
  assert.strictEqual(res.status, 501);
  assert.match((await res.json()).error, /webhook not configured/i);
});

test('applyStripeEvent: checkout.session.completed upgrades the user', async () => {
  const result = billing.applyStripeEvent({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_fake',
        subscription: 'sub_fake_123',
        metadata: { userId, tier: 'ultimate' },
      },
    },
  });
  assert.strictEqual(result.handled, true);

  const u = await get('/api/usage');
  assert.strictEqual(u.tier, 'ultimate');
  assert.strictEqual(u.limit, 250);

  const s = await get('/api/billing/status');
  assert.strictEqual(s.tier, 'ultimate');
  assert.strictEqual(s.provider, 'stripe');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.simulated, false);
});

test('applyStripeEvent: customer.subscription.deleted downgrades to freemium', async () => {
  const result = billing.applyStripeEvent({
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_fake_123' } },
  });
  assert.strictEqual(result.handled, true);

  const s = await get('/api/billing/status');
  assert.strictEqual(s.tier, 'freemium');
  assert.strictEqual(s.status, 'canceled');

  const u = await get('/api/usage');
  assert.strictEqual(u.limit, 25);
});

test('applyStripeEvent ignores unknown events and unknown subscriptions', () => {
  assert.strictEqual(billing.applyStripeEvent({ type: 'invoice.paid', data: { object: { id: 'in_1' } } }).handled, false);
  assert.strictEqual(billing.applyStripeEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_nope' } } }).handled, false);
});

test('Payme/Click providers answer 501 until merchant onboarding completes', () => {
  for (const name of ['payme', 'click']) {
    assert.throws(
      () => billing.PROVIDERS[name].createCheckout(),
      (err) => err instanceof billing.BillingError && err.status === 501 && /onboarding pending/i.test(err.message)
    );
  }
});
