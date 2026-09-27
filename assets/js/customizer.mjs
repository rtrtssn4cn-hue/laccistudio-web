// Lacci Studio — visual product customizer (Stripe checkout).
//
// Artwork and text are objects placed directly on the product: tap to select, drag to move, corner
// handle to resize, top handle to rotate; on a phone one finger moves and two fingers resize and
// turn. A toolbar under the product shows only the tools for the selected object. Product options
// (size, finish, quantity) live in their own panel. Every change can be undone.
//
// The design is saved as a structured record in print-area coordinates
// with the original uploads and a rendered preview, so the cart, the order page and the production
// file show exactly what the customer made. The older form (cart.js openCustomize) stays available
// with ?customizer=classic.

import { priceLine, visibleGroups, choiceName, money } from "./pricing.mjs";
import R from "./customizer-render.mjs";

const PROOF_YES = "Yes — send me a proof before production (recommended)";
const PROOF_NO = "No proof needed — produce as submitted";
const WIP_KEY = "lacci-cz-wip";
const MAX_LAYERS = 8;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;
const uid = () => "c_" + Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
const shop = () => window.LACCI_SHOP || { products: [], checkout: {} };
const raw = () => window.LACCI_RAW || { products: [], colors: [] };
const ucKey = () => (shop().checkout || {}).uploadcarePublicKey || "";
const UCCDN = "https://51niy1s3e7.ucarecd.net/";
const ucDisplay = (url) => url.replace(/-\/inline\/no\/?$/, "").replace(/\/?$/, "/") + "-/preview/2000x2000/-/format/auto/";
const setSize = (options) => { const q = (options || {}).Quantity || ""; const m = /(\d+)/.exec(q); return /^Set of/i.test(q) && m ? Number(m[1]) : 1; };
const isMobile = () => window.matchMedia("(max-width: 899px)").matches;

let S = null;          // the design being edited
const seen = {};      // uploaded URL → loaded picture, kept for this visit so Edit design opens instantly
let imgs = {};         // image key → { img, display, w, h, url, uploading, failed, name }
let localSeq = 0;
let root = null, canvas = null, ctx = null, W = 0;
// View zoom: the whole product (mockup and design together) drawn larger inside a scrollable frame.
// It only changes the view; positions are stored as shares of the print area, so nothing moves.
let zoom = 1;
const ZOOM_MAX = 4;
const mockups = {};    // mockup src|hex → drawable
let hist = [], histAt = -1;

// ---------------------------------------------------------------- state helpers
function product() { return shop().products.find((p) => p.id === S.pid); }
function rawProduct() { return raw().products.find((p) => p.id === S.pid); }
function areas() { return R.areasFor(Object.assign({}, rawProduct() || {}, product()), S.options); }
function area() { const a = areas(); return a.find((x) => x.id === S.area) || a[0]; }
function designFor(i) { return S.layout === "each" ? (S.items[i] || (S.items[i] = {})) : S.shared; }
function layers(areaId = area().id, i = S.item) { const d = designFor(i); return d[areaId] || (d[areaId] = []); }
function selected() { return layers()[S.sel] || null; }
function priced() { return priceLine(rawProduct(), { options: S.options, color: S.color }, raw().colors); }
const filled = (l) => l.type === "image" || (l.type === "text" && l.text.trim());
function hasContent(d) { return Object.values(d || {}).some((ls) => (ls || []).some(filled)); }
function withPlaceholder(l) {
  if (l.type !== "text") return l;
  if (!l.text.trim()) return l.fromDesign ? l : { ...l, text: "Your text", color: "#9A9A9A" };
  return unusedOptional(l) ? { ...l, color: "#A8A29A" } : l;
}
// A design's name / year line still showing its sample wording: not printed.
const unusedOptional = (l) => l.type === "text" && l.optional && l.text.trim() === l.placeholder;
function clone(d) { return JSON.parse(JSON.stringify(d || {})); }
// Lacci designs published for this product (content/designs.json, managed from the Design Library).
let designList = null;
function loadDesigns() {
  if (designList) return Promise.resolve(designList);
  return fetch("/content/designs.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : { designs: [] })).catch(() => ({ designs: [] }))
    .then((d) => (designList = Array.isArray(d.designs) ? d.designs : []));
}
function designsForProduct() {
  return (designList || []).filter((d) => d.active !== false && d.image && (!Array.isArray(d.products) || !d.products.length || d.products.includes(S.pid)));
}
const canPickDesigns = () => personalization().designs && designsForProduct().length > 0;
function personalization() { return Object.assign({ upload: true, text: true, designs: true, blank: true, preview: true, proof: true, notes: true }, (rawProduct() || {}).personalization || {}); }

function defaults(p) {
  const options = {};
  for (const g of p.optionGroups || []) if (g.choices.length) options[g.label] = choiceName(g.choices[0]);
  return {
    pid: p.id, options, color: (p.colors && p.colors[0] && p.colors[0].id) || null, qty: 1,
    started: false, layout: "same", item: 0, shared: {}, items: [], attachments: [], area: "", sel: -1,
    proof: true, comments: "", tab: "design", sheet: false, tool: "", editIndex: null, customizationId: uid(),
  };
}

// ---------------------------------------------------------------- undo / redo
const snapKeys = ["shared", "items", "attachments", "options", "color", "qty", "layout"];
function snapshot() { return JSON.stringify(snapKeys.map((k) => S[k])); }
function resetHistory() { hist = [snapshot()]; histAt = 0; }
// Record the current state as one undo step (after a gesture, a tool, or a pause in typing).
function commit() {
  clearTimeout(typingTimer); typingTimer = 0;
  if (S && root) followDesigns(); // a design's wording is saved where it will be drawn
  const s = snapshot();
  if (hist[histAt] === s) return;
  hist = hist.slice(0, histAt + 1); hist.push(s); if (hist.length > 80) hist.shift(); histAt = hist.length - 1;
  saveWip(); updateUndo();
}
function restore(i) {
  histAt = i; const v = JSON.parse(hist[i]);
  snapKeys.forEach((k, j) => (S[k] = v[j]));
  S.sel = -1; render();
}
// Each action is one step. Typing that hasn't been saved as a step yet is saved first, so undo takes it back.
const undo = () => { if (typingTimer) commit(); if (histAt > 0) restore(histAt - 1); };
const redo = () => { if (histAt < hist.length - 1) restore(histAt + 1); };
function updateUndo() {
  if (!root) return;
  root.querySelector("#lz-undo").disabled = histAt <= 0;
  root.querySelector("#lz-redo").disabled = histAt >= hist.length - 1;
}
let typingTimer = 0;
function commitSoon() { clearTimeout(typingTimer); typingTimer = setTimeout(commit, 600); }

// ---------------------------------------------------------------- work in progress (this device)
function wipAll() { try { return JSON.parse(localStorage.getItem(WIP_KEY)) || {}; } catch { return {}; } }
function portable(d) {
  const out = {};
  for (const [a, ls] of Object.entries(d || {})) out[a] = (ls || []).filter((l) => l.type !== "image" || (imgs[l.src] && imgs[l.src].url)).map((l) => (l.type === "image" ? { ...l, src: imgs[l.src].url } : { ...l }));
  return out;
}
let wipTimer = 0;
function saveWip() {
  clearTimeout(wipTimer);
  wipTimer = setTimeout(() => {
    if (!S || S.editIndex !== null) return;
    const all = wipAll();
    const d = { ...S, shared: portable(S.shared), items: S.items.map(portable), sel: -1, sheet: false, savedAt: Date.now() };
    if (!hasContent(d.shared) && !d.items.some(hasContent)) delete all[S.pid]; else all[S.pid] = d;
    const keys = Object.keys(all).sort((a, b) => (all[b].savedAt || 0) - (all[a].savedAt || 0)).slice(0, 5);
    try { localStorage.setItem(WIP_KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]])))); } catch {}
  }, 300);
}
function clearWip(pid) { const all = wipAll(); delete all[pid]; try { localStorage.setItem(WIP_KEY, JSON.stringify(all)); } catch {} }

// Images referenced by a restored design are loaded from the uploaded originals.
function restoreImages(d) {
  for (const ls of Object.values(d || {})) for (const l of ls || []) {
    if (l.type !== "image" || imgs[l.src]) continue;
    if (seen[l.src] && seen[l.src].img) { imgs[l.src] = seen[l.src]; continue; }
    const info = imgs[l.src] = { url: l.src, w: l.naturalW, h: l.naturalH, name: l.name || "Your upload" };
    R.loadImage(l.src.startsWith("/assets/") ? l.src : ucDisplay(l.src)).then((img) => {
      info.img = img; info.display = R.removeWhite(img); draw();
      if (l.cutout && info.display.bgKind !== "transparent") R.loadImage(ucDisplay(l.cutout)).then((cut) => {
        const c = document.createElement("canvas"); c.width = info.display.width; c.height = info.display.height;
        c.getContext("2d").drawImage(cut, 0, 0, c.width, c.height); c.bgKind = "plain";
        info.display = c; info.touched = true; draw();
      }).catch(() => {});
    }).catch(() => { info.failed = true; draw(); });
  }
}

// ---------------------------------------------------------------- open / close
function ensureCss() {
  if (document.querySelector("#lz-css")) return;
  const l = document.createElement("link"); l.id = "lz-css"; l.rel = "stylesheet"; l.href = "/assets/css/customizer.css?v=1";
  document.head.appendChild(l);
}

export function open(pid) {
  const p = shop().products.find((x) => x.id === pid);
  if (!p) return;
  loadDesigns().then(() => { if (root && S && S.pid === pid) render(); });
  imgs = {};
  S = defaults(p);
  zoom = 1;
  const wip = wipAll()[pid];
  mount();
  resetHistory();
  if (wip && (hasContent(wip.shared) || (wip.items || []).some(hasContent))) showResume(wip);
  render();
}

// Reopen a cart line with its exact saved design. duplicate = start a new line from a copy.
export function edit(index, duplicate) {
  const line = window.LacciCheckout && window.LacciCheckout.lines()[index];
  if (!line || !line.customization) return;
  const p = shop().products.find((x) => x.id === line.productId);
  if (!p) return;
  const c = line.customization;
  imgs = {};
  S = defaults(p);
  Object.assign(S, {
    options: { ...(line.options || {}) }, color: line.color || null, qty: line.qty || 1, started: true,
    layout: c.layout === "each" ? "each" : "same", proof: c.proof !== false, comments: c.comments || "",
    editIndex: duplicate ? null : index, customizationId: duplicate ? uid() : c.customizationId || uid(),
  });
  S.shared = fromRecordAreas(c.areas);
  S.items = (c.items || []).map((it) => fromRecordAreas(it.areas));
  S.attachments = [];
  for (const [id, a] of Object.entries(c.areas || {})) for (const f of a.attachments || []) S.attachments.push({ ...f, area: id });
  restoreImages(S.shared); S.items.forEach(restoreImages);
  if (window.LacciCheckout) window.LacciCheckout.close();
  mount(); resetHistory(); render();
}
function fromRecordAreas(a) {
  const out = {};
  for (const [k, v] of Object.entries(a || {})) out[k] = (v.layers || []).map((l) => ({ ...l }));
  return out;
}

function close() {
  if (!root) return;
  saveWip();
  root.classList.remove("show");
  document.documentElement.classList.remove("lz-lock");
  setTimeout(() => { if (root && !root.classList.contains("show")) { root.remove(); root = null; } }, 250);
}

