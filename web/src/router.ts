type RouteHandler = (root: HTMLElement) => void;
type Route = { pattern: string; handler: RouteHandler };

const routes: Route[] = [];
let root_el: HTMLElement;

export function register(pattern: string, handler: RouteHandler): void {
  routes.push({ pattern, handler });
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

export function current_path(): string {
  const h = window.location.hash.replace(/^#\/?/, "/");
  return h || "/";
}

function resolve(): void {
  const path = current_path();
  for (const route of routes) {
    if (route.pattern === path || (route.pattern === "/" && path === "/")) {
      root_el.innerHTML = "";
      route.handler(root_el);
      return;
    }
  }
  // Default to first route
  if (routes.length > 0) {
    root_el.innerHTML = "";
    routes[0].handler(root_el);
  }
}

export function init(root: HTMLElement): void {
  root_el = root;
  window.addEventListener("hashchange", resolve);
  resolve();
}
