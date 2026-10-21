import { ASSETS, CALIB, DETECT, GESTURE, GROUP_DEFAULT, IS_PHONE, MEDIAPIPE, MIRROR_DEFAULT, PEOPLE, PHOTOBOOTH_CONFIG, POSES, POSE_INFO, TEST_KEYS, Z } from "./config.js";
import { Baseline, Collector, calibrationWarnings } from "./calibration.js";
import { Body, Face, Hand, PoseTracker, decide, measure, over, tongueScore, waving } from "./face.js";
import { People } from "./people.js";
import { loadAssets } from "./assets.js";
import { OverlayRenderer } from "./renderer.js";
import { initGuide } from "./guide.js";
import { composeStrip, loadLogo } from "./strip.js";
import { hideShare, printStrip, serverInfo, showShare, uploadStrip } from "./gallery.js";

const $ = (id) => document.getElementById(id);
const video = $("webcam");
const canvas = $("outputCanvas");
const calibrateBtn = $("calibrateBtn");
const startBoothBtn = $("startBoothBtn");
const downloadBtn = $("downloadBtn");
const statusText = $("statusText");
const countdownOverlay = $("countdownOverlay");
const stripImg = $("stripImg");
const printBtn = $("printBtn");
const qrBtn = $("qrBtn");
const autoPrintToggle = $("autoPrintToggle");
const fullscreenBtn = $("fullscreenBtn");
const flash = $("flash");
const hud = $("hud");
const debugLayer = $("debugCanvas");
const mirrorToggle = $("mirrorToggle");
const groupToggle = $("groupToggle");
const debugBtn = $("debugBtn");
const testPose = $("testPose");

const renderer = new OverlayRenderer(canvas);
const guide = initGuide({ bar: $("emoteBar"), card: $("tryCard"), list: $("poseList"), onPick: (pose) => forcePose(pose) });
const people = new People();
// "spin" (everyone left the frame) belongs to nobody, so it has its own tracker.
const roomTracker = new PoseTracker();
let base = Baseline.load();        // saved calibration (the main person's)
const GENERIC = new Baseline();    // for people nobody calibrated
let lastSpot = null;               // where the last person was, for the spin meme
let worker = null, workerReady = false, inflight = false;   // detection runs in js/detect-worker.js
let mirror = loadMirror();
let group = loadPref("itsgiving.group", GROUP_DEFAULT);
let reconfiguring = false;   // true while the detectors switch between group and solo
let assets = {};
let lastVideoTime = -1;
let lowFpsSeconds = 0, perfLevel = 0;
let calibView = null;       // what the calibration banner shows, updated as detections arrive
let roomShown = null;       // the "everyone left" meme
let lastTs = -1;
let calibration = null;   // { collectors: Map(personId -> Collector), start, seen } while calibrating
let boothRunning = false;
let stripPhotos = [];
let stripCanvas = null, stripBlob = null, logo = null;
let server = null;          // booth_server.py details, or null when it isn't running
let lastShare = null;       // { url, img } for re-opening the QR screen
let fps = 0, fpsFrames = 0, fpsSince = performance.now();
let frameNo = 0, lastBodies = [];

const setStatus = (msg) => { statusText.textContent = msg; };

function readyStatus() {
  return base.generic
    ? "Ready — not calibrated yet, so reactions are harder to trigger. Click 'Calibrate Face' first."
    : `Ready — calibrated ${base.made} on ${base.samples} frames. Pull a face! (Friends joining? Calibrate with everyone in frame.)`;
}

// GPU where the browser allows it, CPU otherwise.
async function create(Task, fileset, modelAssetPath, options) {
  const make = (delegate) => Task.createFromOptions(fileset, {
    baseOptions: { modelAssetPath, delegate }, runningMode: "VIDEO", ...options,
  });
  return make("GPU").catch((e) => {
    console.warn(`GPU delegate failed for ${modelAssetPath}, using CPU:`, e);
    return make("CPU");
  });
}