function mount() {
  ensureCss();
  if (root) root.remove();
  root = document.createElement("div");
  root.className = "lz-overlay";
  root.innerHTML = `
  <div class="lz" role="dialog" aria-modal="true" aria-labelledby="lz-title">
    <header class="lz-head">
      <div class="lz-titles"><h2 id="lz-title"></h2><span class="lz-info" id="lz-info"></span></div>
      <div class="lz-hist">
        <button type="button" id="lz-undo" aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
        <button type="button" id="lz-redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">↷</button>
      </div>
      <button type="button" class="lz-x" id="lz-close" aria-label="Close">&times;</button>
    </header>
    <div class="lz-main">
      <section class="lz-stage" aria-label="Design preview">
        <div class="lz-tabs lz-areatabs" id="lz-areatabs" role="tablist" hidden></div>
        <div class="lz-itemtabs" id="lz-itemtabs" role="tablist" hidden></div>
        <div class="lz-viewport">
        <div class="lz-zoom" id="lz-zoom" role="group" aria-label="Zoom">
          <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
          <button type="button" data-zoom="reset" id="lz-zoomlvl" aria-label="Reset zoom">100%</button>
          <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
        </div>
        <div class="lz-canvaswrap" id="lz-canvaswrap">
          <canvas id="lz-canvas" tabindex="0" aria-label="Your design. Tap an item to select it. Drag to move, pinch to resize, twist to rotate. Arrow keys move the selected item; plus and minus resize; square brackets rotate."></canvas>
          <div class="lz-start" id="lz-start" hidden></div>
          <div class="lz-resume" id="lz-resume" hidden></div>
        </div>
        </div>
        <div class="lz-ctx" id="lz-ctx" role="toolbar" aria-label="Edit the selected item"></div>
        <div class="lz-pop" id="lz-pop" hidden></div>
        <p class="lz-warn" id="lz-warn" role="status" hidden>Part of your design is outside the print area and won't be printed.</p>
        <p class="lz-hint" id="lz-hint"></p>
        ${COLOR_NOTE}
      </section>
      <section class="lz-side" id="lz-side">
        <nav class="lz-tabs lz-paneltabs" id="lz-paneltabs" role="tablist">
          <button type="button" data-tab="design" role="tab">Design</button>
          <button type="button" data-tab="text" role="tab">Text</button>
          <button type="button" data-tab="product" role="tab">Product</button>
          <button type="button" data-tab="review" role="tab">Review</button>
        </nav>
        <div class="lz-sheet-head"><b id="lz-sheet-title"></b><button type="button" id="lz-sheet-close" aria-label="Close panel">Done</button></div>
        <div class="lz-panel" id="lz-panel"></div>
      </section>
    </div>
    <nav class="lz-mbar" id="lz-mbar" aria-label="Customizer tools">
      <button type="button" data-m="design"><span>＋</span>Add</button>
      <button type="button" data-m="text"><span>T</span>Text</button>
      <button type="button" data-m="position"><span>✥</span>Position</button>
      <button type="button" data-m="product"><span>▦</span>Product</button>
      <button type="button" data-m="review"><span>✓</span>Review</button>
    </nav>
    <footer class="lz-bar">
      <div class="lz-total"><strong id="lz-price"></strong><span id="lz-each"></span></div>
      <button type="button" class="btn btn-gold lz-add" id="lz-add">Add to cart</button>
    </footer>
    <p class="lz-err" id="lz-err" role="alert" hidden></p>
    <input type="file" id="lz-file" accept="image/*,.heic,.heif,.pdf,.svg,.ai,.psd,.eps" hidden>
    <input type="file" id="lz-replace" accept="image/*,.heic,.heif" hidden>
  </div>`;
  document.body.appendChild(root);
  document.documentElement.classList.add("lz-lock");
  requestAnimationFrame(() => root.classList.add("show"));
  canvas = root.querySelector("#lz-canvas");
  ctx = canvas.getContext("2d");
  W = 0; zoom = 1; // a new canvas: size it again (reopening at the same size left it at the browser default)
  root.querySelector("#lz-close").onclick = close;
  root.querySelector("#lz-undo").onclick = undo;
  root.querySelector("#lz-redo").onclick = redo;
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (S.sheet) { S.sheet = false; render(); } else close(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); redo(); }
  });
  root.querySelector("#lz-paneltabs").onclick = (e) => { const t = e.target.closest("[data-tab]"); if (t) { S.tab = t.dataset.tab; renderPanel(); } };
  root.querySelector("#lz-mbar").onclick = (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    const m = b.dataset.m;
    if (S.sheet && S.tab === m) S.sheet = false; else { S.tab = m; S.sheet = true; }
    render();
  };
  root.querySelector("#lz-sheet-close").onclick = () => { S.sheet = false; render(); };
  root.querySelector("#lz-ctx").onclick = (e) => { const b = e.target.closest("[data-act]"); if (b) tool(b.dataset.act, b); };
  root.querySelector("#lz-add").onclick = addToCart;
  root.querySelector("#lz-file").onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) addUpload(f); };
  root.querySelector("#lz-replace").onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) addUpload(f, selected()); };
  bindGestures();
  new ResizeObserver(() => sizeCanvas()).observe(root.querySelector("#lz-canvaswrap"));
  root.querySelector("#lz-zoom").onclick = (e) => {
    const b = e.target.closest("[data-zoom]"); if (!b) return;
    setZoom(b.dataset.zoom === "reset" ? 1 : zoom * (b.dataset.zoom === "in" ? 1.5 : 1 / 1.5));
  };
  if (document.fonts) Promise.all(R.FONT_NAMES.map((f) => document.fonts.load(`500 40px ${R.fontFamily(f)}`).catch(() => {}))).then(draw);
}

function showResume(wip) {
  const box = root.querySelector("#lz-resume");
  box.hidden = false;
  box.innerHTML = `<p>We kept the design you started.</p><div><button type="button" class="btn btn-gold" id="lz-cont">Continue</button><button type="button" class="btn btn-ghost-gold" id="lz-over">Start over</button></div>`;
  box.querySelector("#lz-cont").onclick = () => {
    const keep = { customizationId: S.customizationId };
    Object.assign(S, wip, keep, { editIndex: null, sel: -1, started: true, sheet: false, attachments: wip.attachments || [] });
    restoreImages(S.shared); S.items.forEach(restoreImages);
    box.hidden = true; resetHistory(); render();
  };
  box.querySelector("#lz-over").onclick = () => { clearWip(S.pid); box.hidden = true; render(); };
}

// ---------------------------------------------------------------- rendering
function sizeCanvas() {
  if (!canvas) return;
  const wrap = root.querySelector("#lz-canvaswrap");
  const base = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight || wrap.clientWidth));
  const w = Math.round(base * zoom);
  if (!w || w === W) { draw(); return; }
  W = w;
  const dpr = Math.min(3, window.devicePixelRatio || 1, 4096 / w); // keeps the canvas within phone memory limits
  canvas.style.width = canvas.style.height = w + "px";
  canvas.width = canvas.height = Math.round(w * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

// Zoom the view to z (1 = fit), keeping the point under (cx, cy) — or the middle — in place.
function setZoom(z, cx, cy) {
  const wrap = root && root.querySelector("#lz-canvaswrap"); if (!wrap) return;
  z = round(clamp(z, 1, ZOOM_MAX), 3);
  if (Math.abs(z - zoom) < 0.001) return;
  const r = wrap.getBoundingClientRect();
  const ox = cx === undefined ? r.width / 2 : cx - r.left, oy = cy === undefined ? r.height / 2 : cy - r.top;
  const fx = (wrap.scrollLeft + ox) / (W || 1), fy = (wrap.scrollTop + oy) / (W || 1);
  zoom = z;
  wrap.classList.toggle("zoomed", zoom > 1);
  sizeCanvas();
  wrap.scrollLeft = fx * W - ox; wrap.scrollTop = fy * W - oy;
  const lvl = root.querySelector("#lz-zoomlvl"); if (lvl) lvl.textContent = Math.round(zoom * 100) + "%";
  root.querySelector('[data-zoom="out"]').disabled = zoom <= 1;
  root.querySelector('[data-zoom="in"]').disabled = zoom >= ZOOM_MAX;
}
function garmentHex() { return product().colors ? (product().colors.find((c) => c.id === S.color) || {}).hex : ""; }
function mockupImage(a, cb) {
  if (!a.mockup) return null;
  const hex = garmentHex();
  const key = a.mockup + "|" + (hex || "");
  if (mockups[key] && mockups[key] !== "loading") return mockups[key];
  if (!mockups[key]) {
    mockups[key] = "loading";
    R.loadImage(a.mockup).then((img) => { mockups[key] = hex ? R.tinted(img, hex) : img; (cb || draw)(); }).catch(() => { delete mockups[key]; });
  }
  return null;
}

// A Lacci design and its wording move as one: when the design picture is moved, resized or rotated,
// its text lines follow (same offset, scale and turn). A text line selected on its own moves alone.
function followDesigns() {
  const ls = layers(), a = area(), A = a.rect.w / a.rect.h;
  for (const d of ls) {
    if (d.type !== "image" || !d.design || d.locked) continue;
    const g = d._g, cur = { x: d.x, y: d.y, w: d.w, rotation: d.rotation || 0 };
    d._g = cur;
    if (!g || (g.x === cur.x && g.y === cur.y && g.w === cur.w && g.rotation === cur.rotation)) continue;
    const s = cur.w / (g.w || cur.w), dr = cur.rotation - g.rotation, rad = dr * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    for (const t of ls) {
      if (t.type !== "text" || t.fromDesign !== d.design.id) continue;
      const X = t.x - g.x, Y = (t.y - g.y) / A; // offsets in print-area-width units, so turning keeps the shape
      t.x = round(cur.x + s * (X * cos - Y * sin));
      t.y = round(cur.y + s * (X * sin + Y * cos) * A);
      t.size = round(t.size * s);
      if (t.baseSize) t.baseSize = round(t.baseSize * s);
      if (t.maxW) t.maxW = round(t.maxW * s);
      t.rotation = snapRot((t.rotation || 0) + dr);
    }
  }
}
let raf = 0;
function draw() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    if (!ctx || !W || !S) return;
    const a = area();
    followDesigns();
    R.drawComposite(ctx, a, layers().map(withPlaceholder), W, W, imgs, { mockup: mockupImage(a), editing: true, selected: S.sel, selectedAll: !!S.all });
    const out = layers().some((l) => filled(l) && R.isOutside(l, a, W, W, imgs));
    root.querySelector("#lz-warn").hidden = !out;
  });
}

