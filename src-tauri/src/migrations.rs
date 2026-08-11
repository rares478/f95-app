pub const V1_SCHEMA: &str = r#"
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE games_cache (
  thread_id     TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  version       TEXT,
  thumbnail_url TEXT,
  thread_url    TEXT NOT NULL,
  engine        TEXT,
  status        TEXT,
  rating        REAL,
  views         INTEGER,
  likes         INTEGER,
  updated_at    TEXT,
  prefixes_json TEXT,
  tags_json     TEXT,
  cached_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_games_cache_updated_at ON games_cache(updated_at DESC);

CREATE TABLE library_games (
  thread_id              TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,
  thread_url             TEXT NOT NULL,
  thumbnail_url          TEXT,
  current_version        TEXT,
  available_version      TEXT,
  install_status         TEXT NOT NULL DEFAULT 'not_installed',
  install_path           TEXT,
  exe_path               TEXT,
  added_at               TEXT NOT NULL DEFAULT (datetime('now')),
  last_played_at         TEXT,
  total_playtime_seconds INTEGER NOT NULL DEFAULT 0,
  custom_tags_json       TEXT,
  notes                  TEXT
);

CREATE TABLE play_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id        TEXT NOT NULL,
  started_at       TEXT NOT NULL,
  ended_at         TEXT,
  duration_seconds INTEGER,
  FOREIGN KEY (thread_id) REFERENCES library_games(thread_id) ON DELETE CASCADE
);
CREATE INDEX idx_play_sessions_thread ON play_sessions(thread_id);

CREATE TABLE downloads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id     TEXT NOT NULL,
  host          TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  resolved_url  TEXT,
  dest_path     TEXT,
  state         TEXT NOT NULL DEFAULT 'pending',
  bytes_total   INTEGER,
  bytes_done    INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at    TEXT,
  finished_at   TEXT
);
CREATE INDEX idx_downloads_thread ON downloads(thread_id);
"#;

/// v2 stamps the F95 version on each download row so we can apply it back to
/// `library_games.current_version` once extraction succeeds, closing the
/// "install → version is current" loop. Idempotent for pre-existing rows
/// (column defaults to NULL).
pub const V2_ADD_DOWNLOAD_GAME_VERSION: &str = r#"
ALTER TABLE downloads ADD COLUMN game_version TEXT;
"#;

/// v3 introduces Steam-style "install libraries" — the user can register N
/// folders (e.g. `D:\F95Games`, `E:\backup\f95`) and pick where each download
/// lands. Exactly one row is the default (used when the user has only one
/// library or hits "Baixar" without picking).
///
/// We don't seed this table from SQL: the migration is path-agnostic, but the
/// legacy default lives at `<app_local_data_dir>/downloads` which is only
/// known at runtime. Frontend `libraries.ensureSeeded()` inserts the default
/// row on first launch.
///
/// `downloads.library_path` records which library each row was sent to so a
/// retry resumes into the same place even if the user changes their default
/// in the meantime.
pub const V3_INSTALL_LIBRARIES: &str = r#"
CREATE TABLE install_libraries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_install_libs_default ON install_libraries(is_default);

ALTER TABLE downloads ADD COLUMN library_path TEXT;
"#;

/// v4 introduces a generic key-value `app_settings` table for host tokens
/// and other small local preferences that don't deserve their own column.
///
/// First user is the GoFile API token: when an uploader disables guest
/// access, the guest token we mint in `resolve_gofile` returns 401. The
/// user can paste their own logged-in token (premium or free) into
/// Settings → Hosts and downloads start working again.
///
/// Stored in plaintext SQLite for simplicity — the file already lives next
/// to the F95 session cookies, so adding it to stronghold wouldn't change
/// the realistic threat model. Treat this like browser cookies.
pub const V4_APP_SETTINGS: &str = r#"
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

/// v5 adds F95 content category to library rows (games, mods, comics, etc.).
pub const V5_LIBRARY_CATEGORY: &str = r#"
ALTER TABLE library_games ADD COLUMN category TEXT NOT NULL DEFAULT 'games';
"#;

