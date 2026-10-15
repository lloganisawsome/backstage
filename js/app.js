import * as data from "./services/data.js";
import { $, esc, icon, fail, toast, busy } from "./utils/dom.js";
import { prompt, modal } from "./components/modal.js";
import { startRouter, go, renderRoute } from "./router.js";
const nav = [
  [
    "OPERATIONS",
    [
      ["dashboard", "Overview", "dashboard"],
      ["events", "Events", "events"],
      ["equipment", "Equipment", "equipment"],
      ["cases", "Road Cases", "cases"],
      ["maintenance", "Maintenance", "maintenance"],
    ],
  ],
  [
    "PEOPLE & SHOW",
    [
      ["crew", "Crew", "crew"],
      ["clients", "Clients & Schools", "clients"],
      ["songs", "Song Library", "songs"],
    ],
  ],
  [
    "MANAGEMENT",
    [
      ["ledger", "Finances", "finances"],
      ["purchaseGoals", "Purchase Planning", "purchases"],
      ["archives", "Event Archives", "events"],
      ["labels", "Labels & Badges", "labels"],
      ["images", "Image Manager", "images"],
      ["settings", "Settings", "settings"],
    ],
  ],
];
const access = {
  crew: "crew.read",
  clients: "clients.read",
  songs: "operations.read",
  ledger: "finance.read",
  purchaseGoals: "finance.read",
  images: "equipment.write",
};
function brand() {
  return `<span class="wordmark">Backstage<span class="brand-dot"></span></span><div class="parent-brand">SN Productions</div><img class="official-logo" src="assets/branding/sn-productions-logo.png" alt="SN Productions">`;
}
// Logo is loaded only when the official file has been supplied. No substitute artwork is generated.
function mountLogo() {
  document.querySelectorAll(".official-logo").forEach((img) => {
    img.removeAttribute("onerror");
    img.onload = () => (img.style.display = "block");
    img.onerror = () => img.remove();
  });
}
async function authScreen() {
  window.onhashchange = null;
  $("#app").innerHTML =
    `<main class="login"><section class="login-card"><div class="brand">${brand()}</div><h1>Sign in to your workspace</h1><p>Use your existing SN Productions account from the public site. Backstage membership is separate.</p><div id="auth-error" role="alert" hidden></div><form id="login"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Sign In ${icon("arrow")}</button></form><button id="google-login" class="section-gap">Continue with Google</button><div class="login-links"><button id="reset">Reset Shared Password</button><button id="register">Create Account</button></div><div class="local-entry"><button id="local">Open Local Test Workspace ${icon("arrow")}</button><p>Separate browser data for testing. No team synchronization. No production records are added.</p></div></section></main>`;
  mountLogo();
  const error = (e) => {
    const el = $("#auth-error");
    el.className = "setup-error";
    el.hidden = false;
    el.textContent = e.message;
  };
  $("#login").onsubmit = (e) => {
    e.preventDefault();
    busy($("#login button"), async () => {
      try {
        await data.login($("#login").email.value, $("#login").password.value);
        shell();
      } catch (e) {
        error(e);
      }
    });
  };
  $("#google-login").onclick = (e) =>
    busy(e.currentTarget, async () => {
      try {
        await data.loginWithGoogle();
        shell();
      } catch (e) {
        error(e);
      }
    });
  $("#reset").onclick = async () => {
    const email = await prompt(
      "Reset SN Productions Password",
      "Shared account email (also used by the public site)",
      {
        type: "email",
      },
    );
    if (!email) return;
    try {
      await data.reset(email);
      toast("If the account exists, check its inbox for a password reset.");
    } catch (e) {
      error(e);
    }
  };
  $("#register").onclick = () => {
    const m = modal(
      "Create Account",
      '<p>Already registered on the public site? Sign in with that same account instead. New accounts share the SN Productions sign-in system; Backstage membership still requires owner activation.</p><form class="section-gap"><label>Email<input name="email" type="email" autocomplete="email" required></label><label class="section-gap">Password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><div class="form-error"></div><div class="form-actions"><button class="primary">Create Account</button></div></form>',
    );
    $("form", m.el).onsubmit = (e) => {
      e.preventDefault();
      busy($("button.primary", m.el), async () => {
        try {
          const uid = await data.register(
            $("form", m.el).email.value,
            $("form", m.el).password.value,
          );
          $(".dialog-body", m.el).innerHTML =
            `<p>Verify your email, then give this account UID to your owner:</p><p class="mono section-gap">${esc(uid)}</p><p class="section-gap">The owner can activate membership in Settings → Access.</p>`;
        } catch (e) {
          $(".form-error", m.el).textContent = e.message;
        }
      });
    };
  };
  $("#local").onclick = () =>
    busy($("#local"), async () => {
      await data.localWorkspace();
      sessionStorage.setItem("backstageLocal", "1");
      shell();
    });
}
function shell() {
  const { user, local } = data.session();
  $("#app").innerHTML =
    `<div class="shell"><div class="mobile-overlay"></div><aside class="sidebar"><a class="brand" href="#/dashboard">${brand()}</a><nav>${nav
      .map(
        ([heading, items]) =>
          `<div class="nav-heading">${heading}</div>${items
            .filter(([id]) => !access[id] || data.can(access[id]))
            .map(
              ([id, label, ico]) =>
                `<a href="#/${id}" data-route="${id}">${icon(ico)}<span>${label}</span></a>`,
            )
            .join("")}`,
      )
      .join("")}</nav><div class="sidebar-foot"><div class="avatar">${esc(
      (user.name || "BS")
        .split(" ")
        .map((s) => s[0])
        .slice(0, 2)
        .join("")
        .toUpperCase(),
    )}</div><div class="account"><strong>${esc(user.name || "Crew member")}</strong><small>${esc(user.owner ? "Owner" : user.roles?.join(", ") || "Crew")}</small></div><button class="icon-button" id="logout" aria-label="Sign out">${icon("logout")}</button></div></aside><div class="workspace"><header class="topbar"><button class="icon-button mobile-menu" aria-label="Open navigation">☰</button><div class="breadcrumb"><span>Workspace</span><span>/</span><strong id="crumb">Overview</strong></div><div class="top-actions"><button class="search-trigger" id="global-search">${icon("search")}<span>Search workspace</span><kbd>⌘ K</kbd></button><div class="connection"><i></i><span id="connection-label">${local ? "Local device" : "Online"}</span></div><button class="icon-button" id="scan" aria-label="Scan QR code">${icon("scan")}</button><button class="icon-button" id="notifications" aria-label="Notifications">${icon("bell")}</button></div></header>${local ? '<div class="mode-banner"><span><strong>Local test workspace</strong> · Saved on this browser only</span><span>No team synchronization</span></div>' : ""}<main id="page" class="page" tabindex="-1"></main></div></div>`;
  mountLogo();
  $(".mobile-menu").onclick = () => {
    $(".sidebar").classList.toggle("open");
    $(".mobile-overlay").classList.toggle("open");
  };
  $(".mobile-overlay").onclick = () => {
    $(".sidebar").classList.remove("open");
    $(".mobile-overlay").classList.remove("open");
  };
  $("nav").addEventListener("click", () => {
    $(".sidebar").classList.remove("open");
    $(".mobile-overlay").classList.remove("open");
  });
  $("#logout").onclick = async () => {
    await data.logout();
    sessionStorage.removeItem("backstageLocal");
    authScreen();
  };
  $("#global-search").onclick = () => go("search");
  $("#scan").onclick = () => go("scan");
  $("#notifications").onclick = () => go("notifications");
  updateConnection();
  startRouter();
}
function updateConnection() {
  const el = $(".connection");
  if (!el) return;
  el.classList.toggle("offline", !navigator.onLine);
  $("#connection-label").textContent = !navigator.onLine
    ? "Offline · unsynced"
    : data.session().local
      ? "Local device"
      : "Online";
}
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k" && data.session().user) {
    e.preventDefault();
    go("search");
  }
});
data.changes.addEventListener("revoked", () => {
  sessionStorage.removeItem("backstageLocal");
  toast("Membership was deactivated. Your session has been closed.", true);
  authScreen();
});
const savedTheme = localStorage.getItem("backstageTheme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
if (sessionStorage.getItem("backstageLocal")) {
  await data.localWorkspace();
  shell();
} else {
  await authScreen();
  data
    .restore()
    .then((ok) => {
      if (ok && !data.session().local) shell();
    })
    .catch(() => {});
}
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
