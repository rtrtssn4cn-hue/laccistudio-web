// Lacci Studio Admin — home, products table, product workspace (Overview · Pricing · Media · Variants ·
// Personalization · Shipping · SEO) with a live card preview, Save draft → Publish / Discard.
// Everything edits content/products.json through /api/admin/content/*, which checks GitHub push
// access and validates every save on the server. There is no second copy of the product data.
import { choiceModCents, choiceName, isVisible, money, cents } from "/assets/js/pricing.mjs";

const API = "/api/admin/content";
const WORK_KEY = "lacci-admin-work";
const STATUS_LABEL = { active: "Available", hidden: "Hidden", draft: "Draft", seasonal: "Seasonal", archived: "Archived" };
const FILTERS = [["all", "All"], ["active", "Active"], ["hidden", "Hidden"], ["draft", "Draft"], ["featured", "Featured"], ["seasonal", "Seasonal"], ["archived", "Archived"]];
const TABS = [["overview", "Overview"], ["pricing", "Pricing"], ["media", "Media"], ["variants", "Variants"], ["personalization", "Personalization"], ["shipping", "Shipping"], ["seo", "SEO"]];
const FONTS = ["Script / Cursive", "Serif / Classic", "Sans-serif / Modern", "Handwritten", "Bold / Block", "Monogram"];
const PERSONALIZATION = [
  ["upload", "Customer can upload a photo or design", true], ["text", "Customer can add text", true],
  ["designs", "Ready-made Lacci designs", false], ["blank", "Start blank", true],
  ["preview", "Live preview on the product", true], ["proof", "Digital proof offered", true], ["notes", "Special requests box", true],
];

const state = {
  token: null, user: null, server: null, baseSha: null, products: [], colors: [],
  remote: { unpublished: 0, draftCommits: [], recentLive: [] },
  filter: "all", cat: "", q: "", selected: new Set(), loading: true, error: "",
  tab: "overview", colorQ: "", colorView: "available", colorSel: new Set(), showHiddenColors: false, previewOpen: false,
  blobs: {}, openInactive: new Set(),
};

// ---------------------------------------------------------------- helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const statusOf = (p) => (p.status || (p.hidden === true ? "hidden" : "active"));
const isOn = (p) => statusOf(p) === "active";
const liveOf = (id) => state.server && state.server.products.find((p) => p.id === id);
function imgSrc(src) {
  if (!src) return "";
  if (state.blobs[src]) return state.blobs[src];
  try { const u = new URL(src, location.origin); return u.hostname.endsWith("laccistudio.com") ? u.pathname + u.search : u.href; } catch { return ""; }
}
// Pictures uploaded in this draft aren't on the website yet: read them back from the draft.
async function draftFile(path) {
  if (state.blobs[path] || !/^\/assets\/img\/uploads\//.test(path)) return state.blobs[path];
  try {
    const r = await api("/file?path=" + encodeURIComponent(path.slice(1)));
    const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    const type = /\.mp4$/.test(path) ? "video/mp4" : /\.png$/.test(path) ? "image/png" : /\.webp$/.test(path) ? "image/webp" : "image/jpeg";
    state.blobs[path] = URL.createObjectURL(new Blob([bin], { type }));
    return state.blobs[path];
  } catch { return ""; }
}
// The shop grid shows a small JPEG copy of each product mockup (assets/img/card/, same rule as
// cart.js mediaHTML); the admin card preview and thumbnails use the same copy so they match the Shop.
function cardSrc(src) { return String(src || "").replace(/^(https?:\/\/[^\/]+)?\/?assets\/img\/mock\/([\w-]+)\.png(\?.*)?$/, "/assets/img/card/$2.jpg"); }
function img(src, attrs = {}, asCard) {
  const first = asCard && cardSrc(src) !== src ? cardSrc(src) : imgSrc(src);
  const el = h("img", { src: first, alt: "", loading: "lazy", ...attrs });
  // fallbacks: card copy missing → original file → a picture uploaded in this draft
  el.addEventListener("error", async function retry() {
    if (el.getAttribute("src") === first && first !== imgSrc(src)) { el.addEventListener("error", retry, { once: true }); el.src = imgSrc(src); return; }
    const b = await draftFile(src); if (b && el.src !== b) el.src = b;
  }, { once: true });
  return el;
}
function mainImage(p) { return (p.images || [])[0] || p.mockupPhoto || ""; }
const visibleGroups = (p) => (p.optionGroups || []).map((g) => ({ label: g.label, choices: (g.choices || []).filter(isVisible) }));
// Lowest price a customer can pay, optionally with one group's choice fixed.
function fromCents(p, fixLabel, fixChoice) {
  let total = cents(p.price);
  for (const g of visibleGroups(p)) {
    const pool = g.label === fixLabel ? [fixChoice] : g.choices;
    if (!pool.length) continue;
    total += Math.min(...pool.map((c) => choiceModCents(p, c)));
  }
  return total;
}
function priceLabel(p) {
  const multi = visibleGroups(p).some((g) => new Set(g.choices.map((c) => choiceModCents(p, c))).size > 1);
  return (multi ? "from " : "") + money(fromCents(p));
}
function token() { try { const u = JSON.parse(localStorage.getItem("decap-cms-user") || "null"); return u && u.token; } catch { return null; } }
async function api(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { Authorization: "Bearer " + state.token, "Content-Type": "application/json", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || "Something went wrong (" + res.status + ")."); e.status = res.status; e.conflict = data.conflict; throw e; }
  return data;
}
function toast(text, undo) {
  const t = document.getElementById("toast");
  t.replaceChildren(...[h("span", { text }), undo ? h("button", { type: "button", text: "Undo", onclick: () => { undo(); t.hidden = true; } }) : null].filter(Boolean));
  t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), undo ? 7000 : 3500);
}
function confirmBox(title, text, okLabel, danger) {
  const d = document.getElementById("confirm");
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-text").textContent = text;
  const ok = document.getElementById("confirm-ok");
  ok.textContent = okLabel; ok.className = "btn " + (danger ? "danger" : "primary");
  const cancel = document.getElementById("confirm-cancel");
  return new Promise((resolve) => {
    const done = (v) => (e) => { if (e) e.preventDefault(); ok.onclick = cancel.onclick = d.oncancel = null; if (d.open) d.close(); resolve(v); };
    ok.onclick = done(true); cancel.onclick = done(false); d.oncancel = done(false);
    d.showModal();
  });
}
// ON/OFF switch used everywhere a setting is yes/no.
function toggle(on, label, onchange, opts = {}) {
  return h("label", { class: "switch" + (opts.small ? " sm" : ""), title: label },
    h("input", { type: "checkbox", role: "switch", checked: !!on, "aria-label": label, disabled: opts.disabled, onchange: (e) => onchange(e.target.checked) }), h("span"));
}
function field(label, control, hint) { return h("div", { class: "field" }, h("label", { class: "lab" }, label), control, hint ? h("div", { class: "muted", text: hint }) : null); }

