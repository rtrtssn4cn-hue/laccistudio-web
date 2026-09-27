// Lacci Studio — customer design drawing rules.
//
// One set of rules draws a customer's design everywhere it appears: the live editor, the preview
// saved with the order, the cart thumbnail, the orders page and the production print file. Every
// position is stored as a fraction of the product's print area,
// so the same record draws the same composition at any screen size.
//
// Print areas: "rect" is a fraction of the (square) mockup photo; "print" is the physical size in
// inches used for the production file. Physical sizes are the studio's working estimates and can be
// overridden per product in content/products.json with "printAreas".

export const FONT_NAMES = ["Script / Cursive", "Serif / Classic", "Sans-serif / Modern", "Handwritten", "Bold / Block", "Monogram"];
export function fontFamily(name) {
  if (/Script|Handwritten/.test(name || "")) return "'Pinyon Script', cursive";
  if (/Sans|Bold|Block/.test(name || "")) return "'Montserrat', sans-serif";
  return "'Cormorant Garamond', serif";
}
export const TEXT_SWATCHES = [
  { name: "Black", hex: "#141414" }, { name: "White", hex: "#FFFFFF" }, { name: "Gold", hex: "#D79D41" },
  { name: "Silver", hex: "#C9C9C9" }, { name: "Rose Gold", hex: "#B76E79" }, { name: "Red", hex: "#C0392B" },
  { name: "Navy", hex: "#1F3A5F" }, { name: "Pink", hex: "#E79BB0" }, { name: "Green", hex: "#2E7D54" },
];
export const swatchName = (hex) => (TEXT_SWATCHES.find((s) => s.hex.toLowerCase() === String(hex || "").toLowerCase()) || {}).name || "";

