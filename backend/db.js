const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Markivo data-access layer (SQLite via better-sqlite3).
 *
 * Everything the server needs to read/write lives here. The rest of the app
 * never touches SQL directly, so migrating to PostgreSQL later means
 * reimplementing only this one file against the same method surface.
 *
 * @param {string} dbPath  File path for the DB, or ':memory:' for tests.
 */
module.exports = function createDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name     TEXT NOT NULL,
      preferred_lang TEXT DEFAULT 'uz',
      tier          TEXT DEFAULT 'freemium',
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_name   TEXT NOT NULL,
      category        TEXT,
      description     TEXT,
      location        TEXT,
      is_online       INTEGER DEFAULT 0,
      target_audience TEXT,
      brand_tone      TEXT,
      slogan          TEXT,
      logo_metadata   TEXT,
      onboard_path    TEXT,
      created_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platforms (
      id             TEXT PRIMARY KEY,
      profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      platform_name  TEXT NOT NULL,
      is_connected   INTEGER DEFAULT 1,
      account_handle TEXT,
      followers_count INTEGER DEFAULT 0,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id                 TEXT PRIMARY KEY,
      profile_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      competitor_name    TEXT,
      rating             REAL,
      followers_count    INTEGER,
      posts_per_week     INTEGER,
      platforms_detected TEXT
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id            TEXT PRIMARY KEY,
      profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      keyword_phrase TEXT,
      avg_position  INTEGER,
      volume        TEXT
    );

    CREATE TABLE IF NOT EXISTS calendar (
      id             TEXT PRIMARY KEY,
      profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      platform       TEXT,
      post_text      TEXT,
      scheduled_time TEXT,
      status         TEXT DEFAULT 'scheduled'
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id             TEXT PRIMARY KEY,
      profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      action_type    TEXT,
      action_payload TEXT,
      status         TEXT DEFAULT 'pending',
      created_at     TEXT NOT NULL,
      executed_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      revoked    INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_platforms_profile ON platforms(profile_id);
    CREATE INDEX IF NOT EXISTS idx_competitors_profile ON competitors(profile_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_profile ON keywords(profile_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_profile ON calendar(profile_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_profile ON approvals(profile_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_hash ON refresh_tokens(token_hash);
  `);

  const id = () => crypto.randomUUID();
  const now = () => new Date().toISOString();

  // --- row -> API object mappers (snake_case columns -> camelCase) ---
  const mapUser = (r) => r && {
    id: r.id, email: r.email, passwordHash: r.password_hash, fullName: r.full_name,
    preferredLang: r.preferred_lang, tier: r.tier, created_at: r.created_at,
  };
  const mapProfile = (r) => r && {
    id: r.id, userId: r.user_id, businessName: r.business_name, category: r.category,
    description: r.description, location: r.location, isOnline: !!r.is_online,
    targetAudience: r.target_audience, brandTone: r.brand_tone, slogan: r.slogan,
    logoMetadata: r.logo_metadata ? JSON.parse(r.logo_metadata) : null,
    logo: r.logo_metadata ? JSON.parse(r.logo_metadata) : null,
    onboardPath: r.onboard_path, created_at: r.created_at,
  };
  const mapPlatform = (r) => r && {
    id: r.id, profileId: r.profile_id, platformName: r.platform_name,
    isConnected: !!r.is_connected, accountHandle: r.account_handle,
    followersCount: r.followers_count, created_at: r.created_at,
  };
  const mapCompetitor = (r) => r && {
    id: r.id, profileId: r.profile_id, competitor_name: r.competitor_name, rating: r.rating,
    followers_count: r.followers_count, posts_per_week: r.posts_per_week,
    platforms_detected: r.platforms_detected ? JSON.parse(r.platforms_detected) : [],
  };
  const mapKeyword = (r) => r && {
    id: r.id, profileId: r.profile_id, keyword_phrase: r.keyword_phrase,
    avg_position: r.avg_position, volume: r.volume,
  };
  const mapCalendar = (r) => r && {
    id: r.id, profileId: r.profile_id, platform: r.platform, post_text: r.post_text,
    scheduled_time: r.scheduled_time, status: r.status,
  };
  const mapApproval = (r) => r && {
    id: r.id, profileId: r.profile_id, action_type: r.action_type,
    action_payload: r.action_payload ? JSON.parse(r.action_payload) : null,
    status: r.status, created_at: r.created_at, executed_at: r.executed_at,
  };

  return {
    _raw: sqlite,
    close: () => sqlite.close(),

    users: {
      create({ email, passwordHash, fullName, preferredLang = 'uz', tier = 'freemium' }) {
        const row = { id: id(), email, passwordHash, fullName, preferredLang, tier, created_at: now() };
        sqlite.prepare(
          `INSERT INTO users (id, email, password_hash, full_name, preferred_lang, tier, created_at)
           VALUES (@id, @email, @passwordHash, @fullName, @preferredLang, @tier, @created_at)`
        ).run(row);
        return mapUser({ ...row, password_hash: passwordHash, full_name: fullName, preferred_lang: preferredLang });
      },
      findByEmail(email) {
        return mapUser(sqlite.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email));
      },
      findById(userId) {
        return mapUser(sqlite.prepare('SELECT * FROM users WHERE id = ?').get(userId));
      },
    },

    profiles: {
      create(p) {
        const row = {
          id: id(), user_id: p.userId, business_name: p.businessName, category: p.category || null,
          description: p.description || null, location: p.location || null,
          is_online: p.isOnline ? 1 : 0, target_audience: p.targetAudience || null,
          brand_tone: p.brandTone || null, slogan: p.slogan || null,
          logo_metadata: p.logoMetadata ? JSON.stringify(p.logoMetadata) : null,
          onboard_path: p.onboardPath || null, created_at: now(),
        };
        sqlite.prepare(
          `INSERT INTO profiles (id, user_id, business_name, category, description, location,
             is_online, target_audience, brand_tone, slogan, logo_metadata, onboard_path, created_at)
           VALUES (@id, @user_id, @business_name, @category, @description, @location,
             @is_online, @target_audience, @brand_tone, @slogan, @logo_metadata, @onboard_path, @created_at)`
        ).run(row);
        return mapProfile(row);
      },
      findByUserId(userId) {
        return mapProfile(sqlite.prepare(
          'SELECT * FROM profiles WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
        ).get(userId));
      },
      findById(profileId) {
        return mapProfile(sqlite.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId));
      },
    },

    platforms: {
      add(pl) {
        const row = {
          id: id(), profile_id: pl.profileId, platform_name: pl.platformName,
          is_connected: pl.isConnected ? 1 : 0, account_handle: pl.accountHandle || null,
          followers_count: pl.followersCount || 0, created_at: now(),
        };
        sqlite.prepare(
          `INSERT INTO platforms (id, profile_id, platform_name, is_connected, account_handle, followers_count, created_at)
           VALUES (@id, @profile_id, @platform_name, @is_connected, @account_handle, @followers_count, @created_at)`
        ).run(row);
        return mapPlatform(row);
      },
      listByProfile(profileId) {
        return sqlite.prepare('SELECT * FROM platforms WHERE profile_id = ?').all(profileId).map(mapPlatform);
      },
    },

    competitors: {
      add(c) {
        const row = {
          id: id(), profile_id: c.profileId, competitor_name: c.competitorName,
          rating: c.rating, followers_count: c.followersCount, posts_per_week: c.postsPerWeek,
          platforms_detected: JSON.stringify(c.platformsDetected || []),
        };
        sqlite.prepare(
          `INSERT INTO competitors (id, profile_id, competitor_name, rating, followers_count, posts_per_week, platforms_detected)
           VALUES (@id, @profile_id, @competitor_name, @rating, @followers_count, @posts_per_week, @platforms_detected)`
        ).run(row);
        return mapCompetitor(row);
      },
      listByProfile(profileId) {
        return sqlite.prepare('SELECT * FROM competitors WHERE profile_id = ?').all(profileId).map(mapCompetitor);
      },
    },

    keywords: {
      add(k) {
        const row = {
          id: id(), profile_id: k.profileId, keyword_phrase: k.keywordPhrase,
          avg_position: k.avgPosition, volume: k.volume,
        };
        sqlite.prepare(
          `INSERT INTO keywords (id, profile_id, keyword_phrase, avg_position, volume)
           VALUES (@id, @profile_id, @keyword_phrase, @avg_position, @volume)`
        ).run(row);
        return mapKeyword(row);
      },
      listByProfile(profileId) {
        return sqlite.prepare('SELECT * FROM keywords WHERE profile_id = ?').all(profileId).map(mapKeyword);
      },
    },

    calendar: {
      add(post) {
        const row = {
          id: id(), profile_id: post.profileId, platform: post.platform,
          post_text: post.postText, scheduled_time: post.scheduledTime, status: post.status || 'scheduled',
        };
        sqlite.prepare(
          `INSERT INTO calendar (id, profile_id, platform, post_text, scheduled_time, status)
           VALUES (@id, @profile_id, @platform, @post_text, @scheduled_time, @status)`
        ).run(row);
        return mapCalendar(row);
      },
      listByProfile(profileId) {
        return sqlite.prepare('SELECT * FROM calendar WHERE profile_id = ? ORDER BY scheduled_time').all(profileId).map(mapCalendar);
      },
    },

    approvals: {
      create(a) {
        const row = {
          id: id(), profile_id: a.profileId, action_type: a.actionType,
          action_payload: JSON.stringify(a.actionPayload || {}), status: a.status || 'pending',
          created_at: now(), executed_at: null,
        };
        sqlite.prepare(
          `INSERT INTO approvals (id, profile_id, action_type, action_payload, status, created_at, executed_at)
           VALUES (@id, @profile_id, @action_type, @action_payload, @status, @created_at, @executed_at)`
        ).run(row);
        return mapApproval(row);
      },
      findById(approvalId) {
        return mapApproval(sqlite.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId));
      },
      updateStatus(approvalId, status) {
        sqlite.prepare('UPDATE approvals SET status = ?, executed_at = ? WHERE id = ?')
          .run(status, now(), approvalId);
        return mapApproval(sqlite.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId));
      },
    },

    refreshTokens: {
      store({ userId, tokenHash, expiresAt }) {
        const row = { id: id(), user_id: userId, token_hash: tokenHash, expires_at: expiresAt, revoked: 0, created_at: now() };
        sqlite.prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
           VALUES (@id, @user_id, @token_hash, @expires_at, @revoked, @created_at)`
        ).run(row);
        return row;
      },
      find(tokenHash) {
        return sqlite.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
      },
      revoke(tokenHash) {
        sqlite.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(tokenHash);
      },
      revokeAllForUser(userId) {
        sqlite.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
      },
    },
  };
};
