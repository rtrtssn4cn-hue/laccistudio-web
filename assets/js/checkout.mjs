// Lacci Studio — cart and Stripe checkout (active when checkout mode is "stripe").
//
// Lines are stored in this browser only (localStorage) until checkout. Prices shown here come from
// assets/js/pricing.mjs, the same code the server uses; the server recalculates every line before
// creating the Stripe payment and never uses a price sent from here.

import { priceLine, money, itemCount, MAX_ITEMS_PER_ORDER } from "./pricing.mjs";

const KEY = "lacci_stripe_cart_v1";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} };
let cart = load();

const raw = () => window.LACCI_RAW || { products: [], colors: [] };
const productOf = (id) => raw().products.find((p) => p.id === id);
// Physical items in the cart (a coaster set counts its coasters), optionally leaving one line out.
function cartItems(skip = -1) { return cart.reduce((s, l, i) => (i === skip ? s : s + itemCount(productOf(l.productId), { options: l.options }, l.qty)), 0); }
let limitNote = "";
const LIMIT_TEXT = `Online orders are up to ${MAX_ITEMS_PER_ORDER} items. Need more? <a href="contact.html?service=Custom%20or%20bulk%20order">Send us a request</a> with the date you need them by.`;
function price(line) { return priceLine(productOf(line.productId), { options: line.options, color: line.color }, raw().colors); }
// Lines from the visual customizer carry their own design id, so two different designs of the same
// product never merge; re-adding the very same design only raises the quantity.
const sameLine = (a, b) => JSON.stringify([a.productId, a.options, a.color, a.personalization, a.files, a.customizationId || null]) === JSON.stringify([b.productId, b.options, b.color, b.personalization, b.files, b.customizationId || null]);
// Rendered previews saved with a customized line: one per coaster for sets designed individually.
function previewsOf(l) {
  const c = l.customization;
  if (l.thumbs && l.thumbs.length) return l.thumbs; // kept in this browser; the uploaded previews go with the order
  if (!c) return l.files && l.files.preview ? [l.files.preview] : [];
  if (c.items) return c.items.map((it) => Object.values(it.previews || {})[0]).filter(Boolean);
  return Object.values(c.previews || {});
}
const customizer = () => import("./customizer.mjs?v=1");