const A = (id, label, rect, print, extra) => ({ id, label, rect, print: { dpi: 300, ...print }, shape: "rect", ...extra });
const DEFAULT_AREAS = {
  "sublimation-tumbler": [A("main", "Wrap", { x: 0.345, y: 0.24, w: 0.23, h: 0.46 }, { widthIn: 3.8, heightIn: 7.6 },
    { printBy: { Size: { "30 oz": { widthIn: 4.3, heightIn: 8.6 }, "40 oz": { widthIn: 4.5, heightIn: 9 } } } })],
  "sublimation-mug": [A("main", "Front", { x: 0.13, y: 0.24, w: 0.44, h: 0.44 }, { widthIn: 3.5, heightIn: 3.5 },
    { printBy: { Size: { "15 oz": { widthIn: 3.8, heightIn: 3.8 } } } })],
  "apparel-t-shirt": [
    A("front", "Front", { x: 0.33, y: 0.2, w: 0.34, h: 0.4 }, { widthIn: 12, heightIn: 14 }, { mockupSuffix: "-front" }),
    A("back", "Back", { x: 0.33, y: 0.18, w: 0.34, h: 0.4 }, { widthIn: 12, heightIn: 14 }, { mockupSuffix: "-back" })],
  "apparel-hoodie": [
    A("front", "Front", { x: 0.36, y: 0.3, w: 0.28, h: 0.25 }, { widthIn: 11, heightIn: 10 }, { mockupSuffix: "-front" }),
    A("back", "Back", { x: 0.33, y: 0.32, w: 0.34, h: 0.4 }, { widthIn: 12, heightIn: 14 }, { mockupSuffix: "-back" })],
  "apparel-tote-bag": [A("main", "Front", { x: 0.3, y: 0.45, w: 0.36, h: 0.4 }, { widthIn: 10, heightIn: 11.1 })],
  "gift-fridge-magnet": [A("main", "Magnet", { x: 0.12, y: 0.1, w: 0.76, h: 0.76 }, { widthIn: 3, heightIn: 3 })],
  "gift-socks": [A("main", "Socks", { x: 0.25, y: 0.08, w: 0.5, h: 0.42 }, { widthIn: 7, heightIn: 5.9 })],
  "gift-mouse-pad": [A("main", "Mouse pad", { x: 0.08, y: 0.15, w: 0.84, h: 0.7 }, { widthIn: 9.25, heightIn: 7.7 })],
  // Centred on the coaster face in the photos (centre 46.5% across, 47.3% down; the shadow sits to the right)
  "ceramic-coasters": [A("main", "Coaster", { x: 0.085, y: 0.093, w: 0.76, h: 0.76 }, { widthIn: 4, heightIn: 4 },
    { shape: "ellipse", shapeBy: { Shape: { Square: { shape: "rect", rect: { x: 0.084, y: 0.093, w: 0.76, h: 0.76 } } } } })],
  "custom-stickers": [A("main", "Sticker", { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }, { widthIn: 3, heightIn: 3 },
    { base: "sticker", printFromOption: "Size" })],
};
const GENERIC_AREA = A("main", "Design", { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, { widthIn: 8, heightIn: 8 });

// The print areas in use for a product with the chosen options.
// Print location (apparel): Front only → front, Back only → back, Front and back → both.
export function areasFor(product, options) {
  const opts = options || {};
  const defs = (product && Array.isArray(product.printAreas) && product.printAreas.length ? product.printAreas : DEFAULT_AREAS[product && product.id]) || [GENERIC_AREA];
  let list = defs;
  const loc = opts["Print location"];
  if (defs.length > 1) {
    if (/^Back only/.test(loc || "")) list = defs.filter((a) => a.id === "back");
    else if (/^Front and back/.test(loc || "")) list = defs;
    else list = defs.filter((a) => a.id === "front");
    if (!list.length) list = [defs[0]];
  }
  return list.map((a) => {
    const out = { ...a, rect: { ...a.rect }, print: { ...a.print } };
    for (const [label, byChoice] of Object.entries(a.shapeBy || {})) Object.assign(out, byChoice[opts[label]] || {});
    for (const [label, byChoice] of Object.entries(a.printBy || {})) Object.assign(out.print, byChoice[opts[label]] || {});
    if (a.printFromOption) {
      const m = /(\d+(?:\.\d+)?)\s*inch/i.exec(opts[a.printFromOption] || "");
      if (m) out.print.widthIn = out.print.heightIn = Number(m[1]);
    }
    out.mockup = mockupFor(product, opts, out);
    return out;
  });
}

// Mockup photo for one area: the chosen variant photo (e.g. square coaster) or the product mockup,
// with the side suffix for apparel (-front / -back).
export function mockupFor(product, options, area) {
  if (area.base === "sticker") return "";
  let src = product.mockupPhoto || "";
  for (const g of product.optionGroups || []) {
    const c = (g.choices || []).find((x) => x && typeof x === "object" && x.name === (options || {})[g.label] && x.img);
    if (c) src = c.img;
  }
  if (area.mockupSuffix && src) src = src.replace(/(\.png)(\?.*)?$/i, area.mockupSuffix + "$1$2");
  return src;
}

// ---------------------------------------------------------------- images
const cache = new Map();
export function loadImage(src) {
  if (!src) return Promise.reject(new Error("no image"));
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/.test(src) && !src.startsWith(location.origin)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => { cache.delete(src); reject(new Error("image failed")); };
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

// Near-white pixels made transparent so artwork sits cleanly on the product (preview only; the
// original upload is what gets printed).
// Removes a plain background: the single colour (white, black or any other) that surrounds the
// artwork along its edges. Only background connected to the edges is cleared, so white letters or
// details inside a design stay. A picture whose edges are not one colour (a photo of a scene) is left
// unchanged and marked bgKind "busy"; one already transparent at the edges is marked "transparent".
// maxSide limits the working size: the preview uses 2200, the print file the full picture.
export function removeWhite(img, maxSide = 2200) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
  c.bgKind = "none";
  let id;
  try { id = ctx.getImageData(0, 0, w, h); } catch { return c; } // cross-origin image without CORS: shown as is
  const d = id.data, edge = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
  let clear = 0;
  for (const p of edge) if (d[p * 4 + 3] < 16) clear++;
  if (clear > edge.length * 0.3) { c.bgKind = "transparent"; return c; }
  const med = [0, 1, 2].map((k) => { const v = edge.map((p) => d[p * 4 + k]).sort((m, n) => m - n); return v[v.length >> 1]; });
  const diff = (p) => Math.max(Math.abs(d[p * 4] - med[0]), Math.abs(d[p * 4 + 1] - med[1]), Math.abs(d[p * 4 + 2] - med[2]));
  const T1 = 34, T2 = 64; // same colour up to T1 (JPEG noise); T1–T2 is the soft edge
  let same = 0;
  for (const p of edge) if (diff(p) <= T1) same++;
  if (same < edge.length * 0.6) { c.bgKind = "busy"; return c; }
  const seen = new Uint8Array(w * h), stack = [];
  for (const p of edge) if (!seen[p] && diff(p) <= T1) { seen[p] = 1; stack.push(p); }
  while (stack.length) {
    const p = stack.pop(), x = p % w;
    d[p * 4 + 3] = 0;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= w * h || seen[q]) continue;
      seen[q] = 1;
      const e = diff(q);
      if (e <= T1) stack.push(q);
      else if (e <= T2) d[q * 4 + 3] = Math.min(d[q * 4 + 3], Math.round((e - T1) / (T2 - T1) * 255));
    }
  }
  ctx.putImageData(id, 0, 0);
  c.bgKind = "plain";
  return c;
}

