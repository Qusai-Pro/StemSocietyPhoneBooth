// Tuning block — ported from its_giving_v2.py. Same names, same meaning.

// Checked top to bottom by decide(); first match wins. Put a new pose above
// anything it might be mistaken for.
export const POSES = [
  "time_out", "heart", "cover_nose", "crashing_out", "dance", "nose_closed", "flirty", "hand_up",
  "tongue_out", "open_mouth", "disgusted", "talking_to_wall", "suspicious", "spin",
];

// One file per pose in assets/. Missing or unreadable -> red placeholder.
export const ASSETS = {
  time_out: "assets/time_out.jpeg",
  heart: "assets/heart.jpeg",
  cover_nose: "assets/cover_nose.jpeg",
  crashing_out: "assets/crashing_out.jpeg",
  dance: "assets/dance.jpeg",
  nose_closed: "assets/nose_closed.gif",
  flirty: "assets/flirty.jpeg",
  hand_up: "assets/hand_up.jpeg",
  tongue_out: "assets/tongue_out.jpeg",
  open_mouth: "assets/open_mouth.jpeg",
  disgusted: "assets/disgusted.jpeg",
  talking_to_wall: "assets/talking_to_wall.gif",
  suspicious: "assets/suspicious.jpeg",
  spin: "assets/spin.gif",
};

// One key per pose, matched by position in POSES: forces it on screen for 2 s.
export const TEST_KEYS = "1234567890-=[]";

// Meme size and placement. The meme floats just above your head as a small
// sticker, so your whole face stays visible next to it.
export const MEME = {
  scale: 0.85,     // sticker height = your face height x this
  maxWidth: 1.15,  // ...and never wider than this many face heights, so wide GIFs stay small too
  gap: 0.04,       // empty space between the top of your head and the sticker, in face heights
  popMs: 220,      // pop-in animation length
};

// How fast the sticker follows you. It moves gently when you're still (no jitter)
// and catches up almost instantly when you move quickly. 0 = never moves, 1 = glued on.
export const SMOOTH = { slow: 0.35, fast: 0.9, ref: 0.25 };   // ref: movement (face widths per frame) that counts as "fast"

// Detection runs on a downscaled copy of the frame (landmarks are normalised, so
// nothing else changes). Much faster on big webcams; 0 = full size.
export const DETECT = { width: 640 };   // detection runs in a worker, so it can afford a bigger picture (better for people standing far back); auto-drops if the PC struggles

// Label, emoji and instructions for each reaction: used by the on-screen guide
// and the comic tag that pops up on the sticker.
export const POSE_INFO = {
  time_out:        { label: "TIME OUT",  emoji: "⏱️", hint: "Make a T: one hand flat on top, one upright underneath" },
  heart:           { label: "AWWW",      emoji: "🫶", hint: "Make a heart with both hands (index tips and thumbs touching)" },
  cover_nose:      { label: "BRUH",      emoji: "🤭", hint: "Cover your nose and mouth with your hands" },
  crashing_out:    { label: "CRASHING OUT", emoji: "🤯", hint: "Both hands on your head and open your mouth wide" },
  dance:           { label: "GIGACHAD",  emoji: "😎", hint: "Both hands behind your head, mouth closed" },
  nose_closed:     { label: "STINKY",    emoji: "🤢", hint: "Pinch your nose shut" },
  flirty:          { label: "FLIRTY",    emoji: "😏", hint: "Touch one fingertip to your lips" },
  hand_up:         { label: "HOLD UP",   emoji: "✋", hint: "Raise one open palm beside your head" },
  tongue_out:      { label: "BLEHHH",    emoji: "😛", hint: "Open your mouth and stick your tongue out" },
  open_mouth:      { label: "GASP!",     emoji: "😮", hint: "Drop your jaw in shock" },
  disgusted:       { label: "EWWW",      emoji: "😖", hint: "Scrunch your nose and frown" },
  talking_to_wall: { label: "YAPPING",   emoji: "🗣️", hint: "Wave a hand back and forth like you're arguing" },
  suspicious:      { label: "SUS...",    emoji: "🤨", hint: "Turn your head and squint" },
  spin:            { label: "BYE!",      emoji: "🌀", hint: "Everyone walk out of the frame" },
};

// Printing: "4x6" paper with the strip printed twice side by side (cut down the
// middle), or "2x6" for a printer that takes a single strip.
export const PRINT = { paper: "4x6", twoUp: true };

export const HOLD_FRAMES = 10;     // linger after the pose stops
export const ARM = {
  spin: 10, suspicious: 5, talking_to_wall: 4, dance: 4, crashing_out: 3,
  open_mouth: 3, tongue_out: 3, disgusted: 3,
};
export const DEFAULT_ARM = 2;

