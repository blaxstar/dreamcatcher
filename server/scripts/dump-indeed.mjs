// One-off diagnostic: dump the HTML of recent Indeed alert emails so the parser
// can be fixed against real markup. Runs locally with your stored token.
//
//   cd server
//   node --env-file=../.env scripts/dump-indeed.mjs [your@email.com]
//
// Output goes to server/scripts/indeed-samples/. Your own email address is
// auto-redacted. Share one match.indeed.com and one jobalert.indeed.com file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "indeed-samples");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "../../dreamcatcher.db");
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — run with --env-file=../.env");
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
const email = process.argv[2];
const user = email
  ? db.prepare("SELECT * FROM users WHERE email = ?").get(email)
  : db.prepare("SELECT * FROM users LIMIT 1").get();

if (!user) {
  console.error("No user found in the database.");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI || "http://localhost:3001/auth/callback",
);
oauth2.setCredentials({
  access_token: user.access_token,
  refresh_token: user.refresh_token,
  expiry_date: user.token_expiry,
});
const gmail = google.gmail({ version: "v1", auth: oauth2 });

function decode_b64url(data) {
  const n = data.replace(/-/g, "+").replace(/_/g, "/");
  const p = n + "===".slice((n.length + 3) % 4);
  return Buffer.from(p, "base64").toString("utf-8");
}

function walk_html(part) {
  const out = [];
  if (!part) return out;
  if (part.mimeType === "text/html" && part.body?.data) out.push(decode_b64url(part.body.data));
  for (const p of part.parts || []) out.push(...walk_html(p));
  return out;
}

function get_header(headers, name) {
  return (headers || []).find((h) => (h.name || "").toLowerCase() === name.toLowerCase())?.value;
}

function clean(html) {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  // Redact the account owner's email address.
  h = h.split(user.email).join("REDACTED@example.com");
  return h;
}

const QUERY =
  "newer_than:14d (from:(donotreply@match.indeed.com) OR from:(donotreply@jobalert.indeed.com) OR from:(alert@indeed.com))";

const list = await gmail.users.messages.list({ userId: "me", q: QUERY, maxResults: 8 });
const messages = list.data.messages || [];

if (messages.length === 0) {
  console.log("No Indeed emails found in the last 14 days for that query.");
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

let n = 0;
for (const m of messages) {
  const msg = await gmail.users.messages.get({ userId: "me", id: m.id, format: "full" });
  const headers = msg.data.payload?.headers || [];
  const from = get_header(headers, "From") || "unknown";
  const subject = get_header(headers, "Subject") || "(no subject)";
  const html = walk_html(msg.data.payload).join("\n");
  if (!html) continue;

  const sender = (from.match(/@([^>\s]+)/) || [])[1] || "unknown";
  const file = path.join(OUT_DIR, `${sender}-${m.id}.html`);
  fs.writeFileSync(file, clean(html));
  n++;
  console.log(`${file}\n    from:    ${from}\n    subject: ${subject}\n`);
}

console.log(`Wrote ${n} sample(s) to ${OUT_DIR}`);
console.log("Share one file from match.indeed.com and one from jobalert.indeed.com.");
