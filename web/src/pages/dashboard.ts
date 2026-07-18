import { api } from "../api.js";
import { create_job_card, type Job } from "../components/job-card.js";
import { create_spinner } from "../components/spinner.js";

type JobsResponse = {
  jobs: Job[];
  stats: {
    total: number;
    pending: number;
    applied: number;
    skipped: number;
    by_risk: Record<string, number>;
  };
};

let active_tab = "top";

// Pull fresh alerts from Gmail once per browser session (i.e. on a new sign-in),
// not on every refresh or tab switch — reloading hits the Gmail API and is slow.
const SYNCED_KEY = "dreamcatcher:synced";

// Source (site) display filter — which senders to show. Persisted across reloads.
const HIDDEN_SOURCES_KEY = "dreamcatcher:hidden-sources";
const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  ziprecruiter: "ZipRecruiter",
  monster: "Monster",
  unknown: "Other",
};
// Always offer these boards as filter options, even when a sync returned none.
const ALL_SOURCES = ["linkedin", "indeed", "glassdoor", "ziprecruiter", "monster"];
const hidden_sources = new Set<string>(load_hidden_sources());

// Location / employer filters (reset each load; "" = all).
let selected_location = "";
let selected_employer = "";

function load_hidden_sources(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_SOURCES_KEY) || "[]");
  } catch {
    return [];
  }
}

function save_hidden_sources(): void {
  localStorage.setItem(HIDDEN_SOURCES_KEY, JSON.stringify([...hidden_sources]));
}

export function render_dashboard(root: HTMLElement): void {
  root.innerHTML = "";

  const header = document.createElement("div");
  header.className = "page-header";
  header.innerHTML = `
    <div>
      <div class="page-title">Dashboard</div>
      <div class="page-subtitle">Triage your job alerts</div>
    </div>
    <button class="btn btn-ghost" id="reload-btn">Reload from Gmail</button>
  `;
  root.appendChild(header);

  const tip = document.createElement("details");
  tip.className = "card tip-card";
  tip.innerHTML = `
    <summary>Tip: get better results</summary>
    <p><strong>LinkedIn:</strong> Go to Jobs &gt; Job Alerts &gt; edit each alert. Broaden keywords and enable "Email alert frequency: daily digest."</p>
    <p><strong>Indeed:</strong> Go to My Jobs &gt; Saved Searches. Edit or create searches with broader terms. Set email frequency to daily.</p>
    <p>More alerts = more data for Dreamcatcher to triage. Broader searches are fine — the risk scoring filters out the noise.</p>
  `;
  root.appendChild(tip);

  const stats_bar = document.createElement("div");
  stats_bar.className = "stats-bar";
  stats_bar.id = "stats-bar";
  root.appendChild(stats_bar);

  const source_filter = document.createElement("div");
  source_filter.className = "source-filter";
  source_filter.id = "source-filter";
  root.appendChild(source_filter);

  const controls = document.createElement("div");
  controls.className = "dash-controls";
  controls.id = "dash-controls";
  root.appendChild(controls);

  const tabs = document.createElement("div");
  tabs.className = "tabs";
  tabs.id = "job-tabs";
  root.appendChild(tabs);

  const list = document.createElement("div");
  list.id = "job-list";
  root.appendChild(list);

  // Event: reload
  document.getElementById("reload-btn")!.addEventListener("click", () => {
    load_jobs(root, true);
  });

  // On first load of a fresh session, sync from Gmail automatically.
  const first_load = sessionStorage.getItem(SYNCED_KEY) === null;
  load_jobs(root, first_load);
}

