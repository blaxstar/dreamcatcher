import { get_user, logout } from "../auth.js";
import { current_path } from "../router.js";

export function create_nav(on_settings: () => void): HTMLElement {
  const user = get_user();
  const nav = document.createElement("nav");
  nav.className = "sidebar";

  const path = current_path();

  const avatar_content = user?.picture_url
    ? `<img src="${user.picture_url}" alt="" referrerpolicy="no-referrer">`
    : (user?.display_name || user?.email || "?").charAt(0).toLowerCase();

  nav.innerHTML = `
    <a class="nav-logo" href="#/">
      <img class="nav-logo-mark" src="/favicon.svg" alt="" />
      Dreamcatcher
    </a>

    <div class="nav-section">Triage</div>
    <a class="nav-link ${path === "/" ? "active" : ""}" href="#/">
      Dashboard
    </a>

    <div class="nav-footer">
      <div class="nav-user">
        <div class="avatar">${avatar_content}</div>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${user?.display_name || user?.email || ""}</span>
      </div>
      <button class="nav-link" data-action="settings">Settings</button>
      <button class="nav-link" data-action="logout">Sign out</button>
      <a class="nav-link nav-link-muted" href="/privacy" target="_blank" rel="noopener">Privacy policy</a>
    </div>
  `;

  nav.querySelector('[data-action="settings"]')?.addEventListener("click", on_settings);
  nav.querySelector('[data-action="logout"]')?.addEventListener("click", () => logout());

  return nav;
}
