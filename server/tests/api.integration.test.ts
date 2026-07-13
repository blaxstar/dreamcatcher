import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The Gmail boundary is the only piece that would reach the network, so it is the
// only thing stubbed. Everything below it (router, auth, sqlite, scoring) is real.
vi.mock("../src/gmail.js", () => ({
  create_oauth2_client: () => ({ setCredentials: () => {}, on: () => {} }),
  fetch_jobs_from_gmail: vi.fn(),
}));

import { api_router } from "../src/api.js";
import type { server_config } from "../src/config.js";
import { get_db, init_db, upsert_job, upsert_user } from "../src/db.js";
import { fetch_jobs_from_gmail } from "../src/gmail.js";
import { DEFAULT_SETTINGS, type job_item } from "../src/types.js";

const DAY = 1000 * 60 * 60 * 24;
const SESSION_COOKIE = "dreamcatcher_session";

const cfg: server_config = {
  port: 0,
  jwt_secret: "test-jwt-secret",
  jwt_ttl_seconds: 3600,
  google_client_id: "test-client-id",
  google_client_secret: "test-client-secret",
  google_redirect_uri: "http://localhost:3001/auth/callback",
  db_path: ":memory:",
  cookie_secure: false,
};

const USER = "alice@example.com";
const OTHER_USER = "bob@example.com";

let server: Server;
let base_url: string;

/** Mint a session cookie the same way auth.ts does. */
function session(email: string, expires_in: string | number = cfg.jwt_ttl_seconds): string {
  const token = jwt.sign({ sub: email }, cfg.jwt_secret, { expiresIn: expires_in });
  return `${SESSION_COOKIE}=${token}`;
}

