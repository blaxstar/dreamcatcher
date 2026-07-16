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
const hidden_sources = new Set<string>(load_hidden_sources());

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
      <div class="page-title">dashboard</div>
      <div class="page-subtitle">triage your job alerts</div>
    </div>
    <button class="btn btn-ghost" id="reload-btn">reload from gmail</button>
  `;
  root.appendChild(header);

  const tip = document.createElement("details");
  tip.className = "card tip-card";
  tip.innerHTML = `
    <summary>tip: get better results</summary>
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
    reload_btn.textContent = "loading...";
  }

  try {
    const url = reload ? "/api/jobs?reload=true" : "/api/jobs";
    const data = await api<JobsResponse>("GET", url);

    if (reload) sessionStorage.setItem(SYNCED_KEY, "1");

    render_stats(stats_bar, data.stats);
    render_source_filter(data);
    render_tabs(root, data);
    render_job_list(list, data);
  } catch (err: any) {
    list.innerHTML = `<div class="alert alert-err">${err.message}</div>`;
  } finally {
    reload_btn.disabled = false;
    reload_btn.textContent = "reload from gmail";
  }
}

function render_stats(el: HTMLElement, stats: JobsResponse["stats"]): void {
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${stats.total}</div>
      <div class="stat-label">total</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.pending}</div>
      <div class="stat-label">pending</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:var(--green)">${stats.applied}</div>
      <div class="stat-label">applied</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:var(--t2)">${stats.skipped}</div>
      <div class="stat-label">skipped</div>
    </div>
  `;
}

function render_tabs(root: HTMLElement, data: JobsResponse): void {
  const tabs_el = document.getElementById("job-tabs")!;
  const list = document.getElementById("job-list")!;

  const tab_defs: { id: string; label: string }[] = [
    { id: "top", label: "top picks" },
    { id: "all", label: "all" },
    { id: "applied", label: "applied" },
    { id: "skipped", label: "skipped" },
    { id: "risky", label: "risky" },
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
  const sources = [...counts.keys()].sort();

  // Nothing to filter if everything is from one place.
  if (sources.length <= 1) return;

  const heading = document.createElement("span");
  heading.className = "source-filter-label";
  heading.textContent = "show";
  el.appendChild(heading);

  for (const src of sources) {
    const chip = document.createElement("label");
    chip.className = "source-chip";

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
    count.textContent = String(counts.get(src));

    chip.append(box, badge, count);
    el.appendChild(chip);
  }
}

function render_job_list(el: HTMLElement, data: JobsResponse): void {
  el.innerHTML = "";

  // Apply the source (site) filter before anything else.
  const visible = data.jobs.filter((j) => !hidden_sources.has(j.source));

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
        <div class="empty-title">no jobs here</div>
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
