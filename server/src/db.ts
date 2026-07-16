import Database from "better-sqlite3";
import type { db_job, db_user, job_item, job_status, user_settings } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  display_name  TEXT,
  picture_url   TEXT,
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry  INTEGER,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  job_key     TEXT NOT NULL,
  source      TEXT NOT NULL,
  title       TEXT,
  company     TEXT,
  location    TEXT,
  link        TEXT,
  pay         TEXT,
  risk_score  INTEGER NOT NULL DEFAULT 0,
  risk_level  TEXT NOT NULL CHECK(risk_level IN ('low','maybe','high','avoid')),
  status      TEXT NOT NULL CHECK(status IN ('pending','applied','skipped')) DEFAULT 'pending',
  notes_json  TEXT NOT NULL DEFAULT '[]',
  email_id    TEXT,
  seen_email_ids TEXT NOT NULL DEFAULT '[]',
  times_seen  INTEGER NOT NULL DEFAULT 1,
  first_seen  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(user_email, job_key)
);

CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_email);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_email, status);
`;

let db: Database.Database;

export function init_db(db_path: string): Database.Database {
  db = new Database(db_path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  // migrations
  const cols = db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "times_seen")) {
    db.exec("ALTER TABLE jobs ADD COLUMN times_seen INTEGER NOT NULL DEFAULT 1");
  }
  if (!cols.some((c) => c.name === "seen_email_ids")) {
    db.exec("ALTER TABLE jobs ADD COLUMN seen_email_ids TEXT NOT NULL DEFAULT '[]'");
  }

  // Older databases constrained `source` to linkedin/indeed/unknown. We now
  // support more boards (glassdoor/ziprecruiter/monster), so rebuild the table
  // without that CHECK. Data is preserved; columns are copied by name (safe
  // regardless of any ALTER-appended column order).
  const jobs_sql =
    (
      db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'").get() as
        | { sql?: string }
        | undefined
    )?.sql ?? "";
  if (/CHECK\s*\(\s*source\s+IN/i.test(jobs_sql)) {
    db.pragma("foreign_keys = OFF");
    const cols_list = [
      "id",
      "user_email",
      "job_key",
      "source",
      "title",
      "company",
      "location",
      "link",
      "pay",
      "risk_score",
      "risk_level",
      "status",
      "notes_json",
      "email_id",
      "seen_email_ids",
      "times_seen",
      "first_seen",
      "updated_at",
    ].join(", ");
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE jobs_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
          job_key     TEXT NOT NULL,
          source      TEXT NOT NULL,
          title       TEXT,
          company     TEXT,
          location    TEXT,
          link        TEXT,
          pay         TEXT,
          risk_score  INTEGER NOT NULL DEFAULT 0,
          risk_level  TEXT NOT NULL CHECK(risk_level IN ('low','maybe','high','avoid')),
          status      TEXT NOT NULL CHECK(status IN ('pending','applied','skipped')) DEFAULT 'pending',
          notes_json  TEXT NOT NULL DEFAULT '[]',
          email_id    TEXT,
          seen_email_ids TEXT NOT NULL DEFAULT '[]',
          times_seen  INTEGER NOT NULL DEFAULT 1,
          first_seen  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          UNIQUE(user_email, job_key)
        );
      `);
      db.exec(`INSERT INTO jobs_new (${cols_list}) SELECT ${cols_list} FROM jobs`);
      db.exec("DROP TABLE jobs");
      db.exec("ALTER TABLE jobs_new RENAME TO jobs");
      db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_email)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_email, status)");
    });
    rebuild();
    db.pragma("foreign_keys = ON");
  }

  return db;
}

export function get_db(): Database.Database {
  return db;
}

// ── users ──

