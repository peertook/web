-- Peertook Database Schema (Cloudflare D1 / SQLite)

PRAGMA foreign_keys = ON;

-- =========================================================
-- USERS
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  avatar_url    TEXT,
  bio           TEXT DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);

-- =========================================================
-- SESSIONS (server-side token store, HttpOnly cookie)
-- =========================================================
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT,
  ip_hash     TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- =========================================================
-- VIDEOS
-- =========================================================
CREATE TABLE IF NOT EXISTS videos (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  video_key     TEXT NOT NULL,
  thumbnail_key TEXT,
  duration      INTEGER DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  visibility    TEXT NOT NULL DEFAULT 'public'
                CHECK (visibility IN ('public','unlisted','private')),
  status        TEXT NOT NULL DEFAULT 'ready'
                CHECK (status IN ('pending','ready','failed')),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_videos_user       ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_created    ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos(visibility);

-- =========================================================
-- COMMENTS
-- =========================================================
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  video_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_video   ON comments(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_user    ON comments(user_id);

-- =========================================================
-- LIKES
-- =========================================================
CREATE TABLE IF NOT EXISTS likes (
  id         TEXT PRIMARY KEY,
  video_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (video_id, user_id),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_likes_video ON likes(video_id);

-- =========================================================
-- SUBSCRIPTIONS
-- =========================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  subscriber_id TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (subscriber_id, channel_id),
  FOREIGN KEY (subscriber_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id)    REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subs_channel ON subscriptions(channel_id);

-- =========================================================
-- PLAYLISTS
-- =========================================================
CREATE TABLE IF NOT EXISTS playlists (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public'
             CHECK (visibility IN ('public','unlisted','private')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);

CREATE TABLE IF NOT EXISTS playlist_items (
  id          TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL,
  video_id    TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (playlist_id, video_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id)    REFERENCES videos(id)    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, position);

-- =========================================================
-- VIDEO VIEWS (anti-abuse tracking)
-- =========================================================
CREATE TABLE IF NOT EXISTS video_views (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL,
  user_id     TEXT,
  viewer_hash TEXT NOT NULL,
  viewed_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE SET NULL
);

-- A given (video, viewer_hash) can only create a new row every 6h.
-- The backend enforces the cooldown; this index speeds lookups.
CREATE INDEX IF NOT EXISTS idx_views_video_viewer
  ON video_views(video_id, viewer_hash, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_views_video ON video_views(video_id);

-- =========================================================
-- RATE LIMITING
-- =========================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  key         TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
