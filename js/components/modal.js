import { $, esc, fail } from "../utils/dom.js";
export function modal(title, html, { wide = false, onClose = () => {} } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = wide ? "wide" : "";
  dialog.innerHTML = `<header><h2>${esc(title)}</h2><button type="button" class="icon-button" data-close aria-label="Close">×</button></header><div class="dialog-body">${html}</div>`;
  document.body.append(dialog);
  dialog.showModal();
  const close = () => dialog.close();
  $("[data-close]", dialog).onclick = close;
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog && e.clientX < dialog.getBoundingClientRect().left)
      close();
  });
  dialog.addEventListener(
    "close",
    () => {
      onClose();
      dialog.remove();
    },
    { once: true },
  );
  return { el: dialog, body: $(".dialog-body", dialog), close };
}
export function confirm(title, body, action = "Confirm") {
  return new Promise((resolve) => {
    const m = modal(
      title,
      `<p>${esc(body)}</p><div class="form-actions"><button data-no>Cancel</button><button class="primary" data-yes>${esc(action)}</button></div>`,
      { onClose: () => resolve(false) },
    );
    $("[data-no]", m.el).onclick = m.close;
    $("[data-yes]", m.el).onclick = () => {
      resolve(true);
      m.close();
    };
  });
}
export function prompt(title, label, { value = "", type = "text" } = {}) {
  return new Promise((resolve) => {
    const m = modal(
      title,
      `<form><label>${esc(label)}<input name="value" type="${esc(type)}" value="${esc(value)}" required autofocus></label><div class="form-actions"><button type="button" data-cancel>Cancel</button><button class="primary">Continue</button></div></form>`,
      { onClose: () => resolve(null) },
    );
    $("[data-cancel]", m.el).onclick = m.close;
    $("form", m.el).onsubmit = (e) => {
      e.preventDefault();
      resolve($("input", m.el).value);
      m.close();
    };
  });
}