async function init() {
  // Browsers only allow the camera on https:// pages and localhost.
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus(location.protocol === "file:"
      ? "This page has to be served, not opened as a file. In this folder run:  python3 -m http.server 8000  then open http://localhost:8000"
      : "The camera only works on an https:// link (or localhost). Open the GitHub Pages / https link instead of a plain http:// address.");
    return;
  }

  // Ask for the camera straight away and load the models alongside it, so the
  // permission prompt appears immediately and you see yourself while they load.
  setStatus("Starting the camera…");
  const models = loadModels();
  models.catch(() => {});   // handled below; don't report it twice

  try {
    await startCamera();
  } catch (err) {
    console.error("Camera error:", err);
    const name = err?.name || "";
    if (name === "NotAllowedError") setStatus("Camera permission was denied. Allow camera access for this page and reload.");
    else if (name === "NotFoundError") setStatus("No camera found. Plug one in and reload.");
    else if (name === "NotReadableError") setStatus("The camera is busy in another app (Zoom, OBS, the Python version?). Close it and reload.");
    else setStatus(`Couldn't start the camera: ${err?.message || err}`);
    return;
  }
  requestAnimationFrame(loop);
  if (!workerReady) setStatus("Camera on — loading the face, hand and body models (the first visit downloads about 40 MB)…");

  try {
    await models;
  } catch (err) {
    console.error("Model loading error:", err);
    setStatus(`Couldn't load the models: ${err?.message || err}. Check your connection and reload.`);
    return;
  }
  calibrateBtn.disabled = false;
  startBoothBtn.disabled = false;
  setStatus(readyStatus());
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",   // front camera on phones
      width: { ideal: PHOTOBOOTH_CONFIG.camera.width },
      height: { ideal: PHOTOBOOTH_CONFIG.camera.height },
      frameRate: { ideal: PHOTOBOOTH_CONFIG.camera.fps, max: 60 },   // smoother tracking than the 15-24 fps some webcams default to
    },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 1) resolve();
    else video.addEventListener("loadedmetadata", resolve, { once: true });
  });
  await video.play();
  renderer.resize(video.videoWidth || PHOTOBOOTH_CONFIG.camera.width, video.videoHeight || PHOTOBOOTH_CONFIG.camera.height);
}

// Detection lives in a worker; the page only draws. Resolves once the models are ready.
async function loadModels() {
  const abs = (p) => new URL(p, location.href).href;
  const local = await fetch(`${MEDIAPIPE.wasmPath}/vision_wasm_internal.wasm`, { method: "HEAD" })
    .then((r) => r.ok).catch(() => false);
  const bundle = local ? new URL(MEDIAPIPE.localBundle, import.meta.url).href : MEDIAPIPE.cdnBundle;
  const wasm = local ? abs(MEDIAPIPE.wasmPath) : `${MEDIAPIPE.cdnBase}/wasm`;
  if (!local) console.info(`vendor/tasks-vision not found, using ${MEDIAPIPE.cdnBase}`);

  worker = new Worker(new URL("./detect-worker.js", import.meta.url), { type: "module" });
  const ready = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "ready") { console.info("MediaPipe delegates:", m.delegates); resolve(); }
      else if (m.type === "error" && m.during === "init") reject(new Error(m.message));
      else onWorker(m);
    };
    worker.onerror = (e) => reject(new Error(e.message || "the detection worker failed to start"));
  });
  const models = { face: abs(MEDIAPIPE.faceModel), hand: abs(MEDIAPIPE.handModel), pose: abs(MEDIAPIPE.poseModel) };
  worker.postMessage({ type: "init", bundle, wasm, models, faces: counts().faces, hands: counts().hands });
  const [loadedAssets] = await Promise.all([loadAssets(ASSETS), ready]);
  assets = loadedAssets;
  workerReady = true;
}

function onWorker(m) {
  if (m.type === "result") { inflight = false; onResult(m); }
  else if (m.type === "options") reconfiguring = false;
  else if (m.type === "error") { console.warn("detection error:", m.message); inflight = false; }
}

