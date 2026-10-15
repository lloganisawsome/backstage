import * as data from "../services/data.js";
import { $, esc, icon, empty, date, badge, fail } from "../utils/dom.js";
import { money, finances } from "../../core/schema.mjs";
import { go } from "../router.js";
export async function render(root) {
  const today = new Date().toLocaleDateString("en-CA");
  const [events, equipment, deployed, attention, issues] = await Promise.all([
    data.list("events", { size: 8 }),
    data.count("equipment"),
    data.count("equipment", [
      [
        "stage",
        "in",
        [
          "Loaded",
          "In transit",
          "Unloaded",
          "Installed",
          "Rigged",
          "In use",
          "Struck",
        ],
      ],
    ]),
    data.count("equipment", [
      [
        "condition",
        "in",
        ["Needs inspection", "Damaged", "Under repair", "Missing", "Unsafe"],
      ],
    ]),
    data.list("maintenance", { size: 4 }),
  ]);
  const activeCount = await data.count("events", [
    [
      "status",
      "in",
      [
        "Preparing",
        "Loading",
        "In transit",
        "Setting up",
        "Ready",
        "Live",
        "Striking",
        "Loading out",
      ],
    ],
  ]);
  const activeEvents = events.rows.filter(
    (e) => !["Archived", "Canceled", "Completed"].includes(e.status),
  );
  root.innerHTML = `<div class="page-head"><div><div class="overline" style="margin-bottom:10px">Operations</div><h1>Overview</h1><p>${esc(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</p></div><div class="head-actions"><a class="button" href="#/scan">${icon("scan")} Scan Code</a>${data.can("events.write") ? '<button class="primary" id="new-event">＋ New Event</button>' : ""}</div></div><div class="stats">${stat("Active events", activeCount, "In preparation, on site, or striking", "events")}${stat("Equipment deployed", deployed, `${equipment} assets in inventory`, "equipment")}${stat("Needs attention", attention, "Inspection, damage, repair, or missing", "maintenance")}${stat(
    "Upcoming events",
    await data.count("events", [
      ["date", ">=", today],
      ["status", "in", ["Draft", "Planning", "Confirmed"]],
    ]),
    "Draft, planning, and confirmed",
    "events",
  )}</div><div class="dashboard-grid"><div class="stack"><section class="panel"><header class="panel-head"><h2>Events in progress & planning</h2><a href="#/events">View all →</a></header><div id="event-list">${
    activeEvents.length
      ? activeEvents
          .slice(0, 6)
          .map((e) => eventRow(e))
          .join("")
      : empty(
          "No active events",
          "Create an event to plan equipment, crew, and load-in.",
          '<a class="button button-small" href="#/events">Open Events</a>',
        )
  }</div></section><section class="panel"><header class="panel-head"><h2>Outstanding crew tasks</h2><span class="muted" style="font-size:10px">Live event checklists</span></header><div id="tasks-summary"><div class="loading">Checking active events…</div></div></section><section class="panel"><header class="panel-head"><h2>Recent activity</h2>${data.can("audit.read") ? '<a href="#/settings?tab=activity">Activity Log →</a>' : ""}</header><div class="panel-body" id="activity-summary"></div></section></div><div class="stack"><section class="panel"><header class="panel-head"><h2>Quick actions</h2></header><div class="panel-body quick-actions"><a href="#/equipment?new=1">${icon("equipment")} Add Equipment</a><a href="#/maintenance?new=1">${icon("maintenance")} Report Issue</a><a href="#/events">${icon("crew")} Assign Crew</a><a href="#/labels">${icon("labels")} Print Labels</a></div></section><section class="panel"><header class="panel-head"><h2>Equipment attention</h2><a href="#/maintenance">View issues →</a></header>${issues.rows.length ? issues.rows.map((r) => `<a class="list-row" href="#/maintenance/${esc(r.id)}"><span class="grow"><strong>${esc(r.name)}</strong><small>${esc(r.status)}</small></span>${badge(r.severity)}</a>`).join("") : empty("No reported issues", "Report damage or schedule an inspection when equipment needs attention.")}</section><div id="finance-summary"></div></div></div>`;
  $("#new-event", root)?.addEventListener("click", async () => {
    const { editor } = await import("../components/editor.js");
    editor("events", null, { onSaved: (id) => go(`events/${id}`) });
  });
  const disposers = [];
  const taskRows = new Map();
  const paintTasks = () => {
    const tasks = [...taskRows]
      .flatMap(([eventId, rows]) =>
        rows
          .filter(
            (t) =>
              t.status !== "Complete" &&
              (data.can("events.write") ||
                !t.assigneeId ||
                t.assigneeId === data.session().user.crewId),
          )
          .map((t) => ({ ...t, eventId })),
      )
      .slice(0, 8);
    $("#tasks-summary", root).innerHTML = tasks.length
      ? tasks
          .map(
            (t) =>
              `<a class="list-row" href="#/events/${t.eventId}?tab=tasks"><span class="grow"><strong>${esc(t.name)}</strong><small>${esc(activeEvents.find((e) => e.id === t.eventId)?.name)} · ${esc(t.phase || "Preparation")}</small></span>${badge(t.priority || "Normal")}</a>`,
          )
          .join("")
      : empty(
          "No outstanding tasks",
          "Assigned event tasks will appear here as work is added.",
        );
  };
  for (const e of activeEvents.slice(0, 6))
    disposers.push(
      data.watch(
        `events/${e.id}/tasks`,
        (rows) => {
          taskRows.set(e.id, rows);
          paintTasks();
        },
        fail,
      ),
    );
  if (!activeEvents.length) paintTasks();
  if (data.can("audit.read")) {
    const logs = await data.list("activityLogs", { size: 6 });
    $("#activity-summary", root).innerHTML = logs.rows.length
      ? logs.rows
          .map(
            (r) =>
              `<div class="activity-item"><i class="activity-dot"></i><div><p><strong>${esc(r.userName)}</strong> · ${esc(r.action.replace(/([A-Z])/g, " $1").toLowerCase())}</p><small>${esc(date(r.createdAt))}</small></div></div>`,
          )
          .join("")
      : empty(
          "No operational activity",
          "New records and important changes will appear here.",
        );
  } else
    $("#activity-summary", root).innerHTML = empty(
      "Open an assigned event",
      "Your authorized event checklists show the latest operational state.",
    );
  if (data.can("finance.read")) {
    const totals = (await data.get("financeTotals/global")) || {};
    const summary = finances(
        Object.entries(totals.byKind || {}).map(([kind, amount]) => ({
          kind,
          amount,
        })),
      ),
      goals = await data.list("purchaseGoals", { size: 4 });
    $("#finance-summary", root).innerHTML =
      `<section class="panel"><header class="panel-head"><h2>Funds & purchase goals</h2><a href="#/purchaseGoals">View all →</a></header><div class="panel-body"><div class="progress-label"><span>Crew balance outstanding</span><strong>${money(summary.crewDue)}</strong></div><div class="progress-label section-gap"><span>Recorded cash available</span><strong>${money(summary.cash)}</strong></div><p class="form-hint">Received funds less paid expenses. Unpaid invoices excluded.</p></div>${goals.rows.length ? goals.rows.map((g) => `<a class="list-row" href="#/purchaseGoals/${g.id}"><span class="grow"><strong>${esc(g.name)}</strong><div class="progress-label" style="margin-top:9px"><span>${money(g.allocated)} allocated</span><span>${money((g.price || 0) * (g.quantity || 1))}</span></div><div class="progress-track"><div class="progress-bar" style="width:${Math.min(100, (100 * (g.allocated || 0)) / Math.max(1, (g.price || 0) * (g.quantity || 1)))}%"></div></div></span></a>`).join("") : empty("No purchase goals", "Create a goal and allocate available funds.")}</section>`;
  }
  return () => disposers.forEach((off) => off());
}
function stat(label, value, note, ico) {
  return `<div class="stat"><div class="stat-label"><span>${label}</span>${icon(ico)}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`;
}
function eventRow(e) {
  const d = e.date ? new Date(e.date + "T12:00:00") : null;
  return `<a class="list-row" href="#/events/${esc(e.id)}"><span class="date-block"><small>${d ? d.toLocaleDateString(undefined, { month: "short" }) : "—"}</small><strong>${d ? d.getDate() : "—"}</strong></span><span class="grow"><strong>${esc(e.name)}</strong><small>${esc(e.venue || "Venue not set")}${e.crewCall ? ` · Crew call ${esc(e.crewCall)}` : ""}</small></span>${badge(e.status)}</a>`;
}
