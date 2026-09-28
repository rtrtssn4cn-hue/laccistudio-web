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
// Over 20 items the order is sent as a request: nothing is paid until the owner confirms it.
const isRequest = () => cartItems() > MAX_ITEMS_PER_ORDER;
const REQUEST_TEXT = `Orders over ${MAX_ITEMS_PER_ORDER} items are sent as a request. You won't pay now: we'll confirm the date, then you'll get a link to pay.`;
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

// Free local delivery: the customer enters a ZIP in the cart; when it's in the delivery area the
// server adds the free option to the payment page. The ZIP is kept in this browser only.
const ZIP_KEY = "lacci_local_zip";
let localZip = ""; try { localZip = localStorage.getItem(ZIP_KEY) || ""; } catch {}
let localArea = null;
const loadArea = () => localArea || (localArea = fetch("/content/shipping.json").then((r) => r.json())
  .then((s) => (s.methods || []).find((m) => m.postalCodePattern && m.enabled !== false) || null).catch(() => null));
async function zipMessage() {
  const out = document.querySelector("#sc-zipmsg"); if (!out) return;
  if (!/^\d{5}$/.test(localZip)) { out.textContent = ""; out.className = "cart-zipmsg"; return; }
  const m = await loadArea();
  let ok = false; try { ok = !!m && new RegExp(m.postalCodePattern).test(localZip); } catch {}
  out.textContent = ok ? "✓ Free local delivery will be offered at checkout." : "Sorry, that ZIP is outside our local delivery area. Shipping options will be shown.";
  out.className = "cart-zipmsg " + (ok ? "ok" : "no");
}
const localBlock = () => `<div class="cart-local"><label for="sc-zip">Houston area? Enter your ZIP for free local delivery</label><input id="sc-zip" inputmode="numeric" autocomplete="postal-code" maxlength="5" placeholder="ZIP code" value="${esc(localZip)}"><p id="sc-zipmsg" class="cart-zipmsg" aria-live="polite"></p></div>`;
function wireZip() {
  const z = document.querySelector("#sc-zip"); if (!z) return;
  z.oninput = () => { localZip = z.value.replace(/\D/g, "").slice(0, 5); if (z.value !== localZip) z.value = localZip; try { localStorage.setItem(ZIP_KEY, localZip); } catch {} zipMessage(); };
  zipMessage();
}

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
  box.innerHTML = (isRequest() ? `<p class="cart-note cart-limit">${REQUEST_TEXT}</p>` : "") + cart.map((l, i) => {
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
    (isRequest()
      ? `<p class="cart-note">${cartItems()} items. Shipping and any sales tax are added when you pay.</p>` +
        `<button class="btn btn-gold" id="sc-checkout" style="width:100%;justify-content:center"${blocked ? " disabled" : ""}>Send order request</button>` +
        `<p class="cart-note" style="text-align:center;margin-top:.5rem">No payment now</p>`
      : localBlock() + `<p class="cart-note">Shipping and any sales tax are added at checkout. Promo codes can be entered there too.</p>` +
        `<button class="btn btn-gold" id="sc-checkout" style="width:100%;justify-content:center"${blocked ? " disabled" : ""}>Checkout</button>` +
        `<p class="cart-note" style="text-align:center;margin-top:.5rem">Secure payment by Stripe</p>`) +
    `<button class="cart-continue" id="sc-continue">Continue shopping</button>`;
  box.querySelectorAll("[data-inc]").forEach((b) => (b.onclick = () => setQty(+b.dataset.inc, cart[+b.dataset.inc].qty + 1)));
  box.querySelectorAll("[data-dec]").forEach((b) => (b.onclick = () => setQty(+b.dataset.dec, cart[+b.dataset.dec].qty - 1)));
  box.querySelectorAll("[data-rem]").forEach((b) => (b.onclick = () => setQty(+b.dataset.rem, 0)));
  box.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => customizer().then((m) => m.edit(+b.dataset.edit))));
  box.querySelectorAll("[data-dup]").forEach((b) => (b.onclick = () => customizer().then((m) => m.edit(+b.dataset.dup, true))));
  document.querySelector("#sc-continue").onclick = close;
  wireZip();
  document.querySelector("#sc-checkout").onclick = cart.some((l) => l.customization) ? review : isRequest() ? requestForm : checkout;
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
    (isRequest() ? `<p class="cart-note">${REQUEST_TEXT}</p>` +
      `<button class="btn btn-gold" id="sc-pay" style="width:100%;justify-content:center">Continue to order request</button>`
    : localBlock() + `<p class="cart-note">Shipping and any sales tax are added on the next page.</p>` +
      `<button class="btn btn-gold" id="sc-pay" style="width:100%;justify-content:center">Continue to secure checkout</button>`) +
    `<button class="cart-continue" id="sc-back">Back to cart</button>`;
  box.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => customizer().then((m) => m.edit(+b.dataset.edit))));
  document.querySelector("#sc-pay").onclick = isRequest() ? requestForm : checkout;
  wireZip();
  document.querySelector("#sc-back").onclick = () => render();
}

