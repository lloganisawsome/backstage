import * as data from "../services/data.js";
import { permissions, roleDefaults } from "../../core/schema.mjs";
import {
  $,
  $$,
  esc,
  empty,
  toast,
  fail,
  busy,
  download,
  date,
} from "../utils/dom.js";
import { modal, prompt } from "../components/modal.js";
import { go } from "../router.js";
const sections = [
  "Profile",
  "Company",
  "Access",
  "Roles",
  "Categories",
  "Templates",
  "Notifications",
  "Appearance",
  "Export",
  "Activity",
  "Maintenance",
];
export async function render(root, { params }) {
  const active = params.get("tab") || "company";
  root.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>Company, access, operational defaults, and personal preferences.</p></div></div><div class="settings-grid"><div class="settings-nav">${sections
    .filter(
      (s) => !["Access", "Roles"].includes(s) || data.can("members.write"),
    )
    .filter((s) => s !== "Activity" || data.can("audit.read"))
    .map(
      (s) =>
        `<button data-tab="${s.toLowerCase()}" class="${active === s.toLowerCase() ? "primary" : ""}">${s}</button>`,
    )
    .join(
      "",
    )}</div><section class="panel"><header class="panel-head"><h2>${esc(sections.find((s) => s.toLowerCase() === active) || "Company")}</h2></header><div class="panel-body" id="settings-content"></div></section></div>`;
  $$("[data-tab]", root).forEach(
    (b) => (b.onclick = () => go(`settings?tab=${b.dataset.tab}`)),
  );
  const body = $("#settings-content", root);
  await (
    {
      profile,
      company,
      access,
      roles,
      categories,
      templates,
      notifications,
      appearance,
      export: exportData,
      activity,
      maintenance,
    }[active] || company
  )(body);
}
async function company(root) {
  const record = (await data.get("settings/company")) || {};
  root.innerHTML = `<form><div class="form-grid">${[
    ["name", "Company name", record.name || "SN Productions"],
    ["email", "Contact email", record.email || ""],
    ["phone", "Contact phone", record.phone || ""],
    ["accent", "Accent color", record.accent || "#e9edef"],
  ]
    .map(
      ([key, label, value]) =>
        `<label>${label}<input name="${key}" value="${esc(value)}" ${key === "accent" ? 'type="color"' : ""}></label>`,
    )
    .join(
      "",
    )}<div class="full notice">Official logo is installed at <span class="mono">public/assets/branding/sn-productions-logo.png</span>. The logo is used unchanged in the sidebar and label designer. The supplied SN Logo Dark.png is preserved byte for byte.</div></div><div class="form-actions"><button class="primary" ${!data.can("settings.write") ? "disabled" : ""}>Save Company</button></div></form>`;
  $("form", root).onsubmit = (e) => {
    e.preventDefault();
    busy($("button", root), async () => {
      const values = Object.fromEntries(new FormData(e.target));
      await data.operate({ op: "settings", id: "company", data: values });
      document.documentElement.style.setProperty("--accent", values.accent);
      document.documentElement.style.setProperty("--accent-bg", values.accent);
      toast("Company settings saved.");
    });
  };
}
async function access(root) {
  if (!data.can("members.write")) throw Error("Permission denied.");
  const [users, roles, crew] = await Promise.all([
    data.list("users", { size: 100 }),
    data.list("roles", { size: 100 }),
    data.list("crew", { size: 100 }),
  ]);
  root.innerHTML = `<div class="notice">Members first create and verify a Firebase account. An owner enters its UID here and assigns access. Deactivation immediately blocks operational reads and writes; it does not delete their crew history.</div><button class="primary" id="new-member">Activate Account</button> <button id="default-roles" ${!data.session().user.owner ? "disabled" : ""}>Initialize Missing Default Roles</button><div class="section-gap">${users.rows.map((u) => `<div class="list-row"><div class="grow"><strong>${esc(u.name)}</strong><small>${esc(u.id)} · ${esc(u.roles?.join(", "))}</small></div><span class="badge ${u.active ? "success" : "danger"}">${u.active ? "Active" : "Inactive"}</span>${!u.owner ? `<button data-member="${u.id}" class="button-small">Edit Access</button>` : '<span class="badge">Owner</span>'}</div>`).join("")}</div>`;
  $("#default-roles", root).onclick = (e) =>
    busy(e.currentTarget, async () => {
      for (const [name, grants] of Object.entries(roleDefaults)) {
        if (name === "Owner") continue;
        const id = name === "Event Manager" ? "event-manager" : name;
        if (!roles.rows.some((r) => r.id === id))
          await data.operate({ op: "role", id, name, permissions: grants });
      }
      toast("Default roles ready.");
      await access(root);
    });
  const edit = (row) => {
    const m = modal(
      row ? "Edit Account Access" : "Activate Account",
      `<form><div class="form-grid"><label class="full">Firebase account UID<input name="uid" value="${esc(row?.id || "")}" required ${row ? "readonly" : ""}></label><label class="full">Display name<input name="name" value="${esc(row?.name || "")}" required></label><label>Linked crew profile<select name="crewId"><option value="">None</option>${crew.rows.map((c) => `<option value="${c.id}" ${row?.crewId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label><label>Access roles<select multiple name="roles" required>${roles.rows
        .filter((r) => r.id !== "Owner")
        .map(
          (r) =>
            `<option value="${esc(r.id)}" ${row?.roles?.includes(r.id) ? "selected" : ""}>${esc(r.name || r.id)}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="check full"><input name="active" type="checkbox" ${!row || row.active ? "checked" : ""}>Active membership</label></div><p class="form-hint">Current event memberships update when a crew profile is linked or deactivated. Archived snapshots are preserved.</p><div class="form-actions"><button class="primary">Save Access</button></div></form>`,
    );
    $("form", m.el).onsubmit = (e) => {
      e.preventDefault();
      busy($("button.primary", m.el), async () => {
        const f = e.target;
        await data.operate({
          op: "member",
          uid: f.uid.value,
          name: f.name.value,
          crewId: f.crewId.value || null,
          active: f.active.checked,
          roles: [...f.roles.selectedOptions].map((o) => o.value),
        });
        m.close();
        toast("Membership saved.");
        access(root);
      });
    };
  };
  $("#new-member", root).onclick = () => edit();
  $$("[data-member]", root).forEach(
    (b) =>
      (b.onclick = () =>
        edit(users.rows.find((u) => u.id === b.dataset.member))),
  );
}
async function roles(root) {
  if (!data.can("members.write")) throw Error("Permission denied.");
  const roles = await data.list("roles", { size: 100 });
  root.innerHTML = `<p class="notice">Permission changes update effective membership permissions atomically. Only an owner may change role definitions. Multiple roles combine their granted permissions.</p><button id="new-role" ${!data.session().user.owner ? "disabled" : ""}>＋ Custom Role</button><div class="section-gap">${roles.rows.map((r) => `<div class="list-row"><div class="grow"><strong>${esc(r.name || r.id)}</strong><small>${Object.values(r.permissions || {}).filter(Boolean).length} permissions</small></div><button data-role="${r.id}" ${r.id === "Owner" || !data.session().user.owner ? "disabled" : ""}>Configure</button></div>`).join("")}</div>`;
  const edit = async (r) => {
    if (!r) {
      const name = await prompt(
        "Custom Role",
        "Role ID (letters, numbers, and hyphens)",
      );
      if (!name) return;
      r = { id: name, name, permissions: {} };
    }
    const m = modal(
      `Role: ${r.name}`,
      `<form><div class="form-grid">${permissions.map((p) => `<label class="check"><input type="checkbox" name="${p}" ${r.permissions?.[p] ? "checked" : ""}>${esc(p)}</label>`).join("")}</div><div class="form-actions"><button class="primary">Save Permissions</button></div></form>`,
    );
    $("form", m.el).onsubmit = (e) => {
      e.preventDefault();
      busy($("button.primary", m.el), async () => {
        await data.operate({
          op: "role",
          id: r.id,
          name: r.name,
          permissions: Object.fromEntries(
            [...new FormData(e.target).keys()].map((k) => [k, true]),
          ),
        });
        m.close();
        toast("Role and memberships updated.");
        rolesRender();
      });
    };
  };
  const rolesRender = () => rolesView(root);
  $("#new-role", root).onclick = () => edit();
  $$("[data-role]", root).forEach(
    (b) =>
      (b.onclick = () => edit(roles.rows.find((r) => r.id === b.dataset.role))),
  );
}
const rolesView = roles;
async function categories(root) {
  const [categories, crewRoles] = await Promise.all(
    ["categories", "crewRoles"].map((s) => data.get(`settings/${s}`)),
  );
  root.innerHTML = `<form><div class="form-grid"><label>Additional equipment categories (one per line)<textarea name="categories" style="min-height:200px">${esc(categories?.values?.join("\n") || "")}</textarea></label><label>Production crew roles (one per line)<textarea name="crewRoles" style="min-height:200px">${esc(crewRoles?.values?.join("\n") || "DJ\nLighting operator\nAudio engineer\nVideo operator\nCamera operator\nStagehand\nEvent manager\nProducer\nGeneral crew")}</textarea></label></div><div class="form-actions"><button class="primary" ${!data.can("settings.write") ? "disabled" : ""}>Save Defaults</button></div></form>`;
  $("form", root).onsubmit = (e) => {
    e.preventDefault();
    busy($("button", root), async () => {
      for (const key of ["categories", "crewRoles"])
        await data.operate({
          op: "settings",
          id: key,
          data: {
            values: e.target.elements[key].value
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean)
              .slice(0, 100),
          },
        });
      toast("Operational defaults saved.");
    });
  };
}
async function templates(root) {
  const page = await data.list("templates", { size: 100 });
  root.innerHTML = `<p class="notice">Save event templates from an event Overview tab. Templates copy tasks, setlists, and run-of-show entries without assigning equipment or crew. Label and badge templates are saved in the label designer.</p><a class="button" href="#/labels">Open Label & Badge Designer</a><div class="section-gap">${page.rows.length ? page.rows.map((t) => `<div class="list-row"><div class="grow"><strong>${esc(t.name)}</strong><small>${esc(t.type)}</small></div></div>`).join("") : empty("No event templates", "Save a prepared event as a reusable template.")}</div>`;
}
async function notifications(root) {
  const { user } = data.session();
  root.innerHTML = `<form><label class="check"><input type="checkbox" name="operations" ${user.notificationPreferences?.operations !== false ? "checked" : ""}>Task, equipment, and event notifications</label><div class="form-actions"><button class="primary">Save Preferences</button></div></form><p class="form-hint">Notifications appear inside Backstage. Team alerts refresh from the website maintenance controls. No background server is needed.</p>`;
  $("form", root).onsubmit = (e) => {
    e.preventDefault();
    busy($("button", root), async () => {
      await data.operate({
        op: "profile",
        preferences: { operations: e.target.operations.checked },
      });
      toast("Notification preferences saved.");
    });
  };
}
async function appearance(root) {
  root.innerHTML = `<label>Appearance<select><option value="dark">Dark</option><option value="light">Light</option></select></label><p class="form-hint">Saved for this browser.</p>`;
  $("select", root).value = document.documentElement.dataset.theme;
  $("select", root).onchange = (e) => {
    document.documentElement.dataset.theme = e.target.value;
    localStorage.setItem("backstageTheme", e.target.value);
  };
}
async function exportData(root) {
  root.innerHTML =
    '<div class="notice">Exports include only collections allowed by your permissions. Images export separately through Image Manager. This explicit export uses paginated reads; keep exported personnel and financial records private.</div><button class="primary" id="export-all">Export Authorized Records ZIP</button>';
  $("#export-all", root).onclick = (e) =>
    busy(e.currentTarget, async () => {
      const zip = new window.JSZip();
      const collections = [
        "events",
        ...(data.can("operations.read")
          ? ["equipment", "cases", "maintenance", "songs", "templates"]
          : []),
        ...(data.can("crew.read") ? ["crew"] : []),
        ...(data.can("crew.write") ? ["crewPrivate"] : []),
        ...(data.can("clients.read") ? ["clients"] : []),
        ...(data.can("finance.read")
          ? ["ledger", "purchaseGoals", "assetFinance"]
          : []),
        ...(data.can("audit.read") ? ["activityLogs"] : []),
      ];
      for (const c of collections) {
        const rows = await data.queryAll(c);
        zip.file(`${c}.json`, JSON.stringify(rows, null, 2));
        if (c === "events")
          for (const ev of rows)
            for (const child of [
              "tasks",
              "assignments",
              "caseAssignments",
              "roster",
              "rig",
              "rundown",
              "setlists",
              "documents",
            ])
              zip.file(
                `events/${ev.id}/${child}.json`,
                JSON.stringify(
                  await data.queryAll(`events/${ev.id}/${child}`),
                  null,
                  2,
                ),
              );
      }
      download(
        "backstage-data-export.zip",
        await zip.generateAsync({ type: "blob" }),
      );
      toast("Authorized records exported.");
    });
}
async function activity(root) {
  if (!data.can("audit.read")) throw Error("Permission denied.");
  let cursor,
    source = "activityLogs";
  const draw = async () => {
    const page = await data.list(source, { size: 30, cursor });
    root.innerHTML =
      page.rows
        .map(
          (log) =>
            `<details class="section-gap"><summary>${esc(date(log.createdAt))} · ${esc(log.userName)} · ${esc(log.action)} <span class="badge">${log.serverVerified ? "Bootstrap record" : log.source === "static-client" ? "Client recorded" : "Local test record"}</span></summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px;margin-top:10px">${esc(JSON.stringify(log, null, 2))}</pre></details>`,
        )
        .join("") ||
      empty(
        "No audit records",
        "Website operations append client audit records.",
      );
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Audit category");
    select.innerHTML = `<option value="activityLogs">Operational audit</option>${data.can("finance.read") ? '<option value="financeActivityLogs">Financial audit</option>' : ""}${data.can("crew.write") ? '<option value="privateActivityLogs">Private crew audit</option>' : ""}`;
    select.value = source;
    select.onchange = () => {
      source = select.value;
      cursor = null;
      draw().catch(fail);
    };
    root.prepend(select);
    if (page.hasMore) {
      const b = document.createElement("button");
      b.textContent = "Next Page →";
      b.className = "section-gap";
      b.onclick = () => {
        cursor = page.cursor;
        draw().catch(fail);
      };
      root.append(b);
    }
  };
  await draw();
}

