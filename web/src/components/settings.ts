import { api } from "../api.js";

type Settings = {
  gmail_query: string;
  max_messages: number;
  max_apply_today: number;
  theme: "dark" | "light";
};

let panel_el: HTMLElement | null = null;

export function toggle_settings(): void {
  if (!panel_el) {
    panel_el = create_settings_panel();
    document.body.appendChild(panel_el);
    // Force reflow before adding .open
    panel_el.offsetHeight;
  }

  panel_el.classList.toggle("open");
}

function create_settings_panel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "settings-panel";

  panel.innerHTML = `
    <div class="settings-backdrop"></div>
    <div class="settings-drawer">
      <div class="settings-header">
        <span class="page-title" style="font-size:1.1rem">Settings</span>
        <button class="btn btn-ghost btn-sm" data-action="close">Close</button>
      </div>

      <div>
        <div class="form-label">Theme</div>
        <div class="theme-swatches">
          <button class="theme-swatch" data-theme="dark">Dark</button>
          <button class="theme-swatch" data-theme="light">Light</button>
        </div>
      </div>

      <div class="form-field">
        <div class="form-label-row">
          <label class="form-label" for="s-query">Email search filter</label>
          <button class="btn btn-ghost btn-sm" data-action="open-builder">Edit filter</button>
        </div>
        <input class="input input-clickable" id="s-query" type="text" readonly />
        <div class="form-hint">The Gmail query used to find your job-alert emails on each sync.</div>
      </div>

      <div class="form-field">
        <label class="form-label" for="s-max-messages">Messages per sync</label>
        <input class="input" id="s-max-messages" type="number" min="1" max="200" />
        <div class="form-hint">Max number of emails to pull from Gmail on each reload.</div>
      </div>

      <div class="form-field">
        <label class="form-label" for="s-max-apply">Daily application target</label>
        <input class="input" id="s-max-apply" type="number" min="1" max="50" />
        <div class="form-hint">Your goal for applications per day.</div>
      </div>

      <div class="settings-wellness">
        <strong>Why set a limit?</strong> Job searching today is exhausting — the process is more tedious, risky, and draining than it used to be. Setting a daily target keeps things in perspective, prevents burnout, and helps you maintain consistent energy to keep pushing forward. Take care of yourself first.
      </div>

      <button class="btn btn-primary" data-action="save">Save settings</button>
    </div>
  `;

  // Close handlers
  panel
    .querySelector(".settings-backdrop")
    ?.addEventListener("click", () => panel.classList.remove("open"));
  panel
    .querySelector('[data-action="close"]')
    ?.addEventListener("click", () => panel.classList.remove("open"));

  // Theme swatches
  panel.querySelectorAll(".theme-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = (btn as HTMLElement).dataset.theme as "dark" | "light";
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("dreamcatcher:theme", theme);
      update_theme_ui(panel);
    });
  });

  // Filter builder — button or input click
  const open_builder = () => {
    const current_query = (panel.querySelector("#s-query") as HTMLInputElement).value;
    open_filter_builder(current_query, (query) => {
      (panel.querySelector("#s-query") as HTMLInputElement).value = query;
    });
  };
  panel.querySelector('[data-action="open-builder"]')?.addEventListener("click", open_builder);
  panel.querySelector("#s-query")?.addEventListener("click", open_builder);

  // Save
  panel.querySelector('[data-action="save"]')?.addEventListener("click", async () => {
    const query = (panel.querySelector("#s-query") as HTMLInputElement).value;
    const max_messages = Number((panel.querySelector("#s-max-messages") as HTMLInputElement).value);
    const max_apply_today = Number((panel.querySelector("#s-max-apply") as HTMLInputElement).value);
    const theme = (document.documentElement.dataset.theme || "dark") as "dark" | "light";

    await api("PUT", "/api/settings", { gmail_query: query, max_messages, max_apply_today, theme });
    show_toast("Settings saved");
    panel.classList.remove("open");
  });

  // Load current settings
  load_settings(panel);

  return panel;
}