// ---------------------------------------------------------------- unsaved work (device copy)
const changedIds = () => {
  if (!state.server) return [];
  const before = new Map(state.server.products.map((p) => [p.id, JSON.stringify(p)]));
  return state.products.filter((p) => before.get(p.id) !== JSON.stringify(p)).map((p) => p.id);
};
function persistWork() {
  try {
    if (changedIds().length) localStorage.setItem(WORK_KEY, JSON.stringify({ baseSha: state.baseSha, products: state.products, at: Date.now() }));
    else localStorage.removeItem(WORK_KEY);
  } catch {}
}
window.addEventListener("beforeunload", (e) => { if (changedIds().length) { e.preventDefault(); e.returnValue = ""; } });

function setProducts(next, message, undoable) {
  const prev = state.products;
  state.products = next;
  persistWork(); render();
  if (message) toast(message, undoable ? () => { state.products = prev; persistWork(); render(); } : null);
}
function updateProducts(ids, patch, message) {
  const set = new Set(ids);
  setProducts(state.products.map((p) => (set.has(p.id) ? { ...p, ...patch } : p)), message, true);
}
// Change one product. quiet = typing in a field: refresh the preview and save bar, keep focus.
function mutate(id, fn, { quiet, message } = {}) {
  const prev = state.products;
  state.products = state.products.map((p) => { if (p.id !== id) return p; const c = structuredClone(p); fn(c); return c; });
  persistWork();
  if (quiet) refreshLive(); else render();
  if (message) toast(message, () => { state.products = prev; persistWork(); render(); });
}

// ---------------------------------------------------------------- data
async function load() {
  state.loading = true; state.error = ""; render();
  try {
    const [prod, remote] = await Promise.all([api("/products"), api("/state")]);
    state.server = prod.data; state.baseSha = prod.sha; state.colors = (prod.colors && prod.colors.garmentColors) || [];
    state.products = prod.data.products.map((p) => structuredClone(p));
    state.remote = remote; state.user = remote.user;
    try {
      const saved = JSON.parse(localStorage.getItem(WORK_KEY) || "null");
      if (saved && saved.baseSha === state.baseSha && Array.isArray(saved.products)) { state.products = saved.products; toast("Restored your unsaved changes from this device."); }
      else if (saved) localStorage.removeItem(WORK_KEY);
    } catch {}
  } catch (e) { state.error = e.status === 401 ? "login" : e.message; }
  state.loading = false; render();
}
async function saveDraft() {
  const ids = changedIds(); if (!ids.length) return;
  try {
    const r = await api("/products", { method: "PUT", body: JSON.stringify({ sha: state.baseSha, data: { ...state.server, products: state.products } }) });
    localStorage.removeItem(WORK_KEY);
    toast(r.unchanged ? "No changes to save." : "✓ Draft saved (" + ids.length + " product" + (ids.length === 1 ? "" : "s") + "). Not live yet.");
    await load();
  } catch (e) { toast(e.conflict ? "Someone else saved changes first. Reload to see them — your edits stay on this device." : e.message); }
}
async function publish() {
  if (changedIds().length) { toast("Save your draft first."); return; }
  if (!(await confirmBox("Publish changes?", state.remote.unpublished + " saved change(s) will go live on LacciStudio.com in about a minute.", "Publish"))) return;
  try { await api("/publish", { method: "POST" }); toast("Published. The live site updates in about a minute."); await load(); } catch (e) { toast(e.message); }
}
async function discard() {
  if (!(await confirmBox("Discard the draft?", "Saved but unpublished changes will be removed. The live site is not affected.", "Discard draft", true))) return;
  try { await api("/discard", { method: "POST" }); localStorage.removeItem(WORK_KEY); toast("Draft discarded."); await load(); } catch (e) { toast(e.message); }
}
function readFile(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); }); }
function pixelSize(file) {
  return new Promise((res) => { const u = URL.createObjectURL(file), i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([0, 0]); i.src = u; });
}
async function upload(file) {
  const types = ["image/jpeg", "image/png", "image/webp", "video/mp4"];
  if (!types.includes(file.type)) { toast("Use a JPG, PNG or WebP picture, or an MP4 video."); return null; }
  const limit = file.type === "video/mp4" ? 20 : 8;
  if (file.size > limit * 1024 * 1024) { toast(`That file is over ${limit} MB.`); return null; }
  if (file.type.startsWith("image/")) {
    const [w, hgt] = await pixelSize(file);
    if (w && Math.min(w, hgt) < 600 && !(await confirmBox("This picture is small", `It is ${w} × ${hgt} pixels. Shop pictures look best at 1000 pixels or more; this one may look blurry or blocky. Upload anyway?`, "Upload anyway"))) return null;
  }
  try {
    toast("Uploading " + file.name + "…");
    const r = await api("/media", { method: "POST", body: JSON.stringify({ name: file.name, type: file.type, data: await readFile(file) }) });
    state.blobs[r.path] = URL.createObjectURL(file);
    return r.path;
  } catch (e) { toast(e.message); return null; }
}

// ---------------------------------------------------------------- routing / frame
function route() { const [r, id] = (location.hash || "#home").slice(1).split("/"); return { r: r || "home", id: id ? decodeURIComponent(id) : "" }; }

function render() {
  const view = document.getElementById("view");
  const { r, id } = route();
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === (r === "product" ? "products" : r)));
  document.querySelectorAll(".bulkbar, .savebar").forEach((e) => e.remove());
  if (!state.token || state.error === "login") return view.replaceChildren(loginView());
  if (state.loading) return view.replaceChildren(h("div", { class: "empty", text: "Loading…" }));
  if (state.error) return view.replaceChildren(h("div", { class: "card" }, h("p", { text: state.error }), h("button", { class: "btn", type: "button", text: "Try again", onclick: load })));
  const y = window.scrollY;
  const p = r === "product" && state.products.find((x) => x.id === id);
  view.replaceChildren(p ? workspaceView(p) : r === "products" || r === "product" ? productsView() : r === "more" ? moreView() : homeView());
  document.body.classList.toggle("in-workspace", !!p);
  if (state.selected.size && r === "products") document.body.append(bulkBar());
  else document.body.append(saveBar());
  if (render.keepScroll) window.scrollTo(0, y);
  render.keepScroll = true;
}
function refreshLive() {
  document.querySelectorAll(".savebar").forEach((e) => e.remove());
  document.body.append(saveBar());
  const { id } = route(); const p = state.products.find((x) => x.id === id); if (!p) return;
  const pv = document.getElementById("live-preview"); if (pv) pv.replaceChildren(...Array.from(previewCard(p).childNodes));
  const hd = document.getElementById("ws-meta"); if (hd) hd.replaceChildren(...metaLine(p));
}

