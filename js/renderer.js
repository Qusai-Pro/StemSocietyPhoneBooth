// Draws the mirrored camera frame and the meme on top of it.
//
// The mirror happens *in the canvas*, not with CSS, so meme text always reads
// the right way round and the photos you save match what you saw. Turning the
// mirror off gives the true view, where text on your clothes reads correctly.
import { MEME } from "./config.js";
import { BRAND, drawTag, tagSize } from "./pixelfont.js";

const PERSON_COLOURS = ["#22c55e", "#f59e0b", "#ec4899", "#38bdf8"];

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export class OverlayRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    // Clean mirrored frame: what MediaPipe sees and what the tongue check reads.
    this.frame = document.createElement("canvas");
    this.fctx = this.frame.getContext("2d", { willReadFrequently: true });
    // Downscaled copy handed to MediaPipe (much cheaper than a 720p frame).
    this.small = document.createElement("canvas");
    this.sctx = this.small.getContext("2d");
    this.resize(canvas.width, canvas.height);
  }

  resize(W, H) {
    this.canvas.width = this.frame.width = W;
    this.canvas.height = this.frame.height = H;
    this.W = W;
    this.H = H;
  }

  /** The frame MediaPipe looks at: the clean frame shrunk to `maxW` wide (or as is if already smaller). */
  detect(maxW) {
    if (!maxW || this.W <= maxW) return this.frame;
    const w = maxW, h = Math.round((this.H * maxW) / this.W);
    if (this.small.width !== w || this.small.height !== h) {
      this.small.width = w;
      this.small.height = h;
    }
    this.sctx.drawImage(this.frame, 0, 0, w, h);
    return this.small;
  }

  /** Copy the webcam into the clean frame (mirrored like a selfie, or not). */
  capture(video, mirror) {
    const g = this.fctx;
    g.save();
    if (mirror) g.setTransform(-1, 0, 0, 1, this.W, 0);
    g.drawImage(video, 0, 0, this.W, this.H);
    g.restore();
    return this.frame;
  }

  /**
   * Composite the clean frame + one sticker per person onto the visible canvas.
   * `overlays`: [{ asset, elapsed, center: [x, y], faceH, label }] — positions already smoothed.
   * The sticker floats just above the head (face stays visible), pops in, bobs
   * slightly, and carries a pixel comic tag with the reaction's name.
   */
  compose(overlays = []) {
    const { ctx, W, H } = this;
    ctx.drawImage(this.frame, 0, 0);
    for (const o of overlays) if (o.asset) this.sticker(o);
  }

  sticker({ asset, elapsed, center, faceH, label }) {
    const { ctx, W, H } = this;
    const sprite = asset.frameAt(elapsed);
    let h = Math.min(faceH * MEME.scale, (faceH * MEME.maxWidth) / asset.aspect, H * 0.5);
    h = Math.max(36, h);
    let w = h * asset.aspect;

    // Pop-in: overshoots a little, then settles.
    const t = Math.min(1, elapsed / MEME.popMs);
    const pop = t >= 1 ? 1 : 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
    const k = 0.5 + 0.5 * Math.min(pop, 1.12);
    w *= k;
    h *= k;

    const pad = Math.max(3, h * 0.04);                      // white sticker border
    const px = Math.max(2, Math.min(4, Math.floor((w * 1.2) / ((label?.length || 4) * 6 + 8))));
    const tag = label ? tagSize(label, px) : { w: 0, h: 0 };
    const bob = Math.sin(elapsed / 260) * faceH * 0.012;
    let x = center[0] - w / 2;
    let y = center[1] - faceH / 2 - MEME.gap * faceH - h + bob;
    // Keep it on screen (at the very top it slides down over the forehead rather than off the frame).
    x = Math.min(Math.max(x, pad + 2), W - w - pad - 2);
    y = Math.max(y, pad + tag.h * 0.6 + 4);
    y = Math.min(y, H - h - pad - 2);

    const r = Math.max(4, h * 0.08);
    ctx.save();
    // Soft shadow, white border, thin red outline.
    ctx.shadowColor = "rgba(27, 18, 19, 0.45)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = "#fff";
    roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, r + pad);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 2;
    ctx.strokeStyle = BRAND.red;
    ctx.stroke();
    // The meme itself, clipped to rounded corners.
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.drawImage(sprite, x, y, w, h);
    ctx.restore();

    if (label) drawTag(ctx, label, x + w / 2, y - pad - tag.h * 0.6, px);
  }

  /** Debug marks on a separate layer, so they never end up in a photo. */
  drawDebug(debugCanvas, people, strayHands = [], bodies = []) {
    if (debugCanvas.width !== this.W || debugCanvas.height !== this.H) {
      debugCanvas.width = this.W;
      debugCanvas.height = this.H;
    }
    const g = debugCanvas.getContext("2d");
    g.clearRect(0, 0, this.W, this.H);
    const dot = (p, r, colour) => {
      g.fillStyle = colour;
      g.beginPath();
      g.arc(p[0], p[1], r, 0, Math.PI * 2);
      g.fill();
    };
    for (const b of bodies) if (b.seen) for (const p of [...b.shoulders, ...b.elbows]) dot(p, 7, "#60a5fa");
    for (const h of strayHands) dot(h.palm, 8, "#94a3b8");   // hands nobody claimed
    people.forEach((person, i) => {
      const colour = PERSON_COLOURS[i % PERSON_COLOURS.length];
      const f = person.anchor;
      const [x0, y0, x1, y1] = f.box;
      g.strokeStyle = colour;
      g.lineWidth = 3;
      g.setLineDash(person.face ? [] : [8, 6]);   // dashed = hidden / remembered
      g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      g.setLineDash([]);
      g.fillStyle = colour;
      g.font = "bold 22px sans-serif";
      g.fillText(`P${i + 1}`, x0 + 4, y0 - 8);
      dot(f.nose, 4, colour);
      dot(f.mouth, 4, colour);
      for (const h of person.hands) {
        dot(h.palm, 9, colour);
        dot(h.thumb, 5, "#38bdf8");
        dot(h.index, 5, "#f472b6");
      }
    });
  }

  drawCalibration(progress, samples, hasFace, count = 1) {
    const { ctx, W } = this;
    ctx.fillStyle = "rgba(27, 18, 19, 0.82)";
    ctx.fillRect(0, 0, W, 96);
    ctx.fillStyle = "#fff";
    ctx.font = "600 26px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText("CALIBRATING — hold a bored face", 18, 38);
    ctx.font = "600 18px 'Plus Jakarta Sans', sans-serif";
    ctx.fillStyle = hasFace ? "#cbd5e1" : "#fb923c";
    const who = count > 1 ? `${count} people   ` : "";
    ctx.fillText(`${who}${samples} frames${hasFace ? "" : "   NO FACE"}`, 18, 68);
    ctx.fillStyle = BRAND.red;
    ctx.fillRect(0, 84, W * Math.min(progress, 1), 12);
  }
}
