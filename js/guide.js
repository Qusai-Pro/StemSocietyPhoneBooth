// The on-screen guide that tells people what to act. It lives in the page (HTML
// on top of the video), not in the canvas, so it never ends up in a photo.
//
//   emote bar  — one chip per reaction (meme thumbnail + emoji + name). The chip
//                lights up while someone is doing that reaction; tap one to
//                preview its meme.
//   try card   — "TRY THIS": cycles through the reactions with a one-line how-to.
//                The photo booth takes it over to suggest a pose for each shot.
import { ASSETS, POSES, POSE_INFO } from "./config.js";

const CYCLE_MS = 4500;

export function initGuide({ bar, card, list, onPick }) {
  const chips = new Map();
  for (const pose of POSES) {
    const info = POSE_INFO[pose];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.title = `${info.label}: ${info.hint}`;
    chip.innerHTML = `<span class="thumb"><img alt="" src="${ASSETS[pose]}" loading="eager" draggable="false"><i>${info.emoji}</i></span><b>${info.label}</b>`;
    chip.addEventListener("click", () => { show(pose); hold(8000); onPick?.(pose); });
    bar.appendChild(chip);
    chips.set(pose, chip);

    if (list) {   // the how-to list under the stage
      const li = document.createElement("li");
      li.innerHTML = `<span>${info.emoji}</span><div><b>${info.label}</b> ${info.hint}</div>`;
      list.appendChild(li);
    }
  }

  const el = {
    img: card.querySelector(".try-img"), emoji: card.querySelector(".try-emoji"),
    label: card.querySelector(".try-label"), hint: card.querySelector(".try-hint"),
    kicker: card.querySelector(".try-kicker"),
  };
  let idx = -1, pausedUntil = 0, pinned = false, lastActive = "";

  function show(pose, kicker = "TRY THIS") {
    const info = POSE_INFO[pose];
    el.img.src = ASSETS[pose];
    el.emoji.textContent = info.emoji;
    el.label.textContent = info.label;
    el.hint.textContent = info.hint;
    el.kicker.textContent = kicker;
    card.classList.remove("swap");
    void card.offsetWidth;          // restart the little pop animation
    card.classList.add("swap");
    idx = POSES.indexOf(pose);
  }
  const hold = (ms) => { pausedUntil = performance.now() + ms; };

  function next() {
    if (pinned || performance.now() < pausedUntil) return;
    const options = POSES.filter((p) => p !== "spin");   // "walk out of frame" is a bad thing to suggest
    show(options[(options.indexOf(POSES[idx]) + 1) % options.length]);
  }
  next();
  setInterval(next, CYCLE_MS);

  return {
    /** Light up the chips for the reactions currently on screen. */
    setActive(poses) {
      const key = [...poses].sort().join(",");
      if (key === lastActive) return;
      lastActive = key;
      for (const [pose, chip] of chips) chip.classList.toggle("on", poses.includes(pose));
    },
    /** The booth takes over the card to suggest a pose for the next shot. */
    suggest(pose, kicker) {
      pinned = true;
      show(pose, kicker);
    },
    release() {
      pinned = false;
      hold(2500);
    },
  };
}
