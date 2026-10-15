import * as data from "./services/data.js";
import { $, esc, fail } from "./utils/dom.js";
const moduleFor = {
  dashboard: "dashboard",
  events: "events",
  labels: "labels",
  images: "images",
  settings: "settings",
  notifications: "notifications",
  scan: "scan",
  q: "scan",
  search: "search",
  archives: "archives",
};
let generation = 0;
let cleanup = () => {};
export async function renderRoute() {
  const current = ++generation;
  cleanup();
  data.clearListeners();
  const [path, query = ""] = location.hash.slice(2).split("?");
  const [rawSection, id] = path.split("/");
  const section = rawSection || "dashboard";
  const page = $("#page");
  if (!page) return;
  document
    .querySelectorAll("nav a")
    .forEach((a) => a.classList.toggle("active", a.dataset.route === section));
  $("#crumb").textContent =
    section === "equipment"
      ? "Inventory"
      : section.replace(/^./, (s) => s.toUpperCase());
  page.innerHTML = '<div class="loading">Loading authorized records…</div>';
  try {
    const module = await import(
      `./modules/${moduleFor[section] || "records"}.js`
    );
    if (current !== generation) return;
    const view = document.createElement("div");
    page.replaceChildren(view);
    const dispose = await module.render(view, {
      section,
      id,
      params: new URLSearchParams(query),
    });
    if (current === generation) cleanup = dispose || (() => {});
    else dispose?.();
  } catch (error) {
    if (current === generation) {
      page.innerHTML = `<div class="notice warning"><h2>Unable to open this view</h2><p>${esc(error.message)}</p><button data-retry>Try Again</button></div>`;
      $("[data-retry]", page).onclick = renderRoute;
    }
  }
}
export const go = (path) => {
  if (location.hash === `#/${path}`) renderRoute();
  else location.hash = `#/${path}`;
};
export function startRouter() {
  window.onhashchange = renderRoute;
  renderRoute();
}
