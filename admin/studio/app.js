// Lacci Studio Admin — Phase 1: home, products (list, search, filters, bulk show/hide, archive,
// one-tap visibility, editor), Save draft → Publish / Discard. Talks only to /api/admin/content/*,
// which checks GitHub push access on the server for every request.
import { fromPriceCents, money } from "/assets/js/pricing.mjs";

const API = "/api/admin/content";
const WORK_KEY = "lacci-admin-work";
const STATUS_LABEL = { active: "Live", hidden: "Hidden", draft: "Draft", seasonal: "Seasonal", archived: "Archived" };
const FILTERS = [["all", "All"], ["active", "Live"], ["hidden", "Hidden"], ["draft", "Draft"], ["archived", "Archived"]];

const state = {
  token: null, user: null,
  server: null, baseSha: null, products: [], colors: [],
  remote: { unpublished: 0, draftCommits: [], recentLive: [] },
  filter: "all", cat: "", q: "", selected: new Set(), editing: null, loading: true, error: "",
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
function thumbOf(p) {
  const src = p.mockupPhoto || (p.images || [])[0] || "";
  if (!src) return "";
  try { const u = new URL(src, location.origin); return u.hostname.endsWith("laccistudio.com") ? u.pathname + u.search : u.href; } catch { return ""; }
}
const imgSrc = (src) => { try { const u = new URL(src, location.origin); return u.hostname.endsWith("laccistudio.com") ? u.pathname + u.search : u.href; } catch { return ""; } };
function priceLabel(p) {
  let c; try { c = fromPriceCents(p); } catch { c = Math.round(Number(p.price) * 100); }
  const hasOptions = (p.optionGroups || []).some((g) => (g.choices || []).length > 1);
  return (hasOptions ? "from " : "") + money(c);
}
function token() {
  try { const u = JSON.parse(localStorage.getItem("decap-cms-user") || "null"); return u && u.token; } catch { return null; }
}
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
  const prev = state.products.map((p) => ({ ...p }));
  state.products = next;
  persistWork(); render();
  if (message) toast(message, undoable ? () => { state.products = prev; persistWork(); render(); } : null);
}
function updateProducts(ids, patch, message) {
  const set = new Set(ids);
  setProducts(state.products.map((p) => (set.has(p.id) ? { ...p, ...patch } : p)), message, true);
}

// ---------------------------------------------------------------- data
async function load() {
  state.loading = true; state.error = ""; render();
  try {
    const [prod, remote] = await Promise.all([api("/products"), api("/state")]);
    state.server = prod.data; state.baseSha = prod.sha; state.colors = (prod.colors && prod.colors.garmentColors) || [];
    state.products = prod.data.products.map((p) => ({ ...p }));
    state.remote = remote; state.user = remote.user;
    try {
      const saved = JSON.parse(localStorage.getItem(WORK_KEY) || "null");
      if (saved && saved.baseSha === state.baseSha && Array.isArray(saved.products)) {
        state.products = saved.products;
        toast("Restored your unsaved changes from this device.");
      } else if (saved) localStorage.removeItem(WORK_KEY);
    } catch {}
  } catch (e) {
    state.error = e.status === 401 ? "login" : e.message;
  }
  state.loading = false; render();
}
async function saveDraft() {
  const ids = changedIds();
  if (!ids.length) return;
  try {
    const r = await api("/products", { method: "PUT", body: JSON.stringify({ sha: state.baseSha, data: { ...state.server, products: state.products } }) });
    localStorage.removeItem(WORK_KEY);
    toast(r.unchanged ? "No changes to save." : "✓ Draft saved (" + ids.length + " product" + (ids.length === 1 ? "" : "s") + "). Not live yet.");
    await load();
  } catch (e) {
    if (e.conflict) { toast("Someone else saved changes first. Reload to see them — your edits stay on this device."); }
    else toast(e.message);
  }
}
async function publish() {
  if (changedIds().length) { toast("Save your draft first."); return; }
  if (!(await confirmBox("Publish changes?", state.remote.unpublished + " saved change(s) will go live on LacciStudio.com in about a minute.", "Publish"))) return;
  try { await api("/publish", { method: "POST" }); toast("Published. The live site updates in about a minute."); await load(); }
  catch (e) { toast(e.message); }
}
async function discard() {
  if (!(await confirmBox("Discard the draft?", "Saved but unpublished changes will be removed. The live site is not affected.", "Discard draft", true))) return;
  try { await api("/discard", { method: "POST" }); localStorage.removeItem(WORK_KEY); toast("Draft discarded."); await load(); }
  catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- views
function route() { return (location.hash || "#home").slice(1).split("/")[0] || "home"; }

function render() {
  const view = document.getElementById("view");
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === route()));
  document.querySelectorAll(".bulkbar, .savebar, .sheet").forEach((e) => e.remove());
  if (!state.token || state.error === "login") return view.replaceChildren(loginView());
  if (state.loading) return view.replaceChildren(h("div", { class: "empty", text: "Loading…" }));
  if (state.error) return view.replaceChildren(h("div", { class: "card" }, h("p", { text: state.error }), h("button", { class: "btn", type: "button", text: "Try again", onclick: load })));
  const r = route();
  view.replaceChildren(r === "products" ? productsView() : r === "more" ? moreView() : homeView());
  const changed = changedIds().length;
  if (state.selected.size && r === "products") document.body.append(bulkBar());
  else if (changed) document.body.append(saveBar(changed));
  if (state.editing) document.body.append(editorSheet(state.products.find((p) => p.id === state.editing)));
}

