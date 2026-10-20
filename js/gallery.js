// Everything that happens after the strip is made: upload it to the booth PC's
// local server, show a QR code so people can grab it on their phones, and print.
//
// The server side is booth_server.py. Without it (plain `http.server`, GitHub
// Pages) serverInfo() returns null and the page just offers Download / Print.
import { PRINT } from "./config.js";
import { drawQR } from "./qr.js";

const $ = (id) => document.getElementById(id);

/** Ask the booth server who it is. null = no booth server here. */
export async function serverInfo() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch("api/info", { cache: "no-store", signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.booth ? j : null;
  } catch {
    return null;
  }
}

/** Send the finished strip (a JPEG blob) to the server. Resolves { id }. */
export async function uploadStrip(blob) {
  const r = await fetch("api/upload", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
  if (!r.ok) throw new Error(`upload failed (${r.status})`);
  return r.json();
}

/**
 * The share screen. state: "uploading" | "ready" | "error".
 * ready needs `url` (what the QR points at); `img` is a preview picture.
 */
export function showShare({ state, url = "", img = "", message = "" }) {
  const modal = $("shareModal");
  modal.classList.remove("hidden");
  modal.dataset.state = state;
  if (img) $("shareImg").src = img;
  $("shareMsg").textContent = state === "uploading" ? "Saving your strip…"
    : state === "error" ? message || "Couldn't save to the gallery. You can still download or print it."
    : "Scan with your phone camera to get your strip";
  $("shareUrl").textContent = state === "ready" ? url : "";
  $("qrCanvas").classList.toggle("hidden", state !== "ready");
  if (state === "ready") drawQR($("qrCanvas"), url, { size: 300, quiet: 2 });
}

export const hideShare = () => $("shareModal").classList.add("hidden");

/**
 * Print the strip through the browser's print dialog (or silently, if Chrome was
 * started with --kiosk-printing). PRINT.paper "4x6" prints it twice side by side
 * on 4x6 photo paper; cut down the middle. "2x6" prints one strip per page.
 */
export function printStrip(canvas) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const twoUp = PRINT.paper === "4x6" && PRINT.twoUp;
    const page = PRINT.paper === "4x6" ? "4in 6in" : "2in 6in";
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Photo strip</title><style>
      @page { size: ${page}; margin: 0 }
      html, body { margin: 0; padding: 0; background: #fff }
      .sheet { display: flex; width: ${PRINT.paper === "4x6" ? "4in" : "2in"}; height: 6in; overflow: hidden }
      img { width: 2in; height: 6in; display: block; flex: none }
    </style></head><body><div class="sheet"><img src="${url}">${twoUp ? `<img src="${url}">` : ""}</div></body></html>`);
    doc.close();
    const go = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000);
    };
    const img = doc.querySelector("img");
    if (img.complete) go();
    else img.addEventListener("load", go, { once: true });
  }, "image/jpeg", 0.95);
}
