const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const secrets = require('./secrets');

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
      preferred_lang TEXT DEFAULT 'en',
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
      google_place_id      TEXT,
      google_rating        REAL,
      google_reviews_count INTEGER,
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

    CREATE TABLE IF NOT EXISTS telegram_connections (
      id           TEXT PRIMARY KEY,
      profile_id   TEXT UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      bot_token    TEXT NOT NULL,
      bot_user_id  INTEGER,
      bot_username TEXT,
      bot_name     TEXT,
      chat_id      TEXT,
      chat_title   TEXT,
      chat_type    TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS instagram_connections (
      id               TEXT PRIMARY KEY,
      profile_id       TEXT UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      access_token     TEXT NOT NULL,
      token_expires_at TEXT,
      ig_user_id       TEXT,
      ig_username      TEXT,
      page_id          TEXT,
      account_name     TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT
    );

    -- Generic connector framework store (Meta/Facebook/TikTok/Google/YouTube).
    -- One row per (profile, platform). access_token is encrypted at rest; meta
    -- holds platform-specific ids (pageId/igUserId) as JSON. Separate from the
    -- dedicated instagram_connections table used by the Instagram Login flow.
    CREATE TABLE IF NOT EXISTS platform_connections (
      id             TEXT PRIMARY KEY,
      profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      platform       TEXT NOT NULL,
      status         TEXT,
      account_handle TEXT,
      account_id     TEXT,
      access_token   TEXT,
      scopes         TEXT,
      meta           TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT,
      UNIQUE(profile_id, platform)
    );

    -- Reusable message templates, one row per (profile, platform). Built by
    -- pasting a real message the owner already sends; the changing parts become
    -- {{variables}} in template_text. The variables column is a JSON array of
    -- { key, label, example } decorating the placeholders found in the text.
    CREATE TABLE IF NOT EXISTS content_templates (
      id            TEXT PRIMARY KEY,
      profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      platform      TEXT NOT NULL,
      name          TEXT,
      sample_text   TEXT,
      template_text TEXT NOT NULL,
      variables     TEXT,
      source        TEXT,                        -- 'gemini' | 'heuristic' | 'manual'
      created_at    TEXT NOT NULL,
      updated_at    TEXT
    );

    -- Daily snapshot of each dashboard metric, so the sparklines plot REAL
    -- recorded movement instead of a decorative fixed curve. One row per
    -- (profile, metric, day); the day is a local YYYY-MM-DD key.
    CREATE TABLE IF NOT EXISTS metric_history (
      id         TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      metric     TEXT NOT NULL,
      day        TEXT NOT NULL,
      value      REAL NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(profile_id, metric, day)
    );

    CREATE TABLE IF NOT EXISTS media (
      id            TEXT PRIMARY KEY,
      profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind          TEXT,
      mode          TEXT,
      topic         TEXT,
      brief         TEXT,
      file_path     TEXT,
      original_name TEXT,
      status        TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_messages (
      id         TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      sender     TEXT NOT NULL,
      text       TEXT,
      created_at TEXT NOT NULL
    );

    -- Preference memory: every post the owner publishes/schedules/approves is a
    -- positive example of their taste. Mark few-shots on these so it adapts to
    -- each owner over time (no model retraining — pure retrieval + prompting).
    CREATE TABLE IF NOT EXISTS content_feedback (
      id         TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      platform   TEXT,
      signal     TEXT,              -- 'approved' | 'rejected' | 'edited'
      draft_text TEXT,              -- what Mark originally wrote (nullable)
      final_text TEXT,              -- what the owner endorsed/published
      topic      TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tier               TEXT NOT NULL,
      status             TEXT NOT NULL,
      provider           TEXT,
      provider_ref       TEXT,
      current_period_end TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_usage (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS autonomous_config (
      id           TEXT PRIMARY KEY,
      profile_id   TEXT UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      enabled      INTEGER DEFAULT 0,
      platforms    TEXT,                        -- JSON array of platform keys
      frequency    TEXT DEFAULT 'daily',        -- 'daily' | 'weekly' | 'test'
      auto_publish INTEGER DEFAULT 1,           -- 1 = publish organically; 0 = queue approvals
      last_run_at  TEXT,
      next_run_at  TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS autonomous_activity (
      id         TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind       TEXT,
      summary    TEXT,
      payload    TEXT,
      created_at TEXT NOT NULL
    );

    -- Data-deletion request log. Meta's data-deletion callback must hand the
    -- user a confirmation code they can quote back to check progress, so a
    -- request has to outlive the account it erased — this table therefore has
    -- NO foreign key to users(id) and is never cascaded away.
    CREATE TABLE IF NOT EXISTS deletion_requests (
      id               TEXT PRIMARY KEY,
      confirmation_code TEXT UNIQUE NOT NULL,
      source           TEXT NOT NULL,   -- 'account' (self-serve) | 'meta' (callback)
      external_user_id TEXT,            -- Meta app-scoped user id, when source='meta'
      status           TEXT NOT NULL,   -- 'completed' | 'no_match'
      detail           TEXT,
      created_at       TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_deletion_code ON deletion_requests(confirmation_code);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time ON ai_usage(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_platforms_profile ON platforms(profile_id);
    CREATE INDEX IF NOT EXISTS idx_competitors_profile ON competitors(profile_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_profile ON keywords(profile_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_profile ON calendar(profile_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_profile ON approvals(profile_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_hash ON refresh_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_media_profile ON media(profile_id);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_profile_time ON agent_messages(profile_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_content_feedback_profile ON content_feedback(profile_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_instagram_profile ON instagram_connections(profile_id);
    CREATE INDEX IF NOT EXISTS idx_templates_profile_platform ON content_templates(profile_id, platform);
    CREATE INDEX IF NOT EXISTS idx_metric_history_lookup ON metric_history(profile_id, metric, day);
  `);

  // Additive migrations for databases created before a column existed.
  // (CREATE TABLE IF NOT EXISTS never alters an existing table.)
  const addColumn = (table, ddl) => {
    try {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
  };
  addColumn('profiles', 'google_place_id TEXT');
  addColumn('profiles', 'google_rating REAL');
  addColumn('profiles', 'google_reviews_count INTEGER');
  // Brand Identity Brief (JSON): positioning, voice, persona, content pillars,
  // visual direction. Generated post-onboarding and read by every AI generator
  // so output is specific to THIS business, not generic.
  addColumn('profiles', 'brand_brief TEXT');
  // Photo/video attached to a post or template. Instagram has no text-only post
  // type, so a scheduled post without this can only ever publish as simulated.
  addColumn('calendar', 'media_id TEXT');
  addColumn('content_templates', 'media_id TEXT');
  // Free-text label ("Promo", "Announcement", …) shown as a chip on the
  // calendar; repeat_rule (null|'daily'|'weekly'|'monthly') lets the
  // scheduled-post worker clone a post forward once it goes out.
  addColumn('calendar', 'tag TEXT');
  addColumn('calendar', 'repeat_rule TEXT');

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
    googlePlaceId: r.google_place_id || null,
    googleRating: r.google_rating ?? null,
    googleReviewsCount: r.google_reviews_count ?? null,
    brandBrief: r.brand_brief ? JSON.parse(r.brand_brief) : null,
  };
  const mapPlatform = (r) => r && {
    id: r.id, profileId: r.profile_id, platformName: r.platform_name,
    isConnected: !!r.is_connected, accountHandle: r.account_handle,
    followersCount: r.followers_count, created_at: r.created_at,
  };
  // Every metric uses `?? null`, never `|| 0`: a competitor's unknown follower
  // count or cadence must reach the API as null so the UI can say "not
  // reported" instead of a number nobody measured.
  const mapCompetitor = (r) => r && {
    id: r.id, profileId: r.profile_id,
    competitorName: r.competitor_name,
    rating: r.rating ?? null,
    followersCount: r.followers_count ?? null,
    postsPerWeek: r.posts_per_week ?? null,
    platformsDetected: r.platforms_detected ? JSON.parse(r.platforms_detected) : [],
  };
  const mapKeyword = (r) => r && {
    id: r.id, profileId: r.profile_id, keyword_phrase: r.keyword_phrase,
    avg_position: r.avg_position, volume: r.volume,
  };
  const mapCalendar = (r) => r && {
    id: r.id, profileId: r.profile_id, platform: r.platform, post_text: r.post_text,
    scheduled_time: r.scheduled_time, status: r.status, mediaId: r.media_id || null,
    tag: r.tag || null, repeatRule: r.repeat_rule || null,
  };
  const mapMedia = (r) => r && {
    id: r.id, profileId: r.profile_id, kind: r.kind, mode: r.mode, topic: r.topic,
    brief: r.brief ? JSON.parse(r.brief) : null,
    filePath: r.file_path, originalName: r.original_name,
    status: r.status, created_at: r.created_at,
  };
  const mapAgentMessage = (r) => r && {
    id: r.id, profileId: r.profile_id, sender: r.sender, text: r.text, created_at: r.created_at,
  };
  const mapTemplate = (r) => r && {
    id: r.id, profileId: r.profile_id, platform: r.platform, name: r.name,
    sampleText: r.sample_text, templateText: r.template_text,
    variables: r.variables ? JSON.parse(r.variables) : [],
    source: r.source, mediaId: r.media_id || null,
    created_at: r.created_at, updated_at: r.updated_at,
  };
  const mapSubscription = (r) => r && {
    id: r.id, userId: r.user_id, tier: r.tier, status: r.status,
    provider: r.provider, providerRef: r.provider_ref,
    currentPeriodEnd: r.current_period_end,
    created_at: r.created_at, updated_at: r.updated_at,
  };
  const mapDeletionRequest = (r) => r && {
    id: r.id, confirmationCode: r.confirmation_code, source: r.source,
    externalUserId: r.external_user_id, status: r.status, detail: r.detail,
    created_at: r.created_at,
  };
  const mapApproval = (r) => r && {
    id: r.id, profileId: r.profile_id, action_type: r.action_type,
    action_payload: r.action_payload ? JSON.parse(r.action_payload) : null,
    status: r.status, created_at: r.created_at, executed_at: r.executed_at,
  };
  const mapAutoConfig = (r) => r && {
    id: r.id, profileId: r.profile_id, enabled: !!r.enabled,
    platforms: r.platforms ? JSON.parse(r.platforms) : [],
    frequency: r.frequency, autoPublish: !!r.auto_publish,
    lastRunAt: r.last_run_at, nextRunAt: r.next_run_at,
    created_at: r.created_at, updated_at: r.updated_at,
  };
  const mapAutoActivity = (r) => r && {
    id: r.id, profileId: r.profile_id, kind: r.kind, summary: r.summary,
    payload: r.payload ? JSON.parse(r.payload) : null, created_at: r.created_at,
  };

  return {
    _raw: sqlite,
    close: () => sqlite.close(),

    users: {
      create({ email, passwordHash, fullName, preferredLang = 'en', tier = 'freemium' }) {
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
      // Pricing tier changes always go through here (billing layer) so the
      // tier read by usageInfo is the DB's, never a stale JWT claim.
      setTier(userId, tier) {
        sqlite.prepare('UPDATE users SET tier = ? WHERE id = ?').run(tier, userId);
        return mapUser(sqlite.prepare('SELECT * FROM users WHERE id = ?').get(userId));
      },
      // Partial update: only keys present in `fields` are written.
      updateProfile(userId, fields = {}) {
        const colFor = { fullName: 'full_name', preferredLang: 'preferred_lang' };
        const sets = [];
        const params = { userId };
        for (const [key, col] of Object.entries(colFor)) {
          if (fields[key] === undefined) continue;
          sets.push(`${col} = @${key}`);
          params[key] = fields[key];
        }
        if (sets.length) {
          sqlite.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @userId`).run(params);
        }
        return mapUser(sqlite.prepare('SELECT * FROM users WHERE id = ?').get(userId));
      },
      // Erase the account. Every per-user and per-profile table declares
      // ON DELETE CASCADE and `foreign_keys` is ON, so one DELETE removes the
      // profiles, connections, tokens, content, and usage rows with it.
      // Uploaded files live on disk, outside SQL — their paths are collected
      // BEFORE the delete and returned so the caller can unlink them.
      delete(userId) {
        const mediaPaths = sqlite.prepare(
          `SELECT m.file_path AS p FROM media m
             JOIN profiles pr ON pr.id = m.profile_id
            WHERE pr.user_id = ? AND m.file_path IS NOT NULL`
        ).all(userId).map((r) => r.p);
        const info = sqlite.prepare('DELETE FROM users WHERE id = ?').run(userId);
        return { deleted: info.changes > 0, mediaPaths };
      },
    },

    // Data-deletion request log (see the deletion_requests table comment).
    deletionRequests: {
      create({ confirmationCode, source, externalUserId = null, status, detail = null }) {
        const row = {
          id: id(), confirmation_code: confirmationCode, source,
          external_user_id: externalUserId, status, detail, created_at: now(),
        };
        sqlite.prepare(
          `INSERT INTO deletion_requests (id, confirmation_code, source, external_user_id, status, detail, created_at)
           VALUES (@id, @confirmation_code, @source, @external_user_id, @status, @detail, @created_at)`
        ).run(row);
        return mapDeletionRequest(row);
      },
      findByCode(code) {
        return mapDeletionRequest(
          sqlite.prepare('SELECT * FROM deletion_requests WHERE confirmation_code = ?').get(code)
        );
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
          onboard_path: p.onboardPath || null,
          google_place_id: p.googlePlaceId || null,
          google_rating: p.googleRating ?? null,
          google_reviews_count: p.googleReviewsCount ?? null,
          created_at: now(),
        };
        sqlite.prepare(
          `INSERT INTO profiles (id, user_id, business_name, category, description, location,
             is_online, target_audience, brand_tone, slogan, logo_metadata, onboard_path,
             google_place_id, google_rating, google_reviews_count, created_at)
           VALUES (@id, @user_id, @business_name, @category, @description, @location,
             @is_online, @target_audience, @brand_tone, @slogan, @logo_metadata, @onboard_path,
             @google_place_id, @google_rating, @google_reviews_count, @created_at)`
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
      // Partial update: only keys present in `fields` are written.
      update(profileId, fields = {}) {
        const colFor = {
          businessName: 'business_name',
          category: 'category',
          description: 'description',
          location: 'location',
          isOnline: 'is_online',
          targetAudience: 'target_audience',
          brandTone: 'brand_tone',
          slogan: 'slogan',
          logoMetadata: 'logo_metadata',
          brandBrief: 'brand_brief',
        };
        const sets = [];
        const params = { profileId };
        for (const [key, col] of Object.entries(colFor)) {
          if (fields[key] === undefined) continue;
          let value = fields[key];
          if (key === 'isOnline') value = value ? 1 : 0;
          if (key === 'logoMetadata') value = value ? JSON.stringify(value) : null;
          if (key === 'brandBrief') value = value ? JSON.stringify(value) : null;
          sets.push(`${col} = @${key}`);
          params[key] = value;
        }
        if (sets.length) {
          sqlite.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = @profileId`).run(params);
        }
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
      setConnected(profileId, platformName, accountHandle, isConnected = true) {
        const existing = sqlite.prepare(
          'SELECT id FROM platforms WHERE profile_id = ? AND platform_name = ?'
        ).get(profileId, platformName);
        if (existing) {
          sqlite.prepare(
            'UPDATE platforms SET is_connected = ?, account_handle = COALESCE(?, account_handle) WHERE id = ?'
          ).run(isConnected ? 1 : 0, accountHandle || null, existing.id);
        } else {
          this.add({ profileId, platformName, isConnected, accountHandle, followersCount: 0 });
        }
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
          media_id: post.mediaId || null, tag: post.tag || null, repeat_rule: post.repeatRule || null,
        };
        sqlite.prepare(
          `INSERT INTO calendar (id, profile_id, platform, post_text, scheduled_time, status, media_id, tag, repeat_rule)
           VALUES (@id, @profile_id, @platform, @post_text, @scheduled_time, @status, @media_id, @tag, @repeat_rule)`
        ).run(row);
        return mapCalendar(row);
      },
      listByProfile(profileId) {
        return sqlite.prepare('SELECT * FROM calendar WHERE profile_id = ? ORDER BY scheduled_time').all(profileId).map(mapCalendar);
      },
      // All still-scheduled posts (any profile) whose time has come — the
      // scheduled-post worker's work queue.
      listDue(nowIso) {
        return sqlite.prepare(
          "SELECT * FROM calendar WHERE status = 'scheduled' AND scheduled_time <= ? ORDER BY scheduled_time"
        ).all(nowIso).map(mapCalendar);
      },
      setStatus(postId, status) {
        sqlite.prepare('UPDATE calendar SET status = ? WHERE id = ?').run(status, postId);
        return mapCalendar(sqlite.prepare('SELECT * FROM calendar WHERE id = ?').get(postId));
      },
      findById(postId) {
        return mapCalendar(sqlite.prepare('SELECT * FROM calendar WHERE id = ?').get(postId));
      },
      // Drag-to-reschedule from the calendar view.
      setScheduledTime(postId, scheduledTime) {
        sqlite.prepare('UPDATE calendar SET scheduled_time = ? WHERE id = ?').run(scheduledTime, postId);
        return mapCalendar(sqlite.prepare('SELECT * FROM calendar WHERE id = ?').get(postId));
      },
      // Partial update for the "edit an existing post" flow — only the
      // columns present in `patch` are touched. Keys: postText, scheduledTime,
      // mediaId, tag, repeatRule, status.
      update(postId, patch) {
        const columns = {
          postText: 'post_text', scheduledTime: 'scheduled_time', mediaId: 'media_id',
          tag: 'tag', repeatRule: 'repeat_rule', status: 'status',
        };
        const sets = [];
        const params = { id: postId };
        for (const [key, column] of Object.entries(columns)) {
          if (!(key in patch)) continue;
          sets.push(`${column} = @${column}`);
          params[column] = patch[key];
        }
        if (sets.length) {
          sqlite.prepare(`UPDATE calendar SET ${sets.join(', ')} WHERE id = @id`).run(params);
        }
        return mapCalendar(sqlite.prepare('SELECT * FROM calendar WHERE id = ?').get(postId));
      },
      remove(postId) {
        sqlite.prepare('DELETE FROM calendar WHERE id = ?').run(postId);
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
      listByProfile(profileId, limit = 30) {
        return sqlite.prepare('SELECT * FROM approvals WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(profileId, limit).map(mapApproval);
      },
    },

    // Markiv's conversation memory — one row per chat bubble.
    agentMessages: {
      add({ profileId, sender, text }) {
        const row = {
          id: id(), profile_id: profileId, sender,
          text: text == null ? null : String(text), created_at: now(),
        };
        sqlite.prepare(
          `INSERT INTO agent_messages (id, profile_id, sender, text, created_at)
           VALUES (@id, @profile_id, @sender, @text, @created_at)`
        ).run(row);
        return mapAgentMessage(row);
      },
      // The LAST `limit` messages, returned in chronological order. rowid
      // breaks ties when two rows land in the same millisecond (every
      // user/agent pair does — they're written in one request).
      listByProfile(profileId, limit = 40) {
        // rowid must be aliased to survive the subquery (SQLite drops it
        // from `SELECT *` projections).
        return sqlite.prepare(
          `SELECT * FROM (
             SELECT *, rowid AS _rid FROM agent_messages WHERE profile_id = ?
             ORDER BY created_at DESC, _rid DESC LIMIT ?
           ) ORDER BY created_at ASC, _rid ASC`
        ).all(profileId, limit).map(mapAgentMessage);
      },
      clearByProfile(profileId) {
        sqlite.prepare('DELETE FROM agent_messages WHERE profile_id = ?').run(profileId);
      },
    },

    // Preference memory — what the owner actually publishes is the strongest
    // signal of their taste. Used to personalise future generations per business.
    feedback: {
      record({ profileId, platform, signal = 'approved', draftText, finalText, topic }) {
        const text = finalText == null ? null : String(finalText).slice(0, 4000);
        if (!text || !text.trim()) return null; // only store meaningful posts
        const row = {
          id: id(), profile_id: profileId, platform: platform || null, signal,
          draft_text: draftText == null ? null : String(draftText).slice(0, 4000),
          final_text: text, topic: topic == null ? null : String(topic).slice(0, 300),
          created_at: now(),
        };
        sqlite.prepare(
          `INSERT INTO content_feedback (id, profile_id, platform, signal, draft_text, final_text, topic, created_at)
           VALUES (@id, @profile_id, @platform, @signal, @draft_text, @final_text, @topic, @created_at)`
        ).run(row);
        return { id: row.id };
      },
      // Recent owner-endorsed posts (newest first), de-duplicated by text — the
      // positive few-shot examples the generators match.
      recentExamples(profileId, limit = 3) {
        const rows = sqlite.prepare(
          `SELECT platform, final_text, topic, created_at, rowid AS _rid FROM content_feedback
           WHERE profile_id = ? AND signal IN ('approved', 'edited') AND final_text IS NOT NULL
           ORDER BY created_at DESC, _rid DESC LIMIT ?`
        ).all(profileId, Math.max(1, Math.min(40, limit * 5)));
        const seen = new Set();
        const out = [];
        for (const r of rows) {
          const key = (r.final_text || '').trim().slice(0, 120).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ platform: r.platform, text: r.final_text, topic: r.topic, created_at: r.created_at });
          if (out.length >= limit) break;
        }
        return out;
      },
      countByProfile(profileId) {
        return sqlite.prepare(
          "SELECT COUNT(*) AS n FROM content_feedback WHERE profile_id = ? AND signal IN ('approved', 'edited')"
        ).get(profileId).n;
      },
      listByProfile(profileId, limit = 20) {
        return sqlite.prepare(
          `SELECT platform, signal, final_text, topic, created_at FROM content_feedback
           WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`
        ).all(profileId, limit);
      },
    },

    media: {
      add(m) {
        const row = {
          id: id(), profile_id: m.profileId, kind: m.kind || null, mode: m.mode || null,
          topic: m.topic || null, brief: m.brief ? JSON.stringify(m.brief) : null,
          file_path: m.filePath || null, original_name: m.originalName || null,
          status: m.status || 'brief', created_at: now(),
        };
        sqlite.prepare(
          `INSERT INTO media (id, profile_id, kind, mode, topic, brief, file_path, original_name, status, created_at)
           VALUES (@id, @profile_id, @kind, @mode, @topic, @brief, @file_path, @original_name, @status, @created_at)`
        ).run(row);
        return mapMedia(row);
      },
      listByProfile(profileId) {
        return sqlite.prepare(
          'SELECT * FROM media WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC'
        ).all(profileId).map(mapMedia);
      },
      findById(mediaId) {
        return mapMedia(sqlite.prepare('SELECT * FROM media WHERE id = ?').get(mediaId));
      },
      // Partial update: only keys present in `fields` are written.
      update(mediaId, fields = {}) {
        const colFor = {
          kind: 'kind', mode: 'mode', topic: 'topic', brief: 'brief',
          filePath: 'file_path', originalName: 'original_name', status: 'status',
        };
        const sets = [];
        const params = { mediaId };
        for (const [key, col] of Object.entries(colFor)) {
          if (fields[key] === undefined) continue;
          let value = fields[key];
          if (key === 'brief') value = value ? JSON.stringify(value) : null;
          sets.push(`${col} = @${key}`);
          params[key] = value;
        }
        if (sets.length) {
          sqlite.prepare(`UPDATE media SET ${sets.join(', ')} WHERE id = @mediaId`).run(params);
        }
        return mapMedia(sqlite.prepare('SELECT * FROM media WHERE id = ?').get(mediaId));
      },
    },

    usage: {
      record({ userId, kind }) {
        sqlite.prepare('INSERT INTO ai_usage (id, user_id, kind, created_at) VALUES (?, ?, ?, ?)')
          .run(id(), userId, kind, now());
      },
      // Generations used since the start of the current UTC month.
      // ISO-8601 strings compare lexicographically, so a prefix bound works.
      countThisMonth(userId) {
        const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
        return sqlite.prepare(
          'SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND created_at >= ?'
        ).get(userId, monthStart).n;
      },
    },

    // Pricing subscriptions — one row per user (the upsert replaces any
    // previous subscription, so the table always reflects the current plan).
    subscriptions: {
      upsertForUser({ userId, tier, status, provider, providerRef, currentPeriodEnd }) {
        const existing = sqlite.prepare('SELECT id FROM subscriptions WHERE user_id = ?').get(userId);
        if (existing) {
          sqlite.prepare(
            `UPDATE subscriptions SET tier = ?, status = ?, provider = ?, provider_ref = ?,
             current_period_end = ?, updated_at = ? WHERE id = ?`
          ).run(tier, status, provider || null, providerRef || null, currentPeriodEnd || null, now(), existing.id);
        } else {
          sqlite.prepare(
            `INSERT INTO subscriptions (id, user_id, tier, status, provider, provider_ref, current_period_end, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(id(), userId, tier, status, provider || null, providerRef || null, currentPeriodEnd || null, now(), now());
        }
        return this.findByUser(userId);
      },
      findByUser(userId) {
        return mapSubscription(sqlite.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId));
      },
      // Stripe webhooks identify a subscription by its provider id, not ours.
      findByProviderRef(providerRef) {
        return mapSubscription(sqlite.prepare('SELECT * FROM subscriptions WHERE provider_ref = ?').get(providerRef));
      },
    },

    telegram: {
      // Bot token is encrypted at rest; mapTelegram decrypts on the way out.
      upsertBot({ profileId, botToken, botUserId, botUsername, botName }) {
        const existing = sqlite.prepare('SELECT id FROM telegram_connections WHERE profile_id = ?').get(profileId);
        const enc = secrets.encrypt(botToken);
        if (existing) {
          sqlite.prepare(
            `UPDATE telegram_connections SET bot_token = ?, bot_user_id = ?, bot_username = ?, bot_name = ?,
             chat_id = NULL, chat_title = NULL, chat_type = NULL, updated_at = ? WHERE id = ?`
          ).run(enc, botUserId, botUsername, botName, now(), existing.id);
        } else {
          sqlite.prepare(
            `INSERT INTO telegram_connections (id, profile_id, bot_token, bot_user_id, bot_username, bot_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(id(), profileId, enc, botUserId, botUsername, botName, now());
        }
        return this.findByProfile(profileId);
      },
      setChat(profileId, { chatId, chatTitle, chatType }) {
        sqlite.prepare(
          'UPDATE telegram_connections SET chat_id = ?, chat_title = ?, chat_type = ?, updated_at = ? WHERE profile_id = ?'
        ).run(chatId, chatTitle || null, chatType || null, now(), profileId);
        return this.findByProfile(profileId);
      },
      findByProfile(profileId) {
        const r = sqlite.prepare('SELECT * FROM telegram_connections WHERE profile_id = ?').get(profileId);
        if (!r) return null;
        let botToken = null;
        try {
          botToken = secrets.decrypt(r.bot_token);
        } catch {
          // Encryption key changed (JWT_SECRET rotated) — connection is unusable.
          return null;
        }
        return {
          id: r.id, profileId: r.profile_id, botToken, botUserId: r.bot_user_id,
          botUsername: r.bot_username, botName: r.bot_name,
          chatId: r.chat_id, chatTitle: r.chat_title, chatType: r.chat_type,
          created_at: r.created_at, updated_at: r.updated_at,
        };
      },
      remove(profileId) {
        sqlite.prepare('DELETE FROM telegram_connections WHERE profile_id = ?').run(profileId);
      },
    },

    instagram: {
      // Access token is encrypted at rest (secrets.encrypt); findByProfile
      // decrypts on the way out. One row per profile (profile_id is UNIQUE).
      upsert({ profileId, accessToken, tokenExpiresAt, igUserId, igUsername, pageId, accountName }) {
        const enc = secrets.encrypt(accessToken);
        const existing = sqlite.prepare('SELECT id FROM instagram_connections WHERE profile_id = ?').get(profileId);
        if (existing) {
          sqlite.prepare(
            `UPDATE instagram_connections SET access_token = ?, token_expires_at = ?, ig_user_id = ?,
             ig_username = ?, page_id = ?, account_name = ?, updated_at = ? WHERE id = ?`
          ).run(enc, tokenExpiresAt || null, igUserId || null, igUsername || null, pageId || null, accountName || null, now(), existing.id);
        } else {
          sqlite.prepare(
            `INSERT INTO instagram_connections (id, profile_id, access_token, token_expires_at, ig_user_id, ig_username, page_id, account_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(id(), profileId, enc, tokenExpiresAt || null, igUserId || null, igUsername || null, pageId || null, accountName || null, now());
        }
        return this.findByProfile(profileId);
      },
      findByProfile(profileId) {
        const r = sqlite.prepare('SELECT * FROM instagram_connections WHERE profile_id = ?').get(profileId);
        if (!r) return null;
        let accessToken = null;
        try {
          accessToken = secrets.decrypt(r.access_token);
        } catch {
          // Encryption key changed (JWT_SECRET rotated) — connection is unusable.
          return null;
        }
        return {
          id: r.id, profileId: r.profile_id, accessToken, tokenExpiresAt: r.token_expires_at,
          igUserId: r.ig_user_id, igUsername: r.ig_username, pageId: r.page_id, accountName: r.account_name,
          created_at: r.created_at, updated_at: r.updated_at,
        };
      },
      remove(profileId) {
        sqlite.prepare('DELETE FROM instagram_connections WHERE profile_id = ?').run(profileId);
      },
    },

    // Generic connector-framework store (connectors/*). One row per (profile,
    // platform), keyed by the connector registry key (e.g. 'meta_instagram').
    // access_token is encrypted at rest; meta holds platform ids as JSON. With
    // no rows, adapters fall back to sandbox (simulated) publishing.
    connections: {
      upsert({ profileId, platform, status, accountHandle, accountId, accessToken, scopes, meta }) {
        const enc = accessToken ? secrets.encrypt(accessToken) : null;
        const scopesJson = scopes ? JSON.stringify(scopes) : null;
        const metaJson = meta ? JSON.stringify(meta) : null;
        const existing = sqlite.prepare('SELECT id FROM platform_connections WHERE profile_id = ? AND platform = ?').get(profileId, platform);
        if (existing) {
          sqlite.prepare(
            `UPDATE platform_connections SET status = ?, account_handle = ?, account_id = ?,
             access_token = ?, scopes = ?, meta = ?, updated_at = ? WHERE id = ?`
          ).run(status || null, accountHandle || null, accountId || null, enc, scopesJson, metaJson, now(), existing.id);
        } else {
          sqlite.prepare(
            `INSERT INTO platform_connections (id, profile_id, platform, status, account_handle, account_id, access_token, scopes, meta, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(id(), profileId, platform, status || null, accountHandle || null, accountId || null, enc, scopesJson, metaJson, now());
        }
        return this.findByProfile(profileId, platform);
      },
      findByProfile(profileId, platform) {
        const r = sqlite.prepare('SELECT * FROM platform_connections WHERE profile_id = ? AND platform = ?').get(profileId, platform);
        if (!r) return null;
        let accessToken = null;
        if (r.access_token) {
          try {
            accessToken = secrets.decrypt(r.access_token);
          } catch {
            // Encryption key rotated (JWT_SECRET changed) — connection unusable.
            return null;
          }
        }
        return {
          id: r.id, profileId: r.profile_id, platform: r.platform, status: r.status,
          accountHandle: r.account_handle, accountId: r.account_id, accessToken,
          scopes: r.scopes ? JSON.parse(r.scopes) : [], meta: r.meta ? JSON.parse(r.meta) : null,
          created_at: r.created_at, updated_at: r.updated_at,
        };
      },
      // Connected platform keys for a profile — { platform } rows, as the
      // autopilot and agent expect.
      listByProfile(profileId) {
        return sqlite.prepare('SELECT platform FROM platform_connections WHERE profile_id = ?').all(profileId).map((r) => ({ platform: r.platform }));
      },
      remove(profileId, platform) {
        sqlite.prepare('DELETE FROM platform_connections WHERE profile_id = ? AND platform = ?').run(profileId, platform);
      },
      // Owning user ids for a Meta app-scoped user id — the identifier Meta's
      // data-deletion callback sends. It is stored in the connection's `meta`
      // JSON as metaUserId (captured at connect time), and is NOT the same as
      // account_id (a Page id or IG business-account id). Returns [] when the
      // id is unknown to us, which is a legitimate outcome the callback reports
      // rather than an error.
      findUserIdsByMetaUserId(metaUserId) {
        if (!metaUserId) return [];
        const rows = sqlite.prepare(
          `SELECT DISTINCT pr.user_id AS userId
             FROM platform_connections pc
             JOIN profiles pr ON pr.id = pc.profile_id
            WHERE pc.meta IS NOT NULL
              AND json_extract(pc.meta, '$.metaUserId') = ?`
        ).all(String(metaUserId));
        return rows.map((r) => r.userId);
      },
    },

    // Reusable message templates per (profile, platform). The template TEXT is
    // the source of truth for which {{variables}} exist; the stored `variables`
    // array only carries their labels and example values.
    templates: {
      create({ profileId, platform, name, sampleText, templateText, variables, source, mediaId }) {
        const row = {
          id: id(),
          profile_id: profileId,
          platform: String(platform || 'instagram').toLowerCase(),
          name: name || null,
          sample_text: sampleText || null,
          template_text: templateText,
          variables: JSON.stringify(variables || []),
          source: source || 'manual',
          media_id: mediaId || null,
          created_at: now(),
          updated_at: now(),
        };
        sqlite.prepare(
          `INSERT INTO content_templates (id, profile_id, platform, name, sample_text, template_text, variables, source, media_id, created_at, updated_at)
           VALUES (@id, @profile_id, @platform, @name, @sample_text, @template_text, @variables, @source, @media_id, @created_at, @updated_at)`
        ).run(row);
        return mapTemplate(row);
      },
      findById(templateId) {
        return mapTemplate(sqlite.prepare('SELECT * FROM content_templates WHERE id = ?').get(templateId));
      },
      // All templates for a profile, newest first; optionally one platform only.
      listByProfile(profileId, platform) {
        const rows = platform
          ? sqlite.prepare('SELECT * FROM content_templates WHERE profile_id = ? AND platform = ? ORDER BY created_at DESC').all(profileId, String(platform).toLowerCase())
          : sqlite.prepare('SELECT * FROM content_templates WHERE profile_id = ? ORDER BY created_at DESC').all(profileId);
        return rows.map(mapTemplate);
      },
      update(templateId, fields = {}) {
        const colFor = {
          name: 'name',
          platform: 'platform',
          sampleText: 'sample_text',
          templateText: 'template_text',
          source: 'source',
          // Pass null to detach the photo/video from a saved template.
          mediaId: 'media_id',
        };
        const sets = [];
        const params = { id: templateId, updated_at: now() };
        for (const [key, col] of Object.entries(colFor)) {
          if (fields[key] === undefined) continue;
          sets.push(`${col} = @${col}`);
          params[col] = key === 'platform' ? String(fields[key]).toLowerCase() : fields[key];
        }
        if (fields.variables !== undefined) {
          sets.push('variables = @variables');
          params.variables = JSON.stringify(fields.variables || []);
        }
        if (sets.length) {
          sqlite.prepare(`UPDATE content_templates SET ${sets.join(', ')}, updated_at = @updated_at WHERE id = @id`).run(params);
        }
        return this.findById(templateId);
      },
      remove(templateId) {
        sqlite.prepare('DELETE FROM content_templates WHERE id = ?').run(templateId);
      },
    },

    // Recorded metric history — what the dashboard sparklines actually plot.
    metricHistory: {
      // Idempotent per day: the dashboard is fetched many times a day, and only
      // the latest reading for a day should survive.
      record({ profileId, metric, day, value }) {
        sqlite.prepare(
          `INSERT INTO metric_history (id, profile_id, metric, day, value, created_at)
           VALUES (@id, @profile_id, @metric, @day, @value, @created_at)
           ON CONFLICT(profile_id, metric, day) DO UPDATE SET value = @value, created_at = @created_at`
        ).run({
          id: id(), profile_id: profileId, metric, day, value, created_at: now(),
        });
      },
      // Oldest-first so the caller can plot straight through the array.
      series(profileId, metric, limit = 30) {
        const rows = sqlite.prepare(
          'SELECT day, value FROM metric_history WHERE profile_id = ? AND metric = ? ORDER BY day DESC LIMIT ?'
        ).all(profileId, metric, limit);
        return rows.reverse().map((r) => ({ day: r.day, value: r.value }));
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

    // --- Autopilot (autonomous marketing agent) ---
    autonomous: {
      getConfig(profileId) {
        return mapAutoConfig(sqlite.prepare('SELECT * FROM autonomous_config WHERE profile_id = ?').get(profileId));
      },
      upsertConfig({ profileId, enabled, platforms, frequency, autoPublish, nextRunAt }) {
        const existing = sqlite.prepare('SELECT id FROM autonomous_config WHERE profile_id = ?').get(profileId);
        const p = {
          profile_id: profileId,
          enabled: enabled ? 1 : 0,
          platforms: JSON.stringify(Array.isArray(platforms) ? platforms : []),
          frequency: frequency || 'daily',
          auto_publish: autoPublish ? 1 : 0,
          next_run_at: nextRunAt || null,
          updated_at: now(),
        };
        if (existing) {
          sqlite.prepare(
            `UPDATE autonomous_config SET enabled=@enabled, platforms=@platforms, frequency=@frequency,
             auto_publish=@auto_publish, next_run_at=@next_run_at, updated_at=@updated_at WHERE profile_id=@profile_id`
          ).run(p);
        } else {
          sqlite.prepare(
            `INSERT INTO autonomous_config (id, profile_id, enabled, platforms, frequency, auto_publish, next_run_at, created_at, updated_at)
             VALUES (@id, @profile_id, @enabled, @platforms, @frequency, @auto_publish, @next_run_at, @created_at, @updated_at)`
          ).run({ ...p, id: id(), created_at: now() });
        }
        return this.getConfig(profileId);
      },
      setRun(profileId, { lastRunAt, nextRunAt }) {
        sqlite.prepare('UPDATE autonomous_config SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE profile_id = ?')
          .run(lastRunAt || null, nextRunAt || null, now(), profileId);
        return this.getConfig(profileId);
      },
      // Atomically claim a due run: advances next_run_at ONLY if the profile is
      // still enabled and due as of `asOfIso`. Returns true when this caller won
      // the claim (changes === 1), false if another runner already took it or it
      // isn't due — the guard against concurrent double-runs.
      claimDue(profileId, asOfIso, nextRunAt) {
        const info = sqlite.prepare(
          `UPDATE autonomous_config SET last_run_at = @asOf, next_run_at = @next, updated_at = @asOf
           WHERE profile_id = @pid AND enabled = 1 AND (next_run_at IS NULL OR next_run_at <= @asOf)`
        ).run({ pid: profileId, asOf: asOfIso, next: nextRunAt || null });
        return info.changes === 1;
      },
      // Enabled profiles whose next run is due (or never scheduled). The worker's
      // work queue — mirrors calendar.listDue for scheduled posts.
      dueProfiles(nowIso) {
        return sqlite.prepare(
          `SELECT profile_id FROM autonomous_config
           WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)`
        ).all(nowIso).map((r) => r.profile_id);
      },
      logActivity({ profileId, kind, summary, payload }) {
        const row = {
          id: id(), profile_id: profileId, kind: kind || null,
          summary: summary == null ? null : String(summary),
          payload: payload ? JSON.stringify(payload) : null, created_at: now(),
        };
        sqlite.prepare(
          `INSERT INTO autonomous_activity (id, profile_id, kind, summary, payload, created_at)
           VALUES (@id, @profile_id, @kind, @summary, @payload, @created_at)`
        ).run(row);
        return mapAutoActivity(row);
      },
      listActivity(profileId, limit = 30) {
        return sqlite.prepare('SELECT * FROM autonomous_activity WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(profileId, limit).map(mapAutoActivity);
      },
    },
  };
};