function loginView() {
  return h("div", { class: "login" },
    h("img", { src: "/assets/logo/lacci-primary-gold.png", alt: "Lacci Studio" }),
    h("h1", { text: "Lacci Studio Admin" }),
    h("p", { class: "muted", text: "Log in with GitHub on the editor page, then come back here." }),
    h("div", { class: "row-end", style: "justify-content:center" },
      h("a", { class: "btn primary", href: "/admin/" }, "Log in"),
      h("button", { class: "btn", type: "button", text: "I've logged in", onclick: () => { state.token = token(); load(); } })));
}

function saveBar() {
  const n = changedIds().length, u = state.remote.unpublished;
  if (n) return h("div", { class: "savebar" },
    h("div", {}, h("b", { text: n + " product" + (n === 1 ? "" : "s") + " with unsaved changes" }), h("div", { class: "muted", text: "Kept on this device until you save." })),
    h("div", { class: "row-end" },
      h("button", { class: "btn", type: "button", text: "Undo all", onclick: async () => { if (await confirmBox("Undo all unsaved changes?", "Your edits since the last save will be removed.", "Undo all", true)) setProducts(state.server.products.map((p) => structuredClone(p)), "Unsaved changes undone."); } }),
      h("button", { class: "btn primary", type: "button", text: "Save draft", onclick: saveDraft })));
  if (u) return h("div", { class: "savebar draft" },
    h("div", {}, h("b", { text: u + " saved change" + (u === 1 ? "" : "s") + " not live yet" }), h("div", { class: "muted", text: "Customers don't see these until you publish." })),
    h("div", { class: "row-end" }, h("button", { class: "btn danger", type: "button", text: "Discard", onclick: discard }), h("button", { class: "btn gold", type: "button", text: "Publish", onclick: publish })));
  return h("div", { class: "savebar clean" }, h("div", { class: "muted", text: "✓ Everything is saved and live." }));
}

// ---------------------------------------------------------------- home
function homeView() {
  const count = (fn) => state.products.filter(fn).length;
  const stat = (n, label, filter) => h("a", { class: "stat", href: "#products", onclick: () => { state.filter = filter; } }, h("b", { text: String(n) }), h("span", { text: label }));
  return h("div", {},
    h("h1", { text: "Hello" + (state.user ? ", " + state.user : "") }),
    h("div", { class: "stats" }, stat(count(isOn), "Available for sale", "active"), stat(count((p) => statusOf(p) === "hidden"), "Hidden", "hidden"), stat(count((p) => p.featured && statusOf(p) !== "archived"), "Featured", "featured"), stat(count((p) => statusOf(p) === "draft"), "Draft", "draft")),
    h("div", { class: "card" }, h("b", { text: "Quick actions" }),
      h("div", { class: "row-end", style: "justify-content:flex-start;margin-top:10px" },
        h("a", { class: "btn primary", href: "#products" }, "Manage products"), h("a", { class: "btn", href: "/admin/orders.html" }, "Orders"), h("a", { class: "btn", href: "/", target: "_blank", rel: "noopener" }, "View website"))),
    state.remote.draftCommits.length ? h("div", { class: "card" }, h("b", { text: "Saved, not live yet" }), h("ul", { class: "list-plain" }, state.remote.draftCommits.slice(0, 6).map((c) => h("li", { text: c.message })))) : null,
    h("div", { class: "card" }, h("b", { text: "Recent live changes" }),
      state.remote.recentLive.length ? h("ul", { class: "list-plain" }, state.remote.recentLive.slice(0, 6).map((c) => h("li", {}, c.message, h("div", { class: "muted", text: c.date ? new Date(c.date).toLocaleString() : "" })))) : h("p", { class: "muted", text: "No recent changes." })));
}