// Contact details and the date needed, for an order over 20 items. Sent without payment.
function requestForm(message) {
  const box = document.querySelector("#sc-items"), foot = document.querySelector("#sc-foot");
  const today = new Date().toISOString().slice(0, 10);
  let subtotal = 0; for (const l of cart) { const p = price(l); if (p.ok) subtotal += p.unitCents * l.qty; }
  box.innerHTML = `<h4 class="rv-title">Send your order request</h4>
    <p class="cart-note">${REQUEST_TEXT}</p>
    <form class="rq-form" id="rq-form" novalidate>
      <label>Your name<input name="name" autocomplete="name" required></label>
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Phone <small>(optional)</small><input name="phone" type="tel" autocomplete="tel"></label>
      <label>When do you need it by?<input name="neededBy" type="date" min="${today}"></label>
      <label>Anything we should know? <small>(optional)</small><textarea name="message" rows="3"></textarea></label>
    </form>`;
  foot.innerHTML = (message ? `<p class="cart-note" role="alert" style="color:#b3261e">${esc(message)}</p>` : "") +
    `<div class="cart-subtotal"><span>${cartItems()} items · subtotal</span><strong>${money(subtotal)}</strong></div>` +
    `<button class="btn btn-gold" id="rq-send" style="width:100%;justify-content:center">Send order request</button>` +
    `<p class="cart-note" style="text-align:center;margin-top:.5rem">No payment now. You'll pay after we confirm.</p>` +
    `<button class="cart-continue" id="sc-back">Back to cart</button>`;
  const form = document.querySelector("#rq-form");
  if (requestForm.saved) for (const [k, v] of Object.entries(requestForm.saved)) if (form.elements[k]) form.elements[k].value = v;
  document.querySelector("#sc-back").onclick = () => render();
  document.querySelector("#rq-send").onclick = () => sendRequest(form);
}

async function sendRequest(form) {
  const contact = Object.fromEntries(["name", "email", "phone", "neededBy", "message"].map((k) => [k, form.elements[k].value.trim()]));
  requestForm.saved = contact; // kept if the form has to be shown again
  if (!contact.name) return requestForm("Please enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact.email)) return requestForm("Please enter a valid email so we can reply.");
  const btn = document.querySelector("#rq-send");
  btn.disabled = true; btn.textContent = "Sending…";
  const lines = cart.map(({ thumbs, ...l }) => ({ ...l, expectedUnitCents: price(l).unitCents }));
  try {
    const res = await fetch("/api/order-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines, contact }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.link) { clear(); requestForm.saved = null; location.href = data.link; return; }
    if (res.status === 409) { await reloadCatalog(); return render(data.error); }
    requestForm(data.error || "We couldn't send your request. Please try again.");
  } catch {
    requestForm("We couldn't reach our server. Check your connection and try again.");
  }
}

function setQty(i, q) {
  if (!cart[i]) return;
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
    const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines, localZip }) });
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
