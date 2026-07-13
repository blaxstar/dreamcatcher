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
  app.appendChild(nav);

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