// ---------------------------------------------------------------- products table
function inFilter(p, f) {
  const s = statusOf(p);
  if (f === "all") return s !== "archived";
  if (f === "featured") return !!p.featured && s !== "archived";
  return s === f;
}
function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.products.filter((p) => inFilter(p, state.filter) && (!state.cat || (p.category || "") === state.cat) &&
    (!q || ((p.name || "") + " " + (p.category || "") + " " + (p.subcategory || "")).toLowerCase().includes(q)));
}
function productsView() {
  const list = filtered();
  const cats = [...new Set(state.products.map((p) => p.category).filter(Boolean))].sort();
  const changed = new Set(changedIds());
  const allSel = list.length > 0 && list.every((p) => state.selected.has(p.id));
  const search = h("input", { class: "search", type: "search", placeholder: "Search products", value: state.q, "aria-label": "Search products",
    oninput: (e) => { state.q = e.target.value; const pos = e.target.selectionStart; render(); const s = document.querySelector(".search"); s.focus(); s.setSelectionRange(pos, pos); } });
  return h("div", {},
    h("h1", { text: "Products" }),
    h("div", { class: "toolbar" }, search,
      h("div", { class: "chips", role: "tablist" }, FILTERS.map(([k, label]) => h("button", { class: "chip" + (state.filter === k ? " on" : ""), type: "button", role: "tab", "aria-selected": String(state.filter === k),
        text: label + " " + state.products.filter((p) => inFilter(p, k)).length, onclick: () => { state.filter = k; state.selected.clear(); render(); } }))),
      h("div", { class: "selectbar" },
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: allSel, "aria-label": "Select all shown products", onchange: (e) => { list.forEach((p) => (e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id))); render(); } }), h("span", { text: state.selected.size ? state.selected.size + " selected" : "Select all" })),
        h("select", { class: "small", "aria-label": "Category", onchange: (e) => { state.cat = e.target.value; render(); } }, h("option", { value: "", text: "All categories" }), cats.map((c) => h("option", { value: c, selected: state.cat === c, text: c }))))),
    h("div", { class: "ptable", role: "table", "aria-label": "Products" },
      h("div", { class: "prow head", role: "row" }, ["", "", "Product", "Available", "Featured", "Category", "Price", "Updated", ""].map((t) => h("span", { role: "columnheader", text: t }))),
      list.length ? list.map((p) => productRow(p, changed.has(p.id))) : h("div", { class: "empty", text: "No products match." })),
    h("p", { class: "muted", text: list.length + " product" + (list.length === 1 ? "" : "s") }));
}
function productRow(p, isChanged) {
  const s = statusOf(p), sel = state.selected.has(p.id), href = "#product/" + encodeURIComponent(p.id);
  const openBtn = (kids, cls) => h("a", { class: cls, href, onclick: () => { state.tab = "overview"; state.colorSel.clear(); } }, kids);
  return h("div", { class: "prow" + (sel ? " sel" : ""), role: "row" },
    h("label", { class: "check c-sel", "aria-label": "Select " + p.name }, h("input", { type: "checkbox", checked: sel, onchange: (e) => { e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id); render(); } })),
    openBtn(img(mainImage(p), { class: "thumb" }, true), "c-img"),
    openBtn([h("span", { class: "name", text: p.name }),
      h("span", { class: "meta" }, s !== "active" ? h("span", { class: "pill " + s, text: STATUS_LABEL[s] }) : null, isChanged ? h("span", { class: "pill changed", text: "Edited" }) : null, h("span", { class: "m-only", text: (p.category || "") + " · " + priceLabel(p) }))], "c-name"),
    h("div", { class: "c-on" }, h("span", { class: "m-lab", text: "Available" }),
      s === "archived" ? h("button", { class: "btn sm", type: "button", text: "Restore", onclick: () => updateProducts([p.id], { status: "hidden" }, p.name + " restored (hidden).") })
        : toggle(s === "active", (s === "active" ? "Hide " : "Make available: ") + p.name, (on) => updateProducts([p.id], { status: on ? "active" : "hidden" }, p.name + (on ? " will be available" : " will be hidden") + " once published."))),
    h("div", { class: "c-feat" }, h("span", { class: "m-lab", text: "Featured" }), toggle(!!p.featured, "Featured: " + p.name, (on) => updateProducts([p.id], { featured: on }, p.name + (on ? " featured" : " no longer featured") + "."), { small: true })),
    h("span", { class: "c-cat", text: p.category || "—" }),
    h("span", { class: "c-price", text: priceLabel(p) }),
    h("span", { class: "c-upd muted", text: p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "—" }),
    h("a", { class: "btn sm c-act", href, text: "Edit" }));
}
function bulkBar() {
  const ids = [...state.selected], n = ids.length;
  const done = (patch, verb) => { updateProducts(ids, patch, n + " product" + (n === 1 ? "" : "s") + " " + verb + "."); state.selected.clear(); render(); };
  return h("div", { class: "bulkbar", role: "toolbar", "aria-label": "Bulk actions" },
    h("b", { text: n + " selected" }),
    h("div", { class: "row-end" },
      h("button", { class: "btn", type: "button", text: "Hide", onclick: () => done({ status: "hidden" }, "hidden") }),
      h("button", { class: "btn", type: "button", text: "Unhide", onclick: () => done({ status: "active" }, "made available") }),
      h("button", { class: "btn", type: "button", text: "Feature", onclick: () => done({ featured: true }, "featured") }),
      h("button", { class: "btn", type: "button", text: "Unfeature", onclick: () => done({ featured: false }, "unfeatured") }),
      h("button", { class: "btn", type: "button", text: "Archive", onclick: async () => { if (await confirmBox("Archive " + n + " product" + (n === 1 ? "" : "s") + "?", "Archived products are hidden and kept with all their details. You can restore them any time.", "Archive")) done({ status: "archived" }, "archived"); } }),
      h("button", { class: "btn", type: "button", text: "Clear", onclick: () => { state.selected.clear(); render(); } })));
}

// ---------------------------------------------------------------- product workspace
function metaLine(p) {
  const s = statusOf(p);
  return [h("span", { class: "pill " + s, text: STATUS_LABEL[s] }), p.featured ? h("span", { class: "pill feat", text: "Featured" }) : null, h("span", { text: p.category || "No category" }), h("span", { text: priceLabel(p) })].filter(Boolean);
}
function previewCard(p) {
  const s = statusOf(p), cols = (p.colors || []).filter((c) => c.visible).map((c) => state.colors.find((x) => x.id === c.id)).filter(Boolean);
  return h("div", { class: "pv" },
    h("div", { class: "pv-label muted", text: "Shop card preview" }),
    h("div", { class: "pv-card" + (s === "active" ? "" : " off") },
      h("div", { class: "pv-img" }, img(mainImage(p), { loading: "eager" }, true), s !== "active" ? h("span", { class: "pv-ribbon", text: s === "archived" ? "Archived — not shown or sold" : "Hidden — not shown or sold" }) : null),
      h("div", { class: "pv-body" }, h("div", { class: "pv-name", text: p.name || "Untitled" }), h("div", { class: "pv-price", text: priceLabel(p) }),
        cols.length ? h("div", { class: "pv-dots" }, cols.slice(0, 10).map((c) => h("span", { title: c.name, style: `background:${c.hex}` })), cols.length > 10 ? h("small", { text: "+" + (cols.length - 10) }) : null) : null,
        h("div", { class: "pv-btn", text: "Personalize" }))),
    p.description ? h("p", { class: "muted pv-desc", text: p.description.slice(0, 160) + (p.description.length > 160 ? "…" : "") }) : null);
}
function workspaceView(p) {
  const tab = TABS.some(([k]) => k === state.tab) ? state.tab : "overview";
  const body = { overview: overviewTab, pricing: pricingTab, media: mediaTab, variants: variantsTab, personalization: personalizationTab, shipping: shippingTab, seo: seoTab }[tab](p);
  return h("div", { class: "ws" },
    h("div", { class: "ws-head" },
      h("a", { class: "back", href: "#products", "aria-label": "Back to products", text: "‹ Products" }),
      h("h1", { text: p.name }),
      h("div", { class: "ws-meta", id: "ws-meta" }, metaLine(p)),
      h("div", { class: "ws-quick" },
        h("span", { class: "q" }, h("span", { text: "Available for sale" }), toggle(isOn(p), "Available for sale", (on) => mutate(p.id, (x) => (x.status = on ? "active" : "hidden"), { message: p.name + (on ? " will be available" : " will be hidden") + " once published." }), { disabled: statusOf(p) === "archived" })),
        h("span", { class: "q" }, h("span", { text: "Featured" }), toggle(p.featured, "Featured", (on) => mutate(p.id, (x) => (x.featured = on)), { small: true })))),
    h("nav", { class: "tabs", role: "tablist" }, TABS.map(([k, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(k === tab), text: label, onclick: () => { state.tab = k; render.keepScroll = false; render(); window.scrollTo(0, 0); } }))),
    h("div", { class: "ws-grid" },
      h("section", { class: "ws-body" }, body),
      h("aside", { class: "ws-side" + (state.previewOpen ? " open" : "") },
        h("button", { class: "pv-toggle", type: "button", text: state.previewOpen ? "Hide preview ▴" : "Show preview ▾", onclick: () => { state.previewOpen = !state.previewOpen; render(); } }),
        h("div", { id: "live-preview" }, [...previewCard(p).childNodes]))));
}

