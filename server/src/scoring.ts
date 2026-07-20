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
  const hay = `${from_l} ${subj_l}`;
  if (hay.includes("linkedin")) return "linkedin";
  if (hay.includes("indeed")) return "indeed";
  if (hay.includes("glassdoor")) return "glassdoor";
  if (hay.includes("ziprecruiter")) return "ziprecruiter";
  if (hay.includes("monster")) return "monster";
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

/**
 * Map a 0–10 risk score to a level. Single source of truth for the tiers so
 * score_risk and apply_repost_risk can never disagree.
 */
export function risk_level_for(score: number): risk_level {
  const s = Math.max(0, Math.min(10, score));
  if (s <= 2) return "low";
  if (s <= 5) return "maybe";
  if (s <= 8) return "high";
  return "avoid";
}

// Off-platform contact and up-front-payment patterns. These are the strongest
// scam signals in a job posting and rarely appear in a legitimate one. Each is a
// word-boundary regex (not a bare substring) so we don't flag "signal" inside a
// low-voltage/relay technician description or "crypto" inside "cryptography".
const SCAM_PATTERNS: RegExp[] = [
  /\bwhats\s?app\b/,
  /\btelegram\b/,
  /\b(google )?hangouts\b/, // classic scam "interview" channel
  /\bwire transfer\b/,
  /\bgift cards?\b/,
  /\b(bitcoin|cryptocurrency)\b/,
  /\bwestern union\b/,
  /\bmoney order\b/,
  /\bcashier'?s? check\b/,
  /\b(processing|registration|activation|onboarding|training) fee\b/,
  /\bupfront (payment|fee|cost|deposit)\b/,
  /\bpay for (your )?(own )?(equipment|training|background check|starter kit)\b/,
  /\binvest (your own|your) money\b/,
];