function render() {
  if (!root || !S) return;
  const p = product();
  const ar = areas();
  if (!ar.find((x) => x.id === S.area)) S.area = ar[0].id;
  root.querySelector("#lz-title").textContent = p.name;
  const singles = visibleGroups(rawProduct() || { optionGroups: [] }).filter((g) => g.choices.length === 1).map((g) => choiceName(g.choices[0]));
  root.querySelector("#lz-info").textContent = singles.join(" · ");
  const at = root.querySelector("#lz-areatabs");
  at.hidden = ar.length < 2;
  at.innerHTML = ar.map((a) => `<button type="button" role="tab" data-area="${a.id}" aria-selected="${a.id === S.area}">${esc(a.label)}${hasContent({ x: layers(a.id) }) ? " ✓" : ""}</button>`).join("");
  at.onclick = (e) => { const b = e.target.closest("[data-area]"); if (b) { S.area = b.dataset.area; S.sel = -1; render(); } };
  const n = setSize(S.options), it = root.querySelector("#lz-itemtabs");
  if (S.layout === "each" && n > 1) {
    while (S.items.length < n) S.items.push(clone(S.items[0] || S.shared));
    it.hidden = false;
    it.innerHTML = Array.from({ length: n }, (_, i) => `<button type="button" role="tab" data-item="${i}" aria-selected="${i === S.item}"><canvas width="44" height="44" data-thumb="${i}"></canvas><span>Coaster ${i + 1}${hasContent(S.items[i]) ? " ✓" : ""}</span></button>`).join("");
    it.onclick = (e) => { const b = e.target.closest("[data-item]"); if (b) { S.item = +b.dataset.item; S.sel = -1; render(); } };
    drawThumbs();
  } else { it.hidden = true; S.item = 0; }
  // Always opens on the blank product; Upload and Add text sit under it.
  root.querySelector("#lz-start").hidden = true;
  const hint = root.querySelector("#lz-hint");
  hint.textContent = !layers().length ? "" : selected() ? (matchMedia("(pointer: coarse)").matches ? "Drag to move · Pinch to resize · Twist to rotate" : "Drag to move · Corner to resize · Top handle to rotate") : "Tap your design to edit it";
  root.querySelectorAll("#lz-paneltabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
  root.querySelectorAll("#lz-mbar [data-m]").forEach((b) => b.setAttribute("aria-pressed", String(S.sheet && b.dataset.m === S.tab)));
  root.querySelector("#lz-side").classList.toggle("open", S.sheet);
  renderCtx();
  renderPanel();
  renderPrice();
  updateUndo();
  draw();
  saveWip();
}

function drawThumbs() {
  root.querySelectorAll("canvas[data-thumb]").forEach((c) => {
    const i = +c.dataset.thumb, a = area(), t = c.getContext("2d");
    R.drawComposite(t, a, layers(a.id, i).filter(filled), 44, 44, imgs, { mockup: mockupImage(a, drawThumbs) });
  });
}

function renderPrice() {
  const pr = priced(), n = setSize(S.options);
  const priceEl = root.querySelector("#lz-price"), eachEl = root.querySelector("#lz-each"), add = root.querySelector("#lz-add");
  if (!pr.ok) { priceEl.textContent = "—"; eachEl.textContent = pr.error; add.disabled = true; return; }
  priceEl.textContent = money(pr.unitCents * S.qty);
  eachEl.textContent = n > 1 ? `${money(Math.round(pr.unitCents / n))} per coaster` + (S.qty > 1 ? ` · ${S.qty} sets` : "") : (S.qty > 1 ? `${money(pr.unitCents)} each` : "");
  add.disabled = uploadingAny();
  add.textContent = uploadingAny() ? "Uploading your design…" : (S.editIndex !== null ? "Save changes" : "Add to cart");
}
const uploadingAny = () => Object.values(imgs).some((i) => i.uploading);

// ---------------------------------------------------------------- contextual toolbar
const btn = (act, label, icon, extra = "") => `<button type="button" data-act="${act}" ${extra}><span aria-hidden="true">${icon}</span>${label}</button>`;
function renderCtx() {
  const box = root.querySelector("#lz-ctx"), l = selected(), pop = root.querySelector("#lz-pop");
  if (!l) {
    box.innerHTML = personalization().upload || personalization().text
      ? (canPickDesigns() ? btn("designs", "Lacci designs", "✦") : "") + (personalization().upload ? btn("upload", photoSpotOpen() ? "Add your photo" : "Upload", "⬆") : "") + (personalization().text ? btn("addtext", "Add text", "T") : "") + (layers().some((x) => filled(x) && !x.locked) ? btn("selectlast", "Edit design", "✎") : "")
      : "";
    box.classList.toggle("idle", true);
    pop.hidden = true; S.tool = "";
    return;
  }
  box.classList.toggle("idle", false);
  if (l.locked) { box.innerHTML = btn("upload", photoSpotOpen() ? "Add your photo" : "Change photo", "⬆") + btn("delete", "Remove design", "🗑", 'class="lz-danger"'); pop.hidden = true; return; }
  const ls = layers(), i = S.sel;
  const order = (ls.length > 1 && !l.clip ? btn("forward", "Forward", "⬆", i === ls.length - 1 ? "disabled" : "") + btn("backward", "Back", "⬇", i === 0 ? "disabled" : "") : "");
  box.innerHTML = l.type === "image"
    ? btn("replace", "Replace", "⇄") + (bgKind(l) === "plain" ? btn("bg", "Remove bg", "◩", l.removeWhite !== false ? 'aria-pressed="true"' : "") : "") + ((imgs[l.src] || {}).img ? btn("touchup", "Touch up", "🖌") : "") + btn("crop", "Crop", "⌗") + btn("flip", "Flip", "⇋") + btn("fit", "Fit", "⤢") + btn("fill", "Fill", "⛶") + btn("center", "Center", "✛") + btn("duplicate", "Duplicate", "⧉") + order + btn("reset", "Reset", "↺") + btn("delete", "Delete", "🗑", 'class="lz-danger"')
    : btn("edittext", "Edit", "✎") + btn("t-font", "Font", "Aa", S.tool === "t-font" ? 'aria-pressed="true"' : "") + btn("t-size", "Size", "↕", S.tool === "t-size" ? 'aria-pressed="true"' : "") + btn("t-color", "Color", "●", (S.tool === "t-color" ? 'aria-pressed="true" ' : "") + `style="--dot:${esc(l.color)}"`) +
      btn("bold", "Bold", "B", l.bold ? 'aria-pressed="true"' : "") + btn("align", "Align", l.align === "left" ? "⇤" : l.align === "right" ? "⇥" : "≡") + btn("t-spacing", "Spacing", "↔", S.tool === "t-spacing" ? 'aria-pressed="true"' : "") +
      btn("t-curve", "Curve", "◠", S.tool === "t-curve" ? 'aria-pressed="true"' : "") + btn("vertical", l.vertical ? "Across" : "Down", l.vertical ? "⇥" : "⇩") + btn("center", "Center", "✛") + btn("duplicate", "Duplicate", "⧉") + order + btn("delete", "Delete", "🗑", 'class="lz-danger"');
  renderPop();
}
function renderPop() {
  const pop = root.querySelector("#lz-pop"), l = selected();
  if (!l || l.type !== "text" || !S.tool) { pop.hidden = true; return; }
  pop.hidden = false;
  const fonts = (personalization().fonts && personalization().fonts.length ? personalization().fonts : R.FONT_NAMES);
  if (S.tool === "t-font") pop.innerHTML = `<div class="lz-chips">${fonts.map((f) => `<button type="button" data-font="${esc(f)}" aria-pressed="${l.font === f}" style="font-family:${esc(R.fontFamily(f))}">${esc(f.replace(/ \/.*/, ""))}</button>`).join("")}</div>`;
  if (S.tool === "t-color") pop.innerHTML = `<div class="lz-swatches">${R.TEXT_SWATCHES.map((s) => `<button type="button" data-color="${s.hex}" aria-label="${s.name}" title="${s.name}" aria-pressed="${l.color.toLowerCase() === s.hex.toLowerCase()}" style="background:${s.hex}"></button>`).join("")}</div>
    <details class="lz-adv"><summary>Exact colour (HEX)</summary><input type="text" id="lz-hex" maxlength="7" value="${esc(l.color)}" spellcheck="false" autocapitalize="characters" placeholder="#D79D41"></details>`;
  if (S.tool === "t-size") pop.innerHTML = `<label class="lz-range"><span>A</span><input type="range" min="3" max="60" value="${Math.round(l.size * 100)}" data-range="size" aria-label="Text size"><span style="font-size:1.3em">A</span></label>`;
  if (S.tool === "t-spacing") pop.innerHTML = `<label class="lz-range"><span>Tight</span><input type="range" min="0" max="50" value="${Math.round((l.spacing || 0) * 100)}" data-range="spacing" aria-label="Letter spacing"><span>Wide</span></label>`;
  if (S.tool === "t-curve") pop.innerHTML = `<label class="lz-range"><span>◡</span><input type="range" min="-100" max="100" step="5" value="${l.curve || 0}" data-range="curve" aria-label="Curve: arch down to arch up"><span>◠</span></label>${l.text.includes("\n") ? `<p class="lz-note">Curves apply to one line of text.</p>` : ""}`;
  pop.onclick = (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.font) { l.font = t.dataset.font; commit(); renderPop(); draw(); }
    if (t.dataset.color) { l.color = t.dataset.color; commit(); renderCtx(); draw(); }
  };
  pop.oninput = (e) => {
    const t = e.target;
    if (t.dataset.range === "size") l.size = Number(t.value) / 100;
    if (t.dataset.range === "spacing") l.spacing = Number(t.value) / 100;
    if (t.dataset.range === "curve") l.curve = Number(t.value);
    if (t.id === "lz-hex") { const v = t.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) l.color = (v[0] === "#" ? v : "#" + v).toUpperCase(); }
    draw();
  };
  pop.onchange = () => { commit(); renderCtx(); };
}

function tool(act, el) {
  S.all = false;
  if (act === "upload") return pickFile();
  if (act === "designs") return openDesigns();
  if (act === "addtext") return addText();
  if (act === "selectlast") { S.sel = layers().length - 1; render(); canvas.focus({ preventScroll: true }); return; }
  const l = selected(); if (!l) return;
  if (l.locked && act !== "delete") return;
  const ls = layers(), i = S.sel, k = l.type === "text" ? "size" : "w";
  if (act.startsWith("t-")) { S.tool = S.tool === act ? "" : act; renderCtx(); return; }
  if (act === "edittext") { S.tab = "text"; if (isMobile()) S.sheet = true; render(); const ta = root.querySelector("#lz-text"); if (ta) { ta.focus(); ta.select(); } return; }
  if (act === "replace") return root.querySelector("#lz-replace").click();
  if (act === "crop") return openCrop(l);
  if (act === "touchup") return openTouchUp(l);
  if (act === "flip") l.flipX = !l.flipX;
  if (act === "bg") l.removeWhite = l.removeWhite === false;
  if (act === "bold") l.bold = !l.bold;
  if (act === "align") l.align = l.align === "left" ? "center" : l.align === "right" ? "left" : l.align === "center" || !l.align ? "right" : "center";
  if (act === "vertical") l.vertical = !l.vertical;
  if (act === "bigger") l[k] = round(clamp(l[k] * 1.1, 0.03, 3));
  if (act === "smaller") l[k] = round(clamp(l[k] / 1.1, 0.03, 3));
  if (act === "rotl") l.rotation = snapRot(l.rotation - 15);
  if (act === "rotr") l.rotation = snapRot(l.rotation + 15);
  if (act === "center") { l.x = 0.5; l.y = 0.5; }
  if (act === "fit" && l.type === "image") fitLayer(l, "fit");
  if (act === "fill" && l.type === "image") fitLayer(l, "fill");
  if (act === "reset") { if (l.type === "image") { delete l.crop; delete l.flipX; fitLayer(l, "fit", l.design ? 1 : 0.85); } else Object.assign(l, { x: 0.5, y: 0.5, rotation: 0, size: 0.14, curve: 0, spacing: 0 }); }
  if (act === "duplicate") { if (ls.length >= MAX_LAYERS) return error(`Up to ${MAX_LAYERS} items per side.`); const c = clone(l); c.x = round(clamp(c.x + 0.05, 0, 1)); c.y = round(clamp(c.y + 0.05, 0, 1)); ls.splice(i + 1, 0, c); S.sel = i + 1; }
  if (act === "forward" && i < ls.length - 1) { [ls[i], ls[i + 1]] = [ls[i + 1], ls[i]]; S.sel = i + 1; }
  if (act === "backward" && i > 0) { [ls[i], ls[i - 1]] = [ls[i - 1], ls[i]]; S.sel = i - 1; }
  if (act === "delete") {
    ls.splice(i, 1); S.sel = -1;
    if (l.design && !ls.some((x) => x.design && x.design.id === l.design.id)) // the design's own wording goes with it
      for (let j = ls.length - 1; j >= 0; j--) if (ls[j].fromDesign === l.design.id) ls.splice(j, 1);
  }
  commit(); render();
}
function snapRot(d) { let r = ((Math.round(d) % 360) + 540) % 360 - 180; for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(r - s) < 4) r = s; return r; }
// Fit: whole image inside the area. Fill: image covers the area.
function fitLayer(l, how, scale = 1) {
  const a = area(), aspect = a.rect.w / a.rect.h, c = l.crop || { w: 1, h: 1 }, r = ((l.naturalW || 1) * c.w) / ((l.naturalH || 1) * c.h);
  l.w = round((how === "fill" ? Math.max(1, r / aspect) : Math.min(1, r / aspect)) * scale);
  l.x = 0.5; l.y = 0.5; l.rotation = 0;
}

// Escape closes a Crop or Touch up box without saving.
function escToClose(ov) {
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); ov.remove(); } };
  document.addEventListener("keydown", onKey, true);
  new MutationObserver((_, obs) => { if (!ov.isConnected) { document.removeEventListener("keydown", onKey, true); obs.disconnect(); } }).observe(ov.parentNode, { childList: true });
}