export function upsert_user(
  email: string,
  display_name: string | null,
  picture_url: string | null,
  access_token: string,
  refresh_token: string | null,
  token_expiry: number | null,
): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO users (email, display_name, picture_url, access_token, refresh_token, token_expiry, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      display_name = excluded.display_name,
      picture_url = excluded.picture_url,
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, users.refresh_token),
      token_expiry = excluded.token_expiry,
      updated_at = excluded.updated_at
  `).run(email, display_name, picture_url, access_token, refresh_token, token_expiry, now, now);
}

export function get_user(email: string): db_user | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as db_user | undefined;
}

export function update_user_tokens(
  email: string,
  access_token: string,
  refresh_token: string | null,
  token_expiry: number | null,
): void {
  const stmt = refresh_token
    ? db.prepare(
        "UPDATE users SET access_token = ?, refresh_token = ?, token_expiry = ?, updated_at = ? WHERE email = ?",
      )
    : db.prepare(
        "UPDATE users SET access_token = ?, token_expiry = ?, updated_at = ? WHERE email = ?",
      );

  if (refresh_token) {
    stmt.run(access_token, refresh_token, token_expiry, Date.now(), email);
  } else {
    stmt.run(access_token, token_expiry, Date.now(), email);
  }
}

export function get_user_settings(email: string): user_settings | null {
  const user = get_user(email);
  if (!user) return null;
  try {
    return JSON.parse(user.settings_json);
  } catch {
    return {} as user_settings;
  }
}

export function update_user_settings(email: string, settings: Partial<user_settings>): void {
  const current = get_user_settings(email) || {};
  const merged = { ...current, ...settings };
  db.prepare("UPDATE users SET settings_json = ?, updated_at = ? WHERE email = ?").run(
    JSON.stringify(merged),
    Date.now(),
    email,
  );
}

// ── jobs ──

export function upsert_job(user_email: string, job_key: string, item: job_item): void {
  const now = Date.now();
  const existing = db
    .prepare("SELECT seen_email_ids, times_seen FROM jobs WHERE user_email = ? AND job_key = ?")
    .get(user_email, job_key) as { seen_email_ids: string; times_seen: number } | undefined;

  if (!existing) {
    // New job — insert
    const seen_ids = item.email_id ? JSON.stringify([item.email_id]) : "[]";
    db.prepare(`
      INSERT INTO jobs (user_email, job_key, source, title, company, location, link, pay, risk_score, risk_level, notes_json, email_id, seen_email_ids, times_seen, first_seen, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      user_email,
      job_key,
      item.source,
      item.title || null,
      item.company || null,
      item.location || null,
      item.link || null,
      item.pay || null,
      item.risk_score,
      item.risk_level,
      JSON.stringify(item.notes),
      item.email_id || null,
      seen_ids,
      now,
      now,
    );
    return;
  }

  // Existing job — only bump times_seen if this email_id is new
  let seen_ids: string[] = [];
  try {
    seen_ids = JSON.parse(existing.seen_email_ids);
  } catch {
    /* ignore */
  }

  const is_new_email = item.email_id && !seen_ids.includes(item.email_id);
  if (is_new_email) {
    seen_ids.push(item.email_id);
  }

  db.prepare(`
    UPDATE jobs SET
      title = COALESCE(?, title),
      company = COALESCE(?, company),
      location = COALESCE(?, location),
      link = COALESCE(?, link),
      pay = COALESCE(?, pay),
      risk_score = ?,
      risk_level = ?,
      notes_json = ?,
      email_id = ?,
      seen_email_ids = ?,
      times_seen = ?,
      updated_at = ?
    WHERE user_email = ? AND job_key = ?
  `).run(
    item.title || null,
    item.company || null,
    item.location || null,
    item.link || null,
    item.pay || null,
    item.risk_score,
    item.risk_level,
    JSON.stringify(item.notes),
    item.email_id || null,
    JSON.stringify(seen_ids),
    is_new_email ? existing.times_seen + 1 : existing.times_seen,
    now,
    user_email,
    job_key,
  );
}

export function get_jobs(
  user_email: string,
  filters?: { status?: job_status; risk_level?: string },
): db_job[] {
  let sql = "SELECT * FROM jobs WHERE user_email = ?";
  const params: unknown[] = [user_email];

  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  if (filters?.risk_level) {
    sql += " AND risk_level = ?";
    params.push(filters.risk_level);
  }

  sql += " ORDER BY risk_score ASC, updated_at DESC";
  return db.prepare(sql).all(...params) as db_job[];
}

export function update_job_status(
  user_email: string,
  job_key: string,
  status: job_status,
): boolean {
  const result = db
    .prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE user_email = ? AND job_key = ?")
    .run(status, Date.now(), user_email, job_key);
  return result.changes > 0;
}