// ---- the render loop: draws every camera frame, never waits for detection ----

function loop() {
  requestAnimationFrame(loop);
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  // Phone rotated, or the camera changed resolution: follow it.
  if (video.videoWidth && (video.videoWidth !== renderer.W || video.videoHeight !== renderer.H)) {
    renderer.resize(video.videoWidth, video.videoHeight);
  }
  renderer.capture(video, mirror);
  const now = performance.now();

  if (!workerReady || reconfiguring) {   // models loading / switching: just show the camera
    renderer.compose([]);
    return;
  }
  if (calibration && calibView) {
    renderer.compose([]);
    renderer.drawCalibration(calibView.progress, calibView.most, calibView.hasFace, calibView.count);
  } else {
    renderer.compose(currentOverlays(now));
  }

  // Hand the newest frame to the detector whenever it's free (it always works on the latest, never a backlog).
  if (!inflight) {
    inflight = true;
    const withHands = !calibration;
    const withPose = !calibration && frameNo++ % PEOPLE.poseEvery === 0;
    createImageBitmap(renderer.detect(DETECT.width))
      .then((bmp) => worker.postMessage({ type: "detect", bmp, withHands, withPose }, [bmp]))
      .catch(() => { inflight = false; });
  }
}

/** Stickers for this instant: positions ease between detections so they glide at the camera's frame rate. */
function currentOverlays(now) {
  const out = [];
  for (const p of people.list) {
    const shown = p.tracker.shown;
    if (!shown) continue;
    if (!p.disp) p.disp = [...p.center];
    p.disp[0] += (p.center[0] - p.disp[0]) * 0.6;
    p.disp[1] += (p.center[1] - p.disp[1]) * 0.6;
    out.push({ asset: assets[shown], elapsed: now - p.tracker.shownSince, center: p.disp, faceH: p.faceH, label: POSE_INFO[shown]?.label });
  }
  if (roomShown && !people.list.length && lastSpot) {
    out.push({ asset: assets[roomShown], elapsed: now - roomTracker.shownSince, label: POSE_INFO[roomShown]?.label, ...lastSpot });
  }
  return out;
}

// ---- detection results: who is doing what -----------------------------------

function onResult(r) {
  const now = performance.now();
  // Detection speed. A PC that can't keep up quietly gets a smaller detection image and fewer body checks.
  fpsFrames++;
  if (now - fpsSince > 1000) {
    fps = (fpsFrames * 1000) / (now - fpsSince);
    fpsFrames = 0;
    fpsSince = now;
    lowFpsSeconds = !reconfiguring && fps < 12 ? lowFpsSeconds + 1 : 0;
    if (lowFpsSeconds >= 3 && perfLevel < 2) {
      perfLevel++;
      lowFpsSeconds = 0;
      DETECT.width = perfLevel === 1 ? 512 : 416;
      PEOPLE.poseEvery = 4 + perfLevel;
    }
  }

  const { W, H } = renderer;
  const faces = r.faces.map((l, i) => new Face(l, r.blend[i], W, H, mirror));

  if (calibration) {
    people.update(faces, [], [], now);
    stepCalibration(now);
    return;
  }

  const hands = (r.hands || []).map((l) => new Hand(l, W, H));
  if (r.pose) lastBodies = r.pose.map((l) => new Body(l, W, H));
  const bodies = lastBodies;
  people.update(faces, hands, bodies, now);

  // Each person gets judged on their own face, hands and body, with their own meme.
  const active = [];
  for (const p of people.list) {
    const gesture = p.motion.update(p.hands, p.face, now);
    // Face hidden behind hands, or blurring past: keep judging hand poses on where it was.
    const face = p.faceOrGhost(p.hands.length > 0 || waving(gesture));
    const b = baselineFor(p);
    const m = p.face ? measure(p.face, b) : {};
    const tongue = p.face ? tongueScore(renderer.fctx, p.face, p.hands, over("tongue_jaw", m, "z_jaw", "jaw")) : 0;
    const raw = face ? decide(face, p.hands, p.body, tongue, gesture, m) : null;
    const shown = p.tracker.update(raw, now);
    p.debug = { raw, shown, m, tongue, gesture, ghost: !p.face && !!face };
    if (shown) active.push(shown);
    lastSpot = { center: [...p.center], faceH: p.faceH };
  }

  // Everyone gone (no faces, hands or bodies): spin, where the last person was.
  const empty = !people.list.length && !hands.length && !bodies.some((b) => b.seen);
  roomShown = roomTracker.update(empty ? "spin" : null, now);
  if (roomShown && !people.list.length && lastSpot) active.push(roomShown);

  guide.setActive(active);
  if (debugOn()) {
    const claimed = new Set(people.list.flatMap((p) => p.hands));
    renderer.drawDebug(debugLayer, people.list, hands.filter((h) => !claimed.has(h)), bodies);
    drawHud(people.list, hands.length, roomShown);
  }
}

