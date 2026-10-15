import * as data from "../services/data.js";
import { $, esc, empty, debounce } from "../utils/dom.js";
const types = [
  ["equipment", "Equipment", null],
  ["cases", "Road cases", null],
  ["events", "Events", null],
  ["crew", "Crew", "crew.read"],
  ["clients", "Clients", "clients.read"],
  ["maintenance", "Maintenance", null],
  ["purchaseGoals", "Purchase goals", "finance.read"],
];
export async function render(root) {
  root.innerHTML =
    '<div class="page-head"><div><h1>Search workspace</h1><p>Name-prefix search across authorized records.</p></div></div><input id="search" type="search" placeholder="Start typing a record name…" aria-label="Global search" autofocus><div id="search-results" class="section-gap"></div><p class="keyboard-hint">⌘ / Ctrl K opens search. Use Tab and Enter to open a result. Firestore search matches the start of a name.</p>';
  let generation = 0;
  $("#search", root).focus();
  $("#search", root).oninput = debounce(async (e) => {
    const current = ++generation,
      query = e.target.value.trim();
    if (!query) {
      $("#search-results", root).innerHTML = "";
      return;
    }
    const results = await Promise.all(
      types
        .filter(([, , permission]) => !permission || data.can(permission))
        .map(async ([type, label]) => {
          try {
            const page = await data.list(type, { search: query, size: 8 });
            return { type, label, ...page };
          } catch {
            return { type, label, rows: [] };
          }
        }),
    );
    if (current !== generation) return;
    $("#search-results", root).innerHTML = results.some((r) => r.rows.length)
      ? results
          .filter((r) => r.rows.length)
          .map(
            (r) =>
              `<section class="panel section-gap"><header class="panel-head"><h2>${r.label}</h2><small>${r.rows.length}${r.hasMore ? "+" : ""} matches</small></header>${r.rows.map((row) => `<a class="search-result" href="#/${r.type}/${row.id}"><strong>${esc(row.name)}</strong><small>${esc(row.assetId || row.status || "")}</small></a>`).join("")}</section>`,
          )
          .join("")
      : empty(
          "No authorized matches",
          "Try a shorter name prefix, or scan the record’s QR code.",
        );
  });
}