// Garment photo recoloured to the chosen colour: the white background (flood-filled from the corners)
// is kept, the garment is multiplied by the colour with a soft edge.
const tintCache = new Map();
export function tinted(img, hex) {
  if (!hex || /^#?f{6}$/i.test(hex)) return img;
  const key = img.src + "|" + hex;
  if (tintCache.has(key)) return tintCache.get(key);
  const size = Math.min(900, img.naturalWidth), w = size, h = Math.round(size * img.naturalHeight / img.naturalWidth);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
  let id;
  try { id = ctx.getImageData(0, 0, w, h); } catch { return img; }
  const d = id.data, bg = new Uint8Array(w * h), stack = [0, 0, w - 1, 0, 0, h - 1, w - 1, h - 1];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x; if (bg[i]) continue;
    const o = i * 4;
    if (d[o + 3] > 10 && (d[o] < 250 || d[o + 1] < 250 || d[o + 2] < 250)) continue;
    bg[i] = 1; stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  const al = new Float32Array(w * h), R = 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (bg[y * w + x]) continue;
    let edge = 0;
    for (let dy = -R; dy <= R && !edge; dy++) for (let dx = -R; dx <= R; dx++) {
      const ny = y + dy, nx = x + dx;
      if (ny < 0 || nx < 0 || ny >= h || nx >= w || bg[ny * w + nx]) { edge = 1; break; }
    }
    if (!edge) al[y * w + x] = 1;
  }
  const r = parseInt(hex.substr(1, 2), 16) / 255, g = parseInt(hex.substr(3, 2), 16) / 255, b = parseInt(hex.substr(5, 2), 16) / 255;
  for (let k = 0; k < w * h; k++) {
    let t = 0, n = 0;
    const y = (k / w) | 0, x = k - y * w;
    for (let dy = -2; dy <= 2; dy++) { const ny = y + dy; if (ny < 0 || ny >= h) continue; for (let dx = -2; dx <= 2; dx++) { const nx = x + dx; if (nx < 0 || nx >= w) continue; t += al[ny * w + nx]; n++; } }
    t /= n; if (t <= 0) continue;
    const q = k * 4;
    d[q] *= r * t + (1 - t); d[q + 1] *= g * t + (1 - t); d[q + 2] *= b * t + (1 - t);
  }
  ctx.putImageData(id, 0, 0);
  tintCache.set(key, cv);
  return cv;
}

// ---------------------------------------------------------------- geometry
// Pixel box of the print area on a W x H drawing.
export const areaBox = (area, W, H) => ({ x: area.rect.x * W, y: area.rect.y * H, w: area.rect.w * W, h: area.rect.h * H });

// Text is laid out on a scratch canvas in "area units": font size = size x area height.
let scratch = null;
function measureCtx() { if (!scratch) scratch = document.createElement("canvas").getContext("2d"); return scratch; }
function fontString(layer, px) { return `${layer.bold ? 700 : 500} ${px}px ${fontFamily(layer.font)}`; }
const displayText = (layer) => (/Monogram/.test(layer.font || "") ? String(layer.text || "").toUpperCase() : String(layer.text || ""));