/** Your own calibration if you were in frame for it; otherwise the saved one when you're alone. */
function baselineFor(p) {
  if (p.baseline) return p.baseline;
  return people.list.length === 1 ? base : GENERIC;
}

/** Everyone in frame has a meme on, and it has finished popping in. */
function memeIsReady() {
  const now = performance.now();
  return people.list.length > 0 && people.list.every((p) => p.tracker.shown && now - p.tracker.shownSince > 350);
}

/** Photo booth fallback: anyone without a meme yet gets this one. */
function forceMissing(pose) {
  const now = performance.now();
  for (const p of people.list) if (!p.tracker.shown) p.tracker.force(pose, now, 2500);
}

/** "Preview a meme": show it on everyone in frame (or where the last person was). */
function forcePose(pose) {
  const now = performance.now();
  for (const p of people.list) p.tracker.force(pose, now);
  roomTracker.force(pose, now);
}

const debugOn = () => !hud.classList.contains("hidden");

function setDebug(on) {
  hud.classList.toggle("hidden", !on);
  debugLayer.classList.toggle("hidden", !on);
  debugBtn.setAttribute("aria-pressed", String(on));
  if (!on) debugLayer.getContext("2d").clearRect(0, 0, debugLayer.width, debugLayer.height);
}

// ---- group mode ----------------------------------------------------------
// MediaPipe only skips its search for new faces / hands once it is tracking the
// most it was asked for, so allowing 4 people costs a little every frame even
// when you're alone. Group mode off goes back to the one-person setup.

function counts() {
  return group ? { faces: PEOPLE.max, hands: PEOPLE.hands } : { faces: 1, hands: 2 };
}

function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

async function setGroup(on) {
  group = on;
  groupToggle.checked = on;
  people.max = counts().faces;
  people.reset();
  try { localStorage.setItem("itsgiving.group", on ? "1" : "0"); } catch { /* not persisted */ }
  if (!workerReady) return;   // models not loaded yet: they'll be created with the right counts
  reconfiguring = true;       // cleared when the worker confirms
  worker.postMessage({ type: "options", ...counts() });
}

// ---- mirror ----------------------------------------------------------------

function loadMirror() {
  try {
    const v = localStorage.getItem("itsgiving.mirror");
    return v === null ? MIRROR_DEFAULT : v === "1";
  } catch {
    return MIRROR_DEFAULT;
  }
}

function setMirror(on) {
  mirror = on;
  mirrorToggle.checked = on;
  try { localStorage.setItem("itsgiving.mirror", on ? "1" : "0"); } catch { /* not persisted */ }
  // Positions jump to the other side; start tracking everyone afresh.
  people.reset();
}

// ---- calibration ---------------------------------------------------------