// Requests for sensitive personal data before a formal offer. Legitimate boards
// collect this later, on a secured portal — never in an alert email — so its
// presence in a posting is a hard scam signal.
const SENSITIVE_INFO_PATTERNS: RegExp[] = [
  /\bsocial security (number|#|no\.?)\b/,
  /\bssn\b/,
  /\bbank (account|routing)\b/,
  /\brouting number\b/,
  /\b(copy|photo|scan|picture) of your (id|i\.d\.|driver'?s? license|passport|ssn)\b/,
  /\b(provide|send|share) your (date of birth|dob)\b/,
];

// "Get rich" / MLM / investment framing.
const GET_RICH_PATTERNS: RegExp[] = [
  /\bpassive income\b/,
  /\bguaranteed (income|money|wealth|earnings|pay)\b/,
  /\bbe your own boss\b/,
  /\bfinancial freedom\b/,
  /\binvestment opportunity\b/,
  /\bdouble your income\b/,
];

// Improbably high pay pitched with "earn $X a day/week" marketing framing. A
// legitimate posting quotes a rate ("$45/hr") rather than dangling earnings.
const UNREALISTIC_PAY_PATTERNS: RegExp[] = [
  /\bearn (up to )?\$[\d,]{2,}\s*(\/|per |a )?(day|week)\b/,
  /\bmake \$[\d,]{2,}\s*(\/|per |a )?(day|week)\b/,
];

// A free webmail address used as the application contact (their "recruiter domain
// doesn't match the company" signal, approximated from the posting text).
const FREEMAIL_CONTACT =
  /\b[a-z0-9._%+-]+@(gmail|yahoo|outlook|hotmail|aol|protonmail|icloud)\.com\b/;

// High-pressure recruiting language. A weak signal on its own — curated to avoid
// collisions with real job text (e.g. bare "urgent" would hit "urgent care").
const PRESSURE_PATTERNS: RegExp[] = [
  /\bimmediate start\b/,
  /\bstart immediately\b/,
  /\bhiring now\b/,
  /\blimited spots\b/,
  /\bno experience (needed|required|necessary)\b/,
  /\bapply now before\b/,
];

// Job boards (and their known redirect subdomains) whose links we trust.
const KNOWN_JOB_HOSTS = [
  "indeed.com",
  "linkedin.com",
  "lnkd.in",
  "glassdoor.com",
  "glassdoor.ca",
  "glassdoor.co.uk",
  "glassdoor.com.au",
  "glassdoor.co.in",
  "glassdoor.de",
  "glassdoor.fr",
  "glassdoor.com.br",
  "glassdoor.com.mx",
  "glassdoor.sg",
  "glassdoor.com.hk",
  "ziprecruiter.com",
  "monster.com",
  "monster.co.uk",
  "monster.ca",
  "monster.de",
  "monster.fr",
];

/**
 * Score a SINGLE job's own content for risk (0–10). The caller must pass this
 * job's fields only — never a whole digest email — so one bad listing can't
 * taint the others.
 *
 * Rubric (scores clamp to 10):
 *   +6  scam contact / up-front-payment / "invest your money" (SCAM_PATTERNS)
 *   +6  asks for sensitive personal info up front (SENSITIVE_INFO_PATTERNS)
 *   +3  "get rich" / MLM / investment framing (GET_RICH_PATTERNS)
 *   +2  improbable "earn $X a day" pay pitch (UNREALISTIC_PAY_PATTERNS)
 *   +2  application link points off the known job boards
 *   +2  free-webmail address given as the contact (FREEMAIL_CONTACT)
 *   +1  missing company name
 *   +1  no application link  (or +1 if the link is malformed)
 *   +1  high-pressure recruiting language (PRESSURE_PATTERNS)
 * Any single strong (+6) signal reaches "high"; strong + anything → "avoid".
 * Repost/staleness ("ghost job" age) is layered on later by apply_repost_risk.
 *
 * Deliberately NOT scored here (they need live web lookups, not email text):
 * whether the role is on the company's official careers page, whether the
 * company has a real online presence/address, and whether a recruiter's domain
 * matches the company. Those stay as manual checks — see the app's guidance.
 */
export function score_risk(job: {
  source: job_item["source"];
  title?: string;
  company?: string;
  location?: string;
  pay?: string;
  link?: string;
  /** This job's own descriptive text (a per-job snippet), never the whole email. */
  text?: string;
}): { risk_score: number; risk_level: risk_level; notes: string[] } {
  const notes: string[] = [];
  let risk_score = 0;

  const hay = [job.title, job.company, job.location, job.pay, job.text]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (SCAM_PATTERNS.some((re) => re.test(hay))) {
    risk_score += 6;
    notes.push("Mentions off-platform contact or up-front payment — a common scam signal.");
  }

  if (SENSITIVE_INFO_PATTERNS.some((re) => re.test(hay))) {
    risk_score += 6;
    notes.push(
      "Asks for sensitive personal info (SSN, bank, or ID) — never send this before a signed offer.",
    );
  }

  if (GET_RICH_PATTERNS.some((re) => re.test(hay))) {
    risk_score += 3;
    notes.push("Uses 'get rich' / investment framing common in scams and MLMs.");
  }

  if (UNREALISTIC_PAY_PATTERNS.some((re) => re.test(hay))) {
    risk_score += 2;
    notes.push("Advertises improbably high pay ('earn $X a day') — a common lure.");
  }

  if (FREEMAIL_CONTACT.test(hay)) {
    risk_score += 2;
    notes.push("Lists a personal webmail address (Gmail/Yahoo/etc.) as the contact.");
  }

  if (!job.company) {
    risk_score += 1;
    notes.push("No company name listed.");
  }

  if (!job.link) {
    risk_score += 1;
    notes.push("No application link.");
  } else {
    try {
      const host = new URL(job.link).hostname.toLowerCase();
      const is_known = KNOWN_JOB_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
      if (!is_known) {
        risk_score += 2;
        notes.push(`Application link goes off-platform (${host}).`);
      }
    } catch {
      risk_score += 1;
      notes.push("Application link looks malformed.");
    }
  }

  if (PRESSURE_PATTERNS.some((re) => re.test(hay))) {
    risk_score += 1;
    notes.push("Uses high-pressure recruiting language.");
  }

  risk_score = Math.max(0, Math.min(10, risk_score));
  return { risk_score, risk_level: risk_level_for(risk_score), notes };
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

  return { risk_score, risk_level: risk_level_for(risk_score), notes };
}