/// v6 introduces achievement definition + unlock tables (shell for future integration).
pub const V6_ACHIEVEMENTS: &str = r#"
CREATE TABLE achievement_definitions (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT,
  title       TEXT NOT NULL,
  description TEXT,
  icon_key    TEXT,
  points      INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_achievement_defs_thread ON achievement_definitions(thread_id);

CREATE TABLE user_achievement_unlocks (
  thread_id       TEXT NOT NULL DEFAULT '',
  achievement_id  TEXT NOT NULL,
  unlocked_at     TEXT NOT NULL DEFAULT (datetime('now')),
  progress_json   TEXT,
  PRIMARY KEY (thread_id, achievement_id),
  FOREIGN KEY (achievement_id) REFERENCES achievement_definitions(id)
);
"#;

/// v7 stores in-app notifications (F95 alerts mirrored locally + RSS library updates)
/// and tracks RSS guids we've already processed so the first poll doesn't spam.
pub const V7_NOTIFICATIONS: &str = r#"
CREATE TABLE notifications (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  thread_id     TEXT,
  title         TEXT NOT NULL,
  body          TEXT,
  url           TEXT,
  thumbnail_url TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  read_at       TEXT
);
CREATE INDEX idx_notifications_unread ON notifications(read_at, created_at DESC);

CREATE TABLE rss_seen_guids (
  guid     TEXT PRIMARY KEY,
  seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

/// v8 caches OP download links on library rows so Install/Update can run
/// from the library without opening the store page. Version stamp tracks
/// which F95 version the links belong to (refreshed on update checks).
pub const V8_LIBRARY_DOWNLOAD_LINKS: &str = r#"
ALTER TABLE library_games ADD COLUMN download_links_json TEXT;
ALTER TABLE library_games ADD COLUMN download_links_version TEXT;
ALTER TABLE library_games ADD COLUMN download_links_fetched_at TEXT;
"#;

/// v9: multiple executables per library game (separate season packs, etc.).
/// Backfills one default row from existing `exe_path` / `install_path`.
pub const V9_LIBRARY_GAME_EXES: &str = r#"
CREATE TABLE library_game_exes (
  id                TEXT PRIMARY KEY NOT NULL,
  thread_id         TEXT NOT NULL,
  exe_path          TEXT NOT NULL,
  install_path      TEXT,
  label             TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_default        INTEGER NOT NULL DEFAULT 0,
  last_launched_at  TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES library_games(thread_id) ON DELETE CASCADE,
  UNIQUE (thread_id, exe_path)
);
CREATE INDEX idx_library_game_exes_thread ON library_game_exes(thread_id);

INSERT INTO library_game_exes (
  id, thread_id, exe_path, install_path, label, sort_order, is_default, last_launched_at, created_at
)
SELECT
  lower(hex(randomblob(16))),
  thread_id,
  exe_path,
  install_path,
  NULL,
  0,
  1,
  last_played_at,
  datetime('now')
FROM library_games
WHERE exe_path IS NOT NULL AND TRIM(exe_path) != '';
"#;

/// v10: install plans + jobs so multi-section Install/Update can queue
/// coordinated downloads, extract per job, and assign exes without clobbering.
pub const V10_INSTALL_PLANS: &str = r#"
CREATE TABLE install_plans (
  id          TEXT PRIMARY KEY NOT NULL,
  thread_id   TEXT NOT NULL,
  intent      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES library_games(thread_id) ON DELETE CASCADE
);
CREATE INDEX idx_install_plans_thread ON install_plans(thread_id);

CREATE TABLE install_jobs (
  id              TEXT PRIMARY KEY NOT NULL,
  plan_id         TEXT NOT NULL,
  section_label   TEXT NOT NULL,
  section_kind    TEXT NOT NULL,
  source_url      TEXT NOT NULL,
  host            TEXT NOT NULL,
  download_id     INTEGER,
  extract_path    TEXT,
  exe_id          TEXT,
  assign_status   TEXT NOT NULL DEFAULT 'pending',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  FOREIGN KEY (plan_id) REFERENCES install_plans(id) ON DELETE CASCADE
);
CREATE INDEX idx_install_jobs_plan ON install_jobs(plan_id);
CREATE INDEX idx_install_jobs_download ON install_jobs(download_id);
"#;

/// v11: group multi-archive split parts under one bundle_id so they
/// extract into a shared folder and assign once.
pub const V11_INSTALL_JOB_BUNDLE: &str = r#"
ALTER TABLE install_jobs ADD COLUMN bundle_id TEXT;
CREATE INDEX idx_install_jobs_bundle ON install_jobs(bundle_id);
"#;

/// v12: cached SAM list pools for Store discovery Home.
pub const V12_DISCOVERY_POOLS: &str = r#"
CREATE TABLE IF NOT EXISTS discovery_pools (
  key TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
"#;

/// v13: durable Store Home recently-viewed history.
pub const V13_STORE_VIEW_HISTORY: &str = r#"
CREATE TABLE IF NOT EXISTS store_view_history (
  thread_id TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  thread_url TEXT NOT NULL,
  viewed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_store_view_history_viewed_at
  ON store_view_history(viewed_at DESC);
"#;

/// v14: Steam-style library collections — user-named folders grouping library
/// entries. Membership is N:N; junction rows are removed explicitly on delete
/// since the SQLite plugin doesn't enable foreign_keys enforcement.
pub const V14_LIBRARY_COLLECTIONS: &str = r#"
CREATE TABLE library_collections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE library_collection_games (
  collection_id INTEGER NOT NULL,
  thread_id     TEXT NOT NULL,
  added_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, thread_id),
  FOREIGN KEY (collection_id) REFERENCES library_collections(id) ON DELETE CASCADE
);
CREATE INDEX idx_collection_games_thread ON library_collection_games(thread_id);
"#;