function loginView() {
  return h("div", { class: "login" },
    h("img", { src: "/assets/logo/lacci-primary-gold.png", alt: "Lacci Studio" }),
    h("h1", { text: "Lacci Studio Admin" }),
    h("p", { class: "muted", text: "Log in with GitHub on the editor page, then come back here." }),
    h("div", { class: "row-end", style: "justify-content:center" },
      h("a", { class: "btn primary", href: "/admin/", style: "display:inline-flex;align-items:center" }, "Log in"),
      h("button", { class: "btn", type: "button", text: "I've logged in", onclick: () => { state.token = token(); load(); } })));
}

function draftBanner() {
  const n = state.remote.unpublished;
  if (!n) return h("div", { class: "banner clean" }, h("div", {}, h("b", { text: "Everything is published." }), h("div", { class: "muted", text: "The live site matches your saved work." })));
  return h("div", { class: "banner draft" },
    h("div", {}, h("b", { text: n + " unpublished change" + (n === 1 ? "" : "s") }), h("div", { class: "muted", text: "Saved as a draft — customers don't see these yet." })),
    h("ul", { class: "list-plain" }, state.remote.draftCommits.slice(0, 5).map((c) => h("li", { text: c.message }))),
    h("div", { class: "row-end" },
      h("button", { class: "btn", type: "button", disabled: true, title: "Preview links are being switched on", text: "Preview (soon)" }),
      h("button", { class: "btn danger", type: "button", text: "Discard", onclick: discard }),
      h("button", { class: "btn gold", type: "button", text: "Publish", onclick: publish })));
}

