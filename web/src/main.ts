import "./theme.css";
import { check_auth } from "./auth.js";
import { create_nav } from "./components/nav.js";
import { toggle_settings } from "./components/settings.js";
import { create_page_spinner } from "./components/spinner.js";
import { render_dashboard } from "./pages/dashboard.js";
import { render_login } from "./pages/login.js";
import { init, register } from "./router.js";

async function boot(): Promise<void> {
  const root = document.getElementById("root")!;

  // Restore theme from localStorage
  const saved_theme = localStorage.getItem("dreamcatcher:theme");
  if (saved_theme === "dark" || saved_theme === "light") {
    document.documentElement.dataset.theme = saved_theme;
  }

  // Show loading spinner while checking auth
  root.appendChild(create_page_spinner());

  const user = await check_auth();

  root.innerHTML = "";

  if (!user) {
    render_login(root);
    return;
  }

  // Authenticated: set up app shell
  const app = document.createElement("div");
  app.className = "app";

  const nav = create_nav(toggle_settings);

  // Mobile top bar with a hamburger that opens the sidebar as a drawer.
  const topbar = document.createElement("div");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <button class="topbar-toggle" aria-label="Open menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <div class="topbar-title"><span class="topbar-mark" aria-hidden="true"></span> Dreamcatcher</div>
  `;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";

  const toggle_btn = topbar.querySelector(".topbar-toggle") as HTMLButtonElement;
  const set_menu = (open: boolean): void => {
    nav.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
    toggle_btn.setAttribute("aria-expanded", String(open));
  };
  toggle_btn.addEventListener("click", () => set_menu(!nav.classList.contains("open")));
  backdrop.addEventListener("click", () => set_menu(false));
  // Any navigation or action inside the drawer closes it.
  nav.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a, button")) set_menu(false);
  });

  app.appendChild(topbar);
  app.appendChild(nav);
  app.appendChild(backdrop);

  const main = document.createElement("div");
  main.className = "main";
  main.id = "main-content";
  app.appendChild(main);

  root.appendChild(app);

  // Set up routes
  register("/", (el) => render_dashboard(el));

  init(main);
}

boot();