// Glyph placements for a text layer, relative to its centre, in px at font size px.
export function layoutText(layer, px, ctx) {
  const c = ctx || measureCtx();
  c.font = fontString(layer, px);
  const text = displayText(layer), sp = (Number(layer.spacing) || 0) * px;
  const glyphs = [];
  if (layer.vertical) {
    const chars = [...text.replace(/\n/g, "")], step = px * (1 + (Number(layer.spacing) || 0));
    chars.forEach((ch, i) => glyphs.push({ ch, x: 0, y: (i - (chars.length - 1) / 2) * step, r: 0 }));
    const wMax = Math.max(px * 0.6, ...chars.map((ch) => c.measureText(ch).width));
    return { glyphs, w: wMax, h: Math.max(px, chars.length * step) };
  }
  const lines = text.split("\n"), lh = px * 1.1;
  const widths = lines.map((ln) => [...ln].reduce((s, ch) => s + c.measureText(ch).width + sp, 0) - (ln.length ? sp : 0));
  const curve = Math.max(-100, Math.min(100, Number(layer.curve) || 0));
  if (curve && lines.length === 1 && widths[0] > 0) {
    const total = Math.abs(curve) / 100 * Math.PI, R = widths[0] / total, dir = curve > 0 ? 1 : -1;
    // Arched up: letters on the top of a circle; arched down: on the bottom. Centred vertically.
    const mid = (R + R * Math.cos(total / 2)) / 2;
    let s = -widths[0] / 2;
    for (const ch of lines[0]) {
      const cw = c.measureText(ch).width, a = (s + cw / 2) / R;
      glyphs.push({ ch, x: R * Math.sin(a), y: dir > 0 ? mid - R * Math.cos(a) : R * Math.cos(a) - mid, r: dir * a });
      s += cw + sp;
    }
    const sag = R - R * Math.cos(total / 2);
    return { glyphs, w: total >= Math.PI ? 2 * R + px : 2 * R * Math.sin(total / 2) + px * 0.4, h: sag + px * 1.1 };
  }
  const maxW = Math.max(0, ...widths), align = layer.align || "center";
  lines.forEach((ln, li) => {
    let x = align === "left" ? -maxW / 2 : align === "right" ? maxW / 2 - widths[li] : -widths[li] / 2;
    const y = (li - (lines.length - 1) / 2) * lh;
    for (const ch of ln) { const cw = c.measureText(ch).width; glyphs.push({ ch, x: x + cw / 2, y, r: 0 }); x += cw + sp; }
  });
  return { glyphs, w: Math.max(px * 0.6, ...widths), h: lines.length * lh };
}

// Size of a layer on a W x H drawing, in px: { cx, cy, w, h, rot }.
export function layerBox(layer, area, W, H, imgs) {
  const b = areaBox(area, W, H);
  const cx = b.x + layer.x * b.w, cy = b.y + layer.y * b.h, rot = (Number(layer.rotation) || 0) * Math.PI / 180;
  if (layer.type === "text") {
    const px = layer.size * b.h, L = layoutText(layer, px);
    return { cx, cy, w: L.w, h: L.h, rot };
  }
  const info = imgs && imgs[layer.src];
  const c = layer.crop || { x: 0, y: 0, w: 1, h: 1 };
  const nw = (layer.naturalW || (info && info.w) || 1) * c.w, nh = (layer.naturalH || (info && info.h) || 1) * c.h;
  const w = layer.w * b.w;
  return { cx, cy, w, h: w * nh / nw, rot };
}

// Rotated corners of a box.
export function corners(box) {
  const c = Math.cos(box.rot), s = Math.sin(box.rot), hw = box.w / 2, hh = box.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [box.cx + x * c - y * s, box.cy + x * s + y * c]);
}
// True when part of the layer falls outside the print area (0.5% tolerance).
export function isOutside(layer, area, W, H, imgs) {
  const b = areaBox(area, W, H), tol = 0.005 * Math.max(b.w, b.h);
  return corners(layerBox(layer, area, W, H, imgs)).some(([x, y]) => x < b.x - tol || y < b.y - tol || x > b.x + b.w + tol || y > b.y + b.h + tol);
}
// Is point (px, py) inside the layer?
export function hitLayer(layer, area, W, H, imgs, px, py, pad = 0) {
  const box = layerBox(layer, area, W, H, imgs), c = Math.cos(-box.rot), s = Math.sin(-box.rot);
  const dx = px - box.cx, dy = py - box.cy, lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= box.w / 2 + pad && Math.abs(ly) <= box.h / 2 + pad;
}