async function api(
  path: string,
  opts: { cookie?: string; method?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;

  const res = await fetch(`${base_url}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function make_job(overrides: Partial<job_item> = {}): job_item {
  return {
    source: "linkedin",
    email_id: `email-${Math.random().toString(16).slice(2)}`,
    title: "Frontend Engineer",
    company: "Acme Corp",
    location: "Remote",
    link: "https://www.linkedin.com/jobs/view/1",
    risk_score: 0,
    risk_level: "low",
    notes: [],
    ...overrides,
  };
}

/** Seed a job and return the job_key the API addresses it by. */
function seed_job(email: string, key: string, overrides: Partial<job_item> = {}): string {
  upsert_job(email, key, make_job(overrides));
  return key;
}

beforeAll(async () => {
  init_db(":memory:");

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", api_router(cfg));

  server = app.listen(0);
  await once(server, "listening");
  base_url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

beforeEach(() => {
  const db = get_db();
  db.exec("DELETE FROM jobs");
  db.exec("DELETE FROM users");
  vi.mocked(fetch_jobs_from_gmail).mockReset();

  upsert_user(USER, "Alice", null, "access-token", "refresh-token", Date.now() + 3600_000);
  upsert_user(OTHER_USER, "Bob", null, "access-token-b", "refresh-token-b", Date.now() + 3600_000);
});

describe("authentication", () => {
  it("rejects a request with no session cookie", async () => {
    const res = await api("/api/jobs");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("not authenticated");
  });

  it("rejects a malformed token", async () => {
    const res = await api("/api/jobs", { cookie: `${SESSION_COOKIE}=garbage` });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid or expired session");
  });

  it("rejects an expired token", async () => {
    const res = await api("/api/jobs", { cookie: session(USER, "-10s") });
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = jwt.sign({ sub: USER }, "not-the-real-secret");
    const res = await api("/api/jobs", { cookie: `${SESSION_COOKIE}=${forged}` });
    expect(res.status).toBe(401);
  });

  it("accepts a valid session", async () => {
    const res = await api("/api/jobs", { cookie: session(USER) });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/jobs", () => {
  it("returns the caller's jobs with aggregate stats", async () => {
    seed_job(USER, "a", { title: "A" });
    seed_job(USER, "b", { title: "B", risk_level: "high", risk_score: 7 });

    const res = await api("/api/jobs", { cookie: session(USER) });

    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(2);
    expect(res.body.stats.total).toBe(2);
    expect(res.body.stats.pending).toBe(2);
    expect(res.body.stats.by_risk.low).toBe(1);
    expect(res.body.stats.by_risk.high).toBe(1);
  });

  it("filters by status while keeping stats computed over all jobs", async () => {
    seed_job(USER, "a");
    seed_job(USER, "b");
    seed_job(USER, "c");
    await api("/api/jobs/a", {
      cookie: session(USER),
      method: "PATCH",
      body: { status: "applied" },
    });

    const res = await api("/api/jobs?status=applied", { cookie: session(USER) });

    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].job_key).toBe("a");
    // Stats intentionally reflect the whole set, not the filtered view.
    expect(res.body.stats.total).toBe(3);
    expect(res.body.stats.applied).toBe(1);
    expect(res.body.stats.pending).toBe(2);
  });

  it("filters by risk level", async () => {
    seed_job(USER, "low-one", { risk_level: "low", risk_score: 0 });
    seed_job(USER, "avoid-one", { risk_level: "avoid", risk_score: 10 });

    const res = await api("/api/jobs?risk_level=avoid", { cookie: session(USER) });

    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].job_key).toBe("avoid-one");
  });

  it("never leaks another user's jobs", async () => {
    seed_job(USER, "mine");
    seed_job(OTHER_USER, "theirs");

    const res = await api("/api/jobs", { cookie: session(USER) });

    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].job_key).toBe("mine");
    expect(res.body.stats.total).toBe(1);
  });

  it("escalates risk on read for a stale, frequently reposted job", async () => {
    seed_job(USER, "stale", { risk_score: 2, risk_level: "low" });
    // Backdate the listing and mark it as seen many times.
    get_db()
      .prepare(
        "UPDATE jobs SET times_seen = ?, first_seen = ? WHERE user_email = ? AND job_key = ?",
      )
      .run(5, Date.now() - 30 * DAY, USER, "stale");

    const res = await api("/api/jobs", { cookie: session(USER) });
    const job = res.body.jobs[0];

    // 2 base + 2 (reposted 3+ times over 2+ weeks) + 1 (lingering 4+ weeks) = 5
    expect(job.risk_score).toBe(5);
    expect(job.risk_level).toBe("maybe");
    const notes = JSON.parse(job.notes_json);
    expect(notes.some((n: string) => n.includes("Reposted 5x"))).toBe(true);
    expect(notes.some((n: string) => n.includes("Stale listing"))).toBe(true);
  });
});

describe("PATCH /api/jobs/:key", () => {
  it("updates a job's status and persists it", async () => {
    seed_job(USER, "a");

    const patch = await api("/api/jobs/a", {
      cookie: session(USER),
      method: "PATCH",
      body: { status: "applied" },
    });
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ ok: true });

    const list = await api("/api/jobs", { cookie: session(USER) });
    expect(list.body.jobs[0].status).toBe("applied");
  });

  it("rejects an invalid status", async () => {
    seed_job(USER, "a");

    const res = await api("/api/jobs/a", {
      cookie: session(USER),
      method: "PATCH",
      body: { status: "ghosted" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pending, applied, or skipped/);
  });

  it("404s on an unknown job key", async () => {
    const res = await api("/api/jobs/nope", {
      cookie: session(USER),
      method: "PATCH",
      body: { status: "applied" },
    });
    expect(res.status).toBe(404);
  });

  it("cannot patch another user's job", async () => {
    seed_job(OTHER_USER, "theirs");

    const res = await api("/api/jobs/theirs", {
      cookie: session(USER),
      method: "PATCH",
      body: { status: "applied" },
    });

    expect(res.status).toBe(404);

    // And Bob's job is untouched.
    const bobs = await api("/api/jobs", { cookie: session(OTHER_USER) });
    expect(bobs.body.jobs[0].status).toBe("pending");
  });

  it("round-trips a real job_key containing spaces and pipe separators", async () => {
    // job_key() produces keys like "senior dev | acme corp | remote".
    const key = "senior dev | acme corp | remote";
    seed_job(USER, key);

    const res = await api(`/api/jobs/${encodeURIComponent(key)}`, {
      cookie: session(USER),
      method: "PATCH",
      body: { status: "skipped" },
    });

    expect(res.status).toBe(200);
    const list = await api("/api/jobs", { cookie: session(USER) });
    expect(list.body.jobs[0].status).toBe("skipped");
  });
});

describe("settings", () => {
  it("returns defaults for a user who has never saved settings", async () => {
    const res = await api("/api/settings", { cookie: session(USER) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_SETTINGS);
  });

  it("merges a partial update over the defaults and persists it", async () => {
    const put = await api("/api/settings", {
      cookie: session(USER),
      method: "PUT",
      body: { max_messages: 10, theme: "light" },
    });

    expect(put.status).toBe(200);
    expect(put.body.max_messages).toBe(10);
    expect(put.body.theme).toBe("light");
    expect(put.body.gmail_query).toBe(DEFAULT_SETTINGS.gmail_query);

    const get = await api("/api/settings", { cookie: session(USER) });
    expect(get.body.max_messages).toBe(10);
    expect(get.body.theme).toBe("light");
  });

  it("ignores keys outside the allowlist", async () => {
    const res = await api("/api/settings", {
      cookie: session(USER),
      method: "PUT",
      body: { max_messages: 5, is_admin: true, email: OTHER_USER },
    });

    expect(res.status).toBe(200);
    expect(res.body.max_messages).toBe(5);
    expect(res.body.is_admin).toBeUndefined();
    expect(res.body.email).toBeUndefined();
  });

  it("keeps each user's settings separate", async () => {
    await api("/api/settings", {
      cookie: session(USER),
      method: "PUT",
      body: { max_apply_today: 9 },
    });

    const bobs = await api("/api/settings", { cookie: session(OTHER_USER) });
    expect(bobs.body.max_apply_today).toBe(DEFAULT_SETTINGS.max_apply_today);
  });
});

describe("GET /api/jobs?reload=true", () => {
  it("persists jobs fetched from Gmail and returns them", async () => {
    vi.mocked(fetch_jobs_from_gmail).mockResolvedValue([
      make_job({ title: "Senior Dev", company: "Globex", location: "Remote", email_id: "m1" }),
    ]);

    const res = await api("/api/jobs?reload=true", { cookie: session(USER) });

    expect(res.status).toBe(200);
    expect(fetch_jobs_from_gmail).toHaveBeenCalledOnce();
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].title).toBe("Senior Dev");

    // It was actually written to the database, not just echoed back.
    const without_reload = await api("/api/jobs", { cookie: session(USER) });
    expect(without_reload.body.jobs).toHaveLength(1);
  });

  it("uses the caller's saved gmail query and max_messages", async () => {
    vi.mocked(fetch_jobs_from_gmail).mockResolvedValue([]);
    await api("/api/settings", {
      cookie: session(USER),
      method: "PUT",
      body: { gmail_query: "from:(jobs@example.com)", max_messages: 7 },
    });

    await api("/api/jobs?reload=true", { cookie: session(USER) });

    expect(fetch_jobs_from_gmail).toHaveBeenCalledWith(
      expect.anything(),
      "from:(jobs@example.com)",
      7,
    );
  });

  it("counts a repost only when it arrives in a new email", async () => {
    const job = make_job({ title: "Dev", company: "Acme", email_id: "m1" });
    vi.mocked(fetch_jobs_from_gmail).mockResolvedValue([job]);
    await api("/api/jobs?reload=true", { cookie: session(USER) });

    // Same job, same email — a re-fetch of an already-seen message.
    await api("/api/jobs?reload=true", { cookie: session(USER) });
    let rows = get_db().prepare("SELECT times_seen FROM jobs").all() as { times_seen: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].times_seen).toBe(1);

    // Same job, new email — a genuine repost.
    vi.mocked(fetch_jobs_from_gmail).mockResolvedValue([{ ...job, email_id: "m2" }]);
    await api("/api/jobs?reload=true", { cookie: session(USER) });
    rows = get_db().prepare("SELECT times_seen FROM jobs").all() as { times_seen: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].times_seen).toBe(2);
  });

  it("returns 502 when Gmail fails", async () => {
    vi.mocked(fetch_jobs_from_gmail).mockRejectedValue(new Error("invalid_grant"));

    const res = await api("/api/jobs?reload=true", { cookie: session(USER) });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/re-authenticate/i);
  });

  it("404s when the session points at a user that no longer exists", async () => {
    get_db().prepare("DELETE FROM users WHERE email = ?").run(USER);

    const res = await api("/api/jobs?reload=true", { cookie: session(USER) });

    expect(res.status).toBe(404);
    expect(fetch_jobs_from_gmail).not.toHaveBeenCalled();
  });
});
