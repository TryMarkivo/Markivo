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