// ---------------------------------------------------------------- drawing
function clipArea(ctx, area, b) {
  ctx.beginPath();
  if (area.shape === "ellipse") ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
  else ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip();
}
function drawLayer(ctx, layer, area, W, H, imgs) {
  const box = layerBox(layer, area, W, H, imgs);
  ctx.save();
  if (layer.clip) { // a customer photo inside a Lacci photo design: kept within the design's photo spot
    const ab = areaBox(area, W, H), c = layer.clip, x = ab.x + c.x * ab.w, y = ab.y + c.y * ab.h, w = c.w * ab.w, h = c.h * ab.h;
    ctx.beginPath();
    if (c.round) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else ctx.rect(x, y, w, h);
    ctx.clip();
  }
  ctx.translate(box.cx, box.cy); ctx.rotate(box.rot);
  if (layer.flipX) ctx.scale(-1, 1);
  if (layer.flipY) ctx.scale(1, -1);
  if (layer.type === "text") {
    const px = layer.size * areaBox(area, W, H).h, L = layoutText(layer, px, ctx);
    ctx.font = fontString(layer, px); ctx.fillStyle = layer.color || "#141414"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const g of L.glyphs) { ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.r); ctx.fillText(g.ch, 0, 0); ctx.restore(); }
  } else {
    const info = imgs && imgs[layer.src];
    const src = info && (layer.removeWhite === false ? info.img || info.display : info.display || info.img);
    if (src) {
      const c = layer.crop, sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
      if (c) ctx.drawImage(src, c.x * sw, c.y * sh, c.w * sw, c.h * sh, -box.w / 2, -box.h / 2, box.w, box.h);
      else ctx.drawImage(src, -box.w / 2, -box.h / 2, box.w, box.h);
    }
  }
  ctx.restore();
}
function drawStickerBase(ctx, area, W, H) {
  ctx.fillStyle = "#F4F1EC"; ctx.fillRect(0, 0, W, H);
  const b = areaBox(area, W, H), r = b.w * 0.12;
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.18)"; ctx.shadowBlur = W * 0.03; ctx.shadowOffsetY = W * 0.01;
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(b.x - W * 0.03, b.y - W * 0.03, b.w + W * 0.06, b.h + W * 0.06, r); ctx.fill(); ctx.restore();
}