function homeView() {
  const count = (s) => state.products.filter((p) => statusOf(p) === s).length;
  const stat = (n, label, filter) => h("a", { class: "stat", href: "#products", onclick: () => { state.filter = filter; } }, h("b", { text: String(n) }), h("span", { text: label }));
  return h("div", {},
    h("h1", { text: "Hello" + (state.user ? ", " + state.user : "") }),
    draftBanner(),
    h("div", { class: "stats" }, stat(count("active"), "Live products", "active"), stat(count("hidden"), "Hidden", "hidden"), stat(count("draft"), "Draft", "draft"), stat(count("archived"), "Archived", "archived")),
    h("div", { class: "card" }, h("b", { text: "Quick actions" }),
      h("div", { class: "row-end", style: "justify-content:flex-start;margin-top:10px" },
        h("a", { class: "btn primary", href: "#products", style: "display:inline-flex;align-items:center" }, "Manage products"),
        h("a", { class: "btn", href: "/admin/orders.html", style: "display:inline-flex;align-items:center" }, "Orders"),
        h("a", { class: "btn", href: "/", target: "_blank", rel: "noopener", style: "display:inline-flex;align-items:center" }, "View website"))),
    h("div", { class: "card" }, h("b", { text: "Recent live changes" }),
      state.remote.recentLive.length ? h("ul", { class: "list-plain" }, state.remote.recentLive.slice(0, 6).map((c) => h("li", {}, c.message, h("div", { class: "muted", text: c.date ? new Date(c.date).toLocaleString() : "" })))) : h("p", { class: "muted", text: "No recent changes." })));
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.products.filter((p) => {
    const s = statusOf(p);
    if (state.filter === "all" ? s === "archived" : s !== state.filter) return false;
    if (state.cat && (p.category || "") !== state.cat) return false;
    if (q && !((p.name || "") + " " + (p.category || "") + " " + (p.subcategory || "")).toLowerCase().includes(q)) return false;
    return true;
  });
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
    draftBanner(),
    h("div", { class: "toolbar" }, search,
      h("div", { class: "chips", role: "tablist" }, FILTERS.map(([k, label]) => h("button", { class: "chip" + (state.filter === k ? " on" : ""), type: "button", role: "tab", "aria-selected": String(state.filter === k), text: label + " " + (k === "all" ? state.products.filter((p) => statusOf(p) !== "archived").length : state.products.filter((p) => statusOf(p) === k).length), onclick: () => { state.filter = k; state.selected.clear(); render(); } }))),
      h("div", { class: "selectbar" },
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: allSel, "aria-label": "Select all shown products", onchange: (e) => { list.forEach((p) => (e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id))); render(); } }), h("span", { text: state.selected.size ? state.selected.size + " selected" : "Select all" })),
        h("select", { class: "small", "aria-label": "Category", onchange: (e) => { state.cat = e.target.value; render(); } }, h("option", { value: "", text: "All categories" }), cats.map((c) => h("option", { value: c, selected: state.cat === c, text: c }))))),
    list.length ? list.map((p) => productRow(p, changed.has(p.id))) : h("div", { class: "empty", text: "No products match." }),
    h("p", { class: "muted", text: list.length + " product" + (list.length === 1 ? "" : "s") + (state.filter === "all" ? " (archived products are under Archived)" : "") }));
}

function productRow(p, isChanged) {
  const s = statusOf(p);
  const sel = state.selected.has(p.id);
  const open = () => { state.editing = p.id; render(); };
  return h("div", { class: "prod" + (sel ? " sel" : "") },
    h("label", { class: "check", "aria-label": "Select " + p.name }, h("input", { type: "checkbox", checked: sel, onchange: (e) => { e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id); render(); } })),
    h("button", { class: "thumb", type: "button", "aria-label": "Edit " + p.name, onclick: open, style: thumbOf(p) ? `background:center/cover url("${thumbOf(p).replace(/"/g, "")}")` : "" }),
    h("button", { class: "info", type: "button", onclick: open },
      h("span", { class: "name", text: p.name }),
      h("span", { class: "meta", text: (p.category || "No category") + " · " + priceLabel(p) }),
      h("span", {}, h("span", { class: "pill " + s, text: STATUS_LABEL[s] || s }), p.featured ? h("span", { class: "pill feat", text: "Featured" }) : null, isChanged ? h("span", { class: "pill changed", text: "Edited" }) : null)),
    h("span", { class: "price-col", text: priceLabel(p) }),
    s === "archived"
      ? h("button", { class: "btn", type: "button", text: "Restore", onclick: () => updateProducts([p.id], { status: "hidden" }, p.name + " restored (hidden).") })
      : h("label", { class: "switch", title: s === "active" ? "Shown to customers" : "Hidden from customers" },
          h("input", { type: "checkbox", role: "switch", checked: s === "active", "aria-label": (s === "active" ? "Hide " : "Show ") + p.name,
            onchange: (e) => updateProducts([p.id], { status: e.target.checked ? "active" : "hidden" }, p.name + (e.target.checked ? " will be shown" : " will be hidden") + " when published.") }),
          h("span")));
}

