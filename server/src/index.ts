import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import { api_router } from "./api.js";
import { auth_router } from "./auth.js";
import { load_server_config } from "./config.js";
import { init_db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cfg = load_server_config();
init_db(cfg.db_path);

const app = express();
app.use(cookieParser());
app.use(express.json());

// API routes
app.use("/auth", auth_router(cfg));
app.use("/api", api_router(cfg));

// In production, serve the built frontend
const static_dir = path.resolve(__dirname, "../../web/dist");
app.use(express.static(static_dir));

// SPA fallback — serve index.html for all non-API routes
app.get("{*path}", (_req, res) => {
  res.sendFile(path.join(static_dir, "index.html"));
});

app.listen(cfg.port, () => {
  console.log(`dreamcatcher listening on http://localhost:${cfg.port}`);
});
