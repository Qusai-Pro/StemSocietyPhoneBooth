// MediaPipe runs here, in a worker, so detection never blocks the page: the live
// video and stickers keep drawing at the camera's full speed however many people
// are in frame. The page sends a frame; this answers with raw landmarks.
//
// Messages in:   init { bundle, wasm, models, faces, hands }
//                options { faces, hands }
//                detect { bmp, withHands, withPose }      (bmp: ImageBitmap, transferred)
// Messages out:  ready { delegates } | options | result { faces, blend, hands, pose, ms } | error { message }

let Face, Hand, Pose;
let ts = 0;
const nextTs = () => (ts = Math.max(Math.round(performance.now()), ts + 1));

// GPU where the browser allows it inside a worker, CPU otherwise.
async function create(Task, fileset, modelAssetPath, options, delegates, name) {
  const make = (delegate) => Task.createFromOptions(fileset, {
    baseOptions: { modelAssetPath, delegate }, runningMode: "VIDEO", ...options,
  });
  try {
    const t = await make("GPU");
    delegates[name] = "GPU";
    return t;
  } catch (e) {
    delegates[name] = "CPU";
    return make("CPU");
  }
}

// A touch more forgiving than the defaults (0.5): people standing further back, or
// partly hidden behind a hand, keep being tracked instead of flickering in and out.
const CONF = 0.35;

async function init({ bundle, wasm, models, faces, hands }) {
  const mp = await import(bundle);
  const fileset = await mp.FilesetResolver.forVisionTasks(wasm);
  // MediaPipe loads its WebAssembly loader with importScripts(), which module workers don't have, and the
  // fallback doesn't expose the loader's global. So run the loader here ourselves first; MediaPipe then finds it.
  const loader = await (await fetch(fileset.wasmLoaderPath)).text();
  (0, eval)(loader);
  const delegates = {};
  [Face, Hand, Pose] = await Promise.all([
    create(mp.FaceLandmarker, fileset, models.face, {
      numFaces: faces, outputFaceBlendshapes: true,
      minFaceDetectionConfidence: CONF, minFacePresenceConfidence: CONF, minTrackingConfidence: CONF,
    }, delegates, "face"),
    create(mp.HandLandmarker, fileset, models.hand, {
      numHands: hands,
      minHandDetectionConfidence: CONF, minHandPresenceConfidence: CONF, minTrackingConfidence: CONF,
    }, delegates, "hand"),
    create(mp.PoseLandmarker, fileset, models.pose, {
      numPoses: faces,
      minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
    }, delegates, "pose"),
  ]);
  // The first detection compiles GPU programs and can stall; do it now on a blank frame.
  const warm = new OffscreenCanvas(320, 240);
  warm.getContext("2d").fillRect(0, 0, 320, 240);
  for (const t of [Face, Hand, Pose]) t.detectForVideo(warm, nextTs());
  postMessage({ type: "ready", delegates });
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") return await init(m);
    if (m.type === "options") {
      await Promise.all([Face.setOptions({ numFaces: m.faces }), Hand.setOptions({ numHands: m.hands }), Pose.setOptions({ numPoses: m.faces })]);
      return postMessage({ type: "options" });
    }
    if (m.type === "detect") {
      const t0 = performance.now();
      const t = nextTs();
      const fr = Face.detectForVideo(m.bmp, t);
      const hr = m.withHands ? Hand.detectForVideo(m.bmp, t) : null;
      const pr = m.withPose ? Pose.detectForVideo(m.bmp, t) : null;
      m.bmp.close();
      postMessage({
        type: "result",
        faces: fr.faceLandmarks || [],
        blend: (fr.faceBlendshapes || []).map((b) => ({ categories: b.categories.map((c) => ({ categoryName: c.categoryName, score: c.score })) })),
        hands: hr ? hr.landmarks || [] : null,
        pose: pr ? pr.landmarks || [] : null,
        ms: performance.now() - t0,
      });
    }
  } catch (err) {
    postMessage({ type: "error", message: String(err && err.message ? err.message : err), during: m.type });
    if (m.type === "detect") { try { m.bmp.close(); } catch { /* already closed */ } }
  }
};