function bulkBar() {
  const ids = [...state.selected];
  const n = ids.length;
  const done = (patch, verb) => { updateProducts(ids, patch, n + " product" + (n === 1 ? "" : "s") + " " + verb + "."); state.selected.clear(); render(); };
  return h("div", { class: "bulkbar", role: "toolbar", "aria-label": "Bulk actions" },
    h("b", { text: n + " selected" }),
    h("div", { class: "row-end" },
      h("button", { class: "btn", type: "button", text: "Show", onclick: () => done({ status: "active" }, "set to show") }),
      h("button", { class: "btn", type: "button", text: "Hide", onclick: () => done({ status: "hidden" }, "hidden") }),
      h("button", { class: "btn", type: "button", text: "Draft", onclick: () => done({ status: "draft" }, "moved to draft") }),
      h("button", { class: "btn", type: "button", text: "Archive", onclick: async () => { if (await confirmBox("Archive " + n + " product" + (n === 1 ? "" : "s") + "?", "Archived products are hidden and kept with all their details. You can restore them any time.", "Archive")) done({ status: "archived" }, "archived"); } }),
      h("button", { class: "btn", type: "button", text: "Clear", onclick: () => { state.selected.clear(); render(); } })));
}

function saveBar(n) {
  return h("div", { class: "savebar" },
    h("div", {}, h("b", { text: n + " unsaved change" + (n === 1 ? "" : "s") }), h("div", { class: "muted", text: "Kept on this device until you save." })),
    h("div", { class: "row-end" },
      h("button", { class: "btn", type: "button", text: "Undo all", onclick: async () => { if (await confirmBox("Undo all unsaved changes?", "Your edits since the last save will be removed.", "Undo all", true)) setProducts(state.server.products.map((p) => ({ ...p })), "Unsaved changes undone."); } }),
      h("button", { class: "btn primary", type: "button", text: "Save draft", onclick: saveDraft })));
}

