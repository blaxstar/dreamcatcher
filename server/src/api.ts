import { type Request, type Response, Router } from "express";
import { require_auth } from "./auth.js";
import type { server_config } from "./config.js";
import {
  clear_jobs,
  get_jobs,
  get_user,
  get_user_settings,
  update_job_status,
  update_user_settings,
  update_user_tokens,
  upsert_job,
} from "./db.js";
import { create_oauth2_client, fetch_jobs_from_gmail } from "./gmail.js";
import { apply_repost_risk, job_key } from "./scoring.js";
import type { user_settings } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";

export function api_router(cfg: server_config): Router {
  const router = Router();
  router.use(require_auth(cfg));

  // GET /api/jobs — list jobs, optionally reload from Gmail
  router.get("/jobs", async (req: Request, res: Response) => {
    const email = res.locals.user_email as string;
    const reload = req.query.reload === "true";

    if (reload) {
      const user = get_user(email);
      if (!user) {
        res.status(404).json({ error: "user not found" });
        return;
      }

      try {
        const oauth2 = create_oauth2_client(
          cfg.google_client_id,
          cfg.google_client_secret,
          cfg.google_redirect_uri,
        );
        oauth2.setCredentials({
          access_token: user.access_token,
          refresh_token: user.refresh_token,
          expiry_date: user.token_expiry,
        });

        // Listen for token refresh events
        oauth2.on("tokens", (tokens) => {
          update_user_tokens(
            email,
            tokens.access_token!,
            tokens.refresh_token || null,
            tokens.expiry_date || null,
          );
        });

        const settings = get_user_settings(email);
        const query = settings?.gmail_query || DEFAULT_SETTINGS.gmail_query;
        const max = settings?.max_messages || DEFAULT_SETTINGS.max_messages;

        const items = await fetch_jobs_from_gmail(oauth2, query, max);

        for (const item of items) {
          const key = job_key(item);
          upsert_job(email, key, item);
        }
      } catch (err: any) {
        console.error("Gmail fetch error:", err?.message || err);
        res
          .status(502)
          .json({ error: "Failed to fetch from Gmail. You may need to re-authenticate." });
        return;
      }
    }

    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const risk_level = typeof req.query.risk_level === "string" ? req.query.risk_level : undefined;
    const all_jobs = get_jobs(email, {
      status: status as any,
      risk_level,
    });

    // Re-score with repost data
    const now = Date.now();
    for (const j of all_jobs) {
      const base_notes: string[] = (() => {
        try {
          return JSON.parse(j.notes_json);
        } catch {
          return [];
        }
      })();
      const {
        risk_score,
        risk_level: rl,
        notes,
      } = apply_repost_risk(j.risk_score, base_notes, j.times_seen, j.first_seen, now);
      j.risk_score = risk_score;
      j.risk_level = rl;
      j.notes_json = JSON.stringify(notes);
    }

    const stats = {
      total: all_jobs.length,
      pending: 0,
      applied: 0,
      skipped: 0,
      by_risk: { low: 0, maybe: 0, high: 0, avoid: 0 } as Record<string, number>,
    };

    // Compute stats from unfiltered list
    const all_unfiltered = get_jobs(email);
    for (const j of all_unfiltered) {
      if (j.status === "pending") stats.pending++;
      else if (j.status === "applied") stats.applied++;
      else if (j.status === "skipped") stats.skipped++;
      stats.by_risk[j.risk_level] = (stats.by_risk[j.risk_level] || 0) + 1;
    }
    stats.total = all_unfiltered.length;

    res.json({ jobs: all_jobs, stats });
  });

  // PATCH /api/jobs/:key — update job status
  router.patch("/jobs/:key", (req: Request, res: Response) => {
    const email = res.locals.user_email as string;
    const key = decodeURIComponent(String(req.params.key));
    const { status } = req.body;

    if (!status || !["pending", "applied", "skipped"].includes(status)) {
      res.status(400).json({ error: "status must be pending, applied, or skipped" });
      return;
    }

    const updated = update_job_status(email, key, status);
    if (!updated) {
      res.status(404).json({ error: "job not found" });
      return;
    }

    res.json({ ok: true });
  });

  // POST /api/jobs/clear — bulk-skip pending jobs ("pending" = all, "stale" = old/reposted)
  router.post("/jobs/clear", (req: Request, res: Response) => {
    const email = res.locals.user_email as string;
    const scope = req.body?.scope;
    if (scope !== "pending" && scope !== "stale") {
      res.status(400).json({ error: "scope must be 'pending' or 'stale'" });
      return;
    }
    const cleared = clear_jobs(email, scope);
    res.json({ cleared });
  });

  // GET /api/settings
  router.get("/settings", (req: Request, res: Response) => {
    const email = res.locals.user_email as string;
    const settings = get_user_settings(email);
    res.json({ ...DEFAULT_SETTINGS, ...settings });
  });

  // PUT /api/settings
  router.put("/settings", (req: Request, res: Response) => {
    const email = res.locals.user_email as string;
    const allowed_keys: (keyof user_settings)[] = [
      "gmail_query",
      "max_messages",
      "max_apply_today",
      "theme",
    ];
    const update: Partial<user_settings> = {};

    for (const key of allowed_keys) {
      if (req.body[key] !== undefined) {
        (update as any)[key] = req.body[key];
      }
    }

    update_user_settings(email, update);
    const settings = get_user_settings(email);
    res.json({ ...DEFAULT_SETTINGS, ...settings });
  });

  return router;
}