// Overview
function overviewTab(p) {
  const cats = [...new Set(state.products.map((x) => x.category).filter(Boolean))].sort();
  const subs = [...new Set(state.products.filter((x) => x.category === p.category).map((x) => x.subcategory).filter(Boolean))].sort();
  const s = statusOf(p);
  return h("div", { class: "card" },
    field("Product name", h("input", { type: "text", value: p.name || "", maxlength: "140", oninput: (e) => mutate(p.id, (x) => (x.name = e.target.value), { quiet: true }) })),
    field("Description", h("textarea", { rows: "4", maxlength: "5000", oninput: (e) => mutate(p.id, (x) => (x.description = e.target.value), { quiet: true }) }, p.description || ""), "Shown on the shop card tooltip and in the customizer."),
    h("div", { class: "two" },
      field("Category", h("input", { type: "text", list: "cat-list", value: p.category || "", oninput: (e) => mutate(p.id, (x) => (x.category = e.target.value), { quiet: true }) }), null),
      field("Subcategory", h("input", { type: "text", list: "sub-list", value: p.subcategory || "", placeholder: "Optional", oninput: (e) => mutate(p.id, (x) => (x.subcategory = e.target.value || undefined), { quiet: true }) }), null)),
    h("datalist", { id: "cat-list" }, cats.map((c) => h("option", { value: c }))), h("datalist", { id: "sub-list" }, subs.map((c) => h("option", { value: c }))),
    h("div", { class: "trow" }, h("div", {}, h("b", { text: "Available for sale" }), h("div", { class: "muted", text: isOn(p) ? "✓ Shown in the Shop and can be bought." : "○ Hidden: not shown and can't be bought, even from an old link. Everything is kept." })),
      toggle(isOn(p), "Available for sale", (on) => mutate(p.id, (x) => (x.status = on ? "active" : "hidden")), { disabled: s === "archived" })),
    h("div", { class: "trow" }, h("div", {}, h("b", { text: "Featured" }), h("div", { class: "muted", text: "Featured products come first in “Popular Personalized Gifts” on the homepage." })),
      toggle(p.featured, "Featured", (on) => mutate(p.id, (x) => (x.featured = on)))),
    h("details", { class: "adv" }, h("summary", { text: "Advanced" }),
      field("Special status", h("div", { class: "seg four" }, ["draft", "seasonal", "archived"].map((k) => h("button", { type: "button", "aria-pressed": String(s === k), text: STATUS_LABEL[k],
        onclick: () => mutate(p.id, (x) => (x.status = s === k ? "hidden" : k)) }))), "Draft = not finished yet. Seasonal = off sale until its season. Archived = retired but kept. All three are off sale; tap again to clear."),
      field("Product ID (web address)", h("input", { type: "text", value: p.id, readonly: true }), "Fixed so old links and orders keep working.")));
}

// Pricing
function groupPriceMode(g) { return g.choices.some((c) => c && typeof c === "object" && c.price != null && c.price !== "") ? "price" : "add"; }
function setCount(name) { const m = /(\d+)/.exec(name); return /^Single$/i.test(name) ? 1 : m ? Number(m[1]) : null; }
function pricingTab(p) {
  const live = liveOf(p.id);
  const groups = (p.optionGroups || []).map((g, gi) => ({ g, gi }));
  const base = h("div", { class: "card" },
    field("Base price ($)", h("input", { type: "number", inputmode: "decimal", step: "0.01", min: "0", value: p.price, onchange: (e) => { const v = Math.round(Number(e.target.value) * 100) / 100; if (Number.isFinite(v) && v >= 0) mutate(p.id, (x) => (x.price = v)); } }),
      groups.some(({ g }) => groupPriceMode(g) === "price") ? "This product's price is set by its choices below (e.g. each size has its own price). The base price is only used for choices without their own price." : "Choices below can add to this."),
    h("div", { class: "kv" }, h("span", { text: "Customers see" }), h("b", { text: priceLabel(p) }), live && priceLabel(live) !== priceLabel(p) ? h("span", { class: "was", text: "live now: " + priceLabel(live) }) : null));
  const tables = groups.map(({ g, gi }) => {
    const mode = groupPriceMode(g);
    const isSets = /^quantity$/i.test(g.label) && g.choices.every((c) => setCount(choiceName(c)) != null);
    const liveG = live && (live.optionGroups || []).find((x) => x.label === g.label);
    const rowFor = (c, ci) => {
      const name = choiceName(c), obj = typeof c === "object" ? c : { name };
      const pays = fromCents(p, g.label, c), liveC = liveG && liveG.choices.find((x) => choiceName(x) === name), livePays = liveC ? fromCents(live, g.label, liveC) : null;
      const val = mode === "price" ? (obj.price ?? "") : (obj.add ?? "");
      const n = isSets ? setCount(name) : null;
      return h("tr", { class: isVisible(c) ? "" : "off" },
        h("td", { text: name }),
        h("td", {}, toggle(isVisible(c), name + " available", (on) => mutate(p.id, (x) => setChoice(x, gi, ci, { hidden: on ? undefined : true })), { small: true })),
        h("td", {}, h("input", { class: "money", type: "number", inputmode: "decimal", step: "0.01", value: val, placeholder: mode === "price" ? money(cents(p.price)).slice(1) : "0", "aria-label": (mode === "price" ? "Price for " : "Extra charge for ") + name,
          onchange: (e) => { const raw = e.target.value.trim(); const v = raw === "" ? undefined : Math.round(Number(raw) * 100) / 100; if (raw !== "" && !Number.isFinite(v)) return toast("Enter a number."); mutate(p.id, (x) => setChoice(x, gi, ci, { [mode]: v })); } })),
        h("td", { class: "num" }, money(pays), livePays != null && livePays !== pays ? h("div", { class: "was", text: "was " + money(livePays) }) : null),
        isSets ? h("td", { class: "num muted", text: n ? money(Math.round(pays / n)) : "—" }) : null);
    };
    // What customers can buy first; switched-off choices fold away under "Inactive".
    const cols = isSets ? 5 : 4, key = p.id + "|" + g.label;
    const active = g.choices.map((c, ci) => [c, ci]).filter(([c]) => isVisible(c)), inactive = g.choices.map((c, ci) => [c, ci]).filter(([c]) => !isVisible(c));
    const open = state.openInactive.has(key);
    const rows = [...active.map(([c, ci]) => rowFor(c, ci)),
      inactive.length ? h("tr", { class: "fold" }, h("td", { colspan: String(cols) }, h("button", { type: "button", class: "cg-h link", "aria-expanded": String(open), onclick: () => { open ? state.openInactive.delete(key) : state.openInactive.add(key); render(); } },
        `INACTIVE ${isSets ? "QUANTITIES" : "CHOICES"} (${inactive.length}) — ${open ? "Hide" : "Show"}`))) : null,
      ...(open ? inactive.map(([c, ci]) => rowFor(c, ci)) : [])];
    return h("div", { class: "card" },
      h("div", { class: "card-h" }, h("b", { text: g.label }), h("span", { class: "muted", text: mode === "price" ? "Each choice has its own price" : "Extra charge on top of the price" })),
      h("div", { class: "tscroll" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, h("th", { text: isSets ? "Quantity" : g.label }), h("th", { text: "On" }), h("th", { text: mode === "price" ? "Price $" : "Extra $" }), h("th", { class: "num", text: isSets ? "Total" : "Pays" }), isSets ? h("th", { class: "num", text: "Per item" }) : null)),
        h("tbody", {}, rows))));
  });
  return h("div", {}, base, ...tables, stagePlanner(p));
}