// Draw one print area: mockup, then the layers clipped to the print area. While editing, the parts
// outside the area are shown faintly and the area gets a dashed outline.
// opts: { mockup (image|canvas|null), editing, selected (layer index), handles }
export function drawComposite(ctx, area, layers, W, H, imgs, opts = {}) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  if (area.base === "sticker") drawStickerBase(ctx, area, W, H);
  else if (opts.mockup) ctx.drawImage(opts.mockup, 0, 0, W, H);
  const b = areaBox(area, W, H);
  if (opts.editing) {
    ctx.save(); ctx.globalAlpha = 0.3;
    layers.forEach((l) => drawLayer(ctx, l, area, W, H, imgs));
    ctx.restore();
  }
  ctx.save(); clipArea(ctx, area, b);
  layers.forEach((l) => drawLayer(ctx, l, area, W, H, imgs));
  ctx.restore();
  if (opts.editing) { // no print-area outline: parts outside it show faded, and the window warns about them
    if (opts.selectedAll) layers.forEach((l) => drawSelection(ctx, l, area, W, H, imgs, false));
    const sel = layers[opts.selected];
    if (sel) drawSelection(ctx, sel, area, W, H, imgs, opts.handles !== false);
  }
}
export function handlePoints(layer, area, W, H, imgs) {
  const box = layerBox(layer, area, W, H, imgs), cs = corners(box);
  const c = Math.cos(box.rot), s = Math.sin(box.rot), off = box.h / 2 + Math.max(22, W * 0.05);
  return { resize: cs[2], rotate: [box.cx + off * s, box.cy - off * c], top: [(cs[0][0] + cs[1][0]) / 2, (cs[0][1] + cs[1][1]) / 2] };
}
function drawSelection(ctx, layer, area, W, H, imgs, handles) {
  const cs = corners(layerBox(layer, area, W, H, imgs)), lw = Math.max(1.5, W / 300);
  ctx.save(); ctx.strokeStyle = "#B8862F"; ctx.lineWidth = lw;
  ctx.beginPath(); cs.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
  if (handles) {
    const h = handlePoints(layer, area, W, H, imgs), r = Math.max(7, W * 0.018);
    ctx.beginPath(); ctx.moveTo(...h.top); ctx.lineTo(...h.rotate); ctx.stroke();
    for (const [x, y] of [h.resize, h.rotate]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = "#B8862F"; ctx.font = `${Math.round(r * 1.3)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("⟳", h.rotate[0], h.rotate[1] + 1); ctx.fillText("⤡", h.resize[0], h.resize[1] + 1);
  }
  ctx.restore();
}

// Production print file for one area: physical size x DPI, transparent background, drawn from the
// original uploads at full size, with the plain background removed wherever the customer kept it
// removed (as in the preview). Returns { canvas, lowRes[] }.
export function renderPrintFile(area, layers, imgs) {
  const dpi = area.print.dpi || 300, W = Math.round(area.print.widthIn * dpi), H = Math.round(area.print.heightIn * dpi);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const full = { ...area, rect: { x: 0, y: 0, w: 1, h: 1 } };
  const orig = {};
  for (const [k, v] of Object.entries(imgs || {})) {
    const cut = v.img && layers.some((l) => l.src === k && l.removeWhite !== false) ? removeWhite(v.img, 4000) : null;
    orig[k] = { ...v, display: cut && cut.bgKind === "plain" ? cut : v.img };
  }
  ctx.save(); clipArea(ctx, full, { x: 0, y: 0, w: W, h: H });
  layers.forEach((l) => drawLayer(ctx, l, full, W, H, orig));
  ctx.restore();
  const lowRes = layers.filter((l) => l.type === "image").filter((l) => {
    const box = layerBox(l, full, W, H, orig);
    return (l.naturalW || 0) * (l.crop ? l.crop.w : 1) < box.w * 0.66; // under ~200 DPI at this size
  }).map((l) => l.src);
  return { canvas: c, lowRes };
}

// The photo spot of a Lacci photo design: the see-through area enclosed by the artwork (transparent
// pixels not connected to the picture's edges). Returns the spot as fractions of the picture, with
// round true when it fills about as much of its box as a circle does, or null when there is none.
export function findPhotoSpot(img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = Math.min(1, 400 / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0, w, h);
  let d; try { d = x.getImageData(0, 0, w, h).data; } catch { return null; }
  const clear = (p) => d[p * 4 + 3] < 40, outside = new Uint8Array(w * h), stack = [];
  for (let i = 0; i < w; i++) stack.push(i, (h - 1) * w + i);
  for (let j = 0; j < h; j++) stack.push(j * w, j * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (p < 0 || p >= w * h || outside[p] || !clear(p)) continue;
    outside[p] = 1; const px = p % w;
    stack.push(p - w, p + w); if (px > 0) stack.push(p - 1); if (px < w - 1) stack.push(p + 1);
  }
  let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let p = 0; p < w * h; p++) if (clear(p) && !outside[p]) { n++; const px = p % w, py = (p / w) | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
  if (n < w * h * 0.02) return null; // no real opening
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  return { x: x0 / w, y: y0 / h, w: bw / w, h: bh / h, round: n / (bw * bh) < 0.86 };
}

export default { findPhotoSpot, FONT_NAMES, fontFamily, TEXT_SWATCHES, swatchName, areasFor, mockupFor, loadImage, removeWhite, tinted, areaBox, layoutText, layerBox, corners, isOutside, hitLayer, drawComposite, handlePoints, renderPrintFile };
