const config = require('./config');
const createDb = require('./db');

/**
 * Markivo billing layer — Stripe Checkout subscriptions today, simulated
 * upgrades when no key is configured (mirrors the keyless AI/Places
 * fallbacks, so the whole upgrade flow stays testable offline).
 *
 * Uzbekistan processors (Payme, Click) slot in behind the same
 * createCheckout(user, tier) interface once merchant onboarding completes —
 * see PROVIDERS at the bottom.
 */

// Lazily construct the Stripe client only when a key is present, so the app
// runs with zero billing config (mirrors the ai.js Anthropic pattern).
let stripe = null;
if (config.stripeSecretKey) {
  const Stripe = require('stripe');
  stripe = new Stripe(config.stripeSecretKey);
}

// Own connection to the shared SQLite file (WAL mode — safe alongside the
// server's connection; both run the same idempotent migrations).
const db = createDb(config.dbPath);

const TIERS = ['freemium', 'pro', 'ultimate'];

class BillingError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
  }
}

/**
 * Start a plan change for `user` (a DB user, not JWT claims).
 *
 * - Invalid tier or same-as-current tier → BillingError 400.
 * - Target freemium → immediate downgrade (no payment to collect).
 * - No Stripe key → SIMULATED upgrade: tier applies instantly.
 * - Stripe key set → returns { url } to a hosted Checkout session; the tier
 *   applies when the checkout.session.completed webhook (or a manually
 *   replayed event) lands in applyStripeEvent.
 */
async function createCheckout(user, tier) {
  if (!TIERS.includes(tier)) {
    throw new BillingError(400, `Unknown plan "${tier}" — choose one of: ${TIERS.join(', ')}`);
  }
  const current = (db.users.findById(user.id) || user).tier;
  if (current === tier) {
    throw new BillingError(400, `You are already on the ${tier} plan`);
  }

  // Downgrade to freemium — nothing to charge, applies immediately.
  if (tier === 'freemium') {
    const existing = db.subscriptions.findByUser(user.id);
    db.users.setTier(user.id, 'freemium');
    db.subscriptions.upsertForUser({
      userId: user.id,
      tier: 'freemium',
      status: 'canceled',
      provider: existing ? existing.provider : 'simulated',
      providerRef: existing ? existing.providerRef : null,
      currentPeriodEnd: null,
    });
    return { upgraded: true, tier: 'freemium' };
  }

  // SIMULATED mode (no Stripe key): the upgrade applies instantly.
  if (!stripe) {
    db.users.setTier(user.id, tier);
    db.subscriptions.upsertForUser({
      userId: user.id,
      tier,
      status: 'active',
      provider: 'simulated',
      providerRef: null,
      currentPeriodEnd: null,
    });
    return { upgraded: true, tier, simulated: true };
  }

  // Live mode: hosted Stripe Checkout. price_data keeps pricing in config
  // (no dashboard Product setup needed while prices are provisional).
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: config.tierPrices[tier] * 100,
        recurring: { interval: 'month' },
        product_data: { name: `Markivo ${tier}` },
      },
    }],
    success_url: `${config.appUrl}/?billing=success`,
    cancel_url: `${config.appUrl}/?billing=cancel`,
    metadata: { userId: user.id, tier },
  });
  return { url: session.url };
}

/**
 * Apply a (verified) Stripe event to the DB. Exported separately from the
 * webhook route so tests can drive plan changes without forging signatures.
 */
function applyStripeEvent(event) {
  const obj = event && event.data && event.data.object;
  if (!obj) return { handled: false };

  if (event.type === 'checkout.session.completed') {
    const { userId, tier } = obj.metadata || {};
    if (!userId || !TIERS.includes(tier) || !db.users.findById(userId)) return { handled: false };
    db.users.setTier(userId, tier);
    db.subscriptions.upsertForUser({
      userId,
      tier,
      status: 'active',
      provider: 'stripe',
      providerRef: obj.subscription || obj.id,
      currentPeriodEnd: null,
    });
    return { handled: true, userId, tier };
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = db.subscriptions.findByProviderRef(obj.id);
    if (!sub) return { handled: false };
    db.users.setTier(sub.userId, 'freemium');
    db.subscriptions.upsertForUser({
      userId: sub.userId,
      tier: 'freemium',
      status: 'canceled',
      provider: sub.provider,
      providerRef: sub.providerRef,
      currentPeriodEnd: null,
    });
    return { handled: true, userId: sub.userId, tier: 'freemium' };
  }

  return { handled: false };
}

/**
 * Verify a webhook payload came from Stripe and parse it into an event.
 * Throws BillingError 501 when webhooks aren't configured, 400 on a bad
 * signature.
 */
function constructWebhookEvent(rawBody, signature) {
  if (!config.stripeWebhookSecret || !stripe) {
    throw new BillingError(501, 'webhook not configured');
  }
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
  } catch (err) {
    throw new BillingError(400, 'Invalid Stripe webhook signature');
  }
}

/** Current plan + subscription state for the signed-in user (DB-fresh). */
function getStatus(user) {
  const dbUser = db.users.findById(user.id) || user;
  const sub = db.subscriptions.findByUser(user.id);
  return {
    tier: dbUser.tier,
    provider: sub ? sub.provider : null,
    status: sub ? sub.status : null,
    currentPeriodEnd: sub ? sub.currentPeriodEnd : null,
    simulated: !!sub && sub.provider === 'simulated',
    prices: config.tierPrices,
    limits: config.aiTierLimits,
  };
}

// Future Uzbekistan payment processors. Each implements the same
// createCheckout(user, tier) interface as Stripe, so once merchant
// onboarding completes (business.payme.uz / merchant.click.uz — requires a
// registered business, external timeline) they slot in behind the existing
// /api/billing/checkout route with zero route changes.
const PROVIDERS = {
  payme: {
    createCheckout() {
      throw new BillingError(501, 'Payme/Click merchant onboarding pending — see CREDENTIALS.local.md');
    },
  },
  click: {
    createCheckout() {
      throw new BillingError(501, 'Payme/Click merchant onboarding pending — see CREDENTIALS.local.md');
    },
  },
};

module.exports = { createCheckout, applyStripeEvent, constructWebhookEvent, getStatus, PROVIDERS, BillingError };
