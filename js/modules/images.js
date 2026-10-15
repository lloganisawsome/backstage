import * as data from "../services/data.js";
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
async function manifest() {
  return fetch("assets/equipment/manifest.json", { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : { images: [] }))
    .catch(() => ({ images: [] }));
}
export async function compress(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("Choose a JPEG, PNG, or WebP image.");
  if (file.size > 20 * 1024 * 1024)
    throw Error("Original image exceeds 20 MB.");
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 40000000)
      throw Error("Image exceeds 40 megapixels.");
    let scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    let url;
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      url = canvas.toDataURL(
        "image/webp",
        Math.max(0.35, 0.8 - attempt * 0.07),
      );
      if (url.length <= 250000)
        return { dataUrl: url, width: canvas.width, height: canvas.height };
      scale *= 0.82;
    }
    throw Error(
      "Image cannot fit the 250 KB encoded limit. Try a simpler crop.",
    );
  } finally {
    image.close();
  }
}
export async function gallery(
  root,
  type,
  row,
  { quick = type === "maintenance" } = {},
) {
  const [published, pending] = await Promise.all([
    manifest(),
    data
      .list("images", { filters: [["targetId", "==", row.id]], size: 10 })
      .catch(() => ({ rows: [] })),
  ]);
  let images = [
    ...(published.images || [])
      .filter((img) =>
        img.targetType
          ? img.targetType === type && img.targetId === row.id
          : img.assetId === (row.assetId || row.id),
      )
      .map((img) => ({
        ...img,
        published: true,
        url: `assets/equipment/${encodeURIComponent(img.filename)}`,
      })),
    ...pending.rows
      .filter(
        (img) =>
          !(published.images || []).some((p) => p.filename === img.filename),
      )
      .map((img) => ({ ...img, url: img.dataUrl })),
  ];
  const ordering = row.photoOrder || [];
  images.sort((a, b) => {
    const ai = ordering.indexOf(a.filename),
      bi = ordering.indexOf(b.filename);
    return (
      (ai < 0 ? 100 + (a.order || 0) : ai) -
      (bi < 0 ? 100 + (b.order || 0) : bi)
    );
  });
  root.innerHTML = `<section class="panel"><header class="panel-head"><h2>${quick ? "Operational photos" : "Equipment photography"}</h2><div class="head-actions">${data.can(quick ? "maintenance.write" : "equipment.write") ? '<button class="button-small" data-upload>＋ Add Photos</button>' : ""}</div></header><div class="panel-body"><div class="photo-grid">${images.map((img, i) => `<div class="photo"><img data-view="${i}" src="${esc(img.url)}" alt="${esc(row.name)} photo ${i + 1}" loading="lazy"><div class="photo-controls">${i === 0 ? '<span class="badge">Primary</span>' : ""}<span class="badge ${img.published ? "success" : "warning"}">${img.published ? "Published" : img.purpose === "quick" ? "90-day record" : "Pending publication"}</span>${data.can("equipment.write") ? `<button class="button-small" data-primary="${i}">Set Primary</button>${i > 0 ? `<button class="button-small" data-earlier="${i}" aria-label="Move photo earlier">←</button>` : ""}${!img.published ? `<button class="button-small" data-delete="${i}">Remove</button>` : ""}` : ""}</div><p>${esc(img.filename)}</p></div>`).join("") || empty("No photos", "Add compressed images. Permanent equipment photos can be exported for static publication.")}</div><p class="form-hint">${quick ? "Operational photos are eligible for removal after 90 days; use the website maintenance controls." : "Public static equipment photos must contain no sensitive information. Pending images remain in Firestore until publication is verified."} Limit: 8 pending photos per record, 10 uploads per minute, 20 MB total encoded temporary storage.</p></div></section>`;
  $("[data-upload]", root)?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.multiple = true;
    input.onchange = async () => {
      try {
        if (input.files.length + images.length > 8)
          throw Error("Maximum 8 photos per record.");
        for (const file of input.files) {
          const image = await compress(file);
          await data.operate({
            op: "imageUpload",
            targetType: type,
            targetId: row.id,
            purpose: quick ? "quick" : "permanent",
            ...image,
          });
        }
        toast("Photos saved.");
        await gallery(root, type, row, { quick });
      } catch (e) {
        fail(e);
      }
    };
    input.click();
  });
  $$("[data-view]", root).forEach(
    (b) =>
      (b.onclick = () => {
        const img = images[Number(b.dataset.view)];
        modal(
          "Photo Preview",
          `<img src="${esc(img.url)}" alt="${esc(row.name)}" style="max-width:100%;max-height:70dvh;object-fit:contain">`,
          { wide: true },
        );
      }),
  );
  const orderSave = async (next) => {
    try {
      await data.operate({
        op: "photoOrder",
        targetType: type,
        targetId: row.id,
        filenames: next.map((i) => i.filename),
      });
      row.photoOrder = next.map((i) => i.filename);
      await gallery(root, type, row, { quick });
    } catch (e) {
      fail(e);
    }
  };
  $$("[data-primary]", root).forEach(
    (b) =>
      (b.onclick = () => {
        const next = [...images],
          index = Number(b.dataset.primary);
        const [image] = next.splice(index, 1);
        next.unshift(image);
        orderSave(next);
      }),
  );
  $$("[data-earlier]", root).forEach(
    (b) =>
      (b.onclick = () => {
        const next = [...images],
          index = Number(b.dataset.earlier);
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        orderSave(next);
      }),
  );
  $$("[data-delete]", root).forEach(
    (b) =>
      (b.onclick = async () => {
        const img = images[Number(b.dataset.delete)];
        const reason = await prompt(
          "Remove Temporary Photo",
          "Reason for discarding this photo before publication",
        );
        if (!reason) return;
        try {
          await data.operate({
            op: "imageDelete",
            id: img.id,
            discard: true,
            reason,
          });
          gallery(root, type, row, { quick });
        } catch (e) {
          fail(e);
        }
      }),
  );
}
export async function render(root) {
  if (!data.can("equipment.write")) throw Error("Permission denied.");
  const page = await data.list("images", { size: 100 });
  const pending = page.rows.filter((i) => i.purpose === "permanent");
  root.innerHTML = `<div class="page-head"><div><h1>Image manager</h1><p>Download the photo folder, copy it into your site, and publish.</p></div><div class="head-actions"><button class="primary" id="export-images">Download Site Photos ZIP</button></div></div><div class="notice">Extract the ZIP and copy its <strong>equipment</strong> folder into <span class="mono">public/assets/</span> in your site. Publish the site normally. Backstage automatically reads the included manifest and uses those published photos. No script or admin tool is needed. Downloading keeps the Firestore originals; Verify & Clean Up removes them after checking the published files.</div><div class="stats"><div class="stat"><div class="stat-label">Pending on this page</div><div class="stat-value">${pending.length}</div></div><div class="stat"><div class="stat-label">Encoded temporary usage on page</div><div class="stat-value">${(page.rows.reduce((sum, i) => sum + (i.bytes || 0), 0) / 1024).toFixed(0)} KB</div></div></div><section class="panel">${page.rows.length ? page.rows.map((img) => `<div class="list-row"><img src="${esc(img.dataUrl)}" alt="Pending image" style="width:50px;height:45px;object-fit:cover;border-radius:4px"><div class="grow"><strong>${esc(img.filename)}</strong><small>${esc(img.assetId)} · ${(img.bytes / 1024).toFixed(0)} KB encoded · ${img.purpose === "permanent" ? "Pending publication" : `Expires ${date(img.expiresAt)}`}</small></div>${img.purpose === "permanent" ? `<button class="button-small" data-clean="${img.id}">Verify & Clean Up</button>` : ""}</div>`).join("") : empty("No pending image exports", "Add equipment photos from an asset record. They will appear here for publication.")}</section>${page.hasMore ? '<p class="notice section-gap">More than 100 images. Export processes all pending photos with paginated reads. Cleanup lists the latest 100; refresh after cleanup for older records.</p>' : ""}`;
  $("#export-images", root).onclick = (e) =>
    busy(e.currentTarget, async () => {
      if (!window.JSZip) throw Error("ZIP library is unavailable.");
      const all = await data.queryAll("images", [
        ["purpose", "==", "permanent"],
      ]);

      const zip = new window.JSZip(),
        published = await manifest();
      const entries = new Map(
        (published.images || []).map((img) => [img.filename, img]),
      );
      let total = 0;
      // Include published files too, so the downloaded folder is complete when replaced.
      for (const img of entries.values()) {
        if (!/^[-\w]+\.(webp|png|jpe?g)$/.test(img.filename))
          throw Error("Invalid published photo filename.");
        const response = await fetch(
          `assets/equipment/${encodeURIComponent(img.filename)}`,
          { cache: "no-cache" },
        );
        if (!response.ok)
          throw Error(
            `Published photo ${img.filename} is unavailable. Restore it before exporting a complete folder.`,
          );
        const content = new Uint8Array(await response.arrayBuffer());
        total += content.length;
        if (total > 100000000)
          throw Error("Photo folder exceeds 100 MB. Export smaller groups.");
        if (img.sha256 && (await sha256(content)) !== img.sha256)
          throw Error("A published photo does not match its manifest.");
        zip.file(`equipment/${img.filename}`, content);
      }
      const metadata = [];
      for (const img of all) {
        const content = Uint8Array.from(atob(img.dataUrl.split(",")[1]), (c) =>
          c.charCodeAt(0),
        );
        zip.file(`equipment/${img.filename}`, content);
        const entry = {
          imageId: img.id,
          assetId: img.assetId,
          targetId: img.targetId,
          targetType: img.targetType,
          filename: img.filename,
          width: img.width,
          height: img.height,
          order: img.order,
          sha256: await sha256(content),
        };
        entries.set(img.filename, entry);
        metadata.push(entry);
      }
      zip.file(
        "equipment/manifest.json",
        JSON.stringify(
          {
            version: 1,
            generatedAt: new Date().toISOString(),
            images: [...entries.values()],
          },
          null,
          2,
        ),
      );
      zip.file(
        "metadata.json",
        JSON.stringify({ version: 1, images: metadata }, null, 2),
      );
      zip.file(
        "README.txt",
        "Copy the equipment folder into public/assets/ in your site, then publish normally. The folder includes all available published photos, new photos, and its manifest. Backstage detects them automatically after publication. Downloading does not delete Firestore originals.",
      );
      download(
        "backstage-equipment-images.zip",
        await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
      );
      toast("ZIP exported. Temporary images have been retained.");
    });
  $$("[data-clean]", root).forEach(
    (b) =>
      (b.onclick = () =>
        busy(b, async () => {
          await verifyPublication(
            page.rows.find((img) => img.id === b.dataset.clean),
          );
          await data.operate({
            op: "imageDelete",
            id: b.dataset.clean,
            publicationVerified: true,
          });
          toast("Published image verified; temporary document removed.");
          render(root);
        })),
  );
}
export async function sha256(content) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", content))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPublication(img) {
  if (!img) throw Error("Photo no longer exists.");
  const published = await manifest();
  const entry = published.images?.find(
    (p) => p.filename === img.filename && p.assetId === img.assetId,
  );
  if (!entry)
    throw Error(
      "Publish the downloaded equipment folder first. This photo is not in the published manifest yet.",
    );
  const response = await fetch(
    `assets/equipment/${encodeURIComponent(img.filename)}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw Error(
      "The published photo is unavailable. The original has been retained.",
    );
  const bytes = new Uint8Array(await response.arrayBuffer()),
    original = Uint8Array.from(atob(img.dataUrl.split(",")[1]), (c) =>
      c.charCodeAt(0),
    );
  const hash = await sha256(bytes);
  if (hash !== entry.sha256 || hash !== (await sha256(original)))
    throw Error(
      "The published file differs from the original. Cleanup cancelled.",
    );
}