async function load_jobs(root: HTMLElement, reload: boolean): Promise<void> {
  const list = document.getElementById("job-list")!;
  const stats_bar = document.getElementById("stats-bar")!;

  list.innerHTML = "";
  list.appendChild(create_spinner("1.5rem"));

  const reload_btn = document.getElementById("reload-btn") as HTMLButtonElement;
  if (reload) {
    reload_btn.disabled = true;
    reload_btn.textContent = "Loading…";
  }

  try {
    const url = reload ? "/api/jobs?reload=true" : "/api/jobs";
    const data = await api<JobsResponse>("GET", url);

    if (reload) sessionStorage.setItem(SYNCED_KEY, "1");

    render_stats(stats_bar, data.stats);
    render_source_filter(data);
    render_controls(root, data);
    render_tabs(root, data);
    render_job_list(list, data);
  } catch (err: any) {
    list.innerHTML = `<div class="alert alert-err">${err.message}</div>`;
  } finally {
    reload_btn.disabled = false;
    reload_btn.textContent = "Reload from Gmail";
  }
}

function render_stats(el: HTMLElement, stats: JobsResponse["stats"]): void {
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${stats.total}</div>
      <div class="stat-label">Total</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.pending}</div>
      <div class="stat-label">Pending</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:var(--green)">${stats.applied}</div>
      <div class="stat-label">Applied</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:var(--t2)">${stats.skipped}</div>
      <div class="stat-label">Skipped</div>
    </div>
  `;
}

function render_tabs(root: HTMLElement, data: JobsResponse): void {
  const tabs_el = document.getElementById("job-tabs")!;
  const list = document.getElementById("job-list")!;

  const tab_defs: { id: string; label: string }[] = [
    { id: "top", label: "Top picks" },
    { id: "all", label: "All" },
    { id: "applied", label: "Applied" },
    { id: "skipped", label: "Skipped" },
    { id: "risky", label: "Risky" },
  ];

  tabs_el.innerHTML = "";
  for (const t of tab_defs) {
    const btn = document.createElement("button");
    btn.className = `tab ${active_tab === t.id ? "active" : ""}`;
    btn.textContent = t.label;
    btn.addEventListener("click", () => {
      active_tab = t.id;
      render_tabs(root, data);
      render_job_list(list, data);
    });
    tabs_el.appendChild(btn);
  }
}

function render_source_filter(data: JobsResponse): void {
  const el = document.getElementById("source-filter");
  if (!el) return;
  el.innerHTML = "";

  const counts = new Map<string, number>();
  for (const j of data.jobs) counts.set(j.source, (counts.get(j.source) || 0) + 1);
  // Always list the known boards, then any extra sources present (e.g. "unknown").
  const extras = [...counts.keys()].filter((s) => !ALL_SOURCES.includes(s)).sort();
  const sources = [...ALL_SOURCES, ...extras];

  const heading = document.createElement("span");
  heading.className = "source-filter-label";
  heading.textContent = "Show";
  el.appendChild(heading);

  for (const src of sources) {
    const n = counts.get(src) || 0;
    const chip = document.createElement("label");
    chip.className = `source-chip${n === 0 ? " is-empty" : ""}`;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !hidden_sources.has(src);
    box.addEventListener("change", () => {
      if (box.checked) hidden_sources.delete(src);
      else hidden_sources.add(src);
      save_hidden_sources();
      const list = document.getElementById("job-list");
      if (list) render_job_list(list, data);
    });

    const badge = document.createElement("span");
    badge.className = `badge badge-${src}`;
    badge.textContent = SOURCE_LABELS[src] || src;

    const count = document.createElement("span");
    count.className = "source-count";
    count.textContent = String(n);

    chip.append(box, badge, count);
    el.appendChild(chip);
  }
}

function render_controls(root: HTMLElement, data: JobsResponse): void {
  const el = document.getElementById("dash-controls");
  if (!el) return;
  el.innerHTML = "";

  const distinct = (pick: (j: Job) => string | null): string[] =>
    [...new Set(data.jobs.map(pick).filter((v): v is string => !!v && v.trim() !== ""))].sort(
      (a, b) => a.localeCompare(b),
    );

  const make_select = (
    label: string,
    values: string[],
    current: string,
    on_change: (v: string) => void,
  ): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "control-select";
    const cap = document.createElement("span");
    cap.className = "control-label";
    cap.textContent = label;
    const sel = document.createElement("select");
    sel.className = "input input-sm";
    sel.innerHTML =
      `<option value="">All</option>` +
      values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    sel.value = current;
    sel.addEventListener("change", () => {
      on_change(sel.value);
      const list = document.getElementById("job-list");
      if (list) render_job_list(list, data);
    });
    wrap.append(cap, sel);
    return wrap;
  };

  el.appendChild(
    make_select(
      "Location",
      distinct((j) => j.location),
      selected_location,
      (v) => {
        selected_location = v;
      },
    ),
  );
  el.appendChild(
    make_select(
      "Employer",
      distinct((j) => j.company),
      selected_employer,
      (v) => {
        selected_employer = v;
      },
    ),
  );

  // Bulk-clear actions.
  const actions = document.createElement("div");
  actions.className = "control-actions";
  const clear_stale = make_btn("Clear stale", "btn-ghost btn-sm", () =>
    bulk_clear(root, "stale", "Skip old or frequently-reposted pending jobs?"),
  );
  const clear_pending = make_btn("Clear pending", "btn-ghost btn-sm", () =>
    bulk_clear(root, "pending", "Skip ALL pending jobs? You can undo each individually."),
  );
  actions.append(clear_stale, clear_pending);
  el.appendChild(actions);
}

function make_btn(text: string, cls: string, onclick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `btn ${cls}`;
  btn.textContent = text;
  btn.addEventListener("click", onclick);
  return btn;
}

async function bulk_clear(
  root: HTMLElement,
  scope: "pending" | "stale",
  confirm_msg: string,
): Promise<void> {
  if (!window.confirm(confirm_msg)) return;
  try {
    const { cleared } = await api<{ cleared: number }>("POST", "/api/jobs/clear", { scope });
    show_toast(cleared === 1 ? "1 job skipped" : `${cleared} jobs skipped`);
    load_jobs(root, false);
  } catch (err: any) {
    show_toast(`Error: ${err.message}`);
  }
}

function show_toast(msg: string): void {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function render_job_list(el: HTMLElement, data: JobsResponse): void {
  el.innerHTML = "";

  // Apply the source / location / employer filters before the tab filter.
  const visible = data.jobs.filter(
    (j) =>
      !hidden_sources.has(j.source) &&
      (!selected_location || j.location === selected_location) &&
      (!selected_employer || j.company === selected_employer),
  );

  let filtered: Job[];

  switch (active_tab) {
    case "top": {
      filtered = visible
        .filter(
          (j) => j.status === "pending" && (j.risk_level === "low" || j.risk_level === "maybe"),
        )
        .sort((a, b) => a.risk_score - b.risk_score)
        .slice(0, 5);
      break;
    }
    case "all":
      filtered = visible.filter((j) => j.status === "pending");
      break;
    case "applied":
      filtered = visible.filter((j) => j.status === "applied");
      break;
    case "skipped":
      filtered = visible.filter((j) => j.status === "skipped");
      break;
    case "risky":
      filtered = visible.filter((j) => j.risk_level === "high" || j.risk_level === "avoid");
      break;
    default:
      filtered = visible;
  }

  if (filtered.length === 0) {
    el.innerHTML = `
      <div class="empty">
        <div class="empty-icon">&#x1F4AD;</div>
        <div class="empty-title">No jobs here</div>
      </div>
    `;
    return;
  }

  const on_update = () => {
    // Re-fetch to update stats and lists
    const stats_bar = document.getElementById("stats-bar")!;
    api<JobsResponse>("GET", "/api/jobs").then((fresh) => {
      data.jobs = fresh.jobs;
      data.stats = fresh.stats;
      render_stats(stats_bar, fresh.stats);
      render_job_list(el, data);
    });
  };

  for (const job of filtered) {
    el.appendChild(create_job_card(job, on_update));
  }
}
