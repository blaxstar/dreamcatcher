import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { google } from "googleapis";
import { extract_indeed_job_cards, extract_linkedin_job_cards } from "./helpers.ts";

type job_item = {
  source: "linkedin" | "indeed" | "unknown";
  email_id: string;
  thread_id?: string;
  received_iso?: string;

  title?: string;
  company?: string;
  location?: string;
  link?: string;

  risk_score: number; // 0-10
  risk_level: "low" | "maybe" | "high" | "avoid";
  notes: string[];
};

type user_config = {
  credentials_path: string;
  token_path: string;
  cache_path: string;
  output_path: string;
  gmail_query: string;
  max_messages: number;
  max_apply_today: number;
};

const DEFAULTS: user_config = {
  credentials_path: "./credentials.json",
  token_path: "./token.json",
  cache_path: "./.cache.json",
  output_path: "./jobs_today.md",
  gmail_query: "newer_than:7d (from:(jobalerts-noreply@linkedin.com) OR from:(alert@indeed.com))",
  max_messages: 40,
  max_apply_today: 3,
};

function load_config(): user_config {
  // Check for --config <path> CLI arg, otherwise default to ./config.json
  const config_flag_idx = process.argv.indexOf("--config");
  const config_path =
    config_flag_idx !== -1 && process.argv[config_flag_idx + 1]
      ? path.resolve(process.argv[config_flag_idx + 1])
      : path.resolve("config.json");

  let file_config: Partial<user_config> = {};
  if (fs.existsSync(config_path)) {
    try {
      file_config = JSON.parse(fs.readFileSync(config_path, "utf-8"));
    } catch (err: any) {
      console.warn(`Warning: Could not parse ${config_path}: ${err?.message}. Using defaults.`);
    }
  } else if (config_flag_idx !== -1) {
    // User explicitly passed --config but file doesn't exist
    throw new Error(`Config file not found: ${config_path}`);
  }

  const merged = { ...DEFAULTS, ...file_config };

  // Resolve all paths relative to CWD
  merged.credentials_path = path.resolve(merged.credentials_path);
  merged.token_path = path.resolve(merged.token_path);
  merged.cache_path = path.resolve(merged.cache_path);
  merged.output_path = path.resolve(merged.output_path);

  return merged;
}

const CONFIG = load_config();