function startCalibration() {
  if (calibration || boothRunning || !workerReady) return;
  calibration = { collectors: new Map(), start: performance.now(), seen: 0 };
  calibView = null;
  calibrateBtn.disabled = true;
  startBoothBtn.disabled = true;
  setStatus(`Everyone in frame: hold a bored face for ${CALIB.seconds} seconds. Blinking is fine — don't talk, smile or raise your eyebrows.`);
}

// Calibrates everyone in frame at once: each person gets their own neutral face.
function stepCalibration(now) {
  const c = calibration;
  const elapsed = (now - c.start) / 1000;
  if (people.list.some((p) => p.face)) c.seen++;
  if (elapsed > CALIB.warmup) {
    for (const p of people.list) {
      if (!p.face || !Object.keys(p.face.bs).length) continue;
      if (!c.collectors.has(p.id)) c.collectors.set(p.id, new Collector());
      c.collectors.get(p.id).add(p.face);
    }
  }
  const most = Math.max(0, ...[...c.collectors.values()].map((k) => k.n));
  // Normally done at CALIB.seconds; a slow machine keeps going until it has enough frames.
  const enough = most >= CALIB.minSamples;
  const progress = enough ? elapsed / CALIB.seconds : Math.min(elapsed / CALIB.seconds, most / CALIB.minSamples);
  calibView = { progress, most, hasFace: people.list.some((p) => p.face), count: people.list.filter((p) => p.face).length };   // drawn by loop()
  if (elapsed < CALIB.seconds || (!enough && elapsed < CALIB.maxSeconds)) return;

  calibration = null;
  calibrateBtn.disabled = false;
  startBoothBtn.disabled = false;
  // Everyone still in frame with enough frames gets their own baseline.
  const done = [];
  // (A slow phone that ran out of time still counts with fewer frames.)
  const need = enough ? CALIB.minSamples : CALIB.minSamplesSlow;
  for (const p of people.list) {
    const k = c.collectors.get(p.id);
    if (k && k.n >= need) {
      p.baseline = k.finish();
      done.push(p);
    }
  }
  if (!done.length) {
    setStatus(`Calibration failed: only ${most} usable frames${c.seen ? "" : " — no face was detected"}. ` +
      "Light your face from the front, sit head-and-shoulders in frame, and try again.");
    return;
  }
  // The biggest face (closest to the camera) is saved for next time.
  const main = done.reduce((a, b) => (b.faceH > a.faceH ? b : a));
  base = main.baseline;
  base.save();
  for (const p of people.list) {
    p.tracker.reset();
    p.motion.reset();
  }
  const warn = calibrationWarnings(base);
  const who = done.length > 1 ? `${done.length} people` : `on ${base.samples} frames`;
  setStatus(warn.length
    ? `Calibrated ${who}, but ${warn.join("; ")}. Consider recalibrating.`
    : `Calibrated ${who}. Pull a face or throw up a hand sign!`);
}

// ---- debug HUD (press D) ------------------------------------------------

function drawHud(list, handCount, roomShown) {
  const f = (v, d = 1) => (v ?? 0).toFixed(d);
  const s = (v) => `${(v ?? 0) >= 0 ? "+" : ""}${f(v)}σ`;
  const lines = [
    `people: ${list.length}/${people.max}${group ? "" : " (group mode off)"}   hands: ${handCount}   detect ${fps.toFixed(0)}/s   ${mirror ? "mirrored" : "true view"}` +
      (roomShown ? `   room: ${roomShown}` : ""),
  ];
  list.forEach((p, i) => {
    const d = p.debug || {}, m = d.m || {}, g = d.gesture || { speed: 0, swings: 0 };
    const b = baselineFor(p);
    lines.push(
      `P${i + 1} showing: ${d.shown || "-"}   raw: ${d.raw || "-"}   face: ${p.face ? "yes" : d.ghost ? "hidden" : "no"}   ` +
        `hands: ${p.hands.length}   elbows up: ${p.body?.elbowsUp ? "Y" : "n"}   ` +
        `${p.baseline ? "own calibration" : b.generic ? "NOT calibrated" : "saved calibration"}`,
    );
    if (i === 0 || list.length <= 2) {
      lines.push(
        `   jaw ${f(m.jaw, 2)} = ${s(m.z_jaw)} / ${Z.jaw_open}   squint ${f(m.squint, 2)} = ${s(m.z_squint)} / ${Z.squint}   ` +
          `tongue ${f(d.tongue, 2)}   turn ${f(m.turn, 2)}   wave ${f(g.speed)}/${GESTURE.speed} fw/s, ${g.swings}/${GESTURE.minSwings} swings`,
        `   disgust ${s(m.z_disgust)} / ${Z.disgust} = 2x sneer ${s(m.z_sneer)} + brow ${s(m.z_brow)} + frown ${s(m.z_frown)} + lip ${s(m.z_lip)} + stretch ${s(m.z_stretch)}   smile ${f(m.smile, 2)}`,
      );
    }
  });
  lines.push(`keys: D debug   C calibrate   M mirror   test: ${POSES.map((p, i) => `${TEST_KEYS[i]} ${p}`).join("  ")}`);
  hud.textContent = lines.join("\n");
}