function editorSheet(p) {
  if (!p) return null;
  let work = structuredClone(p);
  const close = () => { state.editing = null; render(); };
  const apply = () => {
    const price = Number(work.price);
    if (!work.name || !work.name.trim()) return toast("Please give the product a name.");
    if (!Number.isFinite(price) || price < 0) return toast("Please enter a valid price.");
    work.price = Math.round(price * 100) / 100;
    state.editing = null;
    setProducts(state.products.map((x) => (x.id === p.id ? work : x)), work.name + " updated — save your draft to keep it.", true);
  };
  const cats = [...new Set(state.products.map((x) => x.category).filter(Boolean))].sort();
  const pics = h("div", { class: "pics" });
  const drawPics = () => pics.replaceChildren(...(work.images || []).map((src, i, arr) => h("div", { class: "pic" },
    i === 0 ? h("span", { class: "main", text: "Main" }) : null,
    h("img", { src: imgSrc(src), alt: "", loading: "lazy" }),
    h("div", { class: "acts" },
      h("button", { type: "button", "aria-label": "Move earlier", disabled: i === 0, text: "←", onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; drawPics(); } }),
      h("button", { type: "button", "aria-label": "Remove from this product", text: "✕", onclick: async () => { if (await confirmBox("Remove this picture from the product?", "The picture file itself is kept. You can add it back later.", "Remove")) { arr.splice(i, 1); drawPics(); } } }),
      h("button", { type: "button", "aria-label": "Move later", disabled: i === arr.length - 1, text: "→", onclick: () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; drawPics(); } })))));
  drawPics();
  const statusSeg = h("div", { class: "seg", role: "group", "aria-label": "Visibility" });
  const drawSeg = () => statusSeg.replaceChildren(...["active", "hidden", "draft", "archived"].map((s) => h("button", { type: "button", "aria-pressed": String(statusOf(work) === s), text: STATUS_LABEL[s], onclick: () => { work.status = s; drawSeg(); } })));
  drawSeg();
  const groups = (work.optionGroups || []).map((g) => `${g.label || "Option"} (${(g.choices || []).length})`).join(" · ");
  // When option choices carry their own price (e.g. 11 oz $18.99), the base price isn't what customers pay.
  const pricedBy = (work.optionGroups || []).find((g) => (g.choices || []).some((c) => c && typeof c === "object" && c.price !== undefined && c.price !== null && c.price !== ""));
  const optionPrices = pricedBy ? pricedBy.choices.filter((c) => c && !c.hidden).map((c) => `${c.name} $${Number(c.price).toFixed(2)}`).join(" · ") : "";
  const colourCount = (work.colors || []).filter((c) => c.visible).length;
  return h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "Edit " + p.name },
    h("header", {}, h("button", { class: "btn", type: "button", text: "Cancel", onclick: close }), h("h2", { text: p.name }), h("button", { class: "btn primary", type: "button", text: "Done", onclick: apply })),
    h("div", { class: "field" }, h("label", { for: "f-name", text: "Product name" }), h("input", { id: "f-name", type: "text", value: work.name || "", maxlength: "140", oninput: (e) => (work.name = e.target.value) })),
    pricedBy
      ? h("div", { class: "field" }, h("span", { class: "lab", text: "Price" }), h("div", { class: "note", text: `Set by "${pricedBy.label || "option"}": ${optionPrices}. Customers see ${priceLabel(work)}. Editing option prices comes in the next update.` }))
      : h("div", { class: "field" }, h("label", { for: "f-price", text: "Price ($)" }), h("input", { id: "f-price", type: "number", inputmode: "decimal", step: "0.01", min: "0", value: work.price, oninput: (e) => (work.price = e.target.value) }),
          h("div", { class: "muted", text: "Customers see " + priceLabel(work) + (groups ? " (options can add to this)." : ".") })),
    h("div", { class: "field" }, h("span", { class: "lab", text: "Visibility" }), statusSeg, h("div", { class: "muted", text: "Live = customers see and can buy it. Hidden, Draft and Archived keep every detail." })),
    h("div", { class: "field" }, h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!work.featured, onchange: (e) => (work.featured = e.target.checked) }), h("span", { text: "Featured (for highlighting on the website)" }))),
    h("div", { class: "field" }, h("label", { for: "f-cat", text: "Category" }),
      h("input", { id: "f-cat", type: "text", list: "cat-list", value: work.category || "", oninput: (e) => (work.category = e.target.value) }),
      h("datalist", { id: "cat-list" }, cats.map((c) => h("option", { value: c })))),
    h("div", { class: "field" }, h("label", { for: "f-desc", text: "Description" }), h("textarea", { id: "f-desc", oninput: (e) => (work.description = e.target.value) }, work.description || "")),
    h("div", { class: "field" }, h("span", { class: "lab", text: "Pictures" }), (work.images || []).length ? pics : h("p", { class: "muted", text: "No pictures yet." }),
      h("div", { class: "note", text: "Uploading new pictures from your phone arrives with the Media Library." })),
    h("div", { class: "field" }, h("span", { class: "lab", text: "Options & colours" }),
      h("div", { class: "note", text: (groups || "No options") + (work.colors ? ` · ${colourCount} colour${colourCount === 1 ? "" : "s"} available` : "") + ". Editing options and colours comes in the next phases; they stay exactly as they are." })));
}

function moreView() {
  return h("div", {},
    h("h1", { text: "More" }),
    h("div", { class: "card" }, h("b", { text: "Coming next" }), h("p", { class: "muted", text: "Colours, pictures & videos, homepage and pages, promotions, navigation, SEO." })),
    h("div", { class: "card" }, h("b", { text: "Classic editor" }), h("p", { class: "muted", text: "The previous editor stays available while the new admin grows. Changes made there go live immediately." }),
      h("a", { class: "btn", href: "/admin/", style: "display:inline-flex;align-items:center" }, "Open classic editor")),
    h("div", { class: "card" }, h("b", { text: "Help" }),
      h("ul", { class: "list-plain" },
        h("li", { text: "Hide a product: Products → switch it off → Save draft → Publish." }),
        h("li", { text: "Hide several: tick them (or Select all) → Hide → Save draft → Publish." }),
        h("li", { text: "Edit: tap the picture or name → change → Done → Save draft → Publish." }),
        h("li", { text: "Undo: tap Undo on the message right after a change, or Undo all before saving, or Discard on the draft before publishing." }),
        h("li", { text: "Archive instead of delete: archived products are kept and can be restored from the Archived tab." }))));
}

// ---------------------------------------------------------------- start
window.addEventListener("hashchange", () => { state.selected.clear(); render(); });
state.token = token();
if (state.token) load(); else { state.loading = false; render(); }
