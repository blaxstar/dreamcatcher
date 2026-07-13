import { google } from "googleapis";
import type { OAuth2Client } from "googleapis-common";
import { extract_indeed_job_cards, extract_linkedin_job_cards } from "./helpers.js";
import {
  extract_job_fields,
  guess_source,
  job_key,
  score_risk,
  split_company_location,
} from "./scoring.js";
import type { job_item } from "./types.js";

function decode_base64url(data: string): string {
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
  if (!payload) return "";
  const walk = (part: any): string[] => {
    const out: string[] = [];
    if (!part) return out;
    if (part.mimeType === "text/plain" && part.body?.data) {
      out.push(decode_base64url(part.body.data));
    }
    for (const p of part.parts || []) out.push(...walk(p));
    return out;
  };
  const plains = walk(payload);
  return plains.length > 0 ? plains.join("\n") : "";
}

function extract_best_html(payload: any): string {
  if (!payload) return "";
  const walk = (part: any): string[] => {
    const out: string[] = [];
    if (!part) return out;
    if (part.mimeType === "text/html" && part.body?.data) {
      out.push(decode_base64url(part.body.data));
    }
    for (const p of part.parts || []) out.push(...walk(p));
    return out;
  };
  const htmls = walk(payload);
  return htmls.length > 0 ? htmls.join("\n") : "";
}

export function create_oauth2_client(
  client_id: string,
  client_secret: string,
  redirect_uri: string,
): OAuth2Client {
  return new google.auth.OAuth2(client_id, client_secret, redirect_uri);
}

export async function fetch_jobs_from_gmail(
  oauth2_client: OAuth2Client,
  gmail_query: string,
  max_messages: number,
): Promise<job_item[]> {
  const gmail = google.gmail({ version: "v1", auth: oauth2_client });

  const list = await gmail.users.messages.list({
    userId: "me",
    q: gmail_query,
    maxResults: max_messages,
  });

  const messages = list.data.messages || [];
  if (messages.length === 0) return [];

  const jobs: job_item[] = [];
  const seen_keys = new Set<string>();

  for (const m of messages) {
    const id = m.id!;
    const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });

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

    // Extract ALL cards from digest emails (not just the first)
    if (body_html && source === "linkedin") {
      const cards = extract_linkedin_job_cards(body_html);
      for (const card of cards) {
        const split = split_company_location(card.company_location);
        const fallback = extract_job_fields(subject, body_text);
        const title = card.title || fallback.title;
        const company = split.company || fallback.company;
        const location = split.location || fallback.location;
        const link = card.link || fallback.link;
        const notes = fallback.notes;

        const scored = score_risk({ source, subject, from, body_text, title, company, link });
        const item: job_item = {
          source,
          email_id: id,
          received_iso: internal_date,
          title,
          company,
          location,
          link,
          pay: card.pay,
          risk_score: scored.risk_score,
          risk_level: scored.risk_level,
          notes: [...notes, ...scored.notes],
        };
        const key = job_key(item);
        if (!seen_keys.has(key)) {
          jobs.push(item);
          seen_keys.add(key);
        }
      }
      if (cards.length > 0) continue;
    }

    if (body_html && source === "indeed") {
      const cards = extract_indeed_job_cards(body_html);
      for (const card of cards) {
        const fallback = extract_job_fields(subject, body_text);
        const title = card.title || fallback.title;
        const company = card.company || fallback.company;
        const location = card.location || fallback.location;
        const link = card.link || fallback.link;
        const notes = fallback.notes;

        const scored = score_risk({ source, subject, from, body_text, title, company, link });
        const item: job_item = {
          source,
          email_id: id,
          received_iso: internal_date,
          title,
          company,
          location,
          link,
          pay: card.pay,
          risk_score: scored.risk_score,
          risk_level: scored.risk_level,
          notes: [...notes, ...scored.notes],
        };
        const key = job_key(item);
        if (!seen_keys.has(key)) {
          jobs.push(item);
          seen_keys.add(key);
        }
      }
      if (cards.length > 0) continue;
    }

    // Fallback: plain text extraction (single job per email)
    const extracted = extract_job_fields(subject, body_text);
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
    if (!seen_keys.has(key)) {
      jobs.push(item);
      seen_keys.add(key);
    }
  }

  return jobs;
}
