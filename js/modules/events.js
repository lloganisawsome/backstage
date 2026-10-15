import * as data from "../services/data.js";
import { schemas, money, finances } from "../../core/schema.mjs";
import {
  $,
  $$,
  esc,
  badge,
  empty,
  date,
  toast,
  fail,
  busy,
  download,
  csv,
} from "../utils/dom.js";
import { editor } from "../components/editor.js";
import { modal, prompt, confirm } from "../components/modal.js";
import { table, bindTable } from "../components/table.js";
import { chooseRecord, chooseStage } from "./records.js";
import { go } from "../router.js";
const phases = [
  "Preparation",
  "Loading",
  "Arrival",
  "Setup",
  "Strike",
  "Load-out",
  "Return",
];
export async function render(root, { section, id, params }) {
  if (!id) {
    const records = await import("./records.js");
    return records.render(root, { section: "events", params });
  }
  const event = await data.get(`events/${id}`);
  if (!event) throw Error("This event is unavailable.");
  const manage =
    data.can("events.write") &&
    (data.can("operations.read") ||
      event.managerUid === data.session().user.id);
  const archived = event.status === "Archived";
  const tabs = [
    "Overview",
    "Tasks",
    "Equipment",
    "Cases",
    "Crew",
    "Rig",
    "Setlists",
    "Run of Show",
    ...(data.can("finance.read") ? ["Finances"] : []),
    ...(data.can("audit.read") ? ["Activity"] : []),
  ];
  const tab = params.get("tab") || "overview";
  root.innerHTML = `<div class="page-head"><div><a class="overline" href="#/events">← Events</a><h1 style="margin-top:11px">${esc(event.name)}</h1><p>${esc(event.date)} · ${esc(event.venue || "Venue not set")} ${badge(event.status)}</p></div><div class="head-actions">${manage && !archived ? '<button id="duplicate">Duplicate Event</button><button class="primary" id="edit-event">Edit Event</button>' : ""}${archived ? '<button id="archive-view">Open Archive Snapshot</button>' : ""}</div></div>${archived ? '<div class="notice">This event is archived. Its saved snapshot preserves the event record at archive time.</div>' : ""}<div class="tabs" role="tablist">${tabs
    .map((label) => {
      const key = label === "Run of Show" ? "rundown" : label.toLowerCase();
      return `<button role="tab" aria-selected="${key === tab}" class="${key === tab ? "active" : ""}" data-tab="${key}">${label}</button>`;
    })
    .join("")}</div><div id="event-content"></div>`;
  $$("[data-tab]", root).forEach(
    (button) =>
      (button.onclick = () => go(`events/${id}?tab=${button.dataset.tab}`)),
  );
  $("#edit-event", root)?.addEventListener("click", () =>
    editor("events", event, {
      onSaved: () => go(`events/${id}?tab=${tab}`),
    }).catch(fail),
  );
  $("#duplicate", root)?.addEventListener("click", async () => {
    const name = await prompt("Duplicate Event", "New event name", {
      value: `${event.name} — copy`,
    });
    if (!name) return;
    try {
      const result = await data.operate({
        op: "duplicateEvent",
        eventId: id,
        name,
      });
      go(`events/${result.id}`);
    } catch (e) {
      fail(e);
    }
  });
  $("#archive-view", root)?.addEventListener("click", () =>
    go(`archives/${id}`),
  );
  const content = $("#event-content", root);
  const context = { id, event, manage: manage && !archived, archived };
  const renderers = {
    overview,
    tasks,
    equipment,
    cases,
    crew,
    rig,
    setlists: async (c, x) => {
      const m = await import("./show.js");
      return m.setlists(c, x);
    },
    rundown: async (c, x) => {
      const m = await import("./show.js");
      return m.rundown(c, x);
    },
    finances: finance,
    activity,
  };
  if (!renderers[tab]) throw Error("Unknown event tab.");
  return renderers[tab](content, context);
}
async function overview(root, { id, event, manage }) {
  const [tasks, assets, cases, roster] = await Promise.all(
    ["tasks", "assignments", "caseAssignments", "roster"].map((p) =>
      data.list(`events/${id}/${p}`, { size: 200 }),
    ),
  );
  const done = tasks.rows.filter((t) => t.status === "Complete").length;
  root.innerHTML = `<div class="stats">${[
    ["Preparation tasks", `${done} / ${tasks.rows.length}`],
    ["Assigned equipment", assets.rows.length],
    ["Road cases", cases.rows.length],
    ["Crew assigned", roster.rows.length],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`,
    )
    .join("")}</div><div class="event-phase">${phases
    .map((phase) => {
      const list = tasks.rows.filter((t) => t.phase === phase),
        complete = list.filter((t) => t.status === "Complete").length;
      return `<div><strong>${phase}</strong><div class="progress-track"><div class="progress-bar" style="width:${list.length ? (100 * complete) / list.length : 0}%"></div></div><small>${complete} / ${list.length} tasks</small></div>`;
    })
    .join(
      "",
    )}</div><div class="split"><section class="panel"><header class="panel-head"><h2>Event details</h2></header><div class="panel-body"><dl class="detail-grid">${schemas.events.fields
    .filter((f) => event[f.key])
    .map(
      (f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(event[f.key])}</dd></div>`,
    )
    .join(
      "",
    )}</dl></div></section><div class="stack"><section class="panel"><header class="panel-head"><h2>Schedule</h2><a href="#/events/${id}?tab=rundown">Run of Show →</a></header><div class="panel-body">${[
    ["crewCall", "Crew call"],
    ["loadIn", "Load-in"],
    ["setupDeadline", "Setup deadline"],
    ["soundcheck", "Soundcheck"],
    ["startTime", "Show start"],
    ["endTime", "Show end"],
    ["strike", "Strike"],
    ["loadOut", "Load-out deadline"],
  ]
    .map(
      ([key, label]) =>
        `<div class="progress-label" style="margin-bottom:15px"><span>${label}</span><strong>${esc(event[key] || "Not set")}</strong></div>`,
    )
    .join(
      "",
    )}</div></section>${manage ? '<section class="panel"><header class="panel-head"><h2>Reusable plans & archive</h2></header><div class="panel-body"><div class="head-actions"><button id="save-template">Save Event Template</button><button id="apply-template">Apply Template</button><button id="client-preferences">Use Client Equipment</button><button id="archive">Archive Completed Event</button></div><p class="form-hint">Archiving requires a completed event and all assigned equipment returned.</p></div></section>' : ""}</div></div>`;
  const docs = await data.list(`events/${id}/documents`, { size: 50 });
  const docsPanel = document.createElement("section");
  docsPanel.className = "panel section-gap";
  docsPanel.innerHTML = `<header class="panel-head"><h2>Documents & references</h2>${manage ? '<button class="button-small" data-add-document>＋ Add Link</button>' : ""}</header><div class="panel-body">${docs.rows.length ? docs.rows.map((d) => `<a class="button" style="margin:4px" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.name)} ↗</a>`).join("") : empty("No linked documents", "Add venue plans, client documents, or production references using HTTPS links.")}</div>`;
  root.append(docsPanel);
  $("[data-add-document]", docsPanel)?.addEventListener("click", () =>
    editor("documents", null, {
      eventId: id,
      onSaved: () => go(`events/${id}`),
    }).catch(fail),
  );
  const photos = document.createElement("div");
  photos.className = "section-gap";
  root.append(photos);
  const { gallery } = await import("./images.js");
  await gallery(photos, "events", event, { quick: true });
  $("#archive", root)?.addEventListener("click", async () => {
    if (
      !(await confirm(
        "Archive Event",
        "Save a historical snapshot of equipment, cases, crew, tasks, rig, setlists, run of show, and finances?",
        "Archive Event",
      ))
    )
      return;
    try {
      await data.operate({ op: "archive", eventId: id });
      go(`archives/${id}`);
    } catch (e) {
      fail(e);
    }
  });
  $("#client-preferences", root)?.addEventListener("click", async () => {
    if (!event.clientId)
      return toast("Select a client on the event first.", true);
    try {
      const client = await data.get(`clients/${event.clientId}`);
      if (!client?.preferredEquipment?.length)
        return toast("This client has no preferred equipment list.", true);
      await data.operate({
        op: "assignEvent",
        eventId: id,
        equipmentIds: client.preferredEquipment,
      });
      toast("Client equipment reserved.");
      go(`events/${id}?tab=equipment`);
    } catch (e) {
      fail(e);
    }
  });
  $("#save-template", root)?.addEventListener("click", async () => {
    const name = await prompt("Save Event Template", "Template name");
    if (!name) return;
    try {
      await data.operate({ op: "eventTemplate", eventId: id, name });
      toast("Event template saved.");
    } catch (e) {
      fail(e);
    }
  });
  $("#apply-template", root)?.addEventListener("click", async () => {
    const template = await chooseRecord(
      "templates",
      "Choose an event template",
    );
    if (!template) return;
    try {
      await data.operate({
        op: "applyTemplate",
        eventId: id,
        templateId: template,
      });
      toast("Template tasks and show plans added.");
      go(`events/${id}`);
    } catch (e) {
      fail(e);
    }
  });
}
export function keyed(root, rows, render) {
  const existing = new Map(
    [...root.children].map((el) => [el.dataset.key, el]),
  );
  for (const row of rows) {
    const serialized = JSON.stringify(row);
    let el = existing.get(row.id);
    if (!el || el.dataset.revision !== serialized) {
      const holder = document.createElement("div");
      holder.innerHTML = render(row);
      const next = holder.firstElementChild;
      next.dataset.key = row.id;
      next.dataset.revision = serialized;
      if (el) el.replaceWith(next);
      el = next;
    }
    root.append(el);
    existing.delete(row.id);
  }
  for (const el of existing.values()) el.remove();
}
async function tasks(root, { id, manage, archived }) {
  root.innerHTML = `<div class="toolbar"><div class="toolbar-left"><select id="task-phase" aria-label="Filter phase"><option value="">All phases</option>${phases.map((s) => `<option>${s}</option>`).join("")}</select><select id="task-state" aria-label="Filter tasks"><option value="">All tasks</option><option>Open</option><option>Complete</option></select></div><div class="head-actions">${manage ? '<button id="bulk-complete">Complete Selected</button><button class="primary" id="new-task">＋ New Task</button>' : ""}</div></div><div class="panel" id="task-list"></div><p class="form-hint">Task IDs are available under Details for dependencies. Concurrent updates are checked on the server.</p>`;
  let rows = [];
  const paint = () => {
    const filtered = rows
      .filter(
        (t) =>
          (!$("#task-phase", root).value ||
            t.phase === $("#task-phase", root).value) &&
          (!$("#task-state", root).value ||
            t.status === $("#task-state", root).value),
      )
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const list = $("#task-list", root);
    if (!filtered.length) {
      list.innerHTML = empty(
        "No tasks in this view",
        "Create tasks for preparation, load-in, setup, strike, and return.",
      );
      return;
    }
    list.querySelector(".empty")?.remove();
    keyed(
      list,
      filtered,
      (t) =>
        `<div class="list-row" data-task="${t.id}">${manage ? `<input type="checkbox" data-bulk="${t.id}" aria-label="Select ${esc(t.name)}">` : ""}<input type="checkbox" data-complete="${t.id}" ${t.status === "Complete" ? "checked" : ""} ${archived ? "disabled" : ""} aria-label="Complete ${esc(t.name)}"><div class="grow"><strong>${esc(t.name)}</strong><small>${esc(t.phase || "Preparation")} · ${esc(t.assigneeId || "Unassigned")}${t.due ? ` · Due ${esc(t.due)}` : ""}</small>${t.completedBy ? `<small style="display:block">Completed by ${esc(t.completedBy)} · ${esc(date(t.completedAt))}</small>` : ""}</div>${badge(t.priority || "Normal")}<button class="button-small" data-task-detail="${t.id}">Details</button>${manage ? `<button class="icon-button" data-up="${t.id}" aria-label="Move task up">↑</button>` : ""}</div>`,
    );
  };
  $("#task-phase", root).onchange = paint;
  $("#task-state", root).onchange = paint;
  $("#new-task", root)?.addEventListener("click", () =>
    editor("tasks", null, { eventId: id }).catch(fail),
  );
  root.addEventListener("change", async (e) => {
    const key = e.target.dataset.complete;
    if (!key) return;
    const row = rows.find((r) => r.id === key),
      complete = e.target.checked;
    e.target.disabled = true;
    try {
      await data.operate({
        op: "taskComplete",
        eventId: id,
        id: key,
        complete,
        baseRevision: row.revision,
      });
    } catch (error) {
      e.target.checked = !complete;
      fail(error);
    } finally {
      e.target.disabled = false;
    }
  });
  root.addEventListener("click", async (e) => {
    const detail = e.target.closest("[data-task-detail]"),
      up = e.target.closest("[data-up]");
    if (detail) {
      const row = rows.find((r) => r.id === detail.dataset.taskDetail);
      const m = modal(
        row.name,
        `<dl class="detail-grid">${Object.entries(row)
          .filter(([k]) => !["nameKey"].includes(k))
          .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
          .join(
            "",
          )}</dl><div class="head-actions">${manage ? '<button class="primary" data-edit>Edit Task</button><button data-override>Complete with Override</button>' : ""}</div>`,
      );
      $("[data-edit]", m.el)?.addEventListener("click", () => {
        m.close();
        editor("tasks", row, { eventId: id }).catch(fail);
      });
      $("[data-override]", m.el)?.addEventListener("click", async () => {
        const reason = await prompt(
          "Dependency Override",
          "Reason for overriding incomplete dependencies",
        );
        if (!reason) return;
        try {
          await data.operate({
            op: "taskComplete",
            eventId: id,
            id: row.id,
            complete: true,
            baseRevision: row.revision,
            reason,
          });
          m.close();
        } catch (e) {
          fail(e);
        }
      });
    }
    if (up) {
      const ordered = [...rows].sort((a, b) => (a.order || 0) - (b.order || 0));
      const index = ordered.findIndex((r) => r.id === up.dataset.up);
      if (index < 1) return;
      [ordered[index - 1], ordered[index]] = [
        ordered[index],
        ordered[index - 1],
      ];
      try {
        await data.operate({
          op: "reorder",
          eventId: id,
          type: "tasks",
          ids: ordered.map((r) => r.id),
          revisions: Object.fromEntries(ordered.map((r) => [r.id, r.revision])),
        });
      } catch (e) {
        fail(e);
      }
    }
  });
  $("#bulk-complete", root)?.addEventListener("click", async (e) =>
    busy(e.currentTarget, async () => {
      let completed = 0;
      for (const checkbox of $$("[data-bulk]:checked", root)) {
        const row = rows.find((r) => r.id === checkbox.dataset.bulk);
        await data.operate({
          op: "taskComplete",
          eventId: id,
          id: row.id,
          complete: true,
          baseRevision: row.revision,
        });
        completed++;
      }
      toast(`${completed} tasks completed.`);
    }),
  );
  return data.watch(
    `events/${id}/tasks`,
    (r) => {
      rows = r;
      paint();
    },
    fail,
  );
}
async function equipment(root, { id, manage }) {
  root.innerHTML = `<div class="toolbar"><p class="muted">The event manifest preserves equipment identity and deployment history.</p><div class="head-actions"><button id="packing-list">Print Packing List / PDF</button>${manage ? '<button id="reserve-case">Reserve Case</button><button class="primary" id="reserve-asset">＋ Reserve Equipment</button>' : ""}</div></div><div id="assignment-list"></div>`;
  let rows = [];
  const reserve = async (type) => {
    const key = await chooseRecord(
      type,
      type === "cases"
        ? "Reserve a road case and its contents"
        : "Reserve equipment",
    );
    if (!key) return;
    try {
      await data.operate({
        op: "assignEvent",
        eventId: id,
        ...(type === "cases" ? { caseIds: [key] } : { equipmentIds: [key] }),
      });
      toast("Reserved for this event.");
    } catch (e) {
      if (/override/.test(e.message) && data.can("dependencies.override")) {
        const reason = await prompt(
          "Equipment Override",
          "Reason for reserving unavailable equipment",
        );
        if (reason)
          try {
            await data.operate({
              op: "assignEvent",
              eventId: id,
              reason,
              ...(type === "cases"
                ? { caseIds: [key] }
                : { equipmentIds: [key] }),
            });
          } catch (error) {
            fail(error);
          }
      } else fail(e);
    }
  };
  $("#reserve-asset", root)?.addEventListener("click", () =>
    reserve("equipment"),
  );
  $("#reserve-case", root)?.addEventListener("click", () => reserve("cases"));
  $("#packing-list", root).onclick = async () => {
    const { printSheet } = await import("./show.js");
    printSheet(
      "Event Packing List",
      table(rows, ["assetId", "name", "caseId", "stage", "condition"]),
    );
  };
  return data.watch(
    `events/${id}/assignments`,
    (items) => {
      rows = items;
      $("#assignment-list", root).innerHTML = rows.length
        ? table(rows, ["assetId", "name", "caseId", "stage", "condition"])
        : empty(
            "No reserved equipment",
            "Reserve individual assets or a road case with its standard contents.",
          );
      bindTable($("#assignment-list", root), async (key) => {
        const row = rows.find((r) => r.id === key),
          live = await data.get(`equipment/${key}`);
        const m = modal(
          row.name,
          `<p class="mono">${esc(row.assetId)}</p><p class="section-gap">Deployment: ${esc(live?.stage || row.stage)} · Condition: ${esc(live?.condition || row.condition)}</p><div class="form-actions"><a class="button" href="#/equipment/${key}">Asset Record</a><button data-stage>Update Stage</button>${manage ? "<button data-release>Remove Reservation</button>" : ""}</div>`,
        );
        $("[data-stage]", m.el).onclick = async () => {
          const stage = await chooseStage(live?.stage);
          if (!stage) return;
          const location = await prompt("Equipment Location", "New location", {
            value: live?.location || "",
          });
          if (location === null) return;
          try {
            await data.operate({
              op: "equipmentStage",
              equipmentId: key,
              stage,
              location,
              baseRevision: live?.revision,
            });
            m.close();
          } catch (e) {
            fail(e);
          }
        };
        $("[data-release]", m.el)?.addEventListener("click", async () => {
          try {
            await data.operate({
              op: "releaseEquipment",
              eventId: id,
              equipmentId: key,
            });
            m.close();
          } catch (e) {
            fail(e);
          }
        });
      });
    },
    fail,
  );
}
async function cases(root, { id, event, manage, archived }) {
  root.innerHTML =
    '<div class="notice">Event packing checks are separate from permanent case contents. Every expected item must be verified before packing, loading, or return.</div><div id="event-case-list" class="stack"></div>';
  let cases = [],
    assignments = [];
  const paint = () => {
    const list = $("#event-case-list", root);
    if (!cases.length) {
      list.innerHTML = empty(
        "No reserved road cases",
        "Reserve a case from the Equipment tab. Its standard contents will join the event manifest.",
      );
      return;
    }
    list.innerHTML = cases
      .map((c) => {
        const items = assignments.filter((a) => a.caseId === c.id);
        return `<section class="panel" data-case="${c.id}"><header class="panel-head"><h2>${esc(c.assetId)} · ${esc(c.name)}</h2>${badge(c.stage)}</header><div class="panel-body">${items.length ? items.map((item) => `<label class="check" style="margin-bottom:14px"><input data-case-item="${item.id}" type="checkbox" ${(c.verifiedIds || []).includes(item.id) ? "checked" : ""} ${archived ? "disabled" : ""}><span><span class="mono">${esc(item.assetId)}</span> · ${esc(item.name)}</span>${badge(item.stage)}</label>`).join("") : empty("No expected contents", "Equipment can be reserved loose or moved into this case before the event.")}<label class="section-gap">Case location<input data-case-location value="${esc(c.location || "")}" ${archived ? "readonly" : ""}></label><div class="head-actions section-gap">${!archived ? ["Checking", "Packed", "Loaded", "Unloaded", "Returned"].map((stage) => `<button data-case-stage="${stage}">${stage === "Checking" ? "Save Checks" : `Mark ${stage}`}</button>`).join("") : ""}<button data-photo>Verification Photo</button>${manage ? "<button data-add-item>Add Event-only Item</button><button data-case-up>Move Earlier</button>" : ""}</div><p class="form-hint">Unchecked: ${items.filter((i) => !(c.verifiedIds || []).includes(i.id)).length} · ${esc(c.verifiedBy || "Not yet verified")}</p></div></section>`;
      })
      .join("");
    $$("[data-case-stage]", list).forEach(
      (b) =>
        (b.onclick = () =>
          busy(b, async () => {
            const box = b.closest("[data-case]"),
              c = cases.find((r) => r.id === box.dataset.case);
            const verifiedIds = $$("[data-case-item]:checked", box).map(
              (x) => x.dataset.caseItem,
            );
            await data.operate({
              op: "caseVerify",
              eventId: id,
              caseId: c.id,
              verifiedIds,
              stage: b.dataset.caseStage,
              location: $("[data-case-location]", box).value,
              baseRevision: c.revision,
            });
            toast("Case verification saved.");
          })),
    );
    $$("[data-photo]", list).forEach(
      (b) =>
        (b.onclick = async () => {
          const c = cases.find(
            (r) => r.id === b.closest("[data-case]").dataset.case,
          );
          const m = modal(
            "Packed-case Verification",
            "<div data-gallery></div>",
            { wide: true },
          );
          const { gallery } = await import("./images.js");
          gallery(
            $("[data-gallery]", m.el),
            "cases",
            { ...c, eventId: id },
            { quick: true },
          ).catch(fail);
        }),
    );
    $$("[data-case-up]", list).forEach(
      (b) =>
        (b.onclick = async () => {
          const key = b.closest("[data-case]").dataset.case,
            ordered = [...cases].sort(
              (a, b) => (a.order || 0) - (b.order || 0),
            ),
            index = ordered.findIndex((r) => r.id === key);
          if (index < 1) return;
          [ordered[index - 1], ordered[index]] = [
            ordered[index],
            ordered[index - 1],
          ];
          try {
            await data.operate({
              op: "reorder",
              eventId: id,
              type: "caseAssignments",
              ids: ordered.map((r) => r.id),
              revisions: Object.fromEntries(
                ordered.map((r) => [r.id, r.revision]),
              ),
            });
          } catch (e) {
            fail(e);
          }
        }),
    );
    $$("[data-add-item]", list).forEach(
      (b) =>
        (b.onclick = async () => {
          const key = await chooseRecord(
            "equipment",
            "Add equipment to this event case",
          );
          if (!key) return;
          try {
            await data.operate({
              op: "eventCaseItem",
              eventId: id,
              caseId: b.closest("[data-case]").dataset.case,
              equipmentId: key,
            });
            toast("Event-only packing item added.");
          } catch (e) {
            fail(e);
          }
        }),
    );
  };
  const off1 = data.watch(
      `events/${id}/caseAssignments`,
      (rows) => {
        cases = rows.sort((a, b) => (a.order || 0) - (b.order || 0));
        paint();
      },
      fail,
    ),
    off2 = data.watch(
      `events/${id}/assignments`,
      (rows) => {
        assignments = rows;
        paint();
      },
      fail,
    );
  return () => {
    off1();
    off2();
  };
}
async function crew(root, { id, manage }) {
  root.innerHTML = `<div class="toolbar"><p class="muted">Production roles are separate from application permissions.</p>${manage ? '<div class="head-actions"><button id="set-manager">Set Event Manager</button><button class="primary" id="assign-crew">＋ Assign Crew</button></div>' : ""}</div><div id="roster"></div>`;
  $("#set-manager", root)?.addEventListener("click", async () => {
    const crewId = await chooseRecord("crew", "Choose event manager");
    if (!crewId) return;
    try {
      await data.operate({ op: "eventManager", eventId: id, crewId });
      toast("Event manager updated.");
      go(`events/${id}?tab=crew`);
    } catch (e) {
      fail(e);
    }
  });
  $("#assign-crew", root)?.addEventListener("click", async () => {
    const key = await chooseRecord("crew", "Assign crew");
    if (!key) return;
    const roles = await prompt(
      "Production Roles",
      "Roles for this event (comma separated)",
    );
    if (roles === null) return;
    try {
      await data.operate({ op: "crewAssign", eventId: id, crewId: key, roles });
    } catch (e) {
      fail(e);
    }
  });
  return data.watch(
    `events/${id}/roster`,
    (rows) => {
      $("#roster", root).innerHTML = rows.length
        ? `<section class="panel">${rows
            .map(
              (r) =>
                `<div class="list-row"><div class="avatar">${esc(
                  r.name
                    ?.split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join(""),
                )}</div><div class="grow"><strong>${esc(r.name)}</strong><small>${esc(r.roles)} · ${r.uid ? "Linked account" : "No active linked account"}</small></div>${manage ? `<button class="button-small" data-remove="${r.id}">Remove</button>` : ""}</div>`,
            )
            .join("")}</section>`
        : empty(
            "No assigned crew",
            "Assign crew profiles. Linked active accounts gain event access.",
          );
      $$("[data-remove]", root).forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await data.operate({
                op: "crewAssign",
                eventId: id,
                crewId: b.dataset.remove,
                remove: true,
              });
            } catch (e) {
              fail(e);
            }
          }),
      );
    },
    fail,
  );
}
async function rig(root, { id, manage, archived }) {
  root.innerHTML = `<div class="toolbar"><div class="toolbar-left"><label>Zoom<input id="rig-zoom" type="range" min="50" max="150" value="100"></label><span class="muted" style="font-size:11px">1000 × 600 planning workspace</span></div>${manage ? '<button class="primary" id="new-position">＋ Add Position</button>' : ""}</div><div class="notice">Planning and inventory visualization only. Structural loads and rigging safety are not calculated.</div><div class="rig-view"><div class="rig-canvas"></div></div><div id="rig-table" class="section-gap"></div>`;
  const canvas = $(".rig-canvas", root);
  let rows = [],
    zoom = 1;
  $("#rig-zoom", root).oninput = (e) => {
    zoom = Number(e.target.value) / 100;
    canvas.style.transform = `scale(${zoom})`;
  };
  $("#new-position", root)?.addEventListener("click", () =>
    editor("rig", null, { eventId: id }).catch(fail),
  );
  const paint = () => {
    canvas.innerHTML = rows
      .map(
        (r) =>
          `<button class="fixture ${r.state === "Installed" ? "installed" : ""}" style="left:${Math.max(20, Math.min(980, r.x || 100))}px;top:${Math.max(20, Math.min(580, r.y || 100))}px" data-fixture="${r.id}">${esc(r.name)}<br><small>${esc(r.section || "Unsectioned")}</small></button>`,
      )
      .join("");
    $("#rig-table", root).innerHTML = rows.length
      ? table(rows, ["name", "section", "equipmentId", "state"])
      : empty(
          "No rig positions",
          "Reserve fixtures under Equipment, then add positions to the rig.",
        );
    bindTable($("#rig-table", root), open);
    $$("[data-fixture]", root).forEach((button) => {
      let start = null,
        moved = false;
      button.onpointerdown = (e) => {
        if (!manage) return;
        start = {
          x: e.clientX,
          y: e.clientY,
          left: parseFloat(button.style.left),
          top: parseFloat(button.style.top),
        };
        moved = false;
        button.setPointerCapture(e.pointerId);
      };
      button.onpointermove = (e) => {
        if (!start) return;
        const dx = (e.clientX - start.x) / zoom,
          dy = (e.clientY - start.y) / zoom;
        if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
        if (moved) {
          button.style.left = `${Math.max(20, Math.min(980, start.left + dx))}px`;
          button.style.top = `${Math.max(20, Math.min(580, start.top + dy))}px`;
        }
      };
      button.onpointerup = async () => {
        if (!start) return;
        start = null;
        if (moved) {
          const r = rows.find((r) => r.id === button.dataset.fixture);
          try {
            await data.operate({
              op: "save",
              type: "rig",
              eventId: id,
              id: r.id,
              baseRevision: r.revision,
              data: {
                ...r,
                x: Math.round(parseFloat(button.style.left)),
                y: Math.round(parseFloat(button.style.top)),
              },
            });
          } catch (e) {
            fail(e);
            paint();
          }
        }
      };
      button.onclick = () => {
        if (!moved) open(button.dataset.fixture);
      };
    });
  };
  const open = (key) => {
    const row = rows.find((r) => r.id === key);
    const m = modal(
      row.name,
      `<p>${esc(row.section)} · ${esc(row.equipmentId)}</p><p class="section-gap">${esc(row.notes)}</p><div class="form-actions">${manage ? "<button data-edit>Edit Position</button>" : ""}${!archived ? '<button data-install>Mark Installed</button><button class="primary" data-strike>Mark Removed / Struck</button>' : ""}</div>`,
    );
    $("[data-edit]", m.el)?.addEventListener("click", () => {
      m.close();
      editor("rig", row, { eventId: id }).catch(fail);
    });
    for (const [selector, state] of [
      ["[data-install]", "Installed"],
      ["[data-strike]", "Struck"],
    ])
      $(selector, m.el)?.addEventListener("click", async () => {
        try {
          await data.operate({
            op: "rigState",
            eventId: id,
            id: key,
            state,
            baseRevision: row.revision,
          });
          m.close();
        } catch (e) {
          fail(e);
        }
      });
  };
  return data.watch(
    `events/${id}/rig`,
    (r) => {
      rows = r;
      paint();
    },
    fail,
  );
}
async function finance(root, { id }) {
  const page = await data.list("ledger", {
    filters: [["eventId", "==", id]],
    size: 100,
  });
  const summary = (await data.get(`financeTotals/event_${id}`)) || {},
    totals = finances(
      Object.entries(summary.byKind || {}).map(([kind, amount]) => ({
        kind,
        amount,
      })),
    );
  root.innerHTML = `<div class="stats">${[
    ["Quoted", totals.quoted],
    ["Agreed", totals.agreed],
    ["Expected revenue", totals.expected],
    ["Invoiced", totals.invoiced],
    ["Received", totals.received],
    ["Outstanding", totals.outstanding],
    ["Expected expenses", totals.expensesExpected],
    ["Paid expenses", totals.expensesPaid],
    ["Estimated profit", totals.estimated],
    ["Realized profit", totals.realized],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value" style="font-size:22px">${money(value)}</div></div>`,
    )
    .join(
      "",
    )}</div><div class="toolbar"><p class="muted">Separate entries record obligations, receipts, expenses, and partial crew payments.</p>${data.can("finance.write") ? '<button class="primary" id="new-finance">＋ Add Financial Entry</button>' : ""}</div>${page.rows.length ? table(page.rows, ["name", "kind", "amount", "status", "date"]) : empty("No financial records", "Add quoted or agreed amounts as expected revenue. Record invoices and receipts separately.")}`;
  $("#new-finance", root)?.addEventListener("click", () =>
    editor(
      "ledger",
      { eventId: id },
      { onSaved: () => go(`events/${id}?tab=finances`) },
    ).catch(fail),
  );
  bindTable(root, (key) =>
    editor(
      "ledger",
      page.rows.find((r) => r.id === key),
      { onSaved: () => go(`events/${id}?tab=finances`) },
    ).catch(fail),
  );
}
async function activity(root, { id }) {
  const page = await data.list("activityLogs", {
    filters: [["eventIds", "array-contains", id]],
    size: 50,
  });
  root.innerHTML = `<section class="panel"><header class="panel-head"><h2>Event activity</h2></header><div class="panel-body">${page.rows.length ? page.rows.map((r) => `<div class="activity-item"><i class="activity-dot"></i><div><p>${esc(r.userName)} · ${esc(r.action)}${r.reason ? ` · ${esc(r.reason)}` : ""}</p><small>${esc(date(r.createdAt))}</small></div></div>`).join("") : empty("No event activity", "Changes made through the operational service appear here.")}</div></section>`;
}