async function load_settings(panel: HTMLElement): Promise<void> {
  try {
    const s = await api<Settings>("GET", "/api/settings");
    (panel.querySelector("#s-query") as HTMLInputElement).value = s.gmail_query;
    (panel.querySelector("#s-max-messages") as HTMLInputElement).value = String(s.max_messages);
    (panel.querySelector("#s-max-apply") as HTMLInputElement).value = String(s.max_apply_today);
    update_theme_ui(panel);
  } catch {
    // ignore
  }
}

function update_theme_ui(panel: HTMLElement): void {
  const current = document.documentElement.dataset.theme || "dark";
  panel.querySelectorAll(".theme-swatch").forEach((el) => {
    el.classList.toggle("active", (el as HTMLElement).dataset.theme === current);
  });
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

// ── filter builder modal ──

type BuilderSource = { label: string; emails: string[]; active: boolean };

// Each board can send alerts from several addresses; matching one activates the source.
const KNOWN_SOURCES: { label: string; emails: string[] }[] = [
  {
    label: "LinkedIn",
    emails: ["jobalerts-noreply@linkedin.com", "jobs-listings@linkedin.com"],
  },
  {
    label: "Indeed",
    emails: ["alert@indeed.com", "donotreply@match.indeed.com", "donotreply@jobalert.indeed.com"],
  },
  { label: "Glassdoor", emails: ["noreply@glassdoor.com"] },
  { label: "ZipRecruiter", emails: ["alerts@ziprecruiter.com"] },
  { label: "Monster", emails: ["no-reply@ses.monster.com"] },
];

const TIME_OPTIONS: { label: string; value: string }[] = [
  { label: "1 day", value: "1d" },
  { label: "3 days", value: "3d" },
  { label: "1 week", value: "7d" },
  { label: "2 weeks", value: "14d" },
  { label: "1 month", value: "30d" },
];

function parse_query(query: string): {
  sources: BuilderSource[];
  time: string;
  custom_emails: string[];
} {
  // Extract time range
  const time_match = query.match(/newer_than:(\d+d)/);
  const time = time_match ? time_match[1] : "7d";

  // Extract from: addresses
  const from_regex = /from:\(?([^)\s]+)\)?/gi;
  const found_emails: string[] = [];
  for (const m of query.matchAll(from_regex)) {
    found_emails.push(m[1].toLowerCase());
  }

  const found_set = new Set(found_emails);
  const sources: BuilderSource[] = KNOWN_SOURCES.map((s) => ({
    ...s,
    active: s.emails.some((e) => found_set.has(e.toLowerCase())),
  }));

  const known_set = new Set(KNOWN_SOURCES.flatMap((s) => s.emails.map((e) => e.toLowerCase())));
  const custom_emails = found_emails.filter((e) => !known_set.has(e));

  // If nothing was detected, default all known sources on
  if (sources.every((s) => !s.active) && custom_emails.length === 0) {
    for (const s of sources) s.active = true;
  }

  return { sources, time, custom_emails };
}

function build_query(sources: BuilderSource[], custom_emails: string[], time: string): string {
  const from_parts: string[] = [];
  for (const s of sources) {
    if (s.active) {
      for (const e of s.emails) from_parts.push(`from:(${e})`);
    }
  }
  for (const e of custom_emails) {
    if (e.trim()) from_parts.push(`from:(${e.trim()})`);
  }

  const from_clause = from_parts.length > 1 ? `(${from_parts.join(" OR ")})` : from_parts[0] || "";

  return `newer_than:${time} ${from_clause}`.trim();
}