function ensureDrawer() {
  if (document.querySelector("#sc-drawer")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML =
    '<div class="cart-overlay" id="sc-overlay"></div>' +
    '<aside class="cart-drawer" id="sc-drawer" aria-label="Shopping cart" role="dialog" aria-modal="true">' +
    '<div class="cart-head"><h3>Your Cart</h3><button class="cart-close" id="sc-close" aria-label="Close cart">&times;</button></div>' +
    '<div class="cart-items" id="sc-items"></div><div class="cart-foot" id="sc-foot"></div></aside>';
  document.body.appendChild(wrap);
  document.querySelector("#sc-overlay").addEventListener("click", close);
  document.querySelector("#sc-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}
function open() { ensureDrawer(); render(); document.querySelector("#sc-drawer").classList.add("open"); document.querySelector("#sc-overlay").classList.add("show"); }
function close() { const d = document.querySelector("#sc-drawer"); if (d) { d.classList.remove("open"); document.querySelector("#sc-overlay").classList.remove("show"); } }

function refreshBadge() {
  if (!active()) return;
  const n = cart.reduce((s, l) => s + l.qty, 0);
  document.querySelectorAll(".cart-count").forEach((el) => { el.textContent = n; el.style.display = n ? "" : "none"; });
}

function render(message) {
  refreshBadge();
  const box = document.querySelector("#sc-items"), foot = document.querySelector("#sc-foot");
  if (!box) return;
  if (!cart.length) {
    box.innerHTML = '<p class="cart-empty">Your cart is empty.<br><a href="shop.html">Browse the shop &rarr;</a></p>';
    foot.innerHTML = message ? `<p class="cart-note" role="alert">${esc(message)}</p>` : "";
    return;
  }
  let subtotal = 0, blocked = false;
  box.innerHTML = (limitNote ? `<p class="cart-note cart-limit" role="alert">${limitNote}</p>` : "") + cart.map((l, i) => {
    const p = price(l);
    if (p.ok) subtotal += p.unitCents * l.qty; else blocked = true;
    const opts = p.ok ? p.summary.map((o) => `${esc(o.label)}: ${esc(o.value)}`).join("<br>") : "";
    const pers = l.personalization && l.personalization.text ? `<span class="ci-opt">“${esc(l.personalization.text)}”</span>` : "";
    const files = l.files && (l.files.design || l.files.backDesign) ? '<span class="ci-design ok">✓ Artwork attached</span>' : "";
    const pv = previewsOf(l);
    const thumbs = pv.length > 1 ? `<span class="ci-thumbs">${pv.map((u, k) => `<img src="${esc(u)}" alt="Design ${k + 1}" loading="lazy">`).join("")}</span>` : "";
    const actions = l.customization ? `<span class="ci-acts"><button type="button" data-edit="${i}">Edit design</button><button type="button" data-dup="${i}">Duplicate</button></span>` : "";
    return `<div class="cart-item">` +
      `<img src="${esc(pv[0] || l.image || "")}" alt="${l.customization ? "Your design" : ""}">` +
      `<div class="ci-info"><strong>${esc(l.name)}</strong><span class="ci-opt">${opts}</span>${pers}${files}${thumbs}${actions}` +
      (p.ok ? `<span class="ci-price">${money(p.unitCents)}</span>` : `<span class="ci-price" style="color:#b3261e">${esc(p.error)} Please remove it.</span>`) + `</div>` +
      `<div class="ci-qty"><button data-dec="${i}" aria-label="Decrease quantity">&minus;</button><span>${l.qty}</span><button data-inc="${i}" aria-label="Increase quantity">+</button></div>` +
      `<button class="ci-remove" data-rem="${i}" aria-label="Remove ${esc(l.name)}">&times;</button></div>`;
  }).join("");
  foot.innerHTML =
    (message ? `<p class="cart-note" role="alert" style="color:#b3261e">${esc(message)}</p>` : "") +
    `<div class="cart-subtotal"><span>Subtotal</span><strong id="sc-subtotal">${money(subtotal)}</strong></div>` +
    `<p class="cart-note">Shipping and any sales tax are added at checkout. Promo codes can be entered there too.</p>` +
    `<button class="btn btn-gold" id="sc-checkout" style="width:100%;justify-content:center"${blocked ? " disabled" : ""}>Checkout</button>` +
    `<p class="cart-note" style="text-align:center;margin-top:.5rem">Secure payment by Stripe</p>` +
    `<button class="cart-continue" id="sc-continue">Continue shopping</button>`;
  box.querySelectorAll("[data-inc]").forEach((b) => (b.onclick = () => setQty(+b.dataset.inc, cart[+b.dataset.inc].qty + 1)));
  box.querySelectorAll("[data-dec]").forEach((b) => (b.onclick = () => setQty(+b.dataset.dec, cart[+b.dataset.dec].qty - 1)));
  box.querySelectorAll("[data-rem]").forEach((b) => (b.onclick = () => setQty(+b.dataset.rem, 0)));
  box.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => customizer().then((m) => m.edit(+b.dataset.edit))));
  box.querySelectorAll("[data-dup]").forEach((b) => (b.onclick = () => customizer().then((m) => m.edit(+b.dataset.dup, true))));
  document.querySelector("#sc-continue").onclick = close;
  document.querySelector("#sc-checkout").onclick = cart.some((l) => l.customization) ? review : checkout;
}

// Last look before paying: every customized design large, with its options and text.
function review() {
  const box = document.querySelector("#sc-items"), foot = document.querySelector("#sc-foot");
  let subtotal = 0;
  box.innerHTML = `<h4 class="rv-title">Review your order</h4>` + cart.map((l, i) => {
    const p = price(l); if (p.ok) subtotal += p.unitCents * l.qty;
    const pv = previewsOf(l), c = l.customization;
    const texts = [];
    if (c) for (const a of (c.items ? c.items.flatMap((it) => Object.values(it.areas)) : Object.values(c.areas || {}))) for (const x of a.layers || []) if (x.type === "text") texts.push(x.text);
    return `<div class="rv-item"><div class="rv-imgs">${(pv.length ? pv : [l.image]).map((u, k) => `<img src="${esc(u || "")}" alt="${pv.length > 1 ? "Coaster " + (k + 1) : "Your design"}">`).join("")}</div>` +
      `<div class="rv-info"><strong>${esc(l.name)} × ${l.qty}</strong>` +
      (p.ok ? p.summary.map((o) => `<span>${esc(o.label)}: ${esc(o.value)}</span>`).join("") : "") +
      (texts.length ? `<span>Text: “${texts.map(esc).join("”, “")}”</span>` : "") +
      (c ? `<span>${c.proof ? "Digital proof before we make it" : "No proof — made as shown"}</span>` : "") +
      (c && c.comments ? `<span>Notes: ${esc(c.comments)}</span>` : "") +
      `<span class="ci-price">${p.ok ? money(p.unitCents * l.qty) : esc(p.error)}</span>` +
      (c ? `<button type="button" class="rv-edit" data-edit="${i}">Edit design</button>` : "") + `</div></div>`;
  }).join("");
  foot.innerHTML = `<div class="cart-subtotal"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>` +
    `<p class="cart-note">Shipping and any sales tax are added on the next page.</p>` +
    `<button class="btn btn-gold" id="sc-pay" style="width:100%;justify-content:center">Continue to secure checkout</button>` +
    `<button class="cart-continue" id="sc-back">Back to cart</button>`;
  box.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => customizer().then((m) => m.edit(+b.dataset.edit))));
  document.querySelector("#sc-pay").onclick = checkout;
  document.querySelector("#sc-back").onclick = () => render();
}

