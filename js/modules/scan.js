import * as data from "../services/data.js";
import { $, esc, fail, toast, busy } from "../utils/dom.js";
import { go } from "../router.js";
export async function render(root, { section, id }) {
  let stream = null,
    timer = null,
    stopped = false;
  const resolve = async (input) => {
    let token = input.trim();
    if (token.includes("#/q/"))
      token = token.split("#/q/")[1].split(/[?\s]/)[0];
    let record;
    if (!/^[a-fA-F0-9]{32}$/.test(token)) {
      if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(token.toUpperCase()))
        throw Error(
          "Enter a printed asset ID, 32-character QR identifier, or Backstage QR URL.",
        );
      record = await data.operate({
        op: "lookupAsset",
        assetId: token.toUpperCase(),
      });
    } else record = await data.get(`qr/${token}`);
    if (!record) throw Error("This QR code is revoked or unavailable.");
    go(`${record.type}/${record.recordId || record.id}`);
  };
  if (section === "q" && id) {
    await resolve(id);
    return;
  }
  root.innerHTML = `<div class="page-head"><div><h1>Scan or enter a code</h1><p>Open equipment, road cases, events, and crew credentials.</p></div></div><div class="split"><section class="panel"><header class="panel-head"><h2>Camera scan</h2></header><div class="panel-body"><video playsinline muted id="scanner-video" style="width:100%;max-height:350px;background:var(--bg);border-radius:5px" hidden></video><p class="notice" id="camera-state">${"BarcodeDetector" in window ? "Start the camera to scan a Backstage QR code." : "This browser does not support QR detection. Use your phone’s camera app to open the QR link, or enter its identifier."}</p><button id="start-camera" ${"BarcodeDetector" in window ? "" : "disabled"}>Start Camera</button><button id="stop-camera" hidden>Stop Camera</button></div></section><section class="panel"><header class="panel-head"><h2>Manual entry</h2></header><div class="panel-body"><form><label>Asset ID, QR identifier, or application URL<input name="code" placeholder="Paste code or URL" required autocomplete="off"></label><div class="form-actions"><button class="primary">Open Record</button></div></form><p class="form-hint">Enter the printed asset ID directly here, or search for a name in the workspace. A QR scan never grants new access.</p></div></section></div>`;
  const stop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    clearTimeout(timer);
    const video = $("#scanner-video", root);
    if (video) {
      video.srcObject = null;
      video.hidden = true;
    }
    $("#start-camera", root).hidden = false;
    $("#stop-camera", root).hidden = true;
  };
  $("#stop-camera", root).onclick = stop;
  $("#start-camera", root).onclick = (e) =>
    busy(e.currentTarget, async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        const video = $("#scanner-video", root);
        video.srcObject = stream;
        video.hidden = false;
        await video.play();
        $("#start-camera", root).hidden = true;
        $("#stop-camera", root).hidden = false;
        $("#camera-state", root).textContent =
          "Point the camera at a Backstage QR code.";
        const detector = new BarcodeDetector({ formats: ["qr_code"] });
        const scan = async () => {
          if (!stream || stopped) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length) {
              stop();
              await resolve(codes[0].rawValue);
              return;
            }
          } catch (e) {
            $("#camera-state", root).textContent = e.message;
          }
          timer = setTimeout(scan, 350);
        };
        scan();
      } catch (e) {
        stop();
        throw Error(
          `Camera unavailable: ${e.message}. Manual entry remains available.`,
        );
      }
    });
  $("form", root).onsubmit = (e) => {
    e.preventDefault();
    busy($("form button", root), () => resolve(e.target.code.value));
  };
  return () => {
    stopped = true;
    stop();
  };
}
