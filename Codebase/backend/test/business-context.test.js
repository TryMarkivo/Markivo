// The per-business context cell. Pinned keyless (GEMINI_API_KEY = '' BEFORE the
// require, since config caches env at load) so these assert the deterministic
// template cell rather than whatever a live model happens to return.
process.env.GEMINI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';

const { test } = require('node:test');
const assert = require('node:assert');
const createDb = require('../db');
const svc = require('../businessContextService');

const seedProfile = (db) => {
  const u = db.users.create({ email: 'owner@markivo.uz', passwordHash: 'h', fullName: 'Owner' });
  return db.profiles.create({
    userId: u.id, businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', isOnline: false,
    description: 'Third-wave espresso bar with a quiet upstairs work area.',
    targetAudience: 'remote workers and students', brandTone: 'Cozy & Warm', location: 'Tashkent',
  });
};

const profileData = {
  businessName: 'Noir Cafe',
  category: 'Cafe / Coffee Shop',
  description: 'Third-wave espresso bar with a quiet upstairs work area.',
  tone: 'Cozy & Warm',
  audience: 'remote workers and students',
  location: 'Tashkent',
};

test('keyless: createBusinessContext stores a template cell rather than failing', async () => {
  const db = createDb(':memory:');
  const p = seedProfile(db);

  const cell = await svc.createBusinessContext(db, p.id, profileData);
  assert.ok(cell, 'a cell must always be stored, even with no API key');
  assert.strictEqual(cell.source, 'template');
  assert.strictEqual(cell.profileId, p.id);
  assert.match(cell.summary, /Noir Cafe/);
  // Only the owner's own words — nothing invented.
  assert.match(cell.summary, /Third-wave espresso bar/);
  assert.ok(cell.sellingPoints.length >= 2);
  db.close();
});

test('the cell is one row per business — recreating updates, never duplicates', async () => {
  const db = createDb(':memory:');
  const p = seedProfile(db);

  await svc.createBusinessContext(db, p.id, profileData);
  await svc.createBusinessContext(db, p.id, { ...profileData, description: 'Now also a bakery.' });

  const rows = db._raw.prepare('SELECT * FROM business_contexts WHERE profile_id = ?').all(p.id);
  assert.strictEqual(rows.length, 1, 'UNIQUE(profile_id) makes this literally one cell per business');
  assert.match(svc.getBusinessContext(db, p.id).summary, /Now also a bakery/);
  db.close();
});

test('contexts are isolated by business id', async () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'multi@markivo.uz', passwordHash: 'h', fullName: 'Owner' });
  const a = db.profiles.create({ userId: u.id, businessName: 'Noir Cafe', category: 'Cafe', description: 'Espresso bar.' });
  const b = db.profiles.create({ userId: u.id, businessName: 'Bolt Gym', category: 'Gym', description: 'Strength training studio.' });

  await svc.createBusinessContext(db, a.id, { businessName: 'Noir Cafe', category: 'Cafe', description: 'Espresso bar.' });
  await svc.createBusinessContext(db, b.id, { businessName: 'Bolt Gym', category: 'Gym', description: 'Strength training studio.' });

  const ctxA = svc.getBusinessContext(db, a.id);
  const ctxB = svc.getBusinessContext(db, b.id);
  assert.match(ctxA.summary, /Noir Cafe/);
  assert.doesNotMatch(ctxA.summary, /Bolt Gym/);
  assert.match(ctxB.summary, /Bolt Gym/);
  assert.doesNotMatch(ctxB.summary, /Noir Cafe/);
  db.close();
});

test('getBusinessContext returns null for a business with no cell yet', () => {
  const db = createDb(':memory:');
  const p = seedProfile(db);
  assert.strictEqual(svc.getBusinessContext(db, p.id), null);
  db.close();
});

test('contextDigest carries the cell and the anti-fabrication guard; empty for no cell', () => {
  assert.strictEqual(svc.contextDigest(null), '');
  assert.strictEqual(svc.contextDigest({ summary: '' }), '');

  const digest = svc.contextDigest({
    summary: 'Noir Cafe is a third-wave espresso bar.',
    tone: 'Cozy & Warm',
    audience: 'remote workers',
    sellingPoints: ['quiet upstairs', 'single-origin beans'],
  });
  assert.match(digest, /Noir Cafe is a third-wave espresso bar/);
  assert.match(digest, /Cozy & Warm/);
  assert.match(digest, /remote workers/);
  assert.match(digest, /quiet upstairs \| single-origin beans/);
  assert.match(digest, /never invent/i);
});

test('templateContext never invents facts the owner did not give', () => {
  const bare = svc.templateContext({ businessName: 'Solo Shop' });
  assert.match(bare.summary, /Solo Shop/);
  // No description, audience or location was supplied, so none may appear.
  assert.doesNotMatch(bare.summary, /Tashkent/);
  assert.ok(!bare.sellingPoints.some((p) => /Serves:|Based in/.test(p)));
});