function load_json<T>(file_path: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file_path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function save_json(file_path: string, data: unknown) {
  fs.writeFileSync(file_path, JSON.stringify(data, null, 2), "utf-8");
}

function is_url(s: string | undefined): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function decode_base64url(data: string): string {
  // Gmail uses base64url in message bodies
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf-8");
}

function get_header(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string | undefined {
  const h = headers?.find((x) => (x.name || "").toLowerCase() === name.toLowerCase());
  return h?.value;
}

function extract_best_body(payload: any): string {
  // Prefer text/plain; fallback to snippet-ish; avoid HTML parsing complexity (ADHD-maintenance avoidance)
  if (!payload) return "";

  const walk = (part: any): string[] => {
    const out: string[] = [];
    if (!part) return out;

    if (part.mimeType === "text/plain" && part.body?.data) {
      out.push(decode_base64url(part.body.data));
    }

    const parts = part.parts || [];
    for (const p of parts) out.push(...walk(p));
    return out;
  };

  const plains = walk(payload);
  if (plains.length > 0) return plains.join("\n");

  // fallback: sometimes only snippet is useful
  return "";
}

function extract_best_html(payload: any): string {
  // Collect text/html parts for richer parsing (LinkedIn cards).
  if (!payload) return "";

  const walk = (part: any): string[] => {
    const out: string[] = [];
    if (!part) return out;

    if (part.mimeType === "text/html" && part.body?.data) {
      out.push(decode_base64url(part.body.data));
    }

    const parts = part.parts || [];
    for (const p of parts) out.push(...walk(p));
    return out;
  };

  const htmls = walk(payload);
  if (htmls.length > 0) return htmls.join("\n");
  return "";
}

function guess_source(
  from_header: string | undefined,
  subject: string | undefined,
): job_item["source"] {
  const from_l = (from_header || "").toLowerCase();
  const subj_l = (subject || "").toLowerCase();
  if (from_l.includes("linkedin") || subj_l.includes("linkedin")) return "linkedin";
  if (from_l.includes("indeed") || subj_l.includes("indeed")) return "indeed";
  return "unknown";
}

function extract_first_url(text: string): string | undefined {
  // conservative URL regex
  const m = text.match(/https?:\/\/[^\s<>()"]+/i);
  if (!m) return undefined;
  const url = m[0].replace(/[).,]+$/g, "");
  return is_url(url) ? url : undefined;
}

function extract_job_fields(
  subject: string | undefined,
  body: string,
): { title?: string; company?: string; location?: string; link?: string; notes: string[] } {
  const notes: string[] = [];
  const subj = (subject || "").trim();
  const body_compact = body.replace(/\r/g, "");

  // Best-effort heuristics:
  // 1) Try patterns like "Job alert: <Title> at <Company>"
  let title: string | undefined;
  let company: string | undefined;
  let location: string | undefined;

  const job_alert_match = subj.match(/job alert:\s*(.+?)\s+at\s+(.+)/i);
  if (job_alert_match) {
    title = job_alert_match[1]?.trim();
    company = job_alert_match[2]?.trim();
  }

  // 2) Try "New: <Title> - <Company>"
  if (!title || !company) {
    const dash_match = subj.match(/new:\s*(.+?)\s*[-–]\s*(.+)/i);
    if (dash_match) {
      title = title || dash_match[1]?.trim();
      company = company || dash_match[2]?.trim();
    }
  }

  // 3) Location from body lines like "Location: X" or "Location\nX"
  const loc_match =
    body_compact.match(/Location:\s*(.+)/i) || body_compact.match(/Location\s*\n\s*(.+)/i);
  if (loc_match) location = loc_match[1]?.trim();

  // 4) Link: first URL in body
  const link = extract_first_url(body_compact);

  if (!link) notes.push("No link found (email format may be HTML-only).");

  // Cleanup:
  if (company) company = company.replace(/\s+\|\s+LinkedIn$/i, "").trim();

  return { title, company, location, link, notes };
}

function normalize_key_part(s: string | undefined): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function job_key(job: { title?: string; company?: string; location?: string }): string {
  return [
    normalize_key_part(job.title),
    normalize_key_part(job.company),
    normalize_key_part(job.location),
  ].join(" | ");
}

function extract_marked_keys(md: string, marker: "applied" | "skip"): Set<string> {
  const out = new Set<string>();
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    if (!/\[x\]/i.test(line)) continue;
    if (marker === "skip" && !/%SKIP%/i.test(line)) continue;
    if (marker === "applied" && /%SKIP%/i.test(line)) continue;
    const m = line.match(/<!--\s*key:(.*?)\s*-->/i);
    if (m?.[1]) out.add(m[1].trim());
  }
  return out;
}

function split_company_location(company_location: string | undefined): {
  company?: string;
  location?: string;
} {
  if (!company_location) return {};
  const cleaned = company_location.replace(/\s+/g, " ").trim();
  if (!cleaned) return {};

  // Common separators: "Company · Location", "Company • Location", "Company - Location"
  const parts = cleaned.split(/\s*[·•-]\s*/);
  if (parts.length >= 2) {
    const company = parts[0]?.trim();
    const location = parts.slice(1).join(" - ").trim();
    return { company: company || undefined, location: location || undefined };
  }

  return { company: cleaned };
}

function score_risk(job: {
  source: job_item["source"];
  subject?: string;
  from?: string;
  body_text: string;
  title?: string;
  company?: string;
  link?: string;
}): { risk_score: number; risk_level: job_item["risk_level"]; notes: string[] } {
  const notes: string[] = [];
  let risk_score = 0;

  const subj_l = (job.subject || "").toLowerCase();
  const from_l = (job.from || "").toLowerCase();
  const body_l = (job.body_text || "").toLowerCase();
  const combined = `${subj_l}\n${from_l}\n${body_l}`;

  // Company transparency proxies (limited because we only see alert emails)
  if (!job.company) {
    risk_score += 1;
    notes.push("Missing company name.");
  }

  // Description specificity proxies (alert emails are short; treat vagueness mildly)
  const vague_phrases = [
    "competitive pay",
    "great benefits",
    "immediate start",
    "hiring now",
    "urgent",
    "limited time",
  ];
  if (vague_phrases.some((p) => combined.includes(p))) {
    risk_score += 1;
    notes.push("Contains vague recruiting phrases.");
  }

  // Posting behavior not visible from email; we skip.

  // Recruiter visibility not visible; we skip.

  // Compensation realism signals (scam-ish)
  const scam_channels = ["telegram", "whatsapp", "signal", "wire transfer", "crypto", "gift card"];
  if (scam_channels.some((p) => combined.includes(p))) {
    risk_score += 6;
    notes.push("Contains scam communication/payment keywords.");
  }

  // Suspicious link domains
  if (job.link) {
    try {
      const u = new URL(job.link);
      const host = u.hostname.toLowerCase();

      const ok_hosts = [
        "linkedin.com",
        "www.linkedin.com",
        "indeed.com",
        "www.indeed.com",
        "lnkd.in",
      ];
      const is_ok = ok_hosts.some((h) => host === h || host.endsWith("." + h));

      if (!is_ok) {
        risk_score += 2;
        notes.push(`Link domain not a standard LinkedIn/Indeed domain: ${host}`);
      }
    } catch {
      risk_score += 1;
      notes.push("Link parse failed.");
    }
  } else {
    risk_score += 1;
  }

  // Cap 0-10
  if (risk_score < 0) risk_score = 0;
  if (risk_score > 10) risk_score = 10;

  let risk_level: job_item["risk_level"] = "low";
  if (risk_score <= 2) risk_level = "low";
  else if (risk_score <= 5) risk_level = "maybe";
  else if (risk_score <= 8) risk_level = "high";
  else risk_level = "avoid";

  return { risk_score, risk_level, notes };
}

async function authorize_gmail() {
  if (!fs.existsSync(CONFIG.credentials_path)) {
    throw new Error(`Missing credentials file at ${CONFIG.credentials_path}`);
  }
  const credentials = JSON.parse(fs.readFileSync(CONFIG.credentials_path, "utf-8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0]);

  if (fs.existsSync(CONFIG.token_path)) {
    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(CONFIG.token_path, "utf-8")));
    return oAuth2Client;
  }

  const auth_url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });

  console.log("Authorize this app by visiting this url:\n", auth_url, "\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code: string = await new Promise((resolve) =>
    rl.question("Paste the code from the page here: ", resolve),
  );
  rl.close();

  const token_response = await oAuth2Client.getToken(code.trim());
  oAuth2Client.setCredentials(token_response.tokens);
  save_json(CONFIG.token_path, token_response.tokens);

  console.log("Token stored to", CONFIG.token_path);
  return oAuth2Client;
}

