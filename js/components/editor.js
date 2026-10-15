import { schemas, cents, money } from "../../core/schema.mjs";
import * as data from "../services/data.js";
import { $, $$, esc, busy, toast, fail } from "../utils/dom.js";
import { modal } from "./modal.js";
export async function editor(
  type,
  record = null,
  { eventId, initial = {}, onSaved = () => {} } = {},
) {
  const schema = schemas[type];
  if (!schema) throw Error("Unknown editor.");
  let fields = schema.fields.map((f) => ({ ...f }));
  const category = fields.find((f) => f.key === "category");
  if (category?.type === "select") {
    const custom = await data.get("settings/categories").catch(() => null);
    category.options = [
      ...new Set([...category.options, ...(custom?.values || [])]),
    ];
  }
  const html = `<form class="record-form"><div class="form-grid">${fields
    .map((f) => {
      const v = record?.[f.key] ?? initial[f.key] ?? f.default ?? "";
      return `<label class="${["textarea", "refs"].includes(f.type) ? "full" : ""}">${esc(f.label)}${f.required ? " *" : ""}${input(f, v)}</label>`;
    })
    .join(
      "",
    )}</div><div class="form-error" role="alert"></div><div class="form-actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">${record ? "Save Changes" : `Create ${schema.singular || "Record"}`}</button></div></form>`;
  const m = modal(
    `${record ? "Edit" : "New"} ${schema.singular || type}`,
    html,
  );
  $("[data-cancel]", m.el).onclick = m.close;
  for (const f of fields.filter((f) => ["ref", "refs"].includes(f.type)))
    await populateRef(m.el, f, record?.[f.key] ?? initial[f.key]);
  if (type === "ledger") {
    const form = $("form", m.el);
    form.elements.kind.addEventListener("change", () => {
      if (
        ["Revenue received", "Expense paid", "Crew payment"].includes(
          form.elements.kind.value,
        )
      )
        form.elements.status.value = "Paid";
    });
  }
  $("form", m.el).onsubmit = (e) => {
    e.preventDefault();
    busy($("button[type=submit]", m.el), async () => {
      const form = $("form", m.el),
        values = {};
      for (const f of fields) {
        const control = form.elements[f.key];
        if (f.type === "refs")
          values[f.key] = [...control.selectedOptions].map((o) => o.value);
        else if (f.type === "money")
          values[f.key] = control.value === "" ? "" : cents(control.value);
        else if (f.type === "number")
          values[f.key] = control.value === "" ? "" : Number(control.value);
        else values[f.key] = control.value;
      }
      try {
        const result = await data.operate({
          op: "save",
          type,
          data: values,
          id: record?.id,
          eventId,
          baseRevision: record?.revision,
        });
        m.close();
        toast("Saved.");
        await onSaved(result.id);
      } catch (error) {
        $(".form-error", m.el).textContent = error.message;
      }
    });
  };
  return m;
}
function input(f, v) {
  const key = esc(f.key),
    attrs = `aria-label="${esc(f.label)}" name="${key}" ${f.required ? "required" : ""}`;
  if (f.type === "textarea") return `<textarea ${attrs}>${esc(v)}</textarea>`;
  if (f.type === "select")
    return `<select ${attrs}>${f.options.map((o) => `<option ${v === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  if (["ref", "refs"].includes(f.type))
    return `<span class="ref-select-wrap"><select ${attrs} ${f.type === "refs" ? "multiple" : ""}><option value="">None</option></select><input class="ref-search" type="search" data-ref-search="${key}" placeholder="Find by name prefix…" aria-label="Find ${esc(f.label)}"><small class="muted" data-ref-hint="${key}">Loading authorized records…</small></span>`;
  return `<input ${attrs} type="${f.type === "money" ? "number" : f.type}" ${f.type === "number" ? `min="${f.min ?? 0}" step="1"` : f.type === "money" ? 'min="0" step="0.01"' : ""} value="${esc(f.type === "money" && v !== "" ? v / 100 : v)}">`;
}
async function populateRef(root, field, selected) {
  const control = $(`[name="${field.key}"]`, root),
    search = $(`[data-ref-search="${field.key}"]`, root),
    hint = $(`[data-ref-hint="${field.key}"]`, root);
  let timer;
  const pinned = new Map();
  const ids = Array.isArray(selected) ? selected : selected ? [selected] : [];
  for (const id of ids) {
    const row = await data.get(`${field.collection}/${id}`).catch(() => null);
    if (row) pinned.set(id, { id, ...row });
  }
  async function refresh() {
    try {
      for (const opt of control.selectedOptions)
        if (opt.value && !pinned.has(opt.value))
          pinned.set(opt.value, { id: opt.value, name: opt.textContent });
      const result = await data.list(field.collection, {
        size: 60,
        search: search.value,
      });
      const all = new Map([...pinned, ...result.rows.map((r) => [r.id, r])]);
      const current = new Set(
        [...control.selectedOptions].map((o) => o.value).concat(ids),
      );
      control.innerHTML = `${field.type === "ref" ? '<option value="">None</option>' : ""}${[...all.values()].map((r) => `<option value="${esc(r.id)}" ${current.has(r.id) ? "selected" : ""}>${esc(r.assetId ? `${r.assetId} · ${r.name}` : r.name || r.id)}</option>`).join("")}`;
      hint.textContent = result.hasMore
        ? "First 60 matches. Narrow your search."
        : field.type === "refs"
          ? "Select multiple with Ctrl / Command."
          : `${result.rows.length} authorized matches`;
    } catch (e) {
      hint.textContent = e.message;
    }
  }
  search.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 250);
  };
  await refresh();
}
