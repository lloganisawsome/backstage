import {
  schemas,
  stages,
  conditions,
  money,
  finances,
} from "../../core/schema.mjs";
import * as data from "../services/data.js";
import {
  $,
  $$,
  esc,
  empty,
  badge,
  date,
  human,
  toast,
  fail,
  debounce,
  download,
  csv,
  busy,
} from "../utils/dom.js";
import { table, bindTable } from "../components/table.js";
import { editor } from "../components/editor.js";
import { modal, prompt, confirm } from "../components/modal.js";
import { go } from "../router.js";
export async function render(root, { section: type, id, params }) {
  const schema = schemas[type];
  if (!schema) throw Error("This page does not exist.");
  if (schema.read && !data.can(schema.read)) throw Error("Permission denied.");
  if (id) return detail(root, type, id);
  let cursor = null,
    rows = [],
    search = "",
    filter = "",
    categoryFilter = "",
    sort = "createdAt";
  const canEdit = data.can(schema.write);
  root.innerHTML = `<div class="page-head"><div><h1>${esc(schema.label)}</h1><p>${esc(description[type] || "Manage operational records.")}</p></div><div class="head-actions"><button id="export">Export CSV</button>${canEdit ? `<button class="primary" id="create">＋ ${type === "equipment" ? "Add Equipment" : `New ${schema.singular || "Record"}`}</button>` : ""}</div></div><div id="finance-cards"></div><div class="toolbar"><div class="toolbar-left"><input id="filter-search" type="search" placeholder="Find by name prefix…" aria-label="Search ${esc(schema.label)}">${type === "equipment" ? `<select id="filter" aria-label="Filter condition"><option value="">All conditions</option>${conditions.map((s) => `<option>${s}</option>`).join("")}</select>` : type === "events" ? '<select id="filter"><option value="">All events</option><option>Archived</option><option>Completed</option><option>Live</option><option>Planning</option></select>' : ""}<select id="sort" aria-label="Sort order"><option value="createdAt">Newest first</option><option value="nameKey">Name A–Z</option></select></div><span class="muted" id="visible-count" style="font-size:11px"></span></div>${["equipment", "cases", "crew", "purchaseGoals", "ledger"].includes(type) ? '<div class="toolbar" id="bulk-toolbar"><span class="muted" style="font-size:11px">Select rows for batch labels or status changes.</span><div class="toolbar-left"><button data-bulk-labels>Print Selected Labels</button>' + (type === "equipment" && canEdit ? "<button data-bulk-stage>Update Selected Stage</button>" : "") + "</div></div>" : ""}<div id="record-list"></div><div class="footer-line"><span id="page-note">50 records per page</span><div><button id="first">First Page</button> <button id="next">Next Page →</button></div></div>`;
  const load = async (reset = false) => {
    if (reset) cursor = null;
    const filters = [
      ...(filter
        ? [[type === "equipment" ? "condition" : "status", "==", filter]]
        : []),
      ...(categoryFilter ? [["category", "==", categoryFilter]] : []),
    ];
    const page = await data.list(type, {
      size: 50,
      search,
      filters,
      cursor,
      order: sort,
    });
    rows = page.rows;
    $("#record-list", root).innerHTML = rows.length
      ? table(rows, schema.columns, {
          selectable: ["equipment", "cases", "crew"].includes(type),
        })
      : empty(
          `No ${schema.label.toLowerCase()} ${search || filter || categoryFilter ? "match" : "yet"}`,
          search || filter || categoryFilter
            ? "Try another prefix or filter."
            : `Add the first ${schema.singular?.toLowerCase() || "record"} to get started.`,
          canEdit
            ? '<button class="primary" data-empty-create>＋ Create Record</button>'
            : "",
        );
    $("#visible-count", root).textContent =
      `${rows.length} records on this page`;
    $("#next", root).disabled = !page.hasMore;
    $("#next", root).onclick = () => {
      cursor = page.cursor;
      load().catch(fail);
    };
    bindTable($("#record-list", root), (id) => go(`${type}/${id}`));
    $("[data-empty-create]", root)?.addEventListener("click", create);
  };
  if (["equipment", "cases"].includes(type)) {
    const defaults = schemas.equipment.fields.find(
        (f) => f.key === "category",
      ).options,
      custom = await data.get("settings/categories").catch(() => null);
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Category view");
    select.innerHTML = `<option value="">All categories</option>${[...new Set([...defaults, ...(custom?.values || [])])].map((c) => `<option>${esc(c)}</option>`).join("")}`;
    $("#sort", root).before(select);
    select.onchange = (e) => {
      categoryFilter = e.target.value;
      load(true).catch(fail);
    };
  }
  const create = () =>
    editor(type, null, {
      initial: {
        equipmentId: params.get("equipmentId") || "",
        eventId: params.get("eventId") || "",
      },
      onSaved: (id) => go(`${type}/${id}`),
    }).catch(fail);
  $("#create", root)?.addEventListener("click", create);
  $("#filter-search", root).oninput = debounce((e) => {
    search = e.target.value.trim();
    load(true).catch(fail);
  });
  $("#filter", root)?.addEventListener("change", (e) => {
    filter = e.target.value;
    load(true).catch(fail);
  });
  $("#sort", root).onchange = (e) => {
    sort = e.target.value;
    load(true).catch(fail);
  };
  $("#first", root).onclick = () => load(true).catch(fail);
  $("#export", root).onclick = (e) =>
    busy(e.currentTarget, async () => {
      const all = await data.queryAll(
        type,
        filter
          ? [[type === "equipment" ? "condition" : "status", "==", filter]]
          : [],
      );
      download(
        `${type}.csv`,
        csv(all, [
          ...new Set([
            "id",
            ...schema.fields.map((f) => f.key),
            ...schema.columns,
          ]),
        ]),
        "text/csv",
      );
    });
  $("[data-bulk-labels]", root)?.addEventListener("click", () => {
    const selected = $$("[data-select]:checked", root).map(
      (x) => x.dataset.select,
    );
    if (!selected.length) return toast("Select at least one record.", true);
    sessionStorage.setItem(
      "labelSelection",
      JSON.stringify({ type, ids: selected }),
    );
    go("labels");
  });
  $("[data-bulk-stage]", root)?.addEventListener("click", async () => {
    const selected = $$("[data-select]:checked", root).map((x) =>
      rows.find((r) => r.id === x.dataset.select),
    );
    if (!selected.length) return toast("Select assets first.", true);
    const stage = await chooseStage();
    if (!stage) return;
    let completed = 0;
    try {
      for (const row of selected) {
        await data.operate({
          op: "equipmentStage",
          equipmentId: row.id,
          stage,
          baseRevision: row.revision,
        });
        completed++;
      }
      toast(`Updated ${completed} assets.`);
    } catch (e) {
      toast(`${completed} assets updated. ${e.message}`, true);
    }
    await load();
  });
  await load();
  if (type === "ledger") {
    const summary = (await data.get("financeTotals/global")) || {};
    const result = finances(
      Object.entries(summary.byKind || {}).map(([kind, amount]) => ({
        kind,
        amount,
      })),
    );
    $("#finance-cards", root).innerHTML = `<div class="stats">${[
      ["Expected revenue", result.expected],
      ["Invoiced / unpaid", result.outstanding],
      ["Received", result.received],
      ["Paid expenses", result.expensesPaid],
      ["Estimated profit", result.estimated],
      ["Realized profit", result.realized],
      ["Crew balance due", result.crewDue],
      ["Unallocated cash", result.cash - (summary.allocated || 0)],
    ]
      .map(
        ([label, n]) =>
          `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value" style="font-size:23px">${money(n)}</div></div>`,
      )
      .join(
        "",
      )}</div><p class="notice">All amounts are recorded in USD. Expected and invoiced revenue do not increase available cash. Partial crew payments use separate payment entries; corrections require a reason. This ledger does not process payments or calculate tax.</p>`;
  }
  if (params.get("new") && canEdit) create();
}
const description = {
  equipment: "Asset records, deployment, and condition.",
  cases: "Persistent case contents and event packing records.",
  crew: "People, qualifications, and event assignments.",
  clients: "Contacts and preferences for returning clients.",
  maintenance: "Equipment issues, repairs, and scheduled inspections.",
  purchaseGoals: "Plan purchases using funds already received.",
  ledger: "Expected revenue, received funds, and recorded expenses.",
  songs: "Reusable songs for event setlists.",
};
async function detail(root, type, id) {
  const row = await data.get(`${type}/${id}`);
  if (!row) throw Error("This record is unavailable or no longer exists.");
  const schema = schemas[type];
  root.innerHTML = `<div class="page-head"><div><a class="overline" href="#/${type}">← ${esc(schema.label)}</a><h1 style="margin-top:11px">${esc(row.name)}</h1><p>${esc(row.assetId || row.id)} ${row.condition ? " · " : ""}${row.condition ? esc(row.condition) : ""}</p></div><div class="head-actions">${row.qrId ? '<button id="label">Print Label</button>' : ""}${data.can(schema.write) ? '<button class="primary" id="edit">Edit Record</button>' : ""}</div></div><section class="panel"><div class="panel-body"><dl class="detail-grid">${[
    ...schema.fields,
    ...(type === "equipment"
      ? [
          { key: "stage", label: "Deployment stage" },
          { key: "caseId", label: "Assigned case" },
          { key: "eventId", label: "Assigned event" },
        ]
      : []),
  ]
    .filter((f) => row[f.key] != null && row[f.key] !== "")
    .map(
      (f) =>
        `<div><dt>${esc(f.label)}</dt><dd>${f.type === "money" ? money(row[f.key]) : esc(Array.isArray(row[f.key]) ? row[f.key].join(", ") : row[f.key])}</dd></div>`,
    )
    .join(
      "",
    )}</dl><div class="head-actions" id="record-actions"></div></div></section><div id="related" class="section-gap"></div><div id="photo-section" class="section-gap"></div><div id="history" class="section-gap"></div>`;
  $("#edit", root)?.addEventListener("click", () =>
    editor(type, row, { onSaved: () => detail(root, type, id) }).catch(fail),
  );
  $("#label", root)?.addEventListener("click", () => {
    sessionStorage.setItem(
      "labelSelection",
      JSON.stringify({ type, ids: [id] }),
    );
    go("labels");
  });
  const actions = $("#record-actions", root);
  if (type === "equipment") {
    if (data.can("equipment.write") || row.eventId) {
      actions.innerHTML += '<button id="stage">Update Deployment</button>';
      $("#stage", root).onclick = async () => {
        const stage = await chooseStage(row.stage);
        if (!stage) return;
        const location = await prompt("Update Location", "Equipment location", {
          value: row.location || "",
        });
        if (location === null) return;
        try {
          await data.operate({
            op: "equipmentStage",
            equipmentId: id,
            stage,
            location,
            baseRevision: row.revision,
          });
          toast("Deployment updated.");
          detail(root, type, id);
        } catch (e) {
          fail(e);
        }
      };
    }
    if (data.can("equipment.write")) {
      actions.innerHTML += '<button id="case-assign">Move to Case</button>';
      $("#case-assign", root).onclick = async () => {
        const caseId = await chooseRecord(
          "cases",
          "Select a permanent case (or remove assignment)",
          true,
        );
        if (caseId === undefined) return;
        try {
          await data.operate({
            op: "assignCase",
            equipmentId: id,
            caseId,
            baseRevision: row.revision,
          });
          toast("Case assignment updated.");
          detail(root, type, id);
        } catch (e) {
          fail(e);
        }
      };
    }
    actions.innerHTML += `<a class="button" href="#/maintenance?new=1&equipmentId=${esc(id)}&eventId=${esc(row.eventId || "")}">Report Issue</a>${row.eventId ? `<a class="button" href="#/events/${esc(row.eventId)}?tab=equipment">Open Event</a>` : ""}`;
  } else if (type === "cases") {
    const contents = await data.list("equipment", {
      filters: [["caseId", "==", id]],
      size: 100,
    });
    $("#related", root).innerHTML =
      `<section class="panel"><header class="panel-head"><h2>Standard case contents</h2><span class="muted">${contents.rows.length}${contents.hasMore ? "+" : ""} assets</span></header>${contents.rows.length ? table(contents.rows, ["assetId", "name", "condition", "stage"]) : empty("No assigned contents", "Open an equipment record and choose Move to Case.")}</section>${row.eventId ? `<a class="button section-gap" href="#/events/${esc(row.eventId)}?tab=cases">Verify Event Packing →</a>` : ""}`;
    bindTable($("#related", root), (id) => go(`equipment/${id}`));
  } else if (type === "purchaseGoals" && data.can("finance.write")) {
    actions.innerHTML =
      '<button id="allocate">Allocate Funds</button><button class="primary" id="purchase">Record Purchase & Add Inventory</button>';
    $("#allocate", root).onclick = async () => {
      const value = await prompt(
        "Allocate Funds",
        "Total allocated amount (USD)",
        { value: String((row.allocated || 0) / 100), type: "number" },
      );
      if (value === null) return;
      try {
        const { cents } = await import("../../core/schema.mjs");
        await data.operate({
          op: "allocate",
          id,
          amount: cents(value),
          baseRevision: row.revision,
        });
        detail(root, type, id);
      } catch (e) {
        fail(e);
      }
    };
    $("#purchase", root).onclick = async () => {
      const prefix = await prompt(
        "Record Purchase",
        "Asset ID prefix (for example SN-LGT-004). Number suffixes will be added.",
      );
      if (!prefix) return;
      if (
        !(await confirm(
          "Record Purchase",
          `Record ${money((row.price || 0) * (row.quantity || 1))} as a paid expense and create ${row.quantity || 1} equipment records?`,
          "Record Purchase",
        ))
      )
        return;
      try {
        await data.operate({ op: "purchase", id, assetPrefix: prefix });
        toast("Purchase recorded and equipment created.");
        detail(root, type, id);
      } catch (e) {
        fail(e);
      }
    };
  }
  // Rebind after adding controls; assigning innerHTML replaces earlier event handlers.
  if (type === "equipment") {
    $("#stage", root)?.addEventListener("click", async () => {
      const stage = await chooseStage(row.stage);
      if (!stage) return;
      const location = await prompt("Update Location", "Equipment location", {
        value: row.location || "",
      });
      if (location === null) return;
      try {
        await data.operate({
          op: "equipmentStage",
          equipmentId: id,
          stage,
          location,
          baseRevision: row.revision,
        });
        detail(root, type, id);
      } catch (e) {
        fail(e);
      }
    });
    $("#case-assign", root)?.addEventListener("click", async () => {
      const caseId = await chooseRecord("cases", "Move to Case", true);
      if (caseId === undefined) return;
      try {
        await data.operate({
          op: "assignCase",
          equipmentId: id,
          caseId,
          baseRevision: row.revision,
        });
        detail(root, type, id);
      } catch (e) {
        fail(e);
      }
    });
  }
  if (type === "equipment" && data.can("finance.read")) {
    const b = document.createElement("button");
    b.textContent = "Purchase & Replacement Cost";
    actions.append(b);
    b.onclick = async () => {
      try {
        const costs = await data.list("assetFinance", {
          filters: [["equipmentId", "==", id]],
          size: 1,
        });
        if (data.can("finance.write"))
          editor("assetFinance", costs.rows[0] || null, {
            initial: { equipmentId: id, name: row.name },
            onSaved: () => toast("Equipment cost saved."),
          }).catch(fail);
        else
          modal(
            "Equipment Cost",
            `<p>Purchase: ${money(costs.rows[0]?.purchasePrice)} · Replacement: ${money(costs.rows[0]?.replacementCost)}</p>`,
          );
      } catch (e) {
        fail(e);
      }
    };
  }
  if (type === "maintenance") {
    actions.insertAdjacentHTML(
      "beforeend",
      `<a class="button" href="#/equipment/${esc(row.equipmentId)}">Open Affected Equipment</a>${row.eventId ? `<a class="button" href="#/events/${esc(row.eventId)}">Open Event</a>` : ""}`,
    );
  }
  if (
    row.qrId &&
    data.can(type === "crew" ? "crew.write" : "equipment.write")
  ) {
    const button = document.createElement("button");
    button.textContent = "Replace / Revoke QR";
    actions.append(button);
    button.onclick = async () => {
      if (
        !(await confirm(
          "Replace QR Identifier",
          "Existing stickers will stop opening this record. Print a new sticker after replacement.",
          "Replace QR",
        ))
      )
        return;
      try {
        await data.operate({ op: "qrRotate", type, id });
        detail(root, type, id);
      } catch (e) {
        fail(e);
      }
    };
  }
  if (["equipment", "cases", "crew", "maintenance"].includes(type)) {
    const { gallery } = await import("./images.js");
    await gallery($("#photo-section", root), type, row);
  }
  if (type === "crew") {
    if (data.can("crew.write")) {
      const b = document.createElement("button");
      b.textContent = "Private Contact Details";
      actions.append(b);
      b.onclick = async () => {
        const page = await data.list("crewPrivate", {
          filters: [["crewId", "==", id]],
          size: 1,
        });
        editor(
          "crewPrivate",
          page.rows[0] || { id: undefined, crewId: id, name: row.name },
          { onSaved: () => toast("Private contact details saved.") },
        ).catch(fail);
      };
    }
    const events = await data.list("events", {
      size: 100,
      ...(data.can("operations.read")
        ? { filters: [["crewIds", "array-contains", id]] }
        : {}),
    });
    const history = [];
    for (const ev of events.rows) {
      const roster = await data
        .get(`events/${ev.id}/roster/${id}`)
        .catch(() => null);
      if (roster) history.push({ ...ev, roles: roster.roles });
    }
    $("#related", root).innerHTML =
      `<section class="panel"><header class="panel-head"><h2>Event history & assignments</h2></header>${history.length ? table(history, ["name", "date", "status", "roles"]) : empty("No event assignments", "Assign this crew member from an event workspace.")}</section>`;
    bindTable($("#related", root), (id) => go(`events/${id}`));
  }
  if (type === "crew" && data.can("finance.read")) {
    const payments = await data.list("ledger", {
      filters: [["crewId", "==", id]],
      size: 100,
    });
    const totals = (await data.get(`financeTotals/crew_${id}`)) || {};
    const summary = finances(
      Object.entries(totals.byKind || {}).map(([kind, amount]) => ({
        kind,
        amount,
      })),
    );
    const panel = document.createElement("section");
    panel.className = "panel section-gap";
    panel.innerHTML = `<header class="panel-head"><h2>Crew payment records</h2><strong>${money(summary.crewDue)} outstanding</strong></header>${payments.rows.length ? table(payments.rows, ["name", "kind", "amount", "status", "date"]) : empty("No crew payments recorded", "Use the financial ledger to record obligations and partial payments.")}`;
    $("#related", root).append(panel);
    bindTable(panel, (key) => go(`ledger/${key}`));
  }
  if (type === "clients") {
    const events = await data.list("events", {
      filters: [["clientId", "==", id]],
      size: 50,
    });
    $("#related", root).innerHTML =
      `<section class="panel"><header class="panel-head"><h2>Client event history</h2></header>${events.rows.length ? table(events.rows, ["name", "date", "venue", "status"]) : empty("No client events", "Choose this client when creating an event.")}</section>`;
    bindTable($("#related", root), (id) => go(`events/${id}`));
  }
  if (data.can("audit.read")) {
    const log = await data.list("activityLogs", {
      filters: [["targets", "array-contains", `${type}/${id}`]],
      size: 15,
    });
    $("#history", root).innerHTML =
      `<section class="panel"><header class="panel-head"><h2>Record activity</h2></header><div class="panel-body">${log.rows.length ? log.rows.map((r) => `<div class="activity-item"><i class="activity-dot"></i><div><p>${esc(r.userName)} · ${esc(r.action)}${r.reason ? ` · ${esc(r.reason)}` : ""}</p><small>${esc(date(r.createdAt))}</small></div></div>`).join("") : empty("No activity history", "Future changes will be recorded here.")}</div></section>`;
  }
}
export async function chooseStage(current = "Available") {
  return new Promise((resolve) => {
    const m = modal(
      "Equipment Deployment",
      `<label>Deployment stage<select>${stages.map((s) => `<option ${current === s ? "selected" : ""}>${s}</option>`).join("")}</select></label><p class="form-hint">Condition and location are tracked separately.</p><div class="form-actions"><button class="primary">Continue</button></div>`,
      { onClose: () => resolve(null) },
    );
    $("button.primary", m.el).onclick = () => {
      resolve($("select", m.el).value);
      m.close();
    };
  });
}
export async function chooseRecord(type, title, allowNone = false) {
  return new Promise(async (resolve) => {
    const m = modal(
      title,
      `<input type="search" placeholder="Find by name prefix…" aria-label="Search"><div class="section-gap" data-results></div>`,
      { onClose: () => resolve(undefined) },
    );
    const show = async () => {
      try {
        const page = await data.list(type, {
          size: 30,
          search: $("input", m.el).value,
        });
        $("[data-results]", m.el).innerHTML =
          `${allowNone ? '<button data-choice="" class="section-gap">No Case / Remove Assignment</button>' : ""}${page.rows.map((r) => `<button data-choice="${esc(r.id)}" style="display:flex;width:100%;justify-content:space-between;margin-top:6px"><span>${esc(r.name)}</span><small>${esc(r.assetId || "")}</small></button>`).join("")}${page.hasMore ? '<p class="form-hint">More results available. Narrow the prefix.</p>' : ""}`;
        $$("[data-choice]", m.el).forEach(
          (b) =>
            (b.onclick = () => {
              resolve(b.dataset.choice || null);
              m.close();
            }),
        );
      } catch (e) {
        fail(e);
      }
    };
    $("input", m.el).oninput = debounce(show);
    await show();
  });
}
