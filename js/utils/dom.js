export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [
  ...root.querySelectorAll(selector),
];
export const date = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export const human = (key) =>
  key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
export function badge(value) {
  const state = String(value || "—");
  return `<span class="badge ${/Unsafe|Critical|Missing|Damaged|Urgent/.test(state) ? "danger" : /Complete|Good|Available|Returned|Paid|Resolved/.test(state) ? "success" : /Live|Installed|Loading|High|inspection/.test(state) ? "warning" : ""}">${esc(state)}</span>`;
}
export const empty = (title, body, action = "") =>
  `<div class="empty"><span class="empty-icon">＋</span><h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;
export function toast(message, error = false) {
  for (const old of document.querySelectorAll("#toasts .toast"))
    if (old.textContent === message) old.remove();
  while (document.querySelectorAll("#toasts .toast").length >= 3)
    document.querySelector("#toasts .toast").remove();
  const el = document.createElement("div");
  el.className = `toast ${error ? "error" : ""}`;
  el.setAttribute("role", error ? "alert" : "status");
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), error ? 6500 : 4000);
}
export const fail = (e) => toast(e.message || String(e), true);
export function download(name, content, type = "application/json") {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function csv(rows, fields) {
  return [fields, ...rows.map((r) => fields.map((k) => r[k] ?? ""))]
    .map((row) =>
      row
        .map((v) => {
          let s = String(v);
          if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
          return `"${s.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
export function parseCSV(text) {
  if (text.length > 500000) throw Error("CSV exceeds 500 KB.");
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\r" || c === "\n") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw Error("Unclosed CSV quote.");
  row.push(value);
  if (row.some((v) => v.trim())) rows.push(row);
  const [headers = [], ...data] = rows;
  return data.map((values) =>
    Object.fromEntries(
      headers.map((h, i) => [h.trim(), values[i]?.trim() || ""]),
    ),
  );
}
export function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
export async function busy(button, fn) {
  const text = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    return await fn();
  } catch (e) {
    fail(e);
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = text;
      button.removeAttribute("aria-busy");
    }
  }
}
export function icon(name) {
  const paths = {
    dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    equipment: "M4 7h16v14H4z M8 7V3h8v4 M4 12h16 M10 12v3h4v-3",
    cases: "M3 7h18v14H3z M7 7V3h10v4 M3 12h18 M10 12v3h4v-3",
    events: "M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4",
    crew: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    maintenance: "m14 6 4-4 4 4-4 4-3-1-8 12-4-4 9-8z",
    clients:
      "M3 21V7l9-4 9 4v14 M7 11h2 M15 11h2 M7 15h2 M15 15h2 M10 21v-4h4v4",
    songs:
      "M9 18V5l12-2v13 M9 8l12-2 M9 18a3 3 0 1 1-3-3h3 M21 16a3 3 0 1 1-3-3h3",
    finances: "M3 5h18v14H3z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M6 9v6 M18 9v6",
    purchases: "M3 3h2l3 12h11l3-8H6 M9 21h.01 M19 21h.01",
    labels: "M3 3h9l9 9-9 9-9-9z M7 7h.01",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
    search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    scan: "M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M3 12h18",
    bell: "M18 8a6 6 0 0 0-12 0v6l-3 3h18l-3-3z M10 21h4",
    arrow: "m9 5 7 7-7 7",
    logout: "M9 3H3v18h6 M13 7l5 5-5 5 M8 12h14",
    images: "M3 3h18v18H3z m0 14 6-6 4 4 3-3 5 5 M8 7h.01",
    activity: "M3 12h4l3-9 4 18 3-9h4",
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.dashboard}"/></svg>`;
}
