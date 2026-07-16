import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { get_db, init_db } from "../src/db.js";

// Simulates a real, pre-existing database created before this change: the old
// `source` CHECK constraint AND before the times_seen / seen_email_ids columns
// existed. init_db must migrate it without losing data.
let dir: string;
let db_path: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dc-migrate-"));
  db_path = join(dir, "old.db");

  const old = new Database(db_path);
  old.exec(`
    CREATE TABLE users (
      email TEXT PRIMARY KEY, display_name TEXT, picture_url TEXT,
      access_token TEXT NOT NULL, refresh_token TEXT, token_expiry INTEGER,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      job_key TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('linkedin','indeed','unknown')),
      title TEXT, company TEXT, location TEXT, link TEXT, pay TEXT,
      risk_score INTEGER NOT NULL DEFAULT 0,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('low','maybe','high','avoid')),
      status TEXT NOT NULL CHECK(status IN ('pending','applied','skipped')) DEFAULT 'pending',
      notes_json TEXT NOT NULL DEFAULT '[]',
      email_id TEXT,
      first_seen INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_email, job_key)
    );
  `);
  old
    .prepare("INSERT INTO users (email, access_token, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run("alice@example.com", "tok", 1, 1);
  // A job the user already triaged — its status must survive the migration.
  old
    .prepare(
      "INSERT INTO jobs (user_email, job_key, source, title, company, status, risk_level, first_seen, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("alice@example.com", "k1", "indeed", "Engineer", "Acme", "applied", "low", 1, 1);
  old.close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("jobs table migration (drops the source CHECK)", () => {
  it("preserves existing rows and adds the newer columns", () => {
    init_db(db_path);
    const db = get_db();
    const job = db.prepare("SELECT * FROM jobs WHERE job_key = 'k1'").get() as {
      status: string;
      company: string;
      times_seen: number;
    };
    expect(job.status).toBe("applied"); // triage state survived
    expect(job.company).toBe("Acme");
    expect(job.times_seen).toBe(1); // column added with its default
  });

  it("removes the old source CHECK so new boards can be stored", () => {
    const db = get_db();
    const sql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'jobs'").get() as { sql: string }
    ).sql;
    expect(/CHECK\s*\(\s*source\s+IN/i.test(sql)).toBe(false);

    // Inserting a glassdoor job would have thrown under the old constraint.
    expect(() =>
      db
        .prepare(
          "INSERT INTO jobs (user_email, job_key, source, risk_level, first_seen, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("alice@example.com", "k2", "glassdoor", "low", 1, 1),
    ).not.toThrow();
  });

  it("still enforces the risk_level and status constraints", () => {
    const db = get_db();
    expect(() =>
      db
        .prepare(
          "INSERT INTO jobs (user_email, job_key, source, risk_level, first_seen, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("alice@example.com", "k3", "indeed", "bogus", 1, 1),
    ).toThrow();
  });
});
