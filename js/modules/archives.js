import * as data from "../services/data.js";
import { $, esc, empty, download, date, toast, fail } from "../utils/dom.js";
import { table, bindTable } from "../components/table.js";
import { prompt, confirm } from "../components/modal.js";
import { go } from "../router.js";
export async function render(root, { id, params }) {
  if (!id) {
    const page = await data.list("events", {
      filters: [["status", "==", "Archived"]],
      size: 50,
    });
    root.innerHTML = `<div class="page-head"><div><h1>Event archives</h1><p>Historical snapshots preserve the record of completed shows.</p></div></div>${page.rows.length ? table(page.rows, ["name", "date", "venue", "status"]) : empty("No archived events", "Complete an event, verify equipment return, then archive it from its Overview tab.")}`;
    bindTable(root, (id) => go(`archives/${id}`));
    return;
  }
  const version = params?.get("version");
  const archive = await data.get(
    version ? `archives/${id}/versions/${version}` : `archives/${id}`,
  );
  if (!archive) throw Error("Archive snapshot is unavailable.");
  const ev = archive.event;
  const preservedPhotos = await data.list(`archives/${id}/images`, {
    size: 20,
  });
  root.innerHTML = `<div class="page-head"><div><a class="overline" href="#/archives">← Event Archives</a><h1 style="margin-top:10px">${esc(ev.name)}</h1><p>${esc(ev.date)} · ${esc(ev.venue)} · Snapshot saved ${esc(date(archive.snapshotAt || archive.createdAt))}</p></div><div class="head-actions"><button id="export-archive">Export Snapshot</button>${data.can("events.write") && data.can("operations.read") ? '<button id="reopen">Reopen Event</button>' : ""}<a href="#/events/${id}" class="button">Event Workspace</a></div></div><div class="notice">Snapshot values are historical. Changes to shared equipment and crew records do not rewrite these details. Reopening preserves this snapshot until a new archive version is saved.</div><section class="panel"><header class="panel-head"><h2>Event information</h2></header><div class="panel-body"><dl class="detail-grid">${Object.entries(
    ev,
  )
    .filter(
      ([k, v]) => typeof v === "string" && !["nameKey", "qrId"].includes(k),
    )
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join("")}</dl></div></section>${[
    [
      "assignments",
      "Equipment manifest",
      ["assetId", "name", "caseId", "stage", "condition"],
    ],
    ["caseAssignments", "Road cases", ["assetId", "name", "stage"]],
    ["roster", "Crew", ["name", "roles"]],
    ["tasks", "Tasks", ["name", "phase", "status", "completedBy"]],
    ["rig", "Rig positions", ["name", "section", "equipmentId", "state"]],
    ["setlists", "Setlists", ["name"]],
    ["rundown", "Run of show", ["startTime", "name", "duration", "status"]],
    ["maintenance", "Maintenance", ["name", "severity", "status"]],
  ]
    .map(
      ([key, label, cols]) =>
        `<section class="panel section-gap"><header class="panel-head"><h2>${label}</h2><span class="muted">${(archive[key] || []).length} records</span></header>${archive[key]?.length ? table(archive[key], cols) : empty(`No ${label.toLowerCase()} recorded`, "")}</section>`,
    )
    .join("")}`;
  const versions = await data.list(`archives/${id}/versions`, { size: 30 });
  if (versions.rows.length) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Archive snapshot version");
    select.innerHTML = `<option value="">Latest snapshot</option>${versions.rows.map((v) => `<option value="${v.id}" ${version === v.id ? "selected" : ""}>${esc(date(v.snapshotAt || v.createdAt))}</option>`).join("")}`;
    select.onchange = () =>
      go(`archives/${id}${select.value ? "?version=" + select.value : ""}`);
    root.prepend(select);
  }
  const photoPanel = document.createElement("section");
  photoPanel.className = "panel section-gap";
  photoPanel.innerHTML = `<header class="panel-head"><h2>Preserved operational photos</h2></header><div class="panel-body photo-grid">${preservedPhotos.rows.map((img) => `<div class="photo"><img src="${esc(img.dataUrl)}" alt="Archived operational photo"><p>${esc(img.filename)}</p></div>`).join("") || empty("No operational photos saved", "")}</div>`;
  root.append(photoPanel);
  $("#export-archive", root).onclick = async () => {
    const content = {
      ...archive,
      photos: await data.queryAll(`archives/${id}/images`),
    };
    if (data.can("finance.read"))
      content.finances = await data.get(`archiveFinance/${id}`);
    download(`archive-${id}.json`, JSON.stringify(content, null, 2));
  };
  $("#reopen", root)?.addEventListener("click", async () => {
    const reason = await prompt(
      "Reopen Archived Event",
      "Reason for reopening",
    );
    if (!reason) return;
    try {
      await data.operate({ op: "reopen", eventId: id, reason });
      go(`events/${id}`);
    } catch (e) {
      fail(e);
    }
  });
}
