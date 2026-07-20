import { api } from "../api.js";

export type Job = {
  id: number;
  user_email: string;
  job_key: string;
  source: string;
  title: string | null;
  company: string | null;
  location: string | null;
  link: string | null;
  pay: string | null;
  risk_score: number;
  risk_level: string;
  status: string;
  notes_json: string;
  email_id: string | null;
  times_seen: number;
  first_seen: number;
  updated_at: number;
};

function show_toast(msg: string): void {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

export function create_job_card(job: Job, on_update?: () => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "card job-card";

  const title = job.title || "Untitled listing";
  const company = job.company || "Company not listed";
  const location = job.location ? ` \u2014 ${job.location}` : "";
  const notes: string[] = (() => {
    try {
      return JSON.parse(job.notes_json);
    } catch {
      return [];
    }
  })();

  const title_html = job.link
    ? `<a href="${job.link}" target="_blank" rel="noopener">${esc(title)}</a>`
    : esc(title);

  card.innerHTML = `
    <div class="job-card-header">
      <div class="job-card-title">${title_html}</div>
      <span class="badge badge-${job.risk_level}">${job.risk_level} risk (${job.risk_score}/10)</span>
    </div>
    <div class="job-card-meta">
      <span>${esc(company)}${esc(location)}</span>
      ${job.pay ? `<span>\u00b7 ${esc(job.pay)}</span>` : ""}
      ${job.times_seen > 1 ? `<span class="badge badge-repost">\u00b7 seen ${job.times_seen}x</span>` : ""}
      <span class="badge badge-${job.source}" style="margin-left:auto">${job.source}</span>
    </div>
    ${notes.length > 0 ? `<div class="job-card-notes">${esc(notes.join(" \u00b7 "))}</div>` : ""}
    <div class="job-card-actions"></div>
  `;

  const actions = card.querySelector(".job-card-actions")!;
  render_actions(actions, job, on_update);

  return card;
}

function render_actions(container: Element, job: Job, on_update?: () => void): void {
  container.innerHTML = "";

  if (job.status === "pending") {
    const apply_btn = make_btn("Mark as applied", "btn-success btn-sm", async () => {
      await set_status(job, "applied");
      on_update?.();
    });
    const skip_btn = make_btn("Skip", "btn-ghost btn-sm", async () => {
      await set_status(job, "skipped");
      on_update?.();
    });
    container.append(apply_btn, skip_btn);
  } else {
    const label = job.status === "applied" ? "applied" : "skipped";
    const badge = document.createElement("span");
    badge.className = `badge badge-${job.status}`;
    badge.textContent = label;
    container.appendChild(badge);

    const undo_btn = make_btn("Undo", "btn-ghost btn-sm", async () => {
      await set_status(job, "pending");
      on_update?.();
    });
    container.appendChild(undo_btn);
  }
}

function make_btn(text: string, cls: string, onclick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `btn ${cls}`;
  btn.textContent = text;
  btn.addEventListener("click", onclick);
  return btn;
}

async function set_status(job: Job, status: string): Promise<void> {
  try {
    await api("PATCH", `/api/jobs/${encodeURIComponent(job.job_key)}`, { status });
    job.status = status;
    show_toast(`Marked as ${status}`);
  } catch (err: any) {
    show_toast(`Error: ${err.message}`);
  }
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
