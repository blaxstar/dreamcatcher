import crypto from "node:crypto";
import { type NextFunction, type Request, type Response, Router } from "express";
import jwt from "jsonwebtoken";
import type { server_config } from "./config.js";
import { get_user, upsert_user } from "./db.js";
import { create_oauth2_client } from "./gmail.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export const SESSION_COOKIE = "dreamcatcher_session";
const STATE_COOKIE = "dreamcatcher_oauth_state";

export function require_auth(cfg: server_config) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) {
      res.status(401).json({ error: "not authenticated" });
      return;
    }

    try {
      const payload = jwt.verify(token, cfg.jwt_secret) as { sub: string };
      res.locals.user_email = payload.sub;
      next();
    } catch {
      res.status(401).json({ error: "invalid or expired session" });
    }
  };
}

export function auth_router(cfg: server_config): Router {
  const router = Router();

  // GET /auth/google — redirect to Google OAuth consent
  router.get("/google", (_req: Request, res: Response) => {
    const oauth2 = create_oauth2_client(
      cfg.google_client_id,
      cfg.google_client_secret,
      cfg.google_redirect_uri,
    );
    const state = crypto.randomBytes(24).toString("hex");

    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: cfg.cookie_secure,
      sameSite: "lax",
      maxAge: 5 * 60 * 1000, // 5 minutes
    });

    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      state,
      prompt: "consent",
    });

    res.redirect(url);
  });

  // GET /auth/callback — handle Google's redirect
  router.get("/callback", async (req: Request, res: Response) => {
    const { code, state } = req.query;
    const stored_state = req.cookies?.[STATE_COOKIE];

    if (!state || !stored_state || state !== stored_state) {
      res.status(403).send("OAuth state mismatch. Please try again.");
      return;
    }

    res.clearCookie(STATE_COOKIE);

    if (!code || typeof code !== "string") {
      res.status(400).send("Missing authorization code.");
      return;
    }

    try {
      const oauth2 = create_oauth2_client(
        cfg.google_client_id,
        cfg.google_client_secret,
        cfg.google_redirect_uri,
      );
      const { tokens } = await oauth2.getToken(code);
      oauth2.setCredentials(tokens);

      // Fetch user profile
      const userinfo_res = await oauth2.request({
        url: "https://www.googleapis.com/oauth2/v2/userinfo",
      });
      const profile = userinfo_res.data as { email: string; name?: string; picture?: string };

      if (!profile.email) {
        res.status(400).send("Could not retrieve email from Google.");
        return;
      }

      // Persist user + tokens. Google sometimes omits expiry_date; default to
      // 1 hour from now so the OAuth2 client never treats a fresh token as expired
      // and tries to refresh prematurely (which fails if the refresh_token is stale).
      const expiry = tokens.expiry_date || Date.now() + 3600 * 1000;

      upsert_user(
        profile.email,
        profile.name || null,
        profile.picture || null,
        tokens.access_token!,
        tokens.refresh_token || null,
        expiry,
      );

      // Issue session JWT
      const session_token = jwt.sign({ sub: profile.email }, cfg.jwt_secret, {
        expiresIn: cfg.jwt_ttl_seconds,
      });

      res.cookie(SESSION_COOKIE, session_token, {
        httpOnly: true,
        secure: cfg.cookie_secure,
        sameSite: "lax",
        maxAge: cfg.jwt_ttl_seconds * 1000,
      });

      res.redirect("/");
    } catch (err: any) {
      console.error("OAuth callback error:", err?.message || err);
      res.status(500).send("Authentication failed. Please try again.");
    }
  });

  // GET /auth/me — return current user info
  router.get("/me", require_auth(cfg), (req: Request, res: Response) => {
    const email = res.locals.user_email as string;
    const user = get_user(email);
    if (!user) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    res.json({
      email: user.email,
      display_name: user.display_name,
      picture_url: user.picture_url,
    });
  });

  // POST /auth/logout — clear session
  router.post("/logout", (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  return router;
}