async function profile(root) {
  const { user, authUser } = data.session();
  root.innerHTML = `<form><label>Display name<input name="displayName" value="${esc(user.name || "")}" required></label><div class="section-gap"><small>Account UID</small><p class="mono">${esc(user.id)}</p><small>${esc(authUser?.email || "Local test account")}</small></div><div class="form-actions"><button class="primary">Save Profile</button></div></form>`;
  $("form", root).onsubmit = (e) => {
    e.preventDefault();
    busy($("button", root), async () => {
      await data.operate({
        op: "profile",
        name: e.target.elements.displayName.value,
      });
      toast("Profile saved.");
    });
  };
}

async function maintenance(root) {
  root.innerHTML = `<p class="notice">Refresh team alerts and remove expired operational photos and old request bookkeeping from the website. Changes run while this page is open.</p><button id="run-maintenance" class="primary" ${!data.session().user.owner ? "disabled" : ""}>Refresh Alerts & Clean Up</button><p id="maintenance-result" class="section-gap" role="status"></p><p class="form-hint">Owner access is required for team-wide maintenance. Published photo cleanup is in Image Manager.</p>`;
  $("#run-maintenance", root).onclick = (e) =>
    busy(e.currentTarget, async () => {
      const { refreshMaintenance } = await import("../services/maintenance.js");
      const result = await refreshMaintenance();
      $("#maintenance-result", root).textContent =
        `Processed ${result.events} events and removed ${result.expired} expired photos and ${result.bookkeeping} expired bookkeeping records.`;
      toast("Maintenance complete.");
    });
}