// ---------------------------------------------------------------- Lacci designs
// The photo design on this side, if any, with its photo spot in print-area fractions.
function photoFrame() {
  const f = layers().find((x) => x.locked && x.design && x.spot);
  return f ? { layer: f, spot: f.spot } : null;
}
const photoSpotOpen = () => { const f = photoFrame(); return !!f && !layers().some((x) => x.clip); };
// Customer photo sized to cover the spot, centred in it; they can still move and zoom it.
function placeInSpot(l, sp) {
  const a = area(), aspect = a.rect.w / a.rect.h, r = (l.naturalW || 1) / (l.naturalH || 1);
  l.clip = { x: round(sp.x), y: round(sp.y), w: round(sp.w), h: round(sp.h), round: !!sp.round };
  l.w = round(Math.max(sp.w, sp.h * r / aspect) * 1.02);
  l.x = round(sp.x + sp.w / 2); l.y = round(sp.y + sp.h / 2); l.rotation = 0; l.removeWhite = false;
}
function openDesigns() {
  const list = designsForProduct(); if (!list.length) return;
  const cols = [...new Set(list.map((d) => d.collection || "Designs"))];
  const ov = document.createElement("div");
  ov.className = "lz-crop lz-designs";
  ov.innerHTML = `<div class="lz-crop-box"><div class="lz-crop-head"><h3>Lacci designs</h3><button type="button" class="lz-crop-x" data-c="cancel" aria-label="Close">&times;</button></div>
    ${cols.length > 1 ? `<div class="lz-chips">${["All", ...cols].map((c, i) => `<button type="button" data-col="${esc(c)}" aria-pressed="${i === 0}">${esc(c)}</button>`).join("")}</div>` : ""}
    <div class="lz-dsections">${cols.map((c) => `<div class="lz-dsec" data-colof="${esc(c)}">${cols.length > 1 ? `<h4>${esc(c)}</h4>` : ""}<div class="lz-dgrid">${list.filter((d) => (d.collection || "Designs") === c).map((d) => `<button type="button" data-design="${esc(d.id)}"><img src="${esc(d.thumb || d.image)}" alt="" loading="lazy"><span>${esc(d.name || "")}</span>${d.type === "photo" ? `<small>Add your photo</small>` : ""}</button>`).join("")}</div></div>`).join("")}</div></div>`;
  root.querySelector(".lz").appendChild(ov);
  escToClose(ov);
  ov.onclick = (e) => {
    const col = e.target.closest("[data-col]");
    if (col) {
      ov.querySelectorAll("[data-col]").forEach((b) => b.setAttribute("aria-pressed", String(b === col)));
      ov.querySelectorAll(".lz-dsec").forEach((s) => { s.hidden = col.dataset.col !== "All" && s.dataset.colof !== col.dataset.col; });
      ov.querySelector(".lz-dsections").scrollTop = 0;
      return;
    }
    const pick = e.target.closest("[data-design]");
    if (pick) { const d = list.find((x) => x.id === pick.dataset.design); ov.remove(); if (d) useDesign(d); return; }
    if (e.target.closest('[data-c="cancel"]')) ov.remove();
  };
}
function useDesign(d) {
  const ls = layers();
  if (d.type === "photo" && ls.some(filled) && !confirm("Use this design? It replaces what's on this side now.")) return;
  S.started = true;
  const key = d.image;
  const info = imgs[key] || (imgs[key] = { url: d.image, name: d.name || "Lacci design" });
  R.loadImage(d.image).then((img) => {
    info.img = img; info.w = img.naturalWidth; info.h = img.naturalHeight; info.display = R.removeWhite(img);
    const l = { type: "image", src: key, name: d.name || "Lacci design", naturalW: info.w, naturalH: info.h, x: 0.5, y: 0.5, w: 0.8, rotation: 0, removeWhite: true, design: { id: d.id } };
    if (d.type === "photo") {
      const spotImg = d.spot || R.findPhotoSpot(img);
      fitLayer(l, "fit");
      l.locked = true;
      if (spotImg) { // spot in design fractions → print-area fractions, using where the design sits
        const a = area(), aspect = a.rect.w / a.rect.h, hFrac = l.w * aspect / (info.w / info.h), left = l.x - l.w / 2, top = l.y - hFrac / 2;
        l.spot = { x: round(left + spotImg.x * l.w), y: round(top + spotImg.y * hFrac), w: round(spotImg.w * l.w), h: round(spotImg.h * hFrac), round: !!spotImg.round };
      }
      ls.splice(0, ls.length, l); S.sel = -1;
    } else {
      fitLayer(l, "fit"); // Lacci designs already carry their own margin, so they fill the print area
      const texts = Array.isArray(d.texts) ? d.texts : [];
      if (ls.length + 1 + texts.length > MAX_LAYERS) return error(`Up to ${MAX_LAYERS} items per side. Remove something first.`);
      ls.push(l);
      // The design's wording, placed where it sits in the design (positions are shares of the design picture)
      const a = area(), aspect = a.rect.w / a.rect.h, hFrac = l.w * aspect / (info.w / info.h), left = l.x - l.w / 2, top = l.y - hFrac / 2;
      for (const t of texts) {
        const tl = { type: "text", text: t.text, font: t.font || "Serif / Classic", color: t.color || "#231F20", size: round(t.size * hFrac), x: round(left + t.x * l.w), y: round(top + t.y * hFrac),
          rotation: 0, spacing: 0, curve: 0, bold: !!t.bold, vertical: false, align: "center", placeholder: t.placeholder || t.text, fromDesign: d.id,
          role: t.role || "", optional: !!t.optional, baseSize: round(t.size * hFrac), maxW: t.w ? round(t.w * l.w * 1.2) : 0 };
        fitText(tl); ls.push(tl);
      }
      const firstWords = ls.findIndex((x) => x.fromDesign === d.id && x.text.trim());
      S.sel = firstWords >= 0 ? firstWords : ls.length - 1;
      if (texts.length) S.tab = "text";
    }
    commit(); render();
  }).catch(() => error("That design couldn't be loaded. Please try again."));
}

// ---------------------------------------------------------------- touch up
// Brush over the picture to bring back parts the background removal took away (Restore) or to
// remove leftovers by hand (Erase). Removed areas show faintly so it is clear what can be restored.
// The result replaces the picture's background-removed version; Reset returns to the automatic one.
function openTouchUp(l) {
  const info = imgs[l.src]; if (!info || !info.img) return;
  const auto = () => R.removeWhite(info.img);
  const startFrom = l.removeWhite === false ? auto() : info.display || auto();
  const Wk = startFrom.width, Hk = startFrom.height;
  const work = document.createElement("canvas"); work.width = Wk; work.height = Hk;
  const wctx = work.getContext("2d"); wctx.drawImage(startFrom, 0, 0);
  const orig = document.createElement("canvas"); orig.width = Wk; orig.height = Hk;
  orig.getContext("2d").drawImage(info.img, 0, 0, Wk, Hk);
  const ov = document.createElement("div");
  ov.className = "lz-crop lz-touch";
  ov.innerHTML = `<div class="lz-crop-box"><div class="lz-crop-head"><h3>Touch up</h3><button type="button" class="lz-crop-x" data-c="cancel" aria-label="Close without saving">&times;</button></div>
    <div class="lz-seg" data-bind="brush"><button type="button" data-v="restore" aria-pressed="true">Restore</button><button type="button" data-v="erase" aria-pressed="false">Erase</button></div>
    <p class="lz-note" id="lz-touch-tip">Brush over parts that should be kept. Faded areas are removed.</p>
    <div class="lz-crop-stage lz-touch-stage"><canvas></canvas><span class="lz-brush" hidden></span></div>
    <label class="lz-field lz-touch-size"><span>Brush size</span><input type="range" min="8" max="90" value="28"></label>
    <div class="lz-row"><button type="button" class="btn btn-ghost-gold" data-c="undo" disabled>Undo</button><button type="button" class="btn btn-ghost-gold" data-c="reset">Reset</button><button type="button" class="btn btn-ghost-gold" data-c="cancel">Cancel</button><button type="button" class="btn btn-gold" data-c="apply">Done</button></div></div>`;
  root.querySelector(".lz").appendChild(ov);
  escToClose(ov);
  const stage = ov.querySelector(".lz-touch-stage"), cv = ov.querySelector("canvas"), dot = ov.querySelector(".lz-brush");
  const size = ov.querySelector("input[type=range]"), undoBtn = ov.querySelector('[data-c="undo"]');
  const maxW = Math.min(520, window.innerWidth - 64), maxH = Math.min(420, window.innerHeight * 0.5); // 64 = frame and box padding
  const sc = Math.min(maxW / Wk, maxH / Hk), dw = Math.round(Wk * sc), dh = Math.round(Hk * sc);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(dw * dpr); cv.height = Math.round(dh * dpr); cv.style.width = dw + "px"; cv.style.height = dh + "px";
  stage.style.width = dw + "px"; stage.style.height = dh + "px";
  const cctx = cv.getContext("2d");
  let mode = "restore", frame = 0;
  const undo = [];
  const show = () => { if (frame) return; frame = requestAnimationFrame(() => {
    frame = 0; cctx.clearRect(0, 0, cv.width, cv.height);
    cctx.globalAlpha = 0.22; cctx.drawImage(orig, 0, 0, cv.width, cv.height);
    cctx.globalAlpha = 1; cctx.drawImage(work, 0, 0, cv.width, cv.height);
  }); };
  show();
  const radius = () => (Number(size.value) / 2) / sc; // brush radius in picture pixels
  function dab(x, y) {
    const r = radius(), bx = Math.max(0, Math.floor(x - r)), by = Math.max(0, Math.floor(y - r));
    const bw = Math.min(Wk, Math.ceil(x + r)) - bx, bh = Math.min(Hk, Math.ceil(y + r)) - by;
    if (bw <= 0 || bh <= 0) return;
    wctx.save(); wctx.beginPath(); wctx.arc(x, y, r, 0, Math.PI * 2);
    if (mode === "erase") { wctx.globalCompositeOperation = "destination-out"; wctx.fill(); }
    else { wctx.clip(); wctx.clearRect(bx, by, bw, bh); wctx.drawImage(orig, bx, by, bw, bh, bx, by, bw, bh); }
    wctx.restore();
  }
  const at = (e) => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) / sc, y: (e.clientY - b.top) / sc, sx: e.clientX - b.left, sy: e.clientY - b.top }; };
  const moveDot = (p) => { const d = Number(size.value); dot.hidden = false; Object.assign(dot.style, { width: d + "px", height: d + "px", left: p.sx - d / 2 + "px", top: p.sy - d / 2 + "px" }); };
  let last = null;
  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    undo.push(wctx.getImageData(0, 0, Wk, Hk)); if (undo.length > 5) undo.shift(); undoBtn.disabled = false;
    last = at(e); dab(last.x, last.y); moveDot(last); show();
  });
  cv.addEventListener("pointermove", (e) => {
    const p = at(e); moveDot(p);
    if (!last) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / (radius() / 3)));
    for (let i = 1; i <= steps; i++) dab(last.x + (p.x - last.x) * i / steps, last.y + (p.y - last.y) * i / steps);
    last = p; show();
  });
  const stop = () => { last = null; };
  cv.addEventListener("pointerup", stop); cv.addEventListener("pointercancel", stop);
  cv.addEventListener("pointerleave", () => { if (!last) dot.hidden = true; });
  ov.querySelector('[data-bind="brush"]').onclick = (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    mode = b.dataset.v;
    ov.querySelectorAll('[data-bind="brush"] [data-v]').forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    ov.querySelector("#lz-touch-tip").textContent = mode === "restore" ? "Brush over parts that should be kept. Faded areas are removed." : "Brush over anything that should not be printed.";
  };
  ov.onclick = (e) => {
    const b = e.target.closest("[data-c]"); if (!b) return;
    const c = b.dataset.c;
    if (c === "undo") { const s = undo.pop(); if (s) wctx.putImageData(s, 0, 0); undoBtn.disabled = !undo.length; show(); return; }
    if (c === "reset") { undo.push(wctx.getImageData(0, 0, Wk, Hk)); undoBtn.disabled = false; wctx.clearRect(0, 0, Wk, Hk); wctx.drawImage(auto(), 0, 0, Wk, Hk); show(); return; }
    if (c === "apply") {
      work.bgKind = "plain";
      info.display = work; info.touched = true;
      layers().forEach((x) => { if (x.src === l.src) x.removeWhite = true; });
      commit(); render();
    }
    ov.remove();
  };
}

