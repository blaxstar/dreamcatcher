import fs from "node:fs";
import path from "node:path";

export type server_config = {
  port: number;
  jwt_secret: string;
  jwt_ttl_seconds: number;
  google_client_id: string;
  google_client_secret: string;
  google_redirect_uri: string;
  db_path: string;
  cookie_secure: boolean;
};

export function load_server_config(): server_config {
  const config_path = path.resolve(process.env.CONFIG_PATH || "config.json");

  let file: Record<string, unknown> = {};
  if (fs.existsSync(config_path)) {
    try {
      file = JSON.parse(fs.readFileSync(config_path, "utf-8"));
    } catch (err: any) {
      console.warn(`Warning: Could not parse ${config_path}: ${err?.message}`);
    }
  }

  const env = process.env;

  const jwt_secret = (env.JWT_SECRET || file.jwt_secret || "") as string;
  if (!jwt_secret) {
    throw new Error("JWT_SECRET is required (set via env var or config.json)");
  }

  const google_client_id = (env.GOOGLE_CLIENT_ID || file.google_client_id || "") as string;
  const google_client_secret = (env.GOOGLE_CLIENT_SECRET ||
    file.google_client_secret ||
    "") as string;
  if (!google_client_id || !google_client_secret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required");
  }

  return {
    port: Number(env.PORT || file.port || 3001),
    jwt_secret,
    jwt_ttl_seconds: Number(env.JWT_TTL_SECONDS || file.jwt_ttl_seconds || 2592000), // 30 days
    google_client_id,
    google_client_secret,
    google_redirect_uri: (env.GOOGLE_REDIRECT_URI ||
      file.google_redirect_uri ||
      "http://localhost:3001/auth/callback") as string,
    db_path: (env.DB_PATH || file.db_path || "../dreamcatcher.db") as string,
    cookie_secure: env.COOKIE_SECURE === "true" || (file.cookie_secure as boolean) || false,
  };
}
