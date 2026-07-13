export function create_spinner(size?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "spinner";
  if (size) {
    el.style.width = size;
    el.style.height = size;
  }
  return el;
}

export function create_page_spinner(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "page-spinner";
  wrap.appendChild(create_spinner("2.5rem"));
  return wrap;
}