// ---------------------------------------------------------------- crop
function openCrop(l) {
  const info = imgs[l.src]; if (!info || !(info.display || info.img)) return;
  const src = info.display || info.img;
  const ov = document.createElement("div");
  ov.className = "lz-crop";
  ov.innerHTML = `<div class="lz-crop-box"><div class="lz-crop-head"><h3>Crop</h3><button type="button" class="lz-crop-x" data-c="cancel" aria-label="Close without saving">&times;</button></div><div class="lz-crop-stage"><canvas></canvas><div class="lz-crop-rect"><span data-h="nw"></span><span data-h="ne"></span><span data-h="sw"></span><span data-h="se"></span></div></div>
    <div class="lz-row"><button type="button" class="btn btn-ghost-gold" data-c="reset">Reset crop</button><button type="button" class="btn btn-ghost-gold" data-c="cancel">Cancel</button><button type="button" class="btn btn-gold" data-c="apply">Apply</button></div></div>`;
  root.querySelector(".lz").appendChild(ov);
  escToClose(ov);
  const stage = ov.querySelector(".lz-crop-stage"), cv = ov.querySelector("canvas"), rect = ov.querySelector(".lz-crop-rect");
  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
  const maxW = Math.min(520, window.innerWidth - 64), maxH = Math.min(420, window.innerHeight * 0.55);
  const sc = Math.min(maxW / sw, maxH / sh), dw = Math.round(sw * sc), dh = Math.round(sh * sc);
  cv.width = dw; cv.height = dh; stage.style.width = dw + "px"; stage.style.height = dh + "px";
  cv.getContext("2d").drawImage(src, 0, 0, dw, dh);
  let c = { ...(l.crop || { x: 0, y: 0, w: 1, h: 1 }) };
  const place = () => Object.assign(rect.style, { left: c.x * dw + "px", top: c.y * dh + "px", width: c.w * dw + "px", height: c.h * dh + "px" });
  place();
  rect.addEventListener("pointerdown", (e) => {
    e.preventDefault(); rect.setPointerCapture(e.pointerId);
    const h = e.target.dataset.h, x0 = e.clientX, y0 = e.clientY, c0 = { ...c }, min = 0.08;
    const mv = (ev) => {
      const dx = (ev.clientX - x0) / dw, dy = (ev.clientY - y0) / dh;
      if (!h) { c.x = clamp(c0.x + dx, 0, 1 - c0.w); c.y = clamp(c0.y + dy, 0, 1 - c0.h); }
      else {
        let { x, y, w, h: hh } = c0;
        if (h.includes("w")) { const nx = clamp(x + dx, 0, x + w - min); w += x - nx; x = nx; }
        if (h.includes("e")) w = clamp(w + dx, min, 1 - x);
        if (h.includes("n")) { const ny = clamp(y + dy, 0, y + hh - min); hh += y - ny; y = ny; }
        if (h.includes("s")) hh = clamp(hh + dy, min, 1 - y);
        c = { x, y, w, h: hh };
      }
      place();
    };
    const up = () => { rect.removeEventListener("pointermove", mv); rect.removeEventListener("pointerup", up); };
    rect.addEventListener("pointermove", mv); rect.addEventListener("pointerup", up);
  });
  ov.onclick = (e) => {
    const b = e.target.closest("[data-c]"); if (!b) return;
    if (b.dataset.c === "reset") { c = { x: 0, y: 0, w: 1, h: 1 }; place(); return; }
    if (b.dataset.c === "apply") {
      const full = c.w > 0.995 && c.h > 0.995;
      const oldH = R.layerBox(l, area(), 1, 1, imgs).h;
      if (full) delete l.crop; else l.crop = { x: round(c.x), y: round(c.y), w: round(c.w), h: round(c.h) };
      // keep the visible height roughly the same after cropping
      const newH = R.layerBox(l, area(), 1, 1, imgs).h;
      if (newH > 0) l.w = round(clamp(l.w * oldH / newH, 0.03, 3));
      commit(); render();
    }
    ov.remove();
  };
}

// ---------------------------------------------------------------- panels
function renderPanel() {
  const box = root.querySelector("#lz-panel");
  const tab = S.tab === "position" && !isMobile() ? "design" : S.tab;
  const titles = { design: "Add", text: "Text", product: "Product", review: "Review", position: "Position" };
  root.querySelector("#lz-sheet-title").textContent = titles[tab] || "";
  box.innerHTML = { design: designPanel, text: textPanel, product: productPanel, review: reviewPanel, position: positionPanel }[tab]();
  bindPanel(box);
}

function layerLabel(l) { return l.type === "image" ? "🖼 " + esc((imgs[l.src] || {}).name || l.name || "Your upload") + statusOf(l) + qualityBadge(l) : "T “" + esc(l.text.trim() || "Your text") + "”"; }
function designPanel() {
  const ls = layers(), n = setSize(S.options), z = personalization();
  const list = ls.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => `<li class="${i === S.sel ? "on" : ""}"><button type="button" data-select="${i}">${layerLabel(l)}</button>
    <span class="lz-lacts"><button type="button" class="lz-mini" data-up="${i}" aria-label="Bring forward" ${i === ls.length - 1 || l.clip || l.locked ? "disabled" : ""}>▲</button><button type="button" class="lz-mini" data-down="${i}" aria-label="Send backward" ${i === 0 || l.clip || l.locked ? "disabled" : ""}>▼</button><button type="button" class="lz-mini" data-del="${i}" aria-label="Delete">×</button></span></li>`).join("");
  const att = (S.attachments || []).filter((a) => a.area === area().id);
  return `
    ${n > 1 ? `<div class="lz-field"><span>Your set of ${n}</span><div class="lz-seg" data-bind="layout">
      <button type="button" data-v="same" aria-pressed="${S.layout === "same"}">Same design on all</button>
      <button type="button" data-v="each" aria-pressed="${S.layout === "each"}">Customize individually</button></div></div>` : ""}
    ${canPickDesigns() ? `<button type="button" class="btn btn-ghost-gold lz-wide" data-do="designs">✦ Choose a Lacci design</button>` : ""}
    <div class="lz-row">${z.upload ? `<button type="button" class="btn btn-gold" data-do="upload">＋ ${photoSpotOpen() ? "Add your photo" : "Upload"}</button>` : ""}${z.text ? `<button type="button" class="btn btn-ghost-gold" data-do="addtext">＋ Text</button>` : ""}</div>
    ${ls.length ? `<div class="lz-field"><span class="lz-lhead">Layers (top first)<button type="button" class="lz-clear" data-do="clearall">Clear all</button></span><ul class="lz-layers">${list}</ul></div>` : `<p class="lz-note">Nothing on ${esc(area().label.toLowerCase())} yet.</p>`}
    ${qualityNotes(ls, area())}
    ${att.length ? `<p class="lz-note">Attached for us to place: ${att.map((a) => esc(a.name)).join(", ")}</p>` : ""}
    ${bgNote(ls)}
    ${vinylNote()}`;
}
const bgKind = (l) => ((imgs[l.src] || {}).display || {}).bgKind || "";
function bgNote(ls) {
  const im = ls.filter((l) => l.type === "image" && !l.clip && !l.design), kinds = im.map((l) => [l, bgKind(l)]);
  if (kinds.some(([l, k]) => k === "plain" && l.removeWhite !== false)) return `<p class="lz-note">The plain background around your picture is removed, so only your design is printed. Tap <b>Remove bg</b> to keep it.</p>`;
  if (kinds.some(([, k]) => k === "plain")) return `<p class="lz-note">The background around your picture is kept and will be printed. Tap <b>Remove bg</b> to remove it.</p>`;
  if (kinds.some(([, k]) => k === "busy")) return `<p class="lz-note">This photo has a detailed background, so it's printed as it is.</p>`;
  return "";
}
function statusOf(l) { const i = imgs[l.src] || {}; return i.uploading ? " · uploading…" : i.failed ? " · upload failed" : ""; }
// Print sharpness of a picture at its current size: pixels across ÷ printed inches across.
// Under 100 per inch prints visibly blurry; 100–150 prints soft. Only a warning — the picture is never changed.
function quality(l, a = area()) {
  if (!l || l.type !== "image" || !l.naturalW || !a.print || !a.print.widthIn) return null;
  const inches = l.w * a.print.widthIn; // l.w is the share of the print area width
  const ppi = (l.naturalW * (l.crop ? l.crop.w : 1)) / Math.max(inches, 0.01);
  if (ppi < 100) return { level: "low", text: "This picture is small for the size it will print, so it may look blurry. A larger original works best, or make it smaller on the product." };
  if (ppi < 150) return { level: "soft", text: "This picture is enlarged and may print slightly soft. A larger original gives a sharper result." };
  return null;
}
const qualityBadge = (l) => { const q = quality(l); return q ? ` <em class="lz-q lz-q-${q.level}">${q.level === "low" ? "may print blurry" : "may print soft"}</em>` : ""; };
function qualityNotes(ls, a) {
  const qs = ls.map((l) => quality(l, a)).filter(Boolean);
  const worst = qs.find((q) => q.level === "low") || qs[0];
  return worst ? `<p class="lz-note lz-qnote">${worst.text}</p>` : "";
}
const COLOR_NOTE = `<details class="lz-colornote"><summary>Colours on screen may look slightly different from the finished product. <span>Learn more</span></summary>
  <p>Every screen shows colour a little differently, and each material takes ink in its own way, so small differences in colour and brightness are normal. The preview shows your design, size and placement. If exact colour matters, choose a digital proof and we'll check it with you before production.</p></details>`;
function vinylNote() {
  const c = product().colors && product().colors.find((x) => x.id === S.color);
  return c && c.vinyl ? `<p class="lz-note">Dark garments are decorated with heat-transfer vinyl rather than sublimation. Best for logos, text and solid-colour artwork — photographs and gradients are not suitable on dark fabric.</p>` : "";
}

