// Lacci Studio — cart and Stripe checkout (active when checkout mode is "stripe").
//
// Lines are stored in this browser only (localStorage) until checkout. Prices shown here come from
// assets/js/pricing.mjs, the same code the server uses; the server recalculates every line before
// creating the Stripe payment and never uses a price sent from here.

import { priceLine, money } from "./pricing.mjs";

const KEY = "lacci_stripe_cart_v1";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} };
let cart = load();

const raw = () => window.LACCI_RAW || { products: [], colors: [] };
const productOf = (id) => raw().products.find((p) => p.id === id);
function price(line) { return priceLine(productOf(line.productId), { options: line.options, color: line.color }, raw().colors); }
const sameLine = (a, b) => JSON.stringify([a.productId, a.options, a.color, a.personalization, a.files]) === JSON.stringify([b.productId, b.options, b.color, b.personalization, b.files]);

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
  box.innerHTML = cart.map((l, i) => {
    const p = price(l);
    if (p.ok) subtotal += p.unitCents * l.qty; else blocked = true;
    const opts = p.ok ? p.summary.map((o) => `${esc(o.label)}: ${esc(o.value)}`).join("<br>") : "";
    const pers = l.personalization && l.personalization.text ? `<span class="ci-opt">“${esc(l.personalization.text)}”</span>` : "";
    const files = l.files && (l.files.design || l.files.backDesign) ? '<span class="ci-design ok">✓ Artwork attached</span>' : "";
    return `<div class="cart-item">` +
      `<img src="${esc(l.image || "")}" alt="">` +
      `<div class="ci-info"><strong>${esc(l.name)}</strong><span class="ci-opt">${opts}</span>${pers}${files}` +
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
  document.querySelector("#sc-continue").onclick = close;
  document.querySelector("#sc-checkout").onclick = checkout;
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
  };
  const p = price(clean);
  if (!p.ok) { alert(p.error); return; }
  const same = cart.find((l) => sameLine(l, clean));
  if (same) same.qty = Math.min(50, same.qty + clean.qty); else cart.push(clean);
  save(cart); open();
}

async function checkout() {
  const btn = document.querySelector("#sc-checkout");
  btn.disabled = true; btn.textContent = "Opening secure checkout…";
  const lines = cart.map((l) => ({ ...l, expectedUnitCents: price(l).unitCents }));
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

const active = () => window.LACCI_CHECKOUT_MODE === "stripe";
function start() {
  if (!active()) return; // Snipcart (or another mode) is in charge of the cart
  const removed = window.LACCI_RAW ? prune() : 0;
  refreshBadge();
  if (removed) { ensureDrawer(); open(); render(`${removed} item${removed > 1 ? "s were" : " was"} removed because the option chosen is no longer available.`); }
  if (new URLSearchParams(location.search).get("checkout") === "cancelled") { ensureDrawer(); open(); }
}

window.LacciCheckout = { add, open, close, refreshBadge, clear, lines: () => cart.slice() };
document.dispatchEvent(new Event("lacci:checkout-ready"));
if (window.LACCI_READY) start(); else document.addEventListener("lacci:ready", start, { once: true });
