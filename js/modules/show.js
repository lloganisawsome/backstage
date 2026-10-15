import * as data from "../services/data.js";
import {
  $,
  $$,
  esc,
  empty,
  badge,
  date,
  toast,
  fail,
  busy,
  download,
  csv,
  parseCSV,
} from "../utils/dom.js";
import { editor } from "../components/editor.js";
import { modal, prompt } from "../components/modal.js";
import { chooseRecord } from "./records.js";
import { keyed } from "./events.js";
export function printSheet(title, html) {
  document.querySelector(".print-only")?.remove();
  const section = document.createElement("section");
  section.className = "print-only";
  section.innerHTML = `<h1>${esc(title)}</h1>${html}<p style="margin-top:20px;font-size:9px">Backstage · SN Productions</p>`;
  document.body.append(section);
  document.body.classList.add("print-sheet");
  const clean = () => {
    section.remove();
    document.body.classList.remove("print-sheet");
  };
  window.addEventListener("afterprint", clean, { once: true });
  window.print();
}
export async function setlists(root, { id, manage, archived }) {
  root.innerHTML = `<div class="toolbar"><p class="muted">Ordered songs with planned timing and recorded crowd feedback.</p>${manage ? '<button class="primary" id="new-setlist">＋ New Setlist</button>' : ""}</div><div id="setlist-list" class="stack"></div>`;
  $("#new-setlist", root)?.addEventListener("click", () =>
    editor("setlists", null, { eventId: id }).catch(fail),
  );
  let lists = [];
  const perform = manage || data.can("setlists.perform");
  const draw = () => {
    const body = $("#setlist-list", root);
    if (!lists.length) {
      body.innerHTML = empty(
        "No setlists",
        "Create a setlist, then add songs from your library or import CSV.",
      );
      return;
    }
    body.innerHTML = lists
      .map(
        (list) =>
          `<section class="panel" data-list="${list.id}"><header class="panel-head"><div><h2>${esc(list.name)}</h2><small>${(list.songs || []).length} songs · ${duration((list.songs || []).reduce((s, r) => s + (r.duration || 0), 0))}</small></div><div class="head-actions"><button class="button-small" data-print>Print / PDF</button><button class="button-small" data-export>CSV</button>${manage ? '<button class="button-small" data-import>Import CSV</button><button class="button-small" data-add>＋ Add Song</button><button class="button-small" data-custom>New Song</button>' : ""}</div></header><div class="song-list">${(list.songs || []).map((song, index) => songRow(song, index, manage, archived, perform)).join("") || empty("No songs yet", "CSV headers: name, artist, duration (seconds), genre, bpm, key, transition, plannedTime.")} </div></section>`,
      )
      .join("");
    $$("[data-list]", body).forEach((section) => {
      const list = lists.find((l) => l.id === section.dataset.list);
      const save = async (songs) => {
        section
          .querySelectorAll("button,input,select")
          .forEach((el) => (el.disabled = true));
        try {
          return await data.operate({
            op: "setlistSongs",
            eventId: id,
            id: list.id,
            songs,
            baseRevision: list.revision,
          });
        } catch (error) {
          draw();
          throw error;
        } finally {
          if (section.isConnected)
            section
              .querySelectorAll("button,input,select")
              .forEach((el) => (el.disabled = false));
        }
      };
      $("[data-export]", section).onclick = () =>
        download(
          `${list.name}.csv`,
          csv(list.songs || [], [
            "name",
            "artist",
            "duration",
            "genre",
            "bpm",
            "key",
            "notes",
            "transition",
            "plannedTime",
            "played",
            "feedback",
          ]),
          "text/csv",
        );
      $("[data-print]", section).onclick = () =>
        printSheet(
          list.name,
          `<table><thead><tr><th>#</th><th>Planned</th><th>Song / artist</th><th>Duration</th><th>Notes / transition</th></tr></thead><tbody>${(list.songs || []).map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.plannedTime)}</td><td>${esc(s.name)} — ${esc(s.artist)}</td><td>${duration(s.duration || 0)}</td><td>${esc(s.notes)} ${esc(s.transition)}</td></tr>`).join("")}</tbody></table>`,
        );
      $("[data-add]", section)?.addEventListener("click", async () => {
        const songId = await chooseRecord("songs", "Add a library song");
        if (!songId) return;
        const row = await data.get(`songs/${songId}`);
        if (row)
          try {
            await save([
              ...(list.songs || []),
              { ...row, id: crypto.randomUUID().replaceAll("-", "") },
            ]);
          } catch (e) {
            fail(e);
          }
      });
      $("[data-custom]", section)?.addEventListener("click", () =>
        editor("songs", null, {
          onSaved: async (songId) => {
            const row = await data.get(`songs/${songId}`);
            await save([
              ...(list.songs || []),
              { ...row, id: crypto.randomUUID().replaceAll("-", "") },
            ]);
          },
        }).catch(fail),
      );
      $("[data-import]", section)?.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".csv,text/csv";
        input.onchange = async () => {
          try {
            const rows = parseCSV(await input.files[0].text()).map((row) => ({
              ...row,
              duration: Number(row.duration || 0),
              bpm: Number(row.bpm || 0),
              played: row.played === "true",
              id: crypto.randomUUID().replaceAll("-", ""),
            }));
            await save([...(list.songs || []), ...rows]);
            toast(`Imported ${rows.length} songs.`);
          } catch (e) {
            fail(e);
          }
        };
        input.click();
      });
      section.addEventListener("click", async (e) => {
        const button = e.target.closest(
          "[data-up],[data-down],[data-remove],[data-edit-song]",
        );
        if (!button) return;
        const index = Number(button.closest("[data-song]").dataset.song);
        const songs = structuredClone(list.songs);
        if (button.hasAttribute("data-edit-song")) {
          const song = songs[index];
          const m = modal(
            "Song Details",
            `<form><div class="form-grid">${[
              ["name", "Title"],
              ["artist", "Artist"],
              ["duration", "Duration (seconds)"],
              ["bpm", "BPM"],
              ["key", "Key"],
              ["genre", "Genre"],
              ["plannedTime", "Planned play time"],
              ["transition", "Transition notes"],
              ["notes", "Notes"],
            ]
              .map(
                ([key, label]) =>
                  `<label>${label}<input name="${key}" value="${esc(song[key] ?? "")}" ${["duration", "bpm"].includes(key) ? 'type="number" min="0" step="1"' : ""}></label>`,
              )
              .join(
                "",
              )}</div><div class="form-actions"><button class="primary">Save Song</button></div></form>`,
          );
          $("form", m.el).onsubmit = (e) => {
            e.preventDefault();
            busy($("button.primary", m.el), async () => {
              const fields = Object.fromEntries(new FormData(e.target));
              fields.duration = Number(fields.duration || 0);
              fields.bpm = Number(fields.bpm || 0);
              songs[index] = { ...song, ...fields };
              await save(songs);
              m.close();
            });
          };
          return;
        }
        if (button.hasAttribute("data-remove")) songs.splice(index, 1);
        else {
          const other = index + (button.hasAttribute("data-up") ? -1 : 1);
          if (other < 0 || other >= songs.length) return;
          [songs[index], songs[other]] = [songs[other], songs[index]];
        }
        try {
          await save(songs);
        } catch (e) {
          fail(e);
        }
      });
      section.addEventListener("change", async (e) => {
        const line = e.target.closest("[data-song]");
        if (!line) return;
        const songs = structuredClone(list.songs),
          index = Number(line.dataset.song);
        if (e.target.hasAttribute("data-played"))
          songs[index].played = e.target.checked;
        if (e.target.hasAttribute("data-feedback"))
          songs[index].feedback = e.target.value;
        try {
          if (manage) await save(songs);
          else
            await data.operate({
              op: "setlistPerform",
              eventId: id,
              id: list.id,
              songId: songs[index].id,
              played: songs[index].played,
              feedback: songs[index].feedback,
              baseRevision: list.revision,
            });
        } catch (e) {
          fail(e);
        }
      });
      if (manage) {
        let from = null;
        $$("[data-song]", section).forEach((row) => {
          row.ondragstart = (e) => {
            from = Number(row.dataset.song);
            e.dataTransfer.effectAllowed = "move";
          };
          row.ondragover = (e) => e.preventDefault();
          row.ondrop = async (e) => {
            e.preventDefault();
            const to = Number(row.dataset.song);
            if (from === null || from === to) return;
            const songs = structuredClone(list.songs);
            const [moving] = songs.splice(from, 1);
            songs.splice(to, 0, moving);
            try {
              await save(songs);
            } catch (e) {
              fail(e);
            }
            from = null;
          };
        });
      }
    });
  };
  return data.watch(
    `events/${id}/setlists`,
    (rows) => {
      lists = rows.sort((a, b) => (a.order || 0) - (b.order || 0));
      draw();
    },
    fail,
  );
}
function songRow(song, index, manage, archived, perform) {
  return `<div class="song-row" data-song="${index}" ${manage ? 'draggable="true"' : ""}><span class="mono muted">${String(index + 1).padStart(2, "0")}</span><div><strong class="song-title">${esc(song.name)}</strong><small style="display:block">${esc(song.artist)} · ${duration(song.duration || 0)}${song.bpm ? ` · ${song.bpm} BPM` : ""}${song.key ? ` · ${esc(song.key)}` : ""}</small>${song.transition ? `<small>↳ ${esc(song.transition)}</small>` : ""}</div><label class="check"><input type="checkbox" data-played ${song.played ? "checked" : ""} ${!perform || archived ? "disabled" : ""}> Played</label><select data-feedback aria-label="Crowd response" ${!perform || archived ? "disabled" : ""}><option value="">Response…</option>${["Excellent", "Good", "Average", "Poor"].map((s) => `<option ${song.feedback === s ? "selected" : ""}>${s}</option>`).join("")}</select><div class="order-buttons">${manage ? '<button data-up aria-label="Move song up">↑</button><button data-down aria-label="Move song down">↓</button><button data-edit-song aria-label="Edit song">✎</button><button data-remove aria-label="Remove song">×</button>' : ""}</div></div>`;
}
export function duration(seconds) {
  return `${Math.floor(seconds / 3600) ? Math.floor(seconds / 3600) + "h " : ""}${Math.floor((seconds % 3600) / 60)}m ${Math.floor(seconds % 60)}s`;
}
export async function rundown(root, { id, manage, archived }) {
  root.innerHTML = `<div class="toolbar"><p class="muted">Planned times and actual completions are recorded separately.</p><div class="head-actions"><button id="print-show">Print / PDF</button>${manage ? '<button id="calculate">Calculate Planned Times</button><button class="primary" id="new-segment">＋ New Segment</button>' : ""}</div></div><div class="panel" id="rundown-list"></div><p class="form-hint" id="rundown-duration"></p>`;
  let rows = [];
  $("#new-segment", root)?.addEventListener("click", () =>
    editor("rundown", null, { eventId: id }).catch(fail),
  );
  $("#print-show", root).onclick = () =>
    printSheet(
      "Run of Show",
      `<table><thead><tr><th>Planned start</th><th>Duration</th><th>Segment</th><th>Crew</th><th>Notes</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.startTime)}</td><td>${r.duration || 0}m</td><td>${esc(r.name)}</td><td>${esc(r.crewId)}</td><td>${esc(r.notes)}</td></tr>`).join("")}</tbody></table>`,
    );
  $("#calculate", root)?.addEventListener("click", async () => {
    const start = await prompt(
      "Calculate Planned Times",
      "First segment starts at (HH:MM)",
      { value: rows[0]?.startTime || "18:00", type: "time" },
    );
    if (!start) return;
    try {
      await data.operate({
        op: "rundownTimes",
        eventId: id,
        start,
        ids: rows.map((r) => r.id),
        revisions: Object.fromEntries(rows.map((r) => [r.id, r.revision])),
      });
    } catch (e) {
      fail(e);
    }
  });
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-show-edit],[data-show-up]");
    if (!b) return;
    const row = rows.find(
      (r) => r.id === b.dataset.showEdit || r.id === b.dataset.showUp,
    );
    if (b.hasAttribute("data-show-edit"))
      return editor("rundown", row, { eventId: id }).catch(fail);
    const index = rows.indexOf(row);
    if (index < 1) return;
    const ordered = [...rows];
    [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
    try {
      await data.operate({
        op: "reorder",
        eventId: id,
        type: "rundown",
        ids: ordered.map((r) => r.id),
        revisions: Object.fromEntries(ordered.map((r) => [r.id, r.revision])),
      });
    } catch (e) {
      fail(e);
    }
  });
  root.addEventListener("change", async (e) => {
    if (!e.target.dataset.showComplete) return;
    const r = rows.find((r) => r.id === e.target.dataset.showComplete);
    try {
      await data.operate({
        op: "segmentComplete",
        eventId: id,
        id: r.id,
        complete: e.target.checked,
        baseRevision: r.revision,
      });
    } catch (error) {
      e.target.checked = !e.target.checked;
      fail(error);
    }
  });
  return data.watch(
    `events/${id}/rundown`,
    (items) => {
      rows = items.sort(
        (a, b) => (a.order || a.createdAt || 0) - (b.order || b.createdAt || 0),
      );
      $("#rundown-duration", root).textContent =
        `Planned duration: ${rows.reduce((s, r) => s + (r.duration || 0), 0)} minutes`;
      const list = $("#rundown-list", root);
      if (!rows.length) {
        list.innerHTML = empty(
          "No show segments",
          "Add segments, assign crew, and calculate the planned timeline.",
        );
        return;
      }
      list.querySelector(".empty")?.remove();
      keyed(
        list,
        rows,
        (r) =>
          `<div class="list-row"><span class="mono" style="min-width:45px">${esc(r.startTime || "—")}</span><div class="grow"><strong>${esc(r.name)}</strong><small>${r.duration || 0} minutes · ${esc(r.crewId || "Unassigned")}${r.actualTime ? ` · Actual completion ${esc(date(r.actualTime))}` : ""}</small></div>${badge(r.status || "Open")}<label class="check"><input type="checkbox" data-show-complete="${r.id}" ${r.status === "Complete" ? "checked" : ""} ${!manage || archived ? "disabled" : ""}> Complete</label>${manage ? `<button class="button-small" data-show-edit="${r.id}">Edit</button><button class="icon-button" data-show-up="${r.id}" aria-label="Move segment up">↑</button>` : ""}</div>`,
      );
    },
    fail,
  );
}
