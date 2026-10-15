import * as data from "../services/data.js";
import { $, $$, esc, toast, fail, busy } from "../utils/dom.js";
import { publicSiteOrigin } from "../config.js";
import { chooseRecord } from "./records.js";
import { prompt } from "../components/modal.js";
const defaults = {
  width: 70,
  height: 35,
  font: 11,
  subfont: 8,
  qr: 23,
  align: "left",
  logo: "None",
  logoWidth: 28,
  qrPosition: "Right",
  padding: 3,
  scale: 100,
  offsetX: 0,
  offsetY: 0,
  layout: "Label",
  custom: "",
  showId: true,
  showCategory: true,
  showName: true,
  showPhoto: false,
  sheet: false,
};
export function qrSVG(text) {
  if (!window.qrcode)
    throw Error("QR library is unavailable. Reload while online.");
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 12, scalable: true });
}
export function recordURL(row) {
  const base = publicSiteOrigin || location.origin;
  const path = location.pathname.endsWith("index.html")
    ? location.pathname.slice(0, -10)
    : location.pathname.endsWith("/")
      ? location.pathname
      : location.pathname + "/";
  return `${base.replace(/\/$/, "")}${path}#/q/${row.qrId}`;
}
export async function render(root) {
  let type = "equipment",
    rows = [],
    config = { ...defaults };
  const chosen = sessionStorage.getItem("labelSelection");
  sessionStorage.removeItem("labelSelection");
  if (chosen) {
    try {
      const selected = JSON.parse(chosen);
      type = selected.type;
      rows = (
        await Promise.all(selected.ids.map((id) => data.get(`${type}/${id}`)))
      ).filter(Boolean);
    } catch {}
  }
  const imageManifest = await fetch("assets/equipment/manifest.json", {
    cache: "no-cache",
  })
    .then((r) => r.json())
    .catch(() => ({ images: [] }));
  const attachPhoto = (row) => {
    const match = imageManifest.images?.find(
      (img) => img.assetId === (row.assetId || row.id),
    );
    if (match)
      row.photoUrl = `assets/equipment/${encodeURIComponent(match.filename)}`;
    return row;
  };
  rows.forEach(attachPhoto);
  const templates = (await data
    .get("settings/labelTemplates")
    .catch(() => null)) || { values: [] };
  root.innerHTML = `<div class="page-head"><div><h1>Labels & badges</h1><p>Physical dimensions, replaceable QR stickers, and reusable templates.</p></div><div class="head-actions"><button id="calibrate">Print Calibration</button><button class="primary" id="print-labels">Print / Save PDF</button></div></div><div class="split label-designer"><section class="panel"><header class="panel-head"><h2>Label settings</h2><button class="button-small" id="save-label">Save Template</button></header><div class="panel-body"><form id="label-config"><div class="form-grid"><label class="full">Template<select id="label-template"><option value="">Custom settings</option><option value="compact">Equipment · 70 × 35 mm</option><option value="case">Case · 100 × 50 mm</option><option value="badge">Badge · 86 × 54 mm</option><option value="sticker">QR sticker · 25 × 25 mm</option>${(templates.values || []).map((t, i) => `<option value="saved-${i}">${esc(t.name)}</option>`).join("")}</select></label><label>Record type<select id="label-type">${["equipment", "cases", "crew", "events", "custom"].map((t) => `<option value="${t}" ${type === t ? "selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select></label><label>Layout<select name="layout"><option>Label</option><option>Badge</option><option>QR Only</option></select></label>${[
    ["width", "Width (mm)", 70],
    ["height", "Height (mm)", 35],
    ["padding", "Inside padding (mm)", 3],
    ["qr", "QR size (mm)", 23],
    ["font", "Name font (pt)", 11],
    ["subfont", "Other text (pt)", 8],
    ["logoWidth", "Logo width (mm)", 28],
    ["scale", "Calibration scale (%)", 100],
    ["offsetX", "Horizontal offset (mm)", 0],
    ["offsetY", "Vertical offset (mm)", 0],
  ]
    .map(
      ([key, label, value]) =>
        `<label>${label}<input name="${key}" type="number" step="0.1" value="${value}" min="${key.startsWith("offset") ? -20 : key === "scale" ? 80 : 0}" max="${key === "scale" ? 120 : 300}"></label>`,
    )
    .join(
      "",
    )}<label>Text alignment<select name="align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>QR placement<select name="qrPosition"><option>Right</option><option>Left</option><option>None</option></select></label><label>Official logo placement<select name="logo"><option>None</option><option>Top</option><option>Bottom</option></select></label><label class="full">Custom text<textarea name="custom" placeholder="Optional operational fields"></textarea></label>${[
    ["showId", "Asset / crew ID"],
    ["showName", "Equipment / crew / event name"],
    ["showCategory", "Category / production role"],
    ["showPhoto", "Crew photo when published"],
    ["sheet", "Print multiple labels on a sheet"],
  ]
    .map(
      ([key, label]) =>
        `<label class="check full"><input type="checkbox" name="${key}" ${config[key] ? "checked" : ""}>${label}</label>`,
    )
    .join(
      "",
    )}</div></form><div class="head-actions section-gap"><button id="add-label">＋ Add Record</button><button id="clear-labels">Clear</button></div><p class="form-hint">Print at actual size (100%) with browser headers and footers off. PDF export uses the print dialog’s Save as PDF option.</p></div></section><div><div class="notice" id="label-note">QR identifiers require an authenticated, authorized Backstage session. Printed credentials grant no system or location access.</div><div class="print-stage" id="label-preview"></div><p class="form-hint" id="label-count"></p><div id="label-records" class="section-gap"></div></div></div>`;
  const form = $("#label-config", root);
  const read = () => {
    const next = { ...config };
    for (const [key, value] of new FormData(form)) {
      if (
        [
          "width",
          "height",
          "font",
          "subfont",
          "logoWidth",
          "qr",
          "padding",
          "scale",
          "offsetX",
          "offsetY",
        ].includes(key)
      )
        next[key] = Number(value);
      else next[key] = value;
    }
    for (const key of [
      "showId",
      "showName",
      "showCategory",
      "showPhoto",
      "sheet",
    ])
      next[key] = form.elements[key].checked;
    return next;
  };
  const paint = () => {
    config = read();
    let error = "";
    if (config.width < 20 || config.height < 20)
      error = "Labels must be at least 20 × 20 mm.";
    if (config.qrPosition !== "None" && config.qr < 18)
      error = "Use a QR size of at least 18 mm.";
    if (config.qr + config.padding * 2 > Math.min(config.width, config.height))
      error = "QR code and padding exceed the label dimensions.";
    if (
      config.width > 300 ||
      config.height > 300 ||
      config.font < 5 ||
      config.subfont < 5
    )
      error = "Check label dimensions and font sizes.";
    $("#label-note", root).textContent =
      error ||
      "QR codes require authentication and record permission. Credentials grant no system or location access.";
    $("#label-note", root).classList.toggle("warning", !!error);
    $("#print-labels", root).disabled = !!error || !rows.length;
    $("#label-preview", root).innerHTML = rows.length
      ? rows.map((row) => renderLabel(row, config)).join("")
      : '<p style="color:#333;font-size:12px">Add records to preview actual label geometry.</p>';
    $("#label-count", root).textContent =
      `${rows.length} labels · ${config.width} × ${config.height} mm · ${config.scale}% calibration`;
    $("#label-records", root).innerHTML = rows
      .map(
        (row, i) =>
          `<div class="list-row"><span class="grow">${esc(row.name || "Custom label")} <small>${esc(row.assetId || "")}</small></span><button data-remove="${i}" class="button-small">Remove</button></div>`,
      )
      .join("");
    $$("[data-remove]", root).forEach(
      (b) =>
        (b.onclick = () => {
          rows.splice(Number(b.dataset.remove), 1);
          paint();
        }),
    );
  };
  const apply = (next) => {
    config = { ...defaults, ...next };
    for (const key of Object.keys(config)) {
      const el = form.elements[key];
      if (!el) continue;
      if (el.type === "checkbox") el.checked = !!config[key];
      else el.value = config[key];
    }
    paint();
  };
  form.oninput = paint;
  $("#label-type", root).onchange = (e) => (type = e.target.value);
  $("#add-label", root).onclick = async () => {
    try {
      if (type === "custom") {
        const name = await prompt("Custom Label", "Label text");
        if (name) rows.push({ name, assetId: "", category: "" });
      } else {
        const id = await chooseRecord(type, "Select a label record");
        if (!id) return;
        const row = await data.get(`${type}/${id}`);
        if (!row?.qrId)
          return toast("This record has no active QR identifier.", true);
        rows.push(attachPhoto(row));
      }
      paint();
    } catch (e) {
      fail(e);
    }
  };
  $("#clear-labels", root).onclick = () => {
    rows = [];
    paint();
  };
  $("#label-template", root).onchange = (e) => {
    const key = e.target.value;
    if (key === "compact") apply(defaults);
    if (key === "case")
      apply({ width: 100, height: 50, qr: 35, font: 16, subfont: 10 });
    if (key === "badge")
      apply({
        width: 86,
        height: 54,
        qr: 25,
        font: 17,
        subfont: 10,
        layout: "Badge",
        logo: "Top",
      });
    if (key === "sticker")
      apply({
        width: 25,
        height: 25,
        qr: 23,
        padding: 1,
        layout: "QR Only",
        showId: false,
        showName: false,
        showCategory: false,
      });
    if (key.startsWith("saved-"))
      apply(templates.values[Number(key.slice(6))].config);
  };
  $("#save-label", root).disabled = !data.can("settings.write");
  $("#save-label", root).onclick = async () => {
    const name = await prompt("Save Label Template", "Template name");
    if (!name) return;
    try {
      templates.values = [
        ...(templates.values || []),
        { name, config: read() },
      ];
      await data.operate({
        op: "settings",
        id: "labelTemplates",
        data: { values: templates.values },
      });
      toast("Template saved. Reopen this page to select it.");
    } catch (e) {
      fail(e);
    }
  };
  $("#print-labels", root).onclick = () => {
    const style = document.createElement("style");
    style.textContent = `@media print{@page{size:${config.sheet ? "auto" : `${config.width}mm ${config.height}mm`};margin:0}.print-only{padding:0!important}.print-only .label-print{transform:translate(${config.offsetX}mm,${config.offsetY}mm) scale(${config.scale / 100});transform-origin:top left;${config.sheet ? "" : "break-after:page;"}}.print-only .print-stage{display:flex!important}}`;
    document.head.append(style);
    const section = document.createElement("div");
    section.className = "print-only";
    section.innerHTML = `<div class="print-stage">${rows.map((row) => renderLabel(row, config)).join("")}</div>`;
    document.querySelector(".print-only")?.remove();
    document.body.append(section);
    document.body.classList.add("print-sheet");
    window.addEventListener(
      "afterprint",
      () => {
        section.remove();
        style.remove();
        document.body.classList.remove("print-sheet");
      },
      { once: true },
    );
    window.print();
  };
  $("#calibrate", root).onclick = async () => {
    const { printSheet } = await import("./show.js");
    printSheet(
      "Print Calibration",
      '<p>Print at 100%, then measure this square. It should be 50 × 50 mm.</p><div style="width:50mm;height:50mm;border:0.2mm solid black;margin-top:10mm"></div><p>Scale correction = 50 ÷ measured width × 100. Enter the result in Calibration scale.</p>',
    );
  };
  apply(config);
}
function renderLabel(row, c) {
  const textWidth =
    c.qrPosition === "None"
      ? c.width - c.padding * 2
      : c.width - c.padding * 3 - c.qr;
  const textLeft = c.qrPosition === "Left" ? c.padding * 2 + c.qr : c.padding;
  const logoWidth = Math.max(1, Math.min(c.logoWidth || 28, textWidth));
  const logoHeight = logoWidth * 0.55;
  const primary =
    c.layout === "QR Only"
      ? ""
      : `${c.showName ? `<div class="label-name" style="font-size:${c.font}pt">${esc(row.name)}</div>` : ""}${c.showId ? `<div style="font-size:${c.subfont}pt;margin-top:1.5mm">${esc(row.assetId || "")}</div>` : ""}${c.showCategory ? `<div class="label-sub" style="font-size:${c.subfont}pt;margin-top:1mm">${esc(row.category || row.roles || row.venue || "")}</div>` : ""}${c.custom ? `<div style="font-size:${c.subfont}pt;margin-top:1mm;white-space:pre-wrap">${esc(c.custom)}</div>` : ""}`;
  const qr =
    row.qrId && c.qrPosition !== "None"
      ? `<div class="label-qr" style="position:absolute;width:${c.qr}mm;height:${c.qr}mm;top:${(c.height - c.qr) / 2}mm;${c.qrPosition === "Left" ? "left" : "right"}:${c.padding}mm">${qrSVG(recordURL(row))}</div>`
      : "";
  return `<article class="label-print" style="width:${c.width}mm;height:${c.height}mm;text-align:${c.align}">${c.logo !== "None" ? `<img class="label-logo" src="assets/branding/sn-productions-logo.png" alt="" style="position:absolute;${c.logo === "Top" ? "top" : "bottom"}:${c.padding}mm;left:${textLeft}mm;width:${logoWidth}mm;height:${logoHeight}mm;object-fit:cover;object-position:center">` : ""}<div style="position:absolute;left:${textLeft}mm;top:${c.padding + (c.logo === "Top" ? logoHeight + 2 : 0)}mm;width:${Math.max(0, textWidth)}mm">${c.showPhoto && row.photoUrl ? `<img src="${esc(row.photoUrl)}" alt="" style="width:16mm;height:20mm;object-fit:cover;float:left;margin-right:2mm">` : ""}${c.layout === "Badge" ? `<div style="font-size:7pt;letter-spacing:1px;margin-bottom:2mm">SN PRODUCTIONS</div>` : ""}${primary}</div>${qr}</article>`;
}
