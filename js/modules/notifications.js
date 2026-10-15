import * as data from "../services/data.js";
import { $, $$, esc, empty, date, fail } from "../utils/dom.js";
export async function render(root) {
  root.innerHTML =
    '<div class="page-head"><div><h1>Notifications</h1><p>Assignments and operational updates.</p></div><a class="button" href="#/settings?tab=notifications">Preferences</a></div><section class="panel" id="notification-list"></section>';
  return data.watch(
    "notifications",
    (rows) => {
      $("#notification-list", root).innerHTML = rows.length
        ? rows
            .map(
              (n) =>
                `<div class="notification ${n.read ? "" : "unread"}"><a href="${esc(n.link)}" style="flex:1"><h3>${esc(n.title)}</h3><small>${esc(date(n.createdAt))}</small></a><button class="button-small" data-read="${n.id}" data-state="${n.read}">${n.read ? "Mark Unread" : "Mark Read"}</button></div>`,
            )
            .join("")
        : empty(
            "No notifications",
            "Team alerts can be refreshed in Settings → Maintenance.",
          );
      $$("[data-read]", root).forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await data.operate({
                op: "notificationRead",
                id: b.dataset.read,
                read: b.dataset.state !== "true",
              });
            } catch (e) {
              fail(e);
            }
          }),
      );
    },
    fail,
    { size: 50 },
  );
}