// Sigma above your own neutral face.
// sneer / disgust are lower than the Python's (4.5 / 14): MediaPipe's nose-scrunch
// channel barely moves for most faces, so the old bar was close to unreachable.
export const Z = { jaw_open: 4.5, scream_jaw: 3.0, tongue_jaw: 2.0, sneer: 2.5, disgust: 7.0, squint: 3.0 };
export const Z_CAP = 8.0;
// Before you calibrate, faces vary too much for the lower bar: use the old one.
export const Z_DISGUST_UNCALIBRATED = 14.0;
// ...and a raw floor, so a tiny sigma can't become a hair trigger.
// tongue_jaw is low on purpose: sticking your tongue out barely opens the jaw.
export const FLOOR = { jaw_open: 0.25, scream_jaw: 0.14, tongue_jaw: 0.06, sneer: 0.03, squint: 0.15 };
// tongue: share of the mouth opening (top half included) that is tongue-coloured.
export const T = { tongue: 0.55, head_turn: 0.12, smile: 0.35 };

// talking_to_wall: big, repeated back-and-forth hand movement, not just a hand
// that moves. Distances are in face widths, so it works at any distance; times
// are in seconds, so it behaves the same at 10 fps on a phone or 30 on a laptop.
export const GESTURE = {
  window: 1.5,      // look at the last 1.5 s of hand movement
  jitter: 0.02,     // ignore per-frame wobble smaller than this (tracking noise)
  swing: 0.25,      // a "swing" is a move of at least this far before reversing
  minSwings: 2,     // ...and you need this many in the window (there-and-back, twice)
  speed: 1.1,       // ...with the hand covering at least this many face widths per second
  gap: 0.4,         // fast hands blur and drop out for a frame or two; keep the history this long
};

// Hands over your face often make the face detector lose it. Remember where the
// face was for this long, so hand poses (cover_nose especially) still work.
export const FACE_MEMORY_MS = 700;

export const CALIB = {
  seconds: 5.0,          // Python uses 7; shorter suits a photobooth
  warmup: 1.0,           // ignore the first second while you settle
  minSamples: 30,
  maxSeconds: 12.0,      // slow machines keep collecting past `seconds` until minSamples
  minSamplesSlow: 15,    // ...and if they still haven't got there by maxSeconds, this many will do
  sigmaFloor: 0.015,
  sigmaCeil: 0.080,
  version: 1,
  storageKey: "itsgiving.calibration.v1",
};

export const GENERIC_SIGMA = 0.035;
export const GENERIC_MEAN = {
  jawOpen: 0.08, eyeSquintLeft: 0.10, eyeSquintRight: 0.10,
  eyeBlinkLeft: 0.10, eyeBlinkRight: 0.10, noseSneerLeft: 0.03, noseSneerRight: 0.03,
  browDownLeft: 0.06, browDownRight: 0.06, mouthFrownLeft: 0.05, mouthFrownRight: 0.05,
  mouthUpperUpLeft: 0.05, mouthUpperUpRight: 0.05, mouthStretchLeft: 0.08, mouthStretchRight: 0.08,
};

// Mirror the camera like a selfie (default) or show the true view, where text
// on your shirt reads correctly. Toggle in the page; remembered per browser.
export const MIRROR_DEFAULT = true;

// Phones / tablets (touch-first) get a lighter setup: smaller camera frames and
// GIF frames, so three detectors and ~150 MB of GIF frames don't choke Safari.
export const IS_PHONE = matchMedia("(pointer: coarse)").matches;

// Groups: how many people get tracked at once, and how hands / bodies are
// matched to them (distances in face widths). Phones track fewer people, since
// every extra face, hand and body costs detection time.
// Group mode can be switched off in the page (remembered per browser) for the
// faster one-person setup.
export const GROUP_DEFAULT = true;

export const PEOPLE = {
  max: IS_PHONE ? 3 : 4,
  hands: IS_PHONE ? 4 : 6,   // total hands looked for across everyone
  matchDist: 1.2,            // a face this close to where someone was last frame is still them
  handReach: 2.5,            // a hand belongs to the nearest face within this distance
  bodyReach: 2.5,            // shoulders belong to the nearest face above them within this distance
  poseEvery: 3,              // check bodies (shoulders/elbows) every Nth frame; they move slowly and cost time
};

export const PHOTOBOOTH_CONFIG = {
  camera: IS_PHONE ? { width: 640, height: 480, fps: 60 } : { width: 960, height: 540, fps: 60 },   // fps is a request: webcams that only do 30 stay at 30
  gifMaxSize: IS_PHONE ? 320 : 0,   // longest side of decoded GIF frames; 0 = full size
  boothSequence: { photoCount: 3, countdownSeconds: 5, delayBetweenPhotosMs: 900, memeWaitMs: 3500 },
};

// Pinned and served locally from vendor/ — same reasoning as requirements.txt.
const TASKS_VISION = "1.0.1";
export const MEDIAPIPE = {
  wasmPath: "vendor/tasks-vision/wasm",
  localBundle: "../vendor/tasks-vision/vision_bundle.mjs",   // relative to js/
  cdnBase: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION}`,
  get cdnBundle() { return `${this.cdnBase}/vision_bundle.mjs`; },
  faceModel: "models/face_landmarker.task",
  handModel: "models/hand_landmarker.task",
  poseModel: "models/pose_landmarker_lite.task",
};