function open_filter_builder(current_query: string, on_apply: (query: string) => void): void {
  const parsed = parse_query(current_query);
  const sources = parsed.sources;
  const custom_emails = parsed.custom_emails;
  let selected_time = parsed.time;

  const overlay = document.createElement("div");
  overlay.className = "fb-overlay";

  const modal = document.createElement("div");
  modal.className = "fb-modal";

  function render(): void {
    modal.innerHTML = `
      <div class="fb-header">
        <span class="page-title" style="font-size:1.1rem">Filter builder</span>
        <button class="btn btn-ghost btn-sm" data-action="fb-close">\u00d7</button>
      </div>

      <div class="fb-section">
        <div class="form-label">Email sources</div>
        <div class="form-hint" style="margin-bottom:0.5rem">Which job-alert senders should we look for?</div>
        <div class="fb-chips" id="fb-source-chips"></div>
      </div>

      <div class="fb-section">
        <div class="form-label">Custom sender</div>
        <div class="form-hint" style="margin-bottom:0.5rem">Add other job-alert email addresses.</div>
        <div id="fb-custom-list"></div>
        <button class="btn btn-ghost btn-sm" data-action="fb-add-custom" style="margin-top:0.35rem">+ Add sender</button>
      </div>

      <div class="fb-section">
        <div class="form-label">Time range</div>
        <div class="form-hint" style="margin-bottom:0.5rem">How far back should we search?</div>
        <div class="fb-chips" id="fb-time-chips"></div>
      </div>

      <div class="fb-section fb-preview">
        <div class="form-label">Preview</div>
        <code class="fb-preview-code" id="fb-preview"></code>
      </div>

      <div class="fb-actions">
        <button class="btn btn-ghost" data-action="fb-cancel">Cancel</button>
        <button class="btn btn-primary" data-action="fb-apply">Apply filter</button>
      </div>
    `;

    // Source chips
    const chips_el = modal.querySelector("#fb-source-chips")!;
    for (const src of sources) {
      const chip = document.createElement("button");
      chip.className = `fb-chip ${src.active ? "active" : ""}`;
      chip.textContent = src.label;
      chip.addEventListener("click", () => {
        src.active = !src.active;
        render();
      });
      chips_el.appendChild(chip);
    }

    // Custom emails
    const custom_list = modal.querySelector("#fb-custom-list")!;
    custom_emails.forEach((email, i) => {
      const row = document.createElement("div");
      row.className = "fb-custom-row";
      row.innerHTML = `
        <input class="input input-sm" type="email" value="${esc(email)}" placeholder="alerts@example.com" />
        <button class="btn btn-ghost btn-sm fb-remove-btn" data-idx="${i}">\u00d7</button>
      `;
      const input = row.querySelector("input")!;
      input.addEventListener("input", () => {
        custom_emails[i] = input.value;
        update_preview();
      });
      row.querySelector(".fb-remove-btn")!.addEventListener("click", () => {
        custom_emails.splice(i, 1);
        render();
      });
      custom_list.appendChild(row);
    });

    // Add custom
    modal.querySelector('[data-action="fb-add-custom"]')?.addEventListener("click", () => {
      custom_emails.push("");
      render();
      // Focus the new input
      const inputs = modal.querySelectorAll("#fb-custom-list input");
      (inputs[inputs.length - 1] as HTMLInputElement)?.focus();
    });

    // Time chips
    const time_el = modal.querySelector("#fb-time-chips")!;
    for (const opt of TIME_OPTIONS) {
      const chip = document.createElement("button");
      chip.className = `fb-chip ${selected_time === opt.value ? "active" : ""}`;
      chip.textContent = opt.label;
      chip.addEventListener("click", () => {
        selected_time = opt.value;
        render();
      });
      time_el.appendChild(chip);
    }

    // Preview
    update_preview();

    // Close / cancel / apply
    modal.querySelector('[data-action="fb-close"]')?.addEventListener("click", close);
    modal.querySelector('[data-action="fb-cancel"]')?.addEventListener("click", close);
    modal.querySelector('[data-action="fb-apply"]')?.addEventListener("click", () => {
      const query = build_query(
        sources,
        custom_emails.filter((e) => e.trim()),
        selected_time,
      );
      on_apply(query);
      close();
    });
  }

  function update_preview(): void {
    const preview = modal.querySelector("#fb-preview");
    if (preview) {
      preview.textContent = build_query(
        sources,
        custom_emails.filter((e) => e.trim()),
        selected_time,
      );
    }
  }

  function close(): void {
    overlay.classList.remove("open");
    setTimeout(() => overlay.remove(), 200);
  }

  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  document.body.appendChild(overlay);
  overlay.offsetHeight; // reflow
  overlay.classList.add("open");

  render();
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