// Growth / Balanced / Premium planning. Only the live prices above are charged; Balanced and Premium
// are notes until the owner copies a plan into the live prices (with a confirmation).
const STAGES = [["balanced", "Balanced"], ["premium", "Premium"]];
function planKey(g, c) { return g.label + " / " + choiceName(c); }
function stagePlanner(p) {
  const plan = p.pricePlan || {};
  const priced = (p.optionGroups || []).map((g, gi) => ({ g, gi })).filter(({ g }) => groupPriceMode(g) === "price");
  const lines = priced.length
    ? priced.flatMap(({ g, gi }) => g.choices.map((c, ci) => ({ c, g, gi, ci })).filter(({ c }) => isVisible(c)).map((x) => ({ ...x, label: planKey(x.g, x.c), live: Number(x.c.price) })))
    : [{ label: "Base price", live: Number(p.price), base: true }];
  const setPlan = (stage, label, raw) => mutate(p.id, (x) => {
    const v = raw === "" ? undefined : Math.round(Number(raw) * 100) / 100;
    x.pricePlan = x.pricePlan || {}; x.pricePlan[stage] = { ...(x.pricePlan[stage] || {}) };
    if (v === undefined || !Number.isFinite(v)) delete x.pricePlan[stage][label]; else x.pricePlan[stage][label] = v;
    if (!Object.keys(x.pricePlan[stage]).length) delete x.pricePlan[stage];
    if (!Object.keys(x.pricePlan).length) delete x.pricePlan;
  }, { quiet: true });
  const apply = async (stage, name) => {
    const vals = plan[stage] || {};
    if (!lines.every((l) => Number.isFinite(vals[l.label]))) return toast(`Fill in every ${name} price first.`);
    if (!(await confirmBox(`Use ${name} prices?`, `The live prices for ${p.name} change to your ${name} plan. Customers pay them once you save and publish. The current prices are kept as your Growth plan.`, `Use ${name} prices`))) return;
    mutate(p.id, (x) => {
      x.pricePlan = x.pricePlan || {};
      x.pricePlan.growth = Object.fromEntries(lines.map((l) => [l.label, l.live]));
      for (const l of lines) { if (l.base) x.price = vals[l.label]; else setChoice(x, l.gi, l.ci, { price: vals[l.label] }); }
      x.pricePlan.stage = stage;
    }, { message: `${p.name} now uses ${name} prices (not live until published).` });
  };
  return h("div", { class: "card" },
    h("div", { class: "card-h" }, h("b", { text: "Price planning" }), h("span", { class: "muted", text: "Live stage: " + (plan.stage === "balanced" ? "Balanced" : plan.stage === "premium" ? "Premium" : "Growth") })),
    h("p", { class: "muted", text: "Only the live prices are charged at checkout. Balanced and Premium are your plans for later; nothing moves on its own." }),
    h("div", { class: "tscroll" }, h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, h("th", { text: "Choice" }), h("th", { class: "num", text: "Live" }), STAGES.map(([, n]) => h("th", { text: n + " plan $" })))),
      h("tbody", {}, lines.map((l) => h("tr", {}, h("td", { text: l.label.replace(/^.* \/ /, "") }), h("td", { class: "num", text: money(cents(l.live)) }),
        STAGES.map(([k, n]) => h("td", {}, h("input", { class: "money", type: "number", step: "0.01", inputmode: "decimal", value: (plan[k] || {})[l.label] ?? "", placeholder: "—", "aria-label": n + " plan for " + l.label, onchange: (e) => setPlan(k, l.label, e.target.value.trim()) })))))))),
    h("div", { class: "row-end", style: "margin-top:10px" }, STAGES.map(([k, n]) => h("button", { class: "btn sm", type: "button", text: `Use ${n} prices…`, onclick: () => apply(k, n) }))));
}
function setChoice(x, gi, ci, patch) {
  const g = x.optionGroups[gi];
  let c = g.choices[ci];
  if (typeof c !== "object") c = { name: c };
  c = { ...c };
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete c[k]; else c[k] = v; }
  g.choices[ci] = c;
}

// Media
function mediaTab(p) {
  const pics = p.images || [];
  let drag = null;
  const add = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true, hidden: true, onchange: async (e) => {
    for (const f of [...e.target.files]) { const path = await upload(f); if (path) mutate(p.id, (x) => (x.images = [...(x.images || []), path])); }
    e.target.value = ""; toast("Pictures added — save your draft to keep them.");
  } });
  const grid = h("div", { class: "mgrid" }, pics.map((src, i) => {
    const replace = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true, onchange: async (e) => { const path = e.target.files[0] && await upload(e.target.files[0]); if (path) mutate(p.id, (x) => (x.images[i] = path)); } });
    return h("figure", { class: "mtile", draggable: "true",
      ondragstart: () => { drag = i; }, ondragover: (e) => e.preventDefault(),
      ondrop: (e) => { e.preventDefault(); if (drag == null || drag === i) return; const from = drag; mutate(p.id, (x) => { const [m] = x.images.splice(from, 1); x.images.splice(i, 0, m); }); } },
      img(src), i === 0 ? h("span", { class: "badge", text: "Primary" }) : null,
      h("div", { class: "macts" },
        i ? h("button", { type: "button", text: "★ Primary", onclick: () => mutate(p.id, (x) => { const [m] = x.images.splice(i, 1); x.images.unshift(m); }) }) : null,
        h("button", { type: "button", "aria-label": "Move earlier", disabled: i === 0, text: "←", onclick: () => mutate(p.id, (x) => { [x.images[i - 1], x.images[i]] = [x.images[i], x.images[i - 1]]; }) }),
        h("button", { type: "button", "aria-label": "Move later", disabled: i === pics.length - 1, text: "→", onclick: () => mutate(p.id, (x) => { [x.images[i + 1], x.images[i]] = [x.images[i], x.images[i + 1]]; }) }),
        h("button", { type: "button", text: "Replace", onclick: () => replace.click() }), replace,
        h("button", { type: "button", class: "del", "aria-label": "Remove picture", text: "✕", onclick: async () => { if (await confirmBox("Remove this picture from the product?", "The file is kept; you can add it back later.", "Remove")) mutate(p.id, (x) => x.images.splice(i, 1), { message: "Picture removed." }); } })));
  }));
  const vid = h("input", { type: "file", accept: "video/mp4", hidden: true, onchange: async (e) => { const path = e.target.files[0] && await upload(e.target.files[0]); if (path) mutate(p.id, (x) => (x.video = path)); } });
  const mock = h("input", { type: "file", accept: "image/png", hidden: true, onchange: async (e) => { const path = e.target.files[0] && await upload(e.target.files[0]); if (path) mutate(p.id, (x) => (x.mockupPhoto = path)); } });
  const video = p.video ? h("video", { src: imgSrc(p.video), controls: true, muted: true, playsinline: true, preload: "metadata" }) : null;
  if (video) video.addEventListener("error", async () => { const b = await draftFile(p.video); if (b) video.src = b; }, { once: true });
  return h("div", {},
    h("div", { class: "card" },
      h("div", { class: "card-h" }, h("b", { text: "Pictures (" + pics.length + ")" }), h("button", { class: "btn primary", type: "button", text: "+ Add images", onclick: () => add.click() }), add),
      pics.length ? grid : h("p", { class: "muted", text: "No pictures yet. The shop shows the customizer photo until you add one." }),
      h("p", { class: "muted", text: "Drag to reorder (or use the arrows on a phone). The first picture is the one customers see first." })),
    h("div", { class: "card" },
      h("div", { class: "card-h" }, h("b", { text: "Video" }), h("div", { class: "row-end" }, h("button", { class: "btn", type: "button", text: p.video ? "Replace video" : "+ Add video", onclick: () => vid.click() }), vid,
        p.video ? h("button", { class: "btn danger", type: "button", text: "Remove", onclick: () => mutate(p.id, (x) => (x.video = ""), { message: "Video removed." }) }) : null)),
      video || h("p", { class: "muted", text: "No video. MP4 up to 20 MB." })),
    h("details", { class: "adv card" }, h("summary", { text: "Advanced — customizer photo" }),
      h("p", { class: "muted", text: "The blank product photo the customer designs on. White background PNG." }),
      h("div", { class: "mock" }, p.mockupPhoto ? img(p.mockupPhoto) : null, h("button", { class: "btn", type: "button", text: "Replace", onclick: () => mock.click() }), mock)));
}

