// Builds the vertical photo strip: pixel-art frame, three 4:3 photos, and the
// STEM Society logo and branding underneath. 600 x 1800 px = a standard 2 x 6 in
// booth strip at 300 dpi, so it prints sharp and the preview is the same picture.
import { BRAND, drawOutlined, drawText, textWidth } from "./pixelfont.js";

export const STRIP = { w: 600, h: 1800, logo: "assets/logo.png" };

export function loadLogo() {
  const img = new Image();
  img.src = STRIP.logo;
  return img.decode().then(() => img).catch(() => null);   // no logo file? the strip just skips it
}

const rect = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

/** A box with notched (pixel) corners. */
function notched(g, x, y, w, h, n, color) {
  rect(g, x + n, y, w - 2 * n, h, color);
  rect(g, x, y + n, w, h - 2 * n, color);
}

/** Draw `src` into the box, cropped to fill it (centre crop, like CSS object-fit: cover). */
function cover(g, src, x, y, w, h) {
  const s = Math.max(w / src.width, h / src.height);
  const sw = w / s, sh = h / s;
  g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, x, y, w, h);
}

/**
 * @param photos array of canvases (taken so far); missing ones show an empty slot
 * @param opts   { count, logo (Image|null) }
 */
export function composeStrip(photos, { count = 3, logo = null } = {}) {
  const { w: W, h: H } = STRIP;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";

  // Background: cream with a faint pixel-dot pattern, red pixel frame.
  rect(g, 0, 0, W, H, "#fff");
  notched(g, 0, 0, W, H, 18, BRAND.red);
  notched(g, 14, 14, W - 28, H - 28, 12, BRAND.cream);
  g.fillStyle = BRAND.pink;
  g.globalAlpha = 0.55;
  for (let y = 40; y < H - 40; y += 36) for (let x = 40 + ((y / 36) % 2) * 18; x < W - 40; x += 36) g.fillRect(x, y, 6, 6);
  g.globalAlpha = 1;

  // Header.
  drawOutlined(g, "IT'S GIVING...", W / 2, 54, 6, BRAND.red, BRAND.ink, "center");

  // Photos: 4:3 each, with an ink pixel border.
  const pw = 504, ph = 378, gap = 26, x0 = (W - pw) / 2;
  let y = 130;
  for (let i = 0; i < count; i++) {
    notched(g, x0 - 10, y - 10, pw + 20, ph + 20, 6, BRAND.ink);
    notched(g, x0 - 5, y - 5, pw + 10, ph + 10, 4, BRAND.red);
    if (photos[i]) cover(g, photos[i], x0, y, pw, ph);
    else {
      rect(g, x0, y, pw, ph, BRAND.pink);
      drawText(g, `PHOTO ${i + 1}`, W / 2, y + ph / 2 - 14, 4, BRAND.red, "center");
    }
    y += ph + gap;
  }

  // Footer: logo, hashtag, date.
  const logoD = 300, cy = y - gap + 34;
  const fy = cy + logoD / 2;
  drawText(g, "*", x0 + 30, fy - 20, 7, BRAND.red, "left");
  drawText(g, "*", x0 + pw - 30, fy - 20, 7, BRAND.red, "right");
  if (logo) {
    g.save();
    g.shadowColor = "rgba(27,18,19,.35)";
    g.shadowBlur = 14;
    g.shadowOffsetY = 5;
    g.beginPath();
    g.arc(W / 2, fy, logoD / 2, 0, Math.PI * 2);
    g.fillStyle = "#fff";
    g.fill();
    g.restore();
    g.drawImage(logo, W / 2 - logoD / 2, fy - logoD / 2, logoD, logoD);
  } else {
    drawOutlined(g, "STEM SOCIETY", W / 2, fy - 20, 6, BRAND.red, BRAND.ink, "center");
  }
  const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  const tag = "#STEMSOCIETY";
  drawText(g, tag, W / 2, fy + logoD / 2 + 26, 4, BRAND.dark, "center");
  drawText(g, date, W / 2, fy + logoD / 2 + 26 + 7 * 4 + 14, 3, BRAND.red, "center");
  return c;
}

export { textWidth };