function render_markdown(jobs: job_item[], applied_keys: Set<string>, skipped_keys: Set<string>) {
  const today = new Date().toISOString().slice(0, 10);

  const apply = jobs
    .filter((j) => j.risk_level === "low" || j.risk_level === "maybe")
    .sort((a, b) => a.risk_score - b.risk_score);
  const apply_pending = apply.filter(
    (j) => !applied_keys.has(job_key(j)) && !skipped_keys.has(job_key(j)),
  );
  const apply_done = apply.filter((j) => applied_keys.has(job_key(j)));
  const apply_skipped = apply.filter((j) => skipped_keys.has(job_key(j)));
  const top_picks = apply_pending.slice(0, CONFIG.max_apply_today);
  const top_keys = new Set(top_picks.map((j) => job_key(j)));

  const skip = jobs
    .filter((j) => j.risk_level === "high" || j.risk_level === "avoid")
    .sort((a, b) => b.risk_score - a.risk_score);

  const lines: string[] = [];
  lines.push(`# Job Apply Queue (${today})`);
  lines.push("");
  lines.push(`Query: \`${CONFIG.gmail_query}\``);
  lines.push("");

  lines.push(`## ✅ Top ${CONFIG.max_apply_today} (best picks)`);
  lines.push("");
  if (top_picks.length === 0) {
    lines.push("- No low/maybe-risk items found.");
  } else {
    top_picks.forEach((j, idx) => {
      const title = j.title || "(title missing)";
      const company = j.company || "(company missing)";
      const location = j.location ? ` — ${j.location}` : "";
      const link = j.link ? j.link : "";
      const key = job_key(j);
      const badge =
        j.risk_level === "low"
          ? "🟢"
          : j.risk_level === "maybe"
            ? "🟡"
            : j.risk_level === "high"
              ? "🟠"
              : "🔴";

      lines.push(`### ${idx + 1}. ${title} @ ${company}${location}`);
      lines.push(`- [ ] Applied <!-- key:${key} -->`);
      lines.push(`- [ ] %SKIP% <!-- key:${key} -->`);
      lines.push(`- Source: **${j.source}**`);
      lines.push(`- Risk: ${badge} **${j.risk_level.toUpperCase()}** (score: ${j.risk_score}/10)`);
      if (link) lines.push(`- Link: ${link}`);
      if (j.notes.length) lines.push(`- Notes: ${j.notes.join(" | ")}`);
      lines.push("");
    });
  }

  lines.push(`## ✅ All Low/Maybe (full list)`);
  lines.push("");
  const apply_rest = apply_pending.filter((j) => !top_keys.has(job_key(j)));

  if (apply_rest.length === 0) {
    lines.push("- No low/maybe-risk items found.");
  } else {
    apply_rest.forEach((j) => {
      const title = j.title || "(title missing)";
      const company = j.company || "(company missing)";
      const location = j.location ? ` — ${j.location}` : "";
      const link = j.link ? j.link : "";
      const key = job_key(j);
      const badge =
        j.risk_level === "low"
          ? "🟢"
          : j.risk_level === "maybe"
            ? "🟡"
            : j.risk_level === "high"
              ? "🟠"
              : "🔴";

      lines.push(
        `- [ ] ${badge} **${j.risk_level.toUpperCase()}** (${j.risk_score}/10) — ${title} @ ${company}${location}${link ? ` — ${link}` : ""} <!-- key:${key} -->`,
      );
    });
    lines.push("");
  }

  lines.push(`## ✅ Applied`);
  lines.push("");
  if (apply_done.length === 0) {
    lines.push("- None yet.");
  } else {
    apply_done.forEach((j) => {
      const title = j.title || "(title missing)";
      const company = j.company || "(company missing)";
      const location = j.location ? ` — ${j.location}` : "";
      const link = j.link ? j.link : "";
      const key = job_key(j);
      const badge =
        j.risk_level === "low"
          ? "🟢"
          : j.risk_level === "maybe"
            ? "🟡"
            : j.risk_level === "high"
              ? "🟠"
              : "🔴";

      lines.push(
        `- [x] ${badge} **${j.risk_level.toUpperCase()}** (${j.risk_score}/10) — ${title} @ ${company}${location}${link ? ` — ${link}` : ""} <!-- key:${key} -->`,
      );
    });
    lines.push("");
  }

  lines.push(`## 🚫 Skipped`);
  lines.push("");
  if (apply_skipped.length === 0) {
    lines.push("- None.");
  } else {
    apply_skipped.forEach((j) => {
      const title = j.title || "(title missing)";
      const company = j.company || "(company missing)";
      const location = j.location ? ` — ${j.location}` : "";
      const link = j.link ? j.link : "";
      const key = job_key(j);
      const badge =
        j.risk_level === "low"
          ? "🟢"
          : j.risk_level === "maybe"
            ? "🟡"
            : j.risk_level === "high"
              ? "🟠"
              : "🔴";

      lines.push(
        `- [x] %SKIP% ${badge} **${j.risk_level.toUpperCase()}** (${j.risk_score}/10) — ${title} @ ${company}${location}${link ? ` — ${link}` : ""} <!-- key:${key} -->`,
      );
    });
    lines.push("");
  }

  lines.push(`## 🧊 Skip / Investigate`);
  lines.push("");
  if (skip.length === 0) {
    lines.push("- Nothing flagged high/avoid.");
  } else {
    skip.forEach((j) => {
      const title = j.title || "(title missing)";
      const company = j.company || "(company missing)";
      const link = j.link ? j.link : "";
      const badge = j.risk_level === "high" ? "🟠" : "🔴";
      lines.push(
        `- ${badge} **${j.risk_level.toUpperCase()}** (${j.risk_score}/10) — ${title} @ ${company}${link ? ` — ${link}` : ""}`,
      );
    });
  }

  lines.push("");
  lines.push(`## 📌 Follow-up List (manual)`);
  lines.push(`- [ ] Follow up on applications older than 5 business days`);
  lines.push(`- [ ] Follow up 48 hours after recruiter contact`);
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const reload = process.argv.includes("--reload");
  const reset_cache = process.argv.includes("--reset-cache");
  const cache = reset_cache
    ? { processed_message_ids: {} as Record<string, true> }
    : load_json<{ processed_message_ids: Record<string, true> }>(CONFIG.cache_path, {
        processed_message_ids: {},
      });
  const md_text = fs.existsSync(CONFIG.output_path)
    ? fs.readFileSync(CONFIG.output_path, "utf-8")
    : "";
  const applied_keys = md_text ? extract_marked_keys(md_text, "applied") : new Set<string>();
  const skipped_keys = md_text ? extract_marked_keys(md_text, "skip") : new Set<string>();

  const auth = await authorize_gmail();
  const gmail = google.gmail({ version: "v1", auth });

  const list = await gmail.users.messages.list({
    userId: "me",
    q: CONFIG.gmail_query,
    maxResults: CONFIG.max_messages,
  });

  const messages = list.data.messages || [];
  if (messages.length === 0) {
    fs.writeFileSync(CONFIG.output_path, render_markdown([], new Set(), new Set()), "utf-8");
    console.log("No messages found. Wrote", CONFIG.output_path);
    return;
  }

  const jobs: job_item[] = [];
  const seen_keys = new Set<string>();

  for (const m of messages) {
    const id = m.id!;
    if (!reload && cache.processed_message_ids[id]) continue;

    const msg = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });

    const payload = msg.data.payload;
    const headers = payload?.headers || [];
    const subject = get_header(headers as any[], "Subject");
    const from = get_header(headers as any[], "From");
    const internal_date = msg.data.internalDate
      ? new Date(Number(msg.data.internalDate)).toISOString()
      : undefined;

    const source = guess_source(from, subject);
    const body_text = extract_best_body(payload);
    const body_html = extract_best_html(payload);

    let extracted = extract_job_fields(subject, body_text);

    if (body_html) {
      if (source === "linkedin") {
        const cards = extract_linkedin_job_cards(body_html);
        const first = cards[0];
        if (first) {
          const split = split_company_location(first.company_location);
          extracted = {
            title: first.title || extracted.title,
            company: split.company || extracted.company,
            location: split.location || extracted.location,
            link: first.link || extracted.link,
            notes: extracted.notes,
          };
        }
      } else if (source === "indeed") {
        const cards = extract_indeed_job_cards(body_html);
        const first = cards[0];
        if (first) {
          extracted = {
            title: first.title || extracted.title,
            company: first.company || extracted.company,
            location: first.location || extracted.location,
            link: first.link || extracted.link,
            notes: extracted.notes,
          };
        }
      }
    }

    const scored = score_risk({
      source,
      subject,
      from,
      body_text,
      title: extracted.title,
      company: extracted.company,
      link: extracted.link,
    });

    const item: job_item = {
      source,
      email_id: id,
      thread_id: msg.data.threadId || undefined,
      received_iso: internal_date,

      title: extracted.title,
      company: extracted.company,
      location: extracted.location,
      link: extracted.link,

      risk_score: scored.risk_score,
      risk_level: scored.risk_level,
      notes: [...extracted.notes, ...scored.notes],
    };

    const key = job_key(item);

    if (!seen_keys.has(key) && !skipped_keys.has(key)) {
      jobs.push(item);
      seen_keys.add(key);
    }
    cache.processed_message_ids[id] = true;
  }

  // Also include already-processed from last run? Keep output focused on "new" triage:
  const md = render_markdown(jobs, applied_keys, skipped_keys);
  fs.writeFileSync(CONFIG.output_path, md, "utf-8");
  save_json(CONFIG.cache_path, cache);

  console.log(`Wrote ${CONFIG.output_path} with ${jobs.length} new items.`);
}

main().catch((err) => {
  console.error("Error:", err?.message || err);
  process.exitCode = 1;
});