// Variants
function variantsTab(p) {
  const parts = [];
  if (Array.isArray(p.colors) && p.colors.length) parts.push(colourManager(p));
  (p.optionGroups || []).forEach((g, gi) => parts.push(optionCard(p, g, gi)));
  const size = (p.optionGroups || []).find((g) => /^size$/i.test(g.label));
  if (Array.isArray(p.colors) && p.colors.length && size) parts.push(matrixCard(p, size));
  if (!parts.length) parts.push(h("div", { class: "card" }, h("p", { class: "muted", text: "This product has no colours or options. Customers personalize a single version." })));
  return h("div", {}, parts);
}
function colourManager(p) {
  const lib = new Map(state.colors.map((c) => [c.id, c]));
  const q = state.colorQ.trim().toLowerCase();
  const rows = p.colors.map((c, i) => ({ c, i, info: lib.get(c.id) || { name: c.id, hex: "#ccc" } })).filter((r) => !q || r.info.name.toLowerCase().includes(q));
  const on = rows.filter((r) => r.c.visible), off = rows.filter((r) => !r.c.visible);
  const setVis = (ids, v) => mutate(p.id, (x) => x.colors.forEach((c) => { if (ids.has(c.id)) c.visible = v; }), { message: ids.size + " colour" + (ids.size === 1 ? "" : "s") + (v ? " turned on." : " turned off.") });
  const row = (r) => h("div", { class: "crow" + (r.c.visible ? "" : " off") },
    h("input", { type: "checkbox", "aria-label": "Select " + r.info.name, checked: state.colorSel.has(r.c.id), onchange: (e) => { e.target.checked ? state.colorSel.add(r.c.id) : state.colorSel.delete(r.c.id); render(); } }),
    h("span", { class: "sw", style: `background:${r.info.hex}` }),
    h("span", { class: "cn" }, r.info.name, r.info.method === "vinyl" ? h("small", { class: "muted", text: " · vinyl print" }) : null),
    toggle(r.c.visible, r.info.name + " available", (v) => mutate(p.id, (x) => (x.colors[r.i].visible = v)), { small: true }));
  const sel = state.colorSel;
  return h("div", { class: "card" },
    h("div", { class: "card-h" }, h("b", { text: "Colours" }), h("span", { class: "muted", text: on.length + " available · " + off.length + " hidden" })),
    h("div", { class: "ctools" },
      h("input", { class: "search sm", type: "search", placeholder: "Search colours", value: state.colorQ, oninput: (e) => { state.colorQ = e.target.value; const pos = e.target.selectionStart; render(); const s = document.querySelector(".ctools .search"); s.focus(); s.setSelectionRange(pos, pos); } }),
      h("button", { class: "btn sm", type: "button", text: "Select all", onclick: () => { rows.forEach((r) => sel.add(r.c.id)); render(); } }),
      sel.size ? h("button", { class: "btn sm", type: "button", text: "Show selected (" + sel.size + ")", onclick: () => { setVis(new Set(sel), true); sel.clear(); render(); } }) : null,
      sel.size ? h("button", { class: "btn sm", type: "button", text: "Hide selected", onclick: () => { setVis(new Set(sel), false); sel.clear(); render(); } }) : null,
      sel.size ? h("button", { class: "btn sm", type: "button", text: "Clear", onclick: () => { sel.clear(); render(); } }) : null),
    h("div", { class: "cgroup" }, h("div", { class: "cg-h", text: "AVAILABLE (" + on.length + ")" }), on.length ? on.map(row) : h("p", { class: "muted", text: "No colours on. Turn at least one on to sell this product." })),
    h("div", { class: "cgroup" },
      h("button", { class: "cg-h link", type: "button", "aria-expanded": String(state.showHiddenColors || !!q), onclick: () => { state.showHiddenColors = !state.showHiddenColors; render(); } }, "HIDDEN (" + off.length + ") — " + (state.showHiddenColors || q ? "Hide list" : "Show")),
      state.showHiddenColors || q ? off.map(row) : null),
    h("p", { class: "muted", text: "Hidden colours keep their settings and come back when turned on. Per-colour prices and pictures aren't supported by checkout yet; the customizer recolours the product photo automatically." }));
}
function optionCard(p, g, gi) {
  const withImg = g.choices.some((c) => c && typeof c === "object" && c.img);
  const onCount = g.choices.filter(isVisible).length;
  const flip = (ci, on) => mutate(p.id, (x) => setChoice(x, gi, ci, { hidden: on ? undefined : true }));
  const body = withImg
    ? h("div", { class: "vcards" }, g.choices.map((c, ci) => h("div", { class: "vcard" + (isVisible(c) ? "" : " off") }, c && c.img ? img(c.img) : h("div", { class: "noimg", text: "No picture yet" }), h("span", { text: choiceName(c) }), toggle(isVisible(c), choiceName(c) + " available", (on) => flip(ci, on), { small: true }))))
    : h("div", { class: "vchips" }, g.choices.map((c, ci) => h("div", { class: "vchip" + (isVisible(c) ? "" : " off") }, h("span", { text: choiceName(c) }), toggle(isVisible(c), choiceName(c) + " available", (on) => flip(ci, on), { small: true }))));
  return h("div", { class: "card" },
    h("div", { class: "card-h" }, h("b", { text: g.label }), h("span", { class: "muted", text: onCount + " of " + g.choices.length + " available" }),
      h("button", { class: "btn sm link", type: "button", text: "Prices ›", onclick: () => { state.tab = "pricing"; render(); } })),
    body);
}
function matrixCard(p, size) {
  const lib = new Map(state.colors.map((c) => [c.id, c]));
  const sizes = size.choices, onCols = p.colors.filter((c) => c.visible), offCount = p.colors.length - onCols.length;
  return h("div", { class: "card" },
    h("div", { class: "card-h" }, h("b", { text: "Colour × size" }), h("span", { class: "muted", text: "What customers can order" })),
    h("div", { class: "tscroll" }, h("table", { class: "grid matrix" },
      h("thead", {}, h("tr", {}, h("th", { text: "Colour" }), sizes.map((s) => h("th", { class: isVisible(s) ? "" : "off", text: choiceName(s) })))),
      h("tbody", {}, onCols.map((c) => h("tr", {}, h("td", {}, h("span", { class: "sw", style: `background:${(lib.get(c.id) || {}).hex}` }), " ", (lib.get(c.id) || { name: c.id }).name),
        sizes.map((s) => h("td", { class: "cell " + (isVisible(s) ? "yes" : "no"), text: isVisible(s) ? "✓" : "—" })))),
        offCount ? h("tr", { class: "off" }, h("td", { colspan: String(sizes.length + 1), text: offCount + " hidden colour" + (offCount === 1 ? "" : "s") })) : null))),
    h("p", { class: "muted", text: "Every available colour comes in every available size. Stock per combination can be added later if you need it." }));
}