// Shrinks a design's text line so a longer saying still fits the space it had in the design.
function fitText(t) {
  if (!t.maxW || !t.baseSize) return;
  const ab = R.areaBox(area(), 1000, 1000), c = fitText.ctx || (fitText.ctx = document.createElement("canvas").getContext("2d"));
  const shown = /Monogram/.test(t.font || "") ? t.text.toUpperCase() : t.text;
  c.font = `${t.bold ? 700 : 500} 100px ${R.fontFamily(t.font)}`;
  const wFrac = (c.measureText(shown).width * (t.baseSize * ab.h / 100)) / ab.w;
  t.size = round(wFrac > t.maxW ? t.baseSize * t.maxW / wFrac : t.baseSize);
}
function designIdeas() {
  const f = layers().find((x) => x.design && !x.locked);
  const d = f && (designList || []).find((x) => x.id === f.design.id);
  return d && Array.isArray(d.ideas) && d.ideas.length ? d.ideas : [];
}
function applyIdea(idea) {
  const ls = layers(), by = (r) => ls.find((x) => x.type === "text" && x.fromDesign && x.role === r);
  const top = by("top"), top2 = by("top2"), script = by("script");
  if (idea.top != null && top) {
    if (top2) { const p = idea.top.split(/ (?=\S+$)/); if (p.length > 1) { top.text = p[0]; top2.text = p[1]; } else { top.text = ""; top2.text = p[0]; } fitText(top2); } // one word sits on the lower line, next to the script
    else top.text = idea.top;
    fitText(top);
  }
  if (idea.script != null && script) { script.text = idea.script; fitText(script); }
  commit(); render();
}
function ideasBlock() {
  const ideas = designIdeas(); if (!ideas.length) return "";
  return `<div class="lz-field"><span>Wording ideas</span><div class="lz-ideas">${ideas.map((x, i) => `<button type="button" data-idea="${i}">${esc([x.top, x.script].filter(Boolean).join(" "))}</button>`).join("")}</div></div>`;
}
function textPanel() {
  const l = selected();
  const texts = layers().map((x, i) => [x, i]).filter(([x]) => x.type === "text");
  const list = texts.length ? `<ul class="lz-layers">${texts.map(([x, i]) => `<li class="${i === S.sel ? "on" : ""}"><button type="button" data-select="${i}">T “${esc(x.text.trim() || (x.fromDesign ? "empty line" : "Your text"))}”</button></li>`).join("")}</ul>` : "";
  if (!l || l.type !== "text") {
    return `${ideasBlock()}<button type="button" class="btn btn-gold lz-wide" data-do="addtext">＋ Add text</button>${list || `<p class="lz-note">Add a name, date, message or monogram. Select text on the product to change its font, size, colour, spacing or curve.</p>`}`;
  }
  return `${l.fromDesign ? ideasBlock() : ""}<label class="lz-field"><span>Your text</span><textarea id="lz-text" rows="2" maxlength="200" placeholder="e.g. The Smith Family">${esc(unusedOptional(l) ? "" : l.text)}</textarea></label>
    ${l.optional ? `<p class="lz-note">Optional. Leave it empty and this line won't be printed.</p>` : ""}
    <p class="lz-note">Use the toolbar under the product for font, size, colour, bold, alignment, spacing and curve.</p>
    <div class="lz-row"><button type="button" class="btn btn-ghost-gold" data-do="addtext">＋ Add another text</button><button type="button" class="btn btn-ghost-gold" data-do="done">Done</button></div>${texts.length > 1 ? list : ""}`;
}

// Accessible and precise alternative to the gestures (phone "Position" tool).
function positionPanel() {
  const l = selected();
  if (!l) return `<p class="lz-note">Tap your photo or text on the product first.</p>`;
  const b = (a, t, lab) => `<button type="button" class="lz-pbtn" data-pos="${a}" aria-label="${lab || t}">${t}</button>`;
  return `<div class="lz-pos">
    <div class="lz-pad">${b("up", "▲", "Move up")}<div>${b("left", "◀", "Move left")}${b("center", "✛", "Center")}${b("right", "▶", "Move right")}</div>${b("down", "▼", "Move down")}</div>
    <div class="lz-pgrid">${b("smaller", "− Smaller")}${b("bigger", "+ Bigger")}${b("rotl", "⟲ Rotate")}${b("rotr", "⟳ Rotate")}${l.type === "image" ? b("fit", "Fit") + b("fill", "Fill") : ""}${b("reset", "Reset")}</div></div>`;
}

function productPanel() {
  const p = product(), rp = rawProduct() || { optionGroups: [] };
  const groups = visibleGroups(rp).filter((g) => g.choices.length > 1);
  const html = groups.map((g) => {
    const isSet = /^quantity$/i.test(g.label) && g.choices.some((c) => /^Set of|^Single/i.test(choiceName(c)));
    if (isSet) {
      return `<div class="lz-field"><span>How many coasters</span><div class="lz-qcards">${g.choices.map((c) => {
        const name = choiceName(c), pr = priceLine(rp, { options: { ...S.options, [g.label]: name }, color: S.color }, raw().colors);
        const n = setSize({ Quantity: name });
        return `<button type="button" data-opt="${esc(g.label)}" data-v="${esc(name)}" aria-pressed="${S.options[g.label] === name}"><strong>${n}</strong><small>${n > 1 ? "coasters" : "coaster"}</small>${pr.ok ? `<em>${money(pr.unitCents)}</em>${n > 1 ? `<small>${money(Math.round(pr.unitCents / n))} each</small>` : ""}` : ""}</button>`;
      }).join("")}<a class="lz-qbulk" href="contact.html"><strong>10+</strong><small>Bulk / custom order</small><em>Get a quote</em></a></div></div>`;
    }
    return `<div class="lz-field"><span>${esc(g.label)}</span><div class="lz-chips">${g.choices.map((c) => {
      const name = choiceName(c);
      const tag = c && typeof c === "object" ? (c.price != null && c.price !== "" ? money(Math.round(c.price * 100)) : c.add ? "+" + money(Math.round(c.add * 100)) : "") : "";
      return `<button type="button" data-opt="${esc(g.label)}" data-v="${esc(name)}" aria-pressed="${S.options[g.label] === name}">${esc(name)}${tag ? ` <small>${tag}</small>` : ""}</button>`;
    }).join("")}</div></div>`;
  }).join("");
  const singles = visibleGroups(rp).filter((g) => g.choices.length === 1);
  const colors = p.colors && p.colors.length > 1 ? `<div class="lz-field"><span>Garment colour — ${esc((p.colors.find((c) => c.id === S.color) || {}).name || "")}</span><div class="lz-swatches">${p.colors.map((c) => `<button type="button" data-garment="${esc(c.id)}" aria-label="${esc(c.name)}" title="${esc(c.name)}" aria-pressed="${c.id === S.color}" style="background:${esc(c.hex)}"></button>`).join("")}</div>${vinylNote()}</div>`
    : p.colors && p.colors.length === 1 ? `<p class="lz-note">Garment colour: ${esc(p.colors[0].name)}</p>` : "";
  const n = setSize(S.options);
  return `${html}${colors}
    ${singles.length ? `<p class="lz-info-line">${singles.map((g) => `<span><small>${esc(g.label)}</small> ${esc(choiceName(g.choices[0]))}</span>`).join("")}</p>` : ""}
    <div class="lz-field"><span>${n > 1 ? "Number of sets" : "Quantity"}</span><div class="lz-stepper"><button type="button" data-qty="-1" aria-label="Fewer">−</button><output id="lz-qty">${S.qty}</output><button type="button" data-qty="1" aria-label="More">+</button></div></div>`;
}

function reviewPanel() {
  const pr = priced(), n = setSize(S.options), ar = areas(), z = personalization();
  const count = S.layout === "each" && n > 1 ? n : 1;
  const tiles = [];
  for (let i = 0; i < count; i++) for (const a of ar) tiles.push(`<figure><canvas data-final="${i}|${a.id}" width="300" height="300"></canvas><figcaption>${count > 1 ? `Coaster ${i + 1}` : ""}${count > 1 && ar.length > 1 ? " · " : ""}${ar.length > 1 ? esc(a.label) : ""}</figcaption></figure>`);
  const texts = [];
  for (let i = 0; i < count; i++) for (const a of ar) for (const l of layers(a.id, i)) if (l.type === "text" && l.text.trim()) texts.push(`“${esc(l.text.trim())}” — ${esc(l.font)}, ${esc(R.swatchName(l.color) || l.color)}`);
  return `
    <div class="lz-finals">${tiles.join("")}</div>
    <ul class="lz-summary">${pr.ok ? pr.summary.map((s) => `<li><span>${esc(s.label)}</span><strong>${esc(s.value)}</strong></li>`).join("") : ""}<li><span>${n > 1 ? "Sets" : "Quantity"}</span><strong>${S.qty}</strong></li>${pr.ok ? `<li><span>Total</span><strong>${money(pr.unitCents * S.qty)}</strong></li>` : ""}</ul>
    ${texts.length ? `<p class="lz-note">${texts.join("<br>")}</p>` : ""}
    ${reviewQuality(count, ar)}
    ${COLOR_NOTE}
    ${z.proof ? `<label class="lz-check"><input type="checkbox" id="lz-proof" ${S.proof ? "checked" : ""}> <span>Send me a digital proof before making my order — production starts after you approve it.</span></label>` : ""}
    ${z.notes ? `<label class="lz-field"><span>Special requests (optional)</span><textarea id="lz-comments" rows="2" maxlength="1000" placeholder="Exact wording, event date, anything we should know">${esc(S.comments)}</textarea></label>` : ""}`;
}

function reviewQuality(count, ar) {
  const out = [];
  for (let i = 0; i < count; i++) for (const a of ar) layers(a.id, i).forEach((l) => { const q = quality(l, a); if (q) out.push(`${esc((imgs[l.src] || {}).name || l.name || "Your picture")}${count > 1 ? ` (coaster ${i + 1})` : ""}: ${q.level === "low" ? "may print blurry" : "may print slightly soft"}`); });
  return out.length ? `<p class="lz-note lz-qnote">${out.join("<br>")}. You can still order; a larger original gives a sharper result.</p>` : "";
}
function drawFinals() {
  root.querySelectorAll("canvas[data-final]").forEach((c) => {
    const [i, id] = c.dataset.final.split("|"), a = areas().find((x) => x.id === id);
    R.drawComposite(c.getContext("2d"), a, layers(id, +i).filter((l) => filled(l) && !unusedOptional(l)), 300, 300, imgs, { mockup: mockupImage(a, drawFinals) });
  });
}

function bindPanel(box) {
  box.onclick = (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.idea != null) { const idea = designIdeas()[+t.dataset.idea]; if (idea) applyIdea(idea); }
    else if (t.dataset.do === "clearall") clearSide();
    else if (t.dataset.do === "designs") openDesigns();
    else if (t.dataset.do === "upload") pickFile();
    else if (t.dataset.do === "addtext") addText();
    else if (t.dataset.do === "done") { S.sel = -1; S.sheet = false; render(); }
    else if (t.dataset.select != null) { S.sel = +t.dataset.select; if (isMobile()) S.sheet = false; render(); canvas.focus({ preventScroll: true }); }
    else if (t.dataset.del != null) { layers().splice(+t.dataset.del, 1); S.sel = -1; commit(); render(); }
    else if (t.dataset.up != null) { S.sel = +t.dataset.up; tool("forward"); }
    else if (t.dataset.down != null) { S.sel = +t.dataset.down; tool("backward"); }
    else if (t.dataset.pos) position(t.dataset.pos);
    else if (t.dataset.garment) { S.color = t.dataset.garment; commit(); render(); }
    else if (t.dataset.opt) setOption(t.dataset.opt, t.dataset.v);
    else if (t.dataset.qty) { S.qty = clamp(S.qty + Number(t.dataset.qty), 1, 50); commit(); render(); }
    else if (t.closest("[data-bind=layout]")) setLayout(t.dataset.v);
  };
  box.oninput = (e) => {
    const t = e.target, l = selected();
    if (t.id === "lz-text" && l) { l.text = t.value.slice(0, 200); if (l.fromDesign) fitText(l); draw(); if (/\s$/.test(t.value)) commit(); else commitSoon(); } // one step per word
    else if (t.id === "lz-comments") { S.comments = t.value; saveWip(); }
    else if (t.id === "lz-proof") { S.proof = t.checked; saveWip(); }
  };
  box.onchange = (e) => { if (e.target.id === "lz-proof") { S.proof = e.target.checked; saveWip(); } if (e.target.id === "lz-text") { commit(); renderCtx(); } };
  if (S.tab === "review") drawFinals();
}
function position(a) {
  const l = selected(); if (!l) return;
  const step = 0.02;
  if (a === "up") l.y = round(l.y - step); else if (a === "down") l.y = round(l.y + step);
  else if (a === "left") l.x = round(l.x - step); else if (a === "right") l.x = round(l.x + step);
  else return tool(a);
  commit(); draw();
}

function setOption(label, value) {
  const before = setSize(S.options);
  const after = setSize({ ...S.options, [label]: value });
  if (S.layout === "each" && after < before && S.items.slice(after).some(hasContent) && !confirm(`Coasters ${after + 1}–${before} have designs. Remove them?`)) return;
  S.options[label] = value;
  if (S.layout === "each") S.items = S.items.slice(0, Math.max(after, 1));
  if (after <= 1) { if (S.layout === "each") S.shared = S.items[0] || S.shared; S.layout = "same"; S.item = 0; }
  S.sel = -1;
  commit(); render();
}
function setLayout(v) {
  if (v === S.layout) return;
  const n = setSize(S.options);
  if (v === "each") { S.items = Array.from({ length: n }, () => clone(S.shared)); S.item = 0; }
  else {
    const differ = S.items.some((d) => JSON.stringify(d) !== JSON.stringify(S.items[0]));
    if (differ && !confirm("Use Coaster 1's design on every coaster?")) return;
    S.shared = S.items[0] || {};
  }
  S.layout = v; S.sel = -1; commit(); render();
}

// ---------------------------------------------------------------- layers
function pickFile() { root.querySelector("#lz-file").click(); }

function addText() {
  if (layers().length >= MAX_LAYERS) return error(`Up to ${MAX_LAYERS} items per side.`);
  S.started = true;
  const hasImg = layers().some((l) => l.type === "image");
  layers().push({ type: "text", text: "", font: "Serif / Classic", color: "#141414", size: 0.14, x: 0.5, y: hasImg ? 0.85 : 0.5, rotation: 0, spacing: 0, curve: 0, bold: false, vertical: false, align: "center" });
  S.sel = layers().length - 1; S.tab = "text"; S.tool = ""; if (isMobile()) S.sheet = true;
  commit(); render();
  const ta = root.querySelector("#lz-text"); if (ta) ta.focus({ preventScroll: true });
}

// replaceLayer: keep its position, size and rotation, swap the picture.
function addUpload(file, replaceLayer) {
  if (!replaceLayer && layers().length >= MAX_LAYERS) return error(`Up to ${MAX_LAYERS} items per side.`);
  if (file.size > 25 * 1024 * 1024) return error("That file is over 25 MB. Please choose a smaller file.");
  if (!ucKey()) return error("Uploads aren't available right now. Please add text, or contact us to send your file.");
  S.started = true;
  const key = "local:" + (++localSeq);
  const info = imgs[key] = { name: file.name.slice(0, 120), uploading: true };
  const layer = replaceLayer || { type: "image", src: key, naturalW: 0, naturalH: 0, x: 0.5, y: 0.5, w: 0.8, rotation: 0, removeWhite: true, name: info.name };
  const place = (img) => {
    info.img = img; info.w = img.naturalWidth; info.h = img.naturalHeight; info.display = R.removeWhite(img);
    if (replaceLayer) { layer.src = key; layer.name = info.name; layer.naturalW = info.w; layer.naturalH = info.h; delete layer.crop; }
    else {
      layer.naturalW = info.w; layer.naturalH = info.h;
      const frame = !replaceLayer && photoFrame();
      if (frame) {
        layers().filter((x) => x.clip).forEach((x) => layers().splice(layers().indexOf(x), 1)); // one photo per spot: a new one replaces it
        placeInSpot(layer, frame.spot); layers().unshift(layer); S.sel = 0;
      } else {
        fitLayer(layer, "fit", 0.85);
        if (!layers().includes(layer)) { layers().push(layer); S.sel = layers().length - 1; }
      }
    }
    commit(); render();
  };
  const decode = new Image();
  decode.onload = () => place(decode);
  decode.onerror = () => { info.needsServerPreview = true; };
  decode.src = URL.createObjectURL(file);
  render();
  const fd = new FormData();
  fd.append("UPLOADCARE_PUB_KEY", ucKey()); fd.append("UPLOADCARE_STORE", "auto"); fd.append("file", file);
  fetch("https://upload.uploadcare.com/base/", { method: "POST", body: fd })
    .then((r) => r.json())
    .then((d) => {
      if (!d || !d.file) throw new Error("upload failed");
      info.url = UCCDN + d.file + "/-/inline/no/";
      seen[info.url] = info;
      info.uploading = false;
      if (info.needsServerPreview) serverPreview(info, place, 0);
      render();
    })
    .catch(() => { info.uploading = false; info.failed = true; render(); error("Your file didn't upload. Please delete it and try again."); });
}
// Files the browser can't show (HEIC and similar) are shown from the processed upload.
function serverPreview(info, place, tries) {
  const img = new Image(); img.crossOrigin = "anonymous";
  img.onload = () => place(img);
  img.onerror = () => {
    if (tries < 6) return setTimeout(() => serverPreview(info, place, tries + 1), 800);
    info.previewless = true;
    S.attachments = (S.attachments || []).concat([{ src: info.url, name: info.name, area: area().id }]);
    error("We received your file but can't show it here. Describe where it goes in Special requests and we'll place it for you.");
    commit(); render();
  };
  img.src = ucDisplay(info.url) + (tries ? "?r=" + tries : "");
}

// ---------------------------------------------------------------- gestures
function bindGestures() {
  const pts = new Map();
  let g = null, moved = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (W / r.height) }; };
  const box = () => R.areaBox(area(), W, W);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const snap = (l) => ({ x: l.x, y: l.y, w: l.w, size: l.size, rotation: l.rotation });

  function startSingle(p, pointerType) {
    const ls = layers().map(withPlaceholder), a = area();
    const sel = ls[S.sel];
    const pad = pointerType === "touch" ? 24 : 12;
    if (sel) {
      const h = R.handlePoints(sel, a, W, W, imgs), c = R.layerBox(sel, a, W, W, imgs);
      if (Math.hypot(p.x - h.rotate[0], p.y - h.rotate[1]) < pad) return (g = { kind: "rotate", c, a0: Math.atan2(p.y - c.cy, p.x - c.cx), s: snap(selected()) });
      if (Math.hypot(p.x - h.resize[0], p.y - h.resize[1]) < pad) return (g = { kind: "resize", c, d0: Math.hypot(p.x - c.cx, p.y - c.cy), s: snap(selected()) });
    }
    for (let i = ls.length - 1; i >= 0; i--) {
      if (ls[i].locked) continue; // a photo design's artwork stays put; taps reach the photo under it
      if (R.hitLayer(ls[i], a, W, W, imgs, p.x, p.y, pointerType === "touch" ? 8 : 2)) {
        if (S.sel !== i) { S.sel = i; S.tool = ""; render(); }
        return (g = { kind: "move", p0: p, s: snap(selected()) });
      }
    }
    if (S.sel !== -1) { S.sel = -1; render(); }
    g = null;
  }
  const wrapEl = () => root.querySelector("#lz-canvaswrap");
  const scr = new Map(); // screen positions, for panning and view zoom
  const rawDist = () => { const [a, b] = [...scr.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const rawMid = () => { const [a, b] = [...scr.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  function startPinch() {
    const l = selected(); if (!l) return (g = null);
    const [a, b] = [...pts.values()];
    g = { kind: "pinch", d0: dist(a, b), a0: ang(a, b), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s: snap(l) };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (S.all) { S.all = false; draw(); }
    if (!layers().length && zoom === 1 && e.pointerType !== "touch") return;
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, pos(e));
    scr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pts.size === 1) {
      if (layers().length) startSingle(pos(e), e.pointerType); else g = null;
      if (!g && zoom > 1) { const w = wrapEl(); g = { kind: "pan", x0: e.clientX, y0: e.clientY, sl: w.scrollLeft, st: w.scrollTop }; }
    } else if (pts.size === 2) {
      if (g && g.kind === "pan") g = null;
      if (!selected() && layers().length) startSingle([...pts.values()][0], e.pointerType);
      if (selected()) startPinch();
      else g = { kind: "view", d0: rawDist(), z0: zoom };
    }
    draw();
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) {
      if (e.pointerType === "mouse" && selected()) {
        const p = pos(e), l = withPlaceholder(selected()), h = R.handlePoints(l, area(), W, W, imgs);
        canvas.style.cursor = Math.hypot(p.x - h.rotate[0], p.y - h.rotate[1]) < 12 ? "grab" : Math.hypot(p.x - h.resize[0], p.y - h.resize[1]) < 12 ? "nwse-resize" : R.hitLayer(l, area(), W, W, imgs, p.x, p.y) ? "move" : "default";
      }
      return;
    }
    pts.set(e.pointerId, pos(e));
    scr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g && g.kind === "pan") { const w = wrapEl(); w.scrollLeft = g.sl - (e.clientX - g.x0); w.scrollTop = g.st - (e.clientY - g.y0); return; }
    if (g && g.kind === "view") { if (scr.size >= 2) { const m = rawMid(); setZoom(g.z0 * rawDist() / Math.max(1, g.d0), m.x, m.y); } return; }
    const l = selected(); if (!g || !l) return;
    moved = true;
    const b = box(), p = pos(e), k = l.type === "text" ? "size" : "w";
    if (g.kind === "move") {
      l.x = round(clamp(g.s.x + (p.x - g.p0.x) / b.w, -0.5, 1.5));
      l.y = round(clamp(g.s.y + (p.y - g.p0.y) / b.h, -0.5, 1.5));
    } else if (g.kind === "resize") {
      l[k] = round(clamp(g.s[k] * Math.hypot(p.x - g.c.cx, p.y - g.c.cy) / Math.max(1, g.d0), 0.03, 3));
    } else if (g.kind === "rotate") {
      l.rotation = snapRot(g.s.rotation + (Math.atan2(p.y - g.c.cy, p.x - g.c.cx) - g.a0) * 180 / Math.PI);
    } else if (g.kind === "pinch" && pts.size >= 2) {
      const [a, c] = [...pts.values()];
      const m = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
      l[k] = round(clamp(g.s[k] * dist(a, c) / Math.max(1, g.d0), 0.03, 3));
      l.rotation = snapRot(g.s.rotation + (ang(a, c) - g.a0) * 180 / Math.PI);
      l.x = round(clamp(g.s.x + (m.x - g.m0.x) / b.w, -0.5, 1.5));
      l.y = round(clamp(g.s.y + (m.y - g.m0.y) / b.h, -0.5, 1.5));
    }
    draw();
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId); scr.delete(e.pointerId);
    if (g && (g.kind === "pan" || g.kind === "view")) { if (!pts.size) g = null; return; }
    if (pts.size === 1 && selected()) { const p = [...pts.values()][0]; g = { kind: "move", p0: p, s: snap(selected()) }; }
    else if (!pts.size) { g = null; if (moved) commit(); }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  // Mouse wheel / trackpad: only while an item is selected and the pointer is over the product,
  // so ordinary page scrolling is never taken over. Pinch on a Mac trackpad arrives as ctrl+wheel.
  canvas.addEventListener("wheel", (e) => {
    const l = selected();
    if (!l && e.ctrlKey) { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); return; }
    if (!l) return;
    e.preventDefault();
    const k = l.type === "text" ? "size" : "w";
    if (e.shiftKey) l.rotation = snapRot(l.rotation + (e.deltaY > 0 ? 3 : -3));
    else l[k] = round(clamp(l[k] * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), 0.03, 3));
    draw(); commitSoon();
  }, { passive: false });
  if (!keysBound) { keysBound = true; document.addEventListener("keydown", onKey); }
}
let keysBound = false;
// Keyboard shortcuts while the window is open. Ignored while typing in a field or when a
// Crop / Touch up / Lacci designs box is open, so Backspace in the text box only edits text.
function onKey(e) {
    if (!root || !root.isConnected || !S) return;
    const t = e.target;
    if (t && (t.closest && t.closest("input, textarea, select, [contenteditable]"))) return;
    if (root.querySelector(".lz-crop")) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      if (!layers().length) return;
      e.preventDefault(); S.all = true; S.sel = -1; render(); return;
    }
    if (S.all) {
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); clearSide(); return; }
      if (e.key === "Escape") { S.all = false; render(); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    const l = selected();
    if (!l) { if (/^Arrow/.test(e.key) && layers().length) { S.sel = layers().length - 1; render(); e.preventDefault(); } return; }
    const step = e.shiftKey ? 0.05 : 0.01, k = l.type === "text" ? "size" : "w";
    const acts = {
      ArrowLeft: () => (l.x = round(l.x - step)), ArrowRight: () => (l.x = round(l.x + step)),
      ArrowUp: () => (l.y = round(l.y - step)), ArrowDown: () => (l.y = round(l.y + step)),
      "+": () => (l[k] = round(clamp(l[k] * 1.05, 0.03, 3))), "=": () => (l[k] = round(clamp(l[k] * 1.05, 0.03, 3))), "-": () => (l[k] = round(clamp(l[k] / 1.05, 0.03, 3))),
      "[": () => (l.rotation = snapRot(l.rotation - (e.shiftKey ? 15 : 5))), "]": () => (l.rotation = snapRot(l.rotation + (e.shiftKey ? 15 : 5))),
    };
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return tool("delete"); }
    if (e.key === "Escape") { S.sel = -1; render(); return; }
    if (acts[e.key]) { acts[e.key](); e.preventDefault(); e.stopPropagation(); draw(); commit(); } // one step per key press
}
// Remove everything on this side (Clear all, or select all + Delete). Undo brings it back.
function clearSide() {
  const ls = layers(); if (!ls.length) return;
  if (!confirm("Remove everything on this side? You can undo this.")) return;
  ls.splice(0, ls.length); S.sel = -1; S.all = false; commit(); render();
}

// ---------------------------------------------------------------- saving to the cart
function error(msg) {
  const el = root && root.querySelector("#lz-err"); if (!el) return;
  el.textContent = msg; el.hidden = false;
  clearTimeout(error.t); error.t = setTimeout(() => (el.hidden = true), 6000);
}

function recordLayer(l) {
  if (l.type === "image") {
    const o = { type: "image", src: imgs[l.src].url, name: l.name || "", naturalW: l.naturalW || 0, naturalH: l.naturalH || 0, x: l.x, y: l.y, w: l.w, rotation: l.rotation, removeWhite: l.removeWhite !== false };
    if (l.crop) o.crop = l.crop; if (l.flipX) o.flipX = true;
    if (l.design) o.design = l.design; if (l.locked) o.locked = true; if (l.clip) o.clip = l.clip; if (l.spot) o.spot = l.spot;
    return o;
  }
  return { type: "text", text: l.text.trim(), font: l.font, color: l.color, size: l.size, x: l.x, y: l.y, rotation: l.rotation, spacing: l.spacing || 0, curve: l.curve || 0, bold: !!l.bold, vertical: !!l.vertical, align: l.align || "center" };
}
function recordAreas(d, ar) {
  const out = {};
  for (const a of ar) {
    const ls = (d[a.id] || []).filter((l) => filled(l) && !unusedOptional(l)).map(recordLayer);
    const att = (S.attachments || []).filter((x) => x.area === a.id).map((x) => ({ src: x.src, name: x.name }));
    if (ls.length || att.length) out[a.id] = { layers: ls, ...(att.length ? { attachments: att } : {}) };
  }
  return out;
}

async function renderAndUpload(a, ls, name) {
  const size = 900, c = document.createElement("canvas"); c.width = c.height = size;
  const mk = a.mockup ? await R.loadImage(a.mockup).catch(() => null) : null;
  const hex = garmentHex();
  R.drawComposite(c.getContext("2d"), a, ls, size, size, imgs, { mockup: mk && hex ? R.tinted(mk, hex) : mk });
  return uploadCanvas(c, name);
}
// Full-size print copy that follows a touched-up picture: the original pixels, with the edited
// version's transparency scaled up over them.
function maskedCopy(info) {
  const iw = info.img.naturalWidth || info.img.width, ih = info.img.naturalHeight || info.img.height;
  const s = Math.min(1, 4000 / Math.max(iw, ih)), c = document.createElement("canvas");
  c.width = Math.round(iw * s); c.height = Math.round(ih * s);
  const x = c.getContext("2d");
  x.drawImage(info.img, 0, 0, c.width, c.height);
  x.globalCompositeOperation = "destination-in"; x.drawImage(info.display, 0, 0, c.width, c.height);
  return c;
}
// Small picture of the design kept with the cart line, so the cart shows it straight away and
// without depending on the upload.
function thumbOf(a, ls) {
  const c = document.createElement("canvas"); c.width = c.height = 240;
  try { R.drawComposite(c.getContext("2d"), a, ls, 240, 240, imgs, { mockup: mockupImage(a) }); return c.toDataURL("image/jpeg", 0.8); } catch { return ""; }
}
async function uploadCanvas(c, name) {
  const blob = await new Promise((res) => { try { c.toBlob(res, "image/png"); } catch { res(null); } });
  if (!blob || !ucKey()) return "";
  const fd = new FormData();
  fd.append("UPLOADCARE_PUB_KEY", ucKey()); fd.append("UPLOADCARE_STORE", "auto"); fd.append("file", blob, name);
  try { const d = await (await fetch("https://upload.uploadcare.com/base/", { method: "POST", body: fd })).json(); return d && d.file ? UCCDN + d.file + "/" : ""; } catch { return ""; }
}

// Plain-language placement kept on the line for the Stripe description and older views.
function placementSentence(rec, ar) {
  const parts = [];
  const each = (areasRec, prefix) => {
    for (const a of ar) {
      const d = areasRec[a.id]; if (!d) continue;
      d.layers.forEach((l) => parts.push(`${prefix}${a.label}: ${l.type === "image" ? "artwork" : `text “${l.text}”`} at ${Math.round(l.x * 100)}% across, ${Math.round(l.y * 100)}% down, ${l.type === "image" ? Math.round(l.w * 100) + "% width" : Math.round(l.size * 100) + "% height"}${l.rotation ? `, ${l.rotation}°` : ""}`));
    }
  };
  if (rec.items) rec.items.forEach((it) => each(it.areas, `Coaster ${it.index + 1} · `)); else each(rec.areas, "");
  return parts.join(" · ").slice(0, 1000);
}
// Record layers point at uploaded URLs; drawing uses the in-memory image under either key.
function liveLayer(l) {
  if (l.type !== "image") return l;
  const key = Object.keys(imgs).find((k) => imgs[k].url === l.src);
  return key ? { ...l, src: key } : l;
}

async function addToCart() {
  const add = root.querySelector("#lz-add");
  if (uploadingAny()) return;
  const pr = priced(); if (!pr.ok) return error(pr.error);
  const used = new Set(Object.values(S.shared).concat(...S.items.map((d) => Object.values(d))).flat().filter((l) => l && l.type === "image").map((l) => l.src));
  if ([...used].some((k) => imgs[k] && imgs[k].failed)) return error("One of your files didn't upload. Delete it and upload it again.");
  const n = setSize(S.options), ar = areas(), each = S.layout === "each" && n > 1;
  const designs = each ? S.items.slice(0, n) : [S.shared];
  const hasAtt = (S.attachments || []).length > 0;
  const empty = designs.findIndex((d) => !hasContent(Object.fromEntries(ar.map((a) => [a.id, d[a.id] || []]))) && !hasAtt);
  if (empty >= 0) {
    if (each) { S.item = empty; render(); return error(`Coaster ${empty + 1} has no design yet.`); }
    S.tab = "design"; render(); return error("Add your text or upload a photo or design.");
  }
  if (!each && ar.length > 1 && !hasAtt) {
    const missing = ar.find((a) => !(S.shared[a.id] || []).some(filled));
    if (missing) { S.area = missing.id; render(); return error(`Add your design for the ${missing.label.toLowerCase()} too, or choose a different print location.`); }
  }
  const leftover = [...new Set(designs.flatMap((d) => Object.values(d || {}).flat()).filter((l) => l && l.type === "text" && l.placeholder && !l.optional && l.text.trim() === l.placeholder).map((l) => l.text.trim()))];
  if (leftover.length && !confirm(`Your design still shows the sample wording “${leftover.join("”, “")}”. Add to cart anyway? Tap Cancel to change the text.`)) { S.tab = "text"; render(); return; }
  add.disabled = true; add.textContent = "Saving your design…";
  const rec = { schema: 1, customizationId: S.customizationId, productId: S.pid, layout: each ? "each" : "same", proof: S.proof, comments: S.comments.trim().slice(0, 1000), createdAt: new Date().toISOString() };
  if (each) rec.items = designs.map((d, i) => ({ index: i, areas: recordAreas(d, ar) }));
  else rec.areas = recordAreas(S.shared, ar);
  const jobs = [];
  if (each) rec.items.forEach((it, i) => ar.forEach((a) => jobs.push(renderAndUpload(a, ((it.areas[a.id] || {}).layers || []).map(liveLayer), `coaster-${i + 1}-${a.id}.png`).then((u) => { if (u) (it.previews = it.previews || {})[a.id] = u; }))));
  else { rec.previews = {}; ar.forEach((a) => jobs.push(renderAndUpload(a, ((rec.areas[a.id] || {}).layers || []).map(liveLayer), `design-${a.id}.png`).then((u) => { if (u) rec.previews[a.id] = u; }))); }
  // Print copy with the plain background removed, for every picture the customer kept it removed on.
  const recLayers = (each ? rec.items.flatMap((it) => Object.values(it.areas)) : Object.values(rec.areas)).flatMap((d) => d.layers).filter((l) => l.type === "image" && l.removeWhite);
  const cuts = {};
  for (const l of recLayers) {
    const key = liveLayer(l).src, info = imgs[key];
    if (cuts[l.src] || !info || !info.img || bgKind({ src: key }) !== "plain") continue;
    const base = (l.name || "design").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 60) || "design";
    cuts[l.src] = uploadCanvas(info.touched ? maskedCopy(info) : R.removeWhite(info.img, 4000), base + "-no-background.png");
  }
  jobs.push(...Object.entries(cuts).map(([src, p]) => p.then((u) => { if (u) recLayers.filter((l) => l.src === src).forEach((l) => (l.cutout = u)); })));
  await Promise.all(jobs);
  const firstPreview = each ? Object.values((rec.items[0] || {}).previews || {})[0] : rec.previews[ar[0].id];
  const allLayers = (each ? rec.items.flatMap((it) => Object.values(it.areas)) : Object.values(rec.areas)).flatMap((d) => d.layers);
  const texts = allLayers.filter((l) => l.type === "text");
  // First customer upload on a side (a Lacci design picture is not a customer file)
  const firstImg = (id) => { const d = each ? (rec.items[0] || {}).areas || {} : rec.areas; const x = d[id]; return x ? ((x.layers.find((l) => l.type === "image" && !l.design) || {}).src || ((x.attachments || [])[0] || {}).src || "") : ""; };
  const line = {
    productId: S.pid, name: product().name, image: firstPreview || product().image, qty: S.qty, options: { ...S.options }, color: S.color,
    customizationId: S.customizationId, customization: rec,
    thumbs: (each ? rec.items.map((it) => it.areas) : [rec.areas]).map((as) => thumbOf(ar[0], (((as || {})[ar[0].id] || {}).layers || []).map(liveLayer))).filter(Boolean),
    personalization: {
      text: texts.map((t) => t.text).join(" / ").slice(0, 1000), font: (texts[0] || {}).font || "",
      textColor: texts[0] ? (R.swatchName(texts[0].color) || "Custom") : "", textColorCode: (texts[0] || {}).color || "",
      placement: placementSentence(rec, ar), textStyle: texts.map((t) => [t.font, t.bold ? "bold" : "", t.vertical ? "vertical" : "", t.curve ? `curve ${t.curve}` : "", t.spacing ? `spacing ${t.spacing}` : "", t.align && t.align !== "center" ? `align ${t.align}` : ""].filter(Boolean).join(" · ")).join(" / ").slice(0, 1000),
      comments: rec.comments, proof: S.proof ? PROOF_YES : PROOF_NO,
    },
    files: { design: firstImg(ar[0].id), backDesign: ar.length > 1 ? firstImg(ar[1].id) : "", preview: firstPreview || "" },
  };
  const send = () => {
    if (S.editIndex !== null && window.LacciCheckout.replace) window.LacciCheckout.replace(S.editIndex, line);
    else window.LacciCheckout.add(line);
    clearWip(S.pid);
    root.classList.remove("show"); document.documentElement.classList.remove("lz-lock");
    setTimeout(() => { if (root) { root.remove(); root = null; } }, 250);
  };
  if (window.LacciCheckout) send(); else document.addEventListener("lacci:checkout-ready", send, { once: true });
}

window.LacciCustomizer = { open, edit };
export default { open, edit };
