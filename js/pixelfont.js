// A 5x7 pixel font drawn with plain rectangles, so the lettering matches the
// STEM Society logo and needs no font file, even offline. Used for the comic
// tags over stickers and for all the text on the photo strip.

export const BRAND = { red: "#e5584f", dark: "#b83a35", ink: "#1b1213", cream: "#fff7f4", pink: "#f7c9c4" };

const RAW = {
  A: ".###./#...#/#...#/#####/#...#/#...#/#...#", B: "####./#...#/#...#/####./#...#/#...#/####.",
  C: ".###./#...#/#..../#..../#..../#...#/.###.", D: "####./#...#/#...#/#...#/#...#/#...#/####.",
  E: "#####/#..../#..../####./#..../#..../#####", F: "#####/#..../#..../####./#..../#..../#....",
  G: ".###./#...#/#..../#.###/#...#/#...#/.####", H: "#...#/#...#/#...#/#####/#...#/#...#/#...#",
  I: ".###./..#../..#../..#../..#../..#../.###.", J: "..###/...#./...#./...#./...#./#..#./.##..",
  K: "#...#/#..#./#.#../##.../#.#../#..#./#...#", L: "#..../#..../#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#", N: "#...#/##..#/#.#.#/#..##/#...#/#...#/#...#",
  O: ".###./#...#/#...#/#...#/#...#/#...#/.###.", P: "####./#...#/#...#/####./#..../#..../#....",
  Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#", R: "####./#...#/#...#/####./#.#../#..#./#...#",
  S: ".####/#..../#..../.###./....#/....#/####.", T: "#####/..#../..#../..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/#...#/#...#/.###.", V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#", X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
  Y: "#...#/#...#/.#.#./..#../..#../..#../..#..", Z: "#####/....#/...#./..#../.#.../#..../#####",
  0: ".###./#...#/#..##/#.#.#/##..#/#...#/.###.", 1: "..#../.##../..#../..#../..#../..#../.###.",
  2: ".###./#...#/....#/...#./..#../.#.../#####", 3: "####./....#/....#/.###./....#/....#/####.",
  4: "...#./..##./.#.#./#..#./#####/...#./...#.", 5: "#####/#..../####./....#/....#/#...#/.###.",
  6: "..##./.#.../#..../####./#...#/#...#/.###.", 7: "#####/....#/...#./..#../.#.../.#.../.#...",
  8: ".###./#...#/#...#/.###./#...#/#...#/.###.", 9: ".###./#...#/#...#/.####/....#/...#./.##..",
  "!": "..#../..#../..#../..#../..#../...../..#..", "?": ".###./#...#/....#/...#./..#../...../..#..",
  ".": "...../...../...../...../...../.##../.##..", ",": "...../...../...../...../..##./...#./..#..",
  ":": "...../.##../.##../...../.##../.##../.....", "-": "...../...../...../#####/...../...../.....",
  "'": "..#../..#../.#.../...../...../...../.....", "&": ".##../#..#./#.#../.#.../#.#.#/#..#./.##.#",
  "+": "...../..#../..#../#####/..#../..#../.....", "/": "....#/....#/...#./..#../.#.../#..../#....",
  "#": ".#.#./#####/.#.#./.#.#./#####/.#.#./.....", "*": ".#.#./#####/#####/#####/.###./..#../.....",   // * = heart
  " ": "...../...../...../...../...../...../.....",
};
const GLYPHS = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, v.split("/")]));

const rect = (g, x, y, w, h) => g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));

/** Width in canvas pixels of `text` at `px` canvas pixels per font pixel. */
export const textWidth = (text, px) => Math.max(0, text.length * 6 - 1) * px;

export function drawText(g, text, x, y, px, color, align = "left") {
  const w = textWidth(text, px);
  if (align === "center") x -= w / 2;
  else if (align === "right") x -= w;
  g.fillStyle = color;
  [...text.toUpperCase()].forEach((ch, i) => {
    const rows = GLYPHS[ch] || GLYPHS["?"];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (rows[r][c] === "#") rect(g, x + (i * 6 + c) * px, y + r * px, px, px);
    }
  });
}

/** Text with a chunky ink outline (reads on any background). */
export function drawOutlined(g, text, x, y, px, color, outline = BRAND.ink, align = "left") {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
    drawText(g, text, x + dx * px, y + dy * px, px, outline, align);
  }
  drawText(g, text, x, y, px, color, align);
}

/** Size of a pixel tag around `text`. */
export function tagSize(text, px) {
  return { w: textWidth(text, px) + 8 * px, h: 7 * px + 6 * px };
}

/** The comic tag: a notched red label with an ink border and a pixel drop shadow. */
export function drawTag(g, text, cx, top, px) {
  const { w, h } = tagSize(text, px);
  const x = cx - w / 2;
  const notched = (x0, y0, w0, h0, color) => {
    g.fillStyle = color;
    rect(g, x0 + px, y0, w0 - 2 * px, h0);
    rect(g, x0, y0 + px, w0, h0 - 2 * px);
  };
  notched(x + px, top + px, w, h, "rgba(27, 18, 19, 0.4)");   // shadow
  notched(x, top, w, h, BRAND.ink);
  notched(x + px, top + px, w - 2 * px, h - 2 * px, BRAND.red);
  drawText(g, text, cx, top + 3 * px, px, BRAND.cream, "center");
  return { w, h };
}