// Personalization
function personalizationTab(p) {
  const z = p.personalization || {};
  const set = (k, v) => mutate(p.id, (x) => { x.personalization = { ...(x.personalization || {}), [k]: v }; });
  const fonts = z.fonts || FONTS;
  return h("div", {},
    h("div", { class: "note warn", text: "These settings are used by the new customizer, which is waiting for your review on its own branch. The customizer that's live today offers upload, text, preview, proof and notes on every product and ignores these switches." }),
    h("div", { class: "card" }, PERSONALIZATION.map(([k, label, def]) => h("div", { class: "trow" }, h("span", { text: label + (k === "designs" ? " (appears only when this product has published designs)" : "") }), toggle(z[k] ?? def, label, (v) => set(k, v))))),
    h("div", { class: "card" }, h("b", { text: "Fonts offered" }),
      h("div", { class: "vchips" }, FONTS.map((f) => h("div", { class: "vchip" + (fonts.includes(f) ? "" : " off") }, h("span", { text: f }), toggle(fonts.includes(f), f, (v) => set("fonts", v ? [...fonts, f].filter((x, i, a) => a.indexOf(x) === i) : fonts.filter((x) => x !== f)), { small: true }))))));
}

// Shipping
function shippingTab(p) {
  const g = Number(p.weight) || 0;
  return h("div", { class: "card" },
    field("Packed weight (grams)", h("input", { type: "number", inputmode: "numeric", min: "0", step: "1", value: g, onchange: (e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v >= 0) mutate(p.id, (x) => (x.weight = v)); } }),
      `≈ ${(g / 28.35).toFixed(1)} oz · ${(g / 453.6).toFixed(2)} lb. Checkout adds up the weight of everything in the cart and picks the shipping price from your shipping bands.`),
    h("p", { class: "muted", text: "Shipping methods and prices are set once for the whole shop (content/shipping.json)." }));
}

// SEO
function seoTab(p) {
  const z = p.seo || {};
  const set = (k, v) => mutate(p.id, (x) => { x.seo = { ...(x.seo || {}), [k]: v }; if (!v) delete x.seo[k]; if (!Object.keys(x.seo).length) delete x.seo; }, { quiet: true });
  const count = (id, max) => h("span", { class: "muted", id });
  const t = count("c-t"), d = count("c-d");
  const upd = () => { t.textContent = ((p.seo || {}).title || "").length + " / 60 suggested"; d.textContent = ((p.seo || {}).description || "").length + " / 155 suggested"; };
  const el = h("div", {},
    h("div", { class: "note", text: "The shop is one page today, so these are saved for when each product gets its own page. They don't change the live site yet." }),
    h("div", { class: "card" },
      field("Search title", h("input", { type: "text", maxlength: "120", value: z.title || "", placeholder: p.name, oninput: (e) => { set("title", e.target.value); t.textContent = e.target.value.length + " / 60 suggested"; } }), null), t,
      field("Search description", h("textarea", { rows: "3", maxlength: "320", placeholder: (p.description || "").slice(0, 155), oninput: (e) => { set("description", e.target.value); d.textContent = e.target.value.length + " / 155 suggested"; } }, z.description || ""), null), d,
      field("Product ID", h("input", { type: "text", readonly: true, value: p.id }), "Will become part of the product page address.")));
  upd();
  return el;
}

// ---------------------------------------------------------------- more
function moreView() {
  return h("div", {},
    h("h1", { text: "More" }),
    h("div", { class: "card" }, h("b", { text: "Classic editor" }), h("p", { class: "muted", text: "The previous editor stays available while the new admin grows. Changes made there go live immediately." }), h("a", { class: "btn", href: "/admin/" }, "Open classic editor")),
    h("div", { class: "card" }, h("b", { text: "Help" }),
      h("ul", { class: "list-plain" },
        h("li", { text: "Hide or unhide: Products → Available switch → Save draft → Publish." }),
        h("li", { text: "Change a price: open the product → Pricing → type the new price → Save draft → Publish." }),
        h("li", { text: "Colours and sizes: open the product → Variants → switch each one on or off." }),
        h("li", { text: "Pictures: open the product → Media → + Add images; drag or use the arrows to reorder." }),
        h("li", { text: "Undo: tap Undo on the message right after a change, Undo all before saving, or Discard before publishing." }))));
}

// ---------------------------------------------------------------- start
window.addEventListener("hashchange", () => { state.selected.clear(); render.keepScroll = false; render(); window.scrollTo(0, 0); });
state.token = token();
if (state.token) load(); else { state.loading = false; render(); }