// ---- photobooth --------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
const photoCount = PHOTOBOOTH_CONFIG.boothSequence.photoCount;

/** Rebuild the strip picture (with empty slots for photos not taken yet) and show it. */
function renderStrip() {
  stripCanvas = composeStrip(stripPhotos, { count: photoCount, logo });
  stripImg.src = stripCanvas.toDataURL("image/jpeg", 0.85);
}

function setActions(enabled) {
  downloadBtn.disabled = printBtn.disabled = qrBtn.disabled = !enabled;
}

async function runBooth() {
  if (boothRunning || calibration) return;
  boothRunning = true;
  hideShare();
  startBoothBtn.disabled = calibrateBtn.disabled = true;
  setActions(false);
  stripPhotos = [];
  stripBlob = null;
  renderStrip();

  const { countdownSeconds, delayBetweenPhotosMs, memeWaitMs } = PHOTOBOOTH_CONFIG.boothSequence;
  // A suggested reaction for each shot (they can do anything; it just gets people started).
  const ideas = shuffle(POSES.filter((p) => p !== "spin")).slice(0, photoCount);
  for (let i = 0; i < photoCount; i++) {
    guide.suggest(ideas[i], `POSE ${i + 1} OF ${photoCount}`);
    setStatus(`Photo ${i + 1} of ${photoCount}: ${POSE_INFO[ideas[i]].label} — ${POSE_INFO[ideas[i]].hint}`);
    countdownOverlay.classList.remove("hidden", "word");
    for (let n = countdownSeconds; n > 0; n--) {
      countdownOverlay.textContent = n;
      await sleep(1000);
    }
    // Nobody wants a photo without a meme: wait until everyone in frame has one on. If someone
    // hasn't managed it, give them the suggested meme so the photo never goes out bare.
    countdownOverlay.textContent = "DO THE POSE!";
    countdownOverlay.classList.add("word");
    setStatus(`Now: ${POSE_INFO[ideas[i]].label}! The photo is taken when your meme pops up.`);
    const waitStart = performance.now();
    let steady = 0, forced = false;
    while (performance.now() - waitStart < memeWaitMs + 8000) {   // hard cap, only matters if no face is found at all
      steady = memeIsReady() ? steady + 1 : 0;
      if (steady >= 3) break;
      if (!forced && performance.now() - waitStart > memeWaitMs) { forced = true; forceMissing(ideas[i]); }
      await sleep(40);
    }
    countdownOverlay.textContent = "CHEESE!";
    const shot = document.createElement("canvas");
    shot.width = canvas.width;
    shot.height = canvas.height;
    shot.getContext("2d").drawImage(canvas, 0, 0);
    stripPhotos.push(shot);
    flash.classList.remove("go");
    void flash.offsetWidth;
    flash.classList.add("go");
    renderStrip();
    await sleep(350);
    countdownOverlay.classList.add("hidden");
    if (i < photoCount - 1) await sleep(delayBetweenPhotosMs);
  }
  guide.release();
  await finishBooth();
}