function setQty(i, q) {
  if (!cart[i]) return;
  if (q > cart[i].qty && cartItems(i) + itemCount(productOf(cart[i].productId), { options: cart[i].options }, q) > MAX_ITEMS_PER_ORDER) { limitNote = LIMIT_TEXT; render(); return; }
  limitNote = "";
  if (q <= 0) cart.splice(i, 1); else cart[i].qty = Math.min(q, 50);
  save(cart); render();
}

function add(line) {
  const clean = {
    productId: line.productId, name: line.name, image: line.image || "", qty: Math.max(1, Math.min(50, parseInt(line.qty, 10) || 1)),
    options: line.options || {}, color: line.color || null,
    personalization: Object.fromEntries(Object.entries(line.personalization || {}).filter(([, v]) => v)),
    files: Object.fromEntries(Object.entries(line.files || {}).filter(([, v]) => v)),
    ...(line.customization ? { customizationId: line.customizationId, customization: line.customization } : {}),
    ...(Array.isArray(line.thumbs) && line.thumbs.length ? { thumbs: line.thumbs.filter((t) => /^data:image\/jpeg;base64,/.test(t)).slice(0, 12) } : {}),
  };
  const p = price(clean);
  if (!p.ok) { alert(p.error); return; }
  const same = cart.find((l) => sameLine(l, clean));
  if (same) same.qty = Math.min(50, same.qty + clean.qty); else cart.push(clean);
  save(cart); open();
}

async function checkout() {
  const btn = document.querySelector("#sc-pay") || document.querySelector("#sc-checkout");
  btn.disabled = true; btn.textContent = "Opening secure checkout…";
  const lines = cart.map(({ thumbs, ...l }) => ({ ...l, expectedUnitCents: price(l).unitCents }));
  try {
    const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) { location.href = data.url; return; }
    if (res.status === 409) await reloadCatalog(); // prices changed since the page loaded: show the current ones
    render(data.error || "Checkout isn't available right now. Please try again.");
  } catch {
    render("We couldn't reach checkout. Check your connection and try again.");
  }
}

// Drop lines that are no longer orderable (product or option hidden since they were added).
function prune() {
  const before = cart.length;
  cart = cart.filter((l) => price(l).ok);
  if (cart.length !== before) { save(cart); return before - cart.length; }
  return 0;
}

async function reloadCatalog() {
  try {
    const [p, c] = await Promise.all([fetch("/content/products.json", { cache: "no-store" }).then((r) => r.json()), fetch("/content/colors.json", { cache: "no-store" }).then((r) => r.json())]);
    window.LACCI_RAW = { products: p.products || [], colors: c.garmentColors || [] };
    prune();
  } catch {}
}

function clear() { cart = []; save(cart); refreshBadge(); }
// Swap a line for its edited version (Edit design), keeping its place in the cart.
function replace(i, line) {
  if (!cart[i]) return add(line);
  const before = cart.slice();
  cart.splice(i, 1);
  const n = cart.length;
  add(line);
  if (cart.length > n) { const [l] = cart.splice(cart.length - 1, 1); cart.splice(i, 0, l); save(cart); render(); }
  else if (!cart.length) cart = before;
}

const active = () => window.LACCI_CHECKOUT_MODE === "stripe";
function start() {
  if (!active()) return; // Snipcart (or another mode) is in charge of the cart
  const removed = window.LACCI_RAW ? prune() : 0;
  refreshBadge();
  if (removed) { ensureDrawer(); open(); render(`${removed} item${removed > 1 ? "s were" : " was"} removed because the option chosen is no longer available.`); }
  if (new URLSearchParams(location.search).get("checkout") === "cancelled") { ensureDrawer(); open(); }
}

window.LacciCheckout = { add, replace, open, close, refreshBadge, clear, lines: () => cart.slice() };
document.dispatchEvent(new Event("lacci:checkout-ready"));
if (window.LACCI_READY) start(); else document.addEventListener("lacci:ready", start, { once: true });
