import { esc, badge, human, date } from "../utils/dom.js";
import { money } from "../../core/schema.mjs";
export function table(rows, columns, { selectable = false } = {}) {
  const cell = (row, key) => {
    const value = row[key];
    if (
      [
        "amount",
        "price",
        "allocated",
        "purchasePrice",
        "replacementCost",
      ].includes(key)
    )
      return money(value);
    if (
      [
        "status",
        "condition",
        "stage",
        "severity",
        "priority",
        "state",
      ].includes(key)
    )
      return badge(value);
    if (["createdAt", "updatedAt", "actualTime"].includes(key))
      return esc(date(value));
    return esc(Array.isArray(value) ? value.join(", ") : value || "—");
  };
  return `<div class="table-wrap data-table"><table><thead><tr>${selectable ? '<th><input type="checkbox" data-select-all aria-label="Select all visible records"></th>' : ""}${columns.map((k) => `<th>${esc(human(k))}</th>`).join("")}<th></th></tr></thead><tbody>${rows.map((row) => `<tr data-id="${esc(row.id)}" tabindex="0" aria-label="Open ${esc(row.name || row.id)}">${selectable ? `<td class="check-cell" data-label="Select"><input type="checkbox" data-select="${esc(row.id)}" aria-label="Select ${esc(row.name || row.id)}"></td>` : ""}${columns.map((key, i) => `<td data-label="${esc(human(key))}" class="${i === 0 ? "row-title" : ""} ${/Id$/.test(key) ? "mono" : ""}">${cell(row, key)}</td>`).join("")}<td aria-hidden="true">›</td></tr>`).join("")}</tbody></table></div>`;
}
export function bindTable(root, open) {
  for (const row of root.querySelectorAll("tr[data-id]")) {
    row.onclick = (e) => {
      if (!e.target.closest("input,button,a")) open(row.dataset.id);
    };
    row.onkeydown = (e) => {
      if (e.key === "Enter" && e.target === row) open(row.dataset.id);
    };
  }
  const all = root.querySelector("[data-select-all]");
  if (all)
    all.onchange = () =>
      root
        .querySelectorAll("[data-select]")
        .forEach((c) => (c.checked = all.checked));
}
