import type { job_item, risk_level } from "./types.js";

export function is_url(s: string | undefined): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function extract_first_url(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s<>()"]+/i);
  if (!m) return undefined;
  const url = m[0].replace(/[).,]+$/g, "");
  return is_url(url) ? url : undefined;
}

export function guess_source(
  from_header: string | undefined,
  subject: string | undefined,
): job_item["source"] {
  const from_l = (from_header || "").toLowerCase();
  const subj_l = (subject || "").toLowerCase();
  if (from_l.includes("linkedin") || subj_l.includes("linkedin")) return "linkedin";
  if (from_l.includes("indeed") || subj_l.includes("indeed")) return "indeed";
  return "unknown";
}

export function split_company_location(company_location: string | undefined): {
  company?: string;
  location?: string;
} {
  if (!company_location) return {};
  const cleaned = company_location.replace(/\s+/g, " ").trim();
  if (!cleaned) return {};

  const parts = cleaned.split(/\s*[\u00b7\u2022-]\s*/);
  if (parts.length >= 2) {
    const company = parts[0]?.trim();
    const location = parts.slice(1).join(" - ").trim();
    return { company: company || undefined, location: location || undefined };
  }

  return { company: cleaned };
}

export function extract_job_fields(
  subject: string | undefined,
  body: string,
): { title?: string; company?: string; location?: string; link?: string; notes: string[] } {
  const notes: string[] = [];
  const subj = (subject || "").trim();
  const body_compact = body.replace(/\r/g, "");

  let title: string | undefined;
  let company: string | undefined;
  let location: string | undefined;

  const job_alert_match = subj.match(/job alert:\s*(.+?)\s+at\s+(.+)/i);
  if (job_alert_match) {
    title = job_alert_match[1]?.trim();
    company = job_alert_match[2]?.trim();
  }

  if (!title || !company) {
    const dash_match = subj.match(/new:\s*(.+?)\s*[-\u2013]\s*(.+)/i);
    if (dash_match) {
      title = title || dash_match[1]?.trim();
      company = company || dash_match[2]?.trim();
    }
  }

  const loc_match =
    body_compact.match(/Location:\s*(.+)/i) || body_compact.match(/Location\s*\n\s*(.+)/i);
  if (loc_match) location = loc_match[1]?.trim();

  const link = extract_first_url(body_compact);
  if (!link) notes.push("No link found (email format may be HTML-only).");

  if (company) company = company.replace(/\s+\|\s+LinkedIn$/i, "").trim();

  return { title, company, location, link, notes };
}

export function normalize_key_part(s: string | undefined): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function job_key(job: { title?: string; company?: string; location?: string }): string {
  return [
    normalize_key_part(job.title),
    normalize_key_part(job.company),
    normalize_key_part(job.location),
  ].join(" | ");
}

export function score_risk(job: {
  source: job_item["source"];
  subject?: string;
  from?: string;
  body_text: string;
  title?: string;
  company?: string;
  link?: string;
}): { risk_score: number; risk_level: risk_level; notes: string[] } {
  const notes: string[] = [];
  let risk_score = 0;

  const subj_l = (job.subject || "").toLowerCase();
  const from_l = (job.from || "").toLowerCase();
  const body_l = (job.body_text || "").toLowerCase();
  const combined = `${subj_l}\n${from_l}\n${body_l}`;

  if (!job.company) {
    risk_score += 1;
    notes.push("Missing company name.");
  }

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

  const scam_channels = ["telegram", "whatsapp", "signal", "wire transfer", "crypto", "gift card"];
  if (scam_channels.some((p) => combined.includes(p))) {
    risk_score += 6;
    notes.push("Contains scam communication/payment keywords.");
  }

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

  if (risk_score < 0) risk_score = 0;
  if (risk_score > 10) risk_score = 10;

  let risk_level: risk_level = "low";
  if (risk_score <= 2) risk_level = "low";
  else if (risk_score <= 5) risk_level = "maybe";
  else if (risk_score <= 8) risk_level = "high";
  else risk_level = "avoid";

  return { risk_score, risk_level, notes };
}

/** Adjust risk score based on repost frequency and age. */
export function apply_repost_risk(
  base_score: number,
  base_notes: string[],
  times_seen: number,
  first_seen: number,
  now?: number,
): { risk_score: number; risk_level: risk_level; notes: string[] } {
  const current = now ?? Date.now();
  const age_days = (current - first_seen) / (1000 * 60 * 60 * 24);
  const notes = [...base_notes];
  let risk_score = base_score;

  // Seen 3+ times over 2+ weeks — something's off
  if (times_seen >= 3 && age_days >= 14) {
    risk_score += 2;
    notes.push(`Reposted ${times_seen}x over ${Math.round(age_days)} days.`);
  }
  // Seen 5+ times or lingering 4+ weeks — red flag
  if (times_seen >= 5 || age_days >= 28) {
    risk_score += 1;
    notes.push(`Stale listing — first seen ${Math.round(age_days)} days ago.`);
  }

  if (risk_score > 10) risk_score = 10;

  let risk_level: risk_level = "low";
  if (risk_score <= 2) risk_level = "low";
  else if (risk_score <= 5) risk_level = "maybe";
  else if (risk_score <= 8) risk_level = "high";
  else risk_level = "avoid";

  return { risk_score, risk_level, notes };
}
