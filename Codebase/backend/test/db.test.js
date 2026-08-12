const { test } = require('node:test');
const assert = require('node:assert');
const createDb = require('../db');

test('users: create / findByEmail / findById', () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'Owner@Markivo.UZ', passwordHash: 'hash', fullName: 'Owner' });
  assert.ok(u.id);
  assert.strictEqual(u.email, 'Owner@Markivo.UZ');

  // Email lookup is case-insensitive.
  assert.strictEqual(db.users.findByEmail('owner@markivo.uz').id, u.id);
  assert.strictEqual(db.users.findById(u.id).fullName, 'Owner');
  assert.strictEqual(db.users.findByEmail('nobody@x.com'), undefined);
  db.close();
});

test('profiles + platforms: create and read back with JSON logo', () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'a@b.com', passwordHash: 'h', fullName: 'A' });
  const p = db.profiles.create({
    userId: u.id, businessName: 'Noir Cafe', category: 'Cafe', isOnline: false,
    logoMetadata: { icon: '☕', color: '#D4A373' },
  });
  assert.strictEqual(p.businessName, 'Noir Cafe');
  assert.deepStrictEqual(p.logo, { icon: '☕', color: '#D4A373' });

  db.platforms.add({ profileId: p.id, platformName: 'instagram', isConnected: true });
  db.platforms.add({ profileId: p.id, platformName: 'telegram', isConnected: true });
  const list = db.platforms.listByProfile(p.id);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(db.profiles.findByUserId(u.id).id, p.id);
  db.close();
});

// Pins the camelCase mapper. autonomous.js reads `c.competitorName` and ends in
// .filter(Boolean), so a mapper field rename would degrade it to an empty list
// silently rather than throwing — this is the assertion that catches that.
test('competitors: camelCase mapper round-trip, unknown metrics stay null', () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'c@b.com', passwordHash: 'h', fullName: 'C' });
  const p = db.profiles.create({ userId: u.id, businessName: 'Noir', category: 'Cafe' });

  db.competitors.add({
    profileId: p.id, competitorName: 'Rival Cafe', rating: 4.4,
    followersCount: null, postsPerWeek: null, platformsDetected: ['google'],
  });
  db.competitors.add({
    profileId: p.id, competitorName: 'Bistro Nine', rating: null,
    followersCount: 2400, postsPerWeek: 6, platformsDetected: ['google', 'instagram'],
  });

  const rows = db.competitors.listByProfile(p.id);
  assert.strictEqual(rows.length, 2);

  const rival = rows.find((c) => c.competitorName === 'Rival Cafe');
  assert.ok(rival, 'competitorName must be camelCase');
  assert.strictEqual(rival.rating, 4.4);
  assert.strictEqual(rival.followersCount, null, 'unknown followers stay null, not 0');
  assert.strictEqual(rival.postsPerWeek, null, 'unknown cadence stays null, not 0');
  assert.deepStrictEqual(rival.platformsDetected, ['google']);

  const bistro = rows.find((c) => c.competitorName === 'Bistro Nine');
  assert.strictEqual(bistro.rating, null, 'unrated competitor stays null, not 0');
  assert.strictEqual(bistro.followersCount, 2400);
  assert.deepStrictEqual(bistro.platformsDetected, ['google', 'instagram']);

  // The exact expression autonomous.js uses to feed competitor names to the AI.
  const names = rows.slice(0, 5).map((c) => c.competitorName).filter(Boolean);
  assert.deepStrictEqual(names.sort(), ['Bistro Nine', 'Rival Cafe']);

  db.close();
});

test('profiles: google discovery fields round-trip and migration is idempotent', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const TMP = path.join(os.tmpdir(), `markivo-mig-${Date.now()}.db`);

  // First open creates the table; second open re-runs the additive ALTER
  // migration against an existing file — must not throw.
  let db = createDb(TMP);
  const u = db.users.create({ email: 'g@b.com', passwordHash: 'h', fullName: 'G' });
  const p = db.profiles.create({
    userId: u.id, businessName: 'Noir', googlePlaceId: 'pid_42', googleRating: 4.5, googleReviewsCount: 10,
  });
  assert.strictEqual(p.googlePlaceId, 'pid_42');
  db.close();

  db = createDb(TMP); // idempotent re-open
  const found = db.profiles.findByUserId(u.id);
  assert.strictEqual(found.googlePlaceId, 'pid_42');
  assert.strictEqual(found.googleRating, 4.5);
  assert.strictEqual(found.googleReviewsCount, 10);
  db.close();
  for (const f of [TMP, `${TMP}-shm`, `${TMP}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('refresh tokens: store / find / revoke', () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'r@b.com', passwordHash: 'h', fullName: 'R' });
  const hash = 'abc123hash';
  db.refreshTokens.store({ userId: u.id, tokenHash: hash, expiresAt: new Date(Date.now() + 1000).toISOString() });

  const found = db.refreshTokens.find(hash);
  assert.strictEqual(found.user_id, u.id);
  assert.strictEqual(found.revoked, 0);

  db.refreshTokens.revoke(hash);
  assert.strictEqual(db.refreshTokens.find(hash).revoked, 1);
  db.close();
});

test('approvals: create and update status', () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'ap@b.com', passwordHash: 'h', fullName: 'Ap' });
  const p = db.profiles.create({ userId: u.id, businessName: 'X' });
  const a = db.approvals.create({ profileId: p.id, actionType: 'ad_creation', actionPayload: { cost: '$5' } });
  assert.strictEqual(a.status, 'pending');
  assert.deepStrictEqual(a.action_payload, { cost: '$5' });

  const updated = db.approvals.updateStatus(a.id, 'approved');
  assert.strictEqual(updated.status, 'approved');
  assert.ok(updated.executed_at);
  db.close();
});