async function finishBooth() {
  stripBlob = await new Promise((r) => stripCanvas.toBlob(r, "image/jpeg", 0.92));
  boothRunning = false;
  startBoothBtn.disabled = calibrateBtn.disabled = false;
  setActions(true);
  if (IS_PHONE) downloadBtn.textContent = "Save / share strip";
  if (autoPrintToggle.checked) printStrip(stripCanvas);

  const img = stripCanvas.toDataURL("image/jpeg", 0.8);
  if (!server) {
    setStatus("Photo strip complete! Download it, print it, or go again.");
    return;
  }
  setStatus("Photo strip complete! Scan the QR code to get it on your phone.");
  showShare({ state: "uploading", img });
  try {
    const { id } = await uploadStrip(stripBlob);
    lastShare = { url: `${server.lan_url}/g/${id}`, img };
    showShare({ state: "ready", ...lastShare });
  } catch (e) {
    console.warn("Gallery upload failed:", e);
    lastShare = null;
    showShare({ state: "error", img });
  }
}

function downloadStrip() {
  if (!stripBlob) return;
  const blob = stripBlob;
  const name = `stem-society-strip-${Date.now()}.jpg`;
  (async () => {
    // On a phone the share sheet is nicer: "Save Image" puts it straight in Photos.
    if (IS_PHONE && navigator.canShare) {
      const file = new File([blob], name, { type: "image/jpeg" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "STEM Society Meme Booth" });
          return;
        } catch (e) {
          if (e.name === "AbortError") return;   // they closed the sheet
        }
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  })();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// ---- wiring -------------------------------------------------------------

calibrateBtn.addEventListener("click", startCalibration);
startBoothBtn.addEventListener("click", runBooth);
downloadBtn.addEventListener("click", downloadStrip);
printBtn.addEventListener("click", () => stripCanvas && printStrip(stripCanvas));
qrBtn.addEventListener("click", () => (lastShare ? showShare({ state: "ready", ...lastShare }) : showShare({ state: "error", img: stripImg.src })));
$("shareClose").addEventListener("click", hideShare);
$("sharePrint").addEventListener("click", () => stripCanvas && printStrip(stripCanvas));
$("shareDownload").addEventListener("click", downloadStrip);
fullscreenBtn.addEventListener("click", toggleFullscreen);
debugBtn.addEventListener("click", () => setDebug(!debugOn()));
for (const p of POSES) {
  const opt = document.createElement("option");
  opt.value = p;
  opt.textContent = p.replace(/_/g, " ");
  testPose.appendChild(opt);
}
testPose.addEventListener("change", () => {
  if (testPose.value) forcePose(testPose.value);
  testPose.value = "";
});
mirrorToggle.checked = mirror;
groupToggle.checked = group;
people.max = counts().faces;
groupToggle.addEventListener("change", () => setGroup(groupToggle.checked));
mirrorToggle.addEventListener("change", () => setMirror(mirrorToggle.checked));

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "escape") hideShare();
  else if (k === "b") runBooth();
  else if (k === "p") { if (stripBlob) printStrip(stripCanvas); }
  else if (k === "f") toggleFullscreen();
  else if (k === "d") setDebug(!debugOn());
  else if (k === "c") startCalibration();
  else if (k === "m") setMirror(!mirror);
  else {
    const i = TEST_KEYS.indexOf(k);
    if (i >= 0 && i < POSES.length) forcePose(POSES[i]);
  }
});

// Branded strip (empty slots until the first photo) and, if booth_server.py is running, the QR share option.
loadLogo().then((l) => { logo = l; if (!boothRunning) renderStrip(); });
renderStrip();
serverInfo().then((info) => {
  server = info;
  if (!info) return;
  qrBtn.classList.remove("hidden");
  $("galleryLink").classList.remove("hidden");
});

init();
