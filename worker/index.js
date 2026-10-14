// Lacci Studio checkout worker (Cloudflare Workers, free plan).
//
// Static files are served by Cloudflare's asset handling before this code runs; only paths that
// are not files (the /api/ routes below) reach the worker, so browsing the site costs no
// worker requests.
//
//   POST /api/checkout                 validate the cart on the server, create a Stripe Checkout Session
//   POST /api/stripe/webhook           Stripe events (signature-checked, idempotent)
//   GET  /api/order-status?session_id  confirmation page status (asks Stripe directly if still pending)
//   POST /api/order-request            order over 20 items: saved for the owner to confirm, no payment yet
//   GET  /api/order-request?o&k        the customer's request page (status, items)
//   POST /api/order-request/pay        after the owner confirms: opens Stripe Checkout for that order
//   GET  /api/admin/orders[/:number]   order list / detail for repo editors (GitHub login)
//   POST /api/admin/orders/:number     mark fulfilled, add a note
//   /api/admin/content/*               new admin: products, draft / publish (worker/admin-content.js)
//
// Prices come from the deployed content/products.json via the same assets/js/pricing.mjs the
// shop uses. A price sent by the browser is never charged; it is only compared, and a mismatch
// returns the correct prices instead of creating a payment.

import { cleanCustomization, DESIGN_SRC } from "./customization.js";
import { priceLine, coasterCount, itemCount, MAX_ITEMS_PER_ORDER, money } from "../assets/js/pricing.mjs";
import { stripe, isTestKey, verifyStripeSignature } from "./stripe.js";
import { handleAdminContent } from "./admin-content.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const nowIso = () => new Date().toISOString();

const LIMITS = { lines: 25, qty: 50, text: 1000, body: 512 * 1024 };
const PERSONALIZATION_KEYS = ["text", "font", "textColor", "textColorCode", "placement", "textStyle", "comments", "proof"];
const FILE_KEYS = ["design", "backDesign", "preview"];

// ---------------------------------------------------------------- catalog
let catalogCache = null;
async function loadCatalog(env) {
  if (catalogCache && catalogCache.until > Date.now()) return catalogCache.data;
  const get = async (path) => {
    const res = await env.ASSETS.fetch(new Request(`https://assets.invalid${path}`));
    if (!res.ok) throw new Error(`catalog file missing: ${path}`);
    return res.json();
  };
  const [products, colors, shipping] = await Promise.all([get("/content/products.json"), get("/content/colors.json"), get("/content/shipping.json")]);
  const data = { products: products.products || [], colors: colors.garmentColors || [], shipping };
  catalogCache = { data, until: Date.now() + 30_000 };
  return data;
}

// ---------------------------------------------------------------- helpers
const clip = (v, n = LIMITS.text) => (typeof v === "string" ? v.slice(0, n).trim() : "");
function uploadHosts(env) { return (env.UPLOAD_HOSTS || "51niy1s3e7.ucarecd.net,ucarecdn.com").split(",").map((s) => s.trim()).filter(Boolean); }
function cleanFileUrl(env, v) {
  if (!v || typeof v !== "string") return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return null;
    return uploadHosts(env).some((h) => u.hostname === h || u.hostname.endsWith("." + h)) ? u.toString() : null;
  } catch { return null; }
}
function siteOrigin(env, request) { return (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, ""); }

// Guest order links use a random nonce plus an HMAC. D1 stores the nonce and a SHA-256 digest,
// never the usable token. The HMAC secret stays in Cloudflare as ORDER_LINK_SECRET, so a database
// export alone cannot be turned into working customer links.
const enc = new TextEncoder();
function bytesHex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256(value) { return bytesHex(await crypto.subtle.digest("SHA-256", enc.encode(value))); }
function base64url(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function signOrderToken(secret, orderNumber, nonce) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${nonce}.${base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${orderNumber}:${nonce}`))))}`;
}
function proofRequired(line) {
  if (line && line.customization) return line.customization.proof === true;
  const proof = clip(line && line.personalization && line.personalization.proof, 120).toLowerCase();
  return !!proof && !proof.startsWith("no") && proof !== "false";
}
function proofUnits(lines) {
  const out = [];
  lines.forEach((line, lineIndex) => {
    if (!proofRequired(line)) return;
    const c = line.customization;
    if (c && c.layout === "each" && Array.isArray(c.items)) {
      c.items.forEach((item, itemIndex) => out.push({ proofKey: `line-${lineIndex}-item-${itemIndex}`, lineIndex, itemIndex, name: `${line.name} · design ${itemIndex + 1}`, previews: item.previews || {} }));
    } else {
      out.push({ proofKey: `line-${lineIndex}`, lineIndex, itemIndex: null, name: line.name, previews: (c && c.previews) || (line.files && line.files.preview ? { main: line.files.preview } : {}) });
    }
  });
  return out;
}
async function createAccess(env, orderNumber, rotate = false) {
  if (!env.ORDER_LINK_SECRET) throw new Error("Order links are not configured.");
  if (!rotate) {
    const found = await env.DB.prepare("SELECT * FROM order_access WHERE order_number = ?").bind(orderNumber).first();
    if (found) return { row: found, token: await signOrderToken(env.ORDER_LINK_SECRET, orderNumber, found.token_nonce) };
  }
  const nonce = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const token = await signOrderToken(env.ORDER_LINK_SECRET, orderNumber, nonce);
  const created = nowIso(), expires = new Date(Date.now() + 180 * 86400_000).toISOString();
  await env.DB.prepare(`INSERT INTO order_access (order_number, token_nonce, token_hash, created_at, expires_at, revoked_at, email_sent_at, email_error_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
    ON CONFLICT(order_number) DO UPDATE SET token_nonce = excluded.token_nonce, token_hash = excluded.token_hash, created_at = excluded.created_at,
      expires_at = excluded.expires_at, revoked_at = NULL, email_sent_at = NULL, email_error_at = NULL`)
    .bind(orderNumber, nonce, await sha256(token), created, expires).run();
  return { row: { order_number: orderNumber, token_nonce: nonce, token_hash: await sha256(token), created_at: created, expires_at: expires }, token };
}
async function authorizedOrder(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const access = await env.DB.prepare("SELECT * FROM order_access WHERE token_hash = ?").bind(await sha256(token)).first();
  if (!access || access.revoked_at || access.expires_at <= nowIso()) return null;
  const expected = await signOrderToken(env.ORDER_LINK_SECRET || "", access.order_number, access.token_nonce);
  if ((await sha256(expected)) !== access.token_hash) return null;
  const order = await env.DB.prepare("SELECT * FROM orders WHERE order_number = ?").bind(access.order_number).first();
  if (!order || !["paid", "fulfilled"].includes(order.status)) return null;
  await env.DB.prepare("UPDATE order_access SET last_used_at = ? WHERE order_number = ?").bind(nowIso(), access.order_number).run();
  return { access, order };
}

function htmlEsc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function emailPreviews(lines) {
  const urls = [];
  for (const line of lines) {
    const c = line.customization;
    if (c && Array.isArray(c.items)) c.items.forEach((i) => urls.push(...Object.values(i.previews || {})));
    else if (c) urls.push(...Object.values(c.previews || {}));
    else if (line.files && line.files.preview) urls.push(line.files.preview);
  }
  return [...new Set(urls.filter(Boolean))].slice(0, 12);
}
async function sendOrderEmail(env, order, token, origin) {
  if (!env.EMAIL_API_KEY || !env.EMAIL_API_URL || !env.ORDER_EMAIL_FROM) throw new Error("Order email is not configured.");
  if (!order.customer_email) throw new Error("Order has no customer email.");
  const lines = JSON.parse(order.lines_json || "[]"), needsProof = proofUnits(lines).length > 0;
  const link = `${origin}/track-order.html#token=${encodeURIComponent(token)}`;
  const pictures = emailPreviews(lines).map((src, i) => `<img src="${htmlEsc(src)}" alt="Saved design ${i + 1}" style="width:140px;height:140px;object-fit:contain;border:1px solid #e8e1d7;border-radius:8px;margin:4px;background:#fff">`).join("");
  const itemRows = lines.map((l) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${htmlEsc(l.name)} × ${Number(l.qty) || 1}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${money(l.lineCents)}</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#2b1d12;max-width:640px;margin:auto"><img src="${origin}/assets/logo/lacci-primary.png" alt="Lacci Studio" style="width:190px;height:auto"><h1 style="font-family:Georgia,serif;font-weight:500">Your order means the world to us.</h1><p>Thank you for your order. Your payment is confirmed.</p><p><strong>Order ${htmlEsc(order.order_number)}</strong></p><table style="width:100%;border-collapse:collapse">${itemRows}<tr><td style="padding-top:10px"><strong>Total</strong></td><td style="padding-top:10px;text-align:right"><strong>${money(order.total_cents)}</strong></td></tr></table>${pictures ? `<h2 style="font-family:Georgia,serif;font-weight:500">Your saved design${emailPreviews(lines).length > 1 ? "s" : ""}</h2><div>${pictures}</div>` : ""}<p>${needsProof ? "Please review and approve each design before production can begin." : "You can review your order and follow its status at any time."}</p><p><a href="${htmlEsc(link)}" style="display:inline-block;background:#2b1d12;color:#fff;text-decoration:none;padding:13px 20px;border-radius:4px">Track &amp; review my order</a></p><p style="font-size:12px;color:#6f6258">This private link expires in 180 days. Do not forward it.</p></div>`;
  const res = await fetch(env.EMAIL_API_URL, { method: "POST", headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `order-confirmation-${order.order_number}` }, body: JSON.stringify({ from: env.ORDER_EMAIL_FROM, to: [order.customer_email], subject: `Lacci Studio order ${order.order_number} — confirmed`, html }) });
  if (!res.ok) throw new Error(`Order email failed (${res.status}).`);
}

async function ensurePaidExperience(env, orderNumber, requestOrigin) {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE order_number = ?").bind(orderNumber).first();
  if (!order || !["paid", "fulfilled"].includes(order.status)) return;
  const lines = JSON.parse(order.lines_json || "[]"), units = proofUnits(lines);
  for (const u of units) await env.DB.prepare("INSERT OR IGNORE INTO proof_decisions (order_number, proof_key, line_index, item_index) VALUES (?, ?, ?, ?)").bind(orderNumber, u.proofKey, u.lineIndex, u.itemIndex).run();
  if (order.production_status === "not_started") {
    await env.DB.prepare("UPDATE orders SET production_status = ? WHERE order_number = ? AND production_status = 'not_started'").bind(units.length ? "awaiting_approval" : "ready", orderNumber).run();
  }
  const access = await createAccess(env, orderNumber);
  if (access.row.email_sent_at) return;
  try {
    await sendOrderEmail(env, order, access.token, requestOrigin);
    await env.DB.prepare("UPDATE order_access SET email_sent_at = ?, email_error_at = NULL WHERE order_number = ? AND email_sent_at IS NULL").bind(nowIso(), orderNumber).run();
  } catch (e) {
    await env.DB.prepare("UPDATE order_access SET email_error_at = ? WHERE order_number = ?").bind(nowIso(), orderNumber).run();
    throw e;
  }
}

function packingFor(catalog, lines) {
  let coasters = 0, other = 0;
  for (const l of lines) { if (l.coasters) coasters += l.coasters; else other += l.qty; }
  const rules = (catalog.shipping.packaging && catalog.shipping.packaging.coasters) || [];
  const rule = !other && coasters ? rules.find((r) => coasters >= r.minCoasters && coasters <= r.maxCoasters) : null;
  return { coasters, otherItems: other, suggestedBox: rule ? rule.box : null, note: rule ? null : "No packaging rule for this mix; choose a box by hand." };
}

// Shipping: the owner's Snipcart methods and weight bands (content/shipping.json), applied to
// order weight = product weight x quantity (the rule Snipcart used). No method, no checkout.
// Stripe Tax codes, sent only when TAX_MODE is "stripe_tax". Items: general tangible goods
// (personalized printed products are taxed like other goods in Texas, Rule 3.300). Shipping: Stripe's
// shipping code, so shipping is taxed wherever the rules require it (Texas: Rule 3.303).
const TAX_CODE_GOODS = "txcd_99999999";
const TAX_CODE_SHIPPING = "txcd_92010001";

// A method with a postalCodePattern (free local delivery) is offered only when the ZIP the customer
// entered in the cart is in that area, and then listed first. Stripe's page can't hide a rate by the
// address typed there, so the address is checked again after payment (markPaid flags a mismatch).
const cleanZip = (z) => (typeof z === "string" && /^\d{5}$/.test(z.trim()) ? z.trim() : "");
function shippingOptions(catalog, grams, withTax, zip = "") {
  const inArea = (m) => { try { return !!zip && new RegExp(m.postalCodePattern).test(zip); } catch { return false; } };
  const methods = (catalog.shipping.methods || []).filter((m) => m && m.enabled !== false && m.name && Array.isArray(m.bands) && m.bands.length && (!m.postalCodePattern || inArea(m)))
    .sort((a, b) => (b.postalCodePattern ? 1 : 0) - (a.postalCodePattern ? 1 : 0));
  const opts = methods.slice(0, 5).map((m) => {
    const band = m.bands.find((b) => b.maxGrams === null || b.maxGrams === undefined || grams <= b.maxGrams);
    if (!band || !Number.isFinite(Number(band.amount))) return null;
    return { shipping_rate_data: { type: "fixed_amount", display_name: m.name, fixed_amount: { amount: Math.round(Number(band.amount) * 100), currency: "usd" }, metadata: { method_id: m.id || "" },
      ...(withTax ? { tax_behavior: "exclusive", tax_code: TAX_CODE_SHIPPING } : {}),
      ...(m.maxDays ? { delivery_estimate: { maximum: { unit: "business_day", value: m.maxDays } } } : {}) } };
  }).filter(Boolean);
  return opts.length ? opts : null;
}

// Tax: Stripe's hosted Checkout can only apply tax by the customer's address through Stripe Tax
// (TAX_MODE = "stripe_tax": 0.5% of the order where tax is collected, no monthly fee; Texas must be
// registered in Stripe Tax settings). "none" collects no tax. Per-address tax rates
// ("dynamic_tax_rates") were tried first and are rejected by Stripe as deprecated.

// ---------------------------------------------------------------- checkout
async function validateCart(env, body, opts = {}) {
  const catalog = await loadCatalog(env);
  const input = Array.isArray(body && body.lines) ? body.lines : [];
  if (!input.length) return { error: "Your cart is empty.", status: 400 };
  if (input.length > LIMITS.lines) return { error: "Too many items in one order. Please contact us for large orders.", status: 400 };
  const lines = [], fresh = [];
  let mismatch = false;
  for (const raw of input) {
    const product = catalog.products.find((p) => p.id === raw.productId);
    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.qty) return { error: `Quantity must be between 1 and ${LIMITS.qty}.`, status: 400 };
    const selections = { options: raw.options && typeof raw.options === "object" ? raw.options : {}, color: raw.color || null };
    const priced = priceLine(product, selections, catalog.colors);
    if (!priced.ok) return { error: priced.error, status: 400, productId: raw.productId };
    const personalization = {};
    for (const k of PERSONALIZATION_KEYS) { const v = clip(raw.personalization && raw.personalization[k]); if (v) personalization[k] = v; }
    const files = {};
    for (const k of FILE_KEYS) {
      const f = raw.files && raw.files[k];
      const v = typeof f === "string" && DESIGN_SRC.test(f) ? f : cleanFileUrl(env, f); // a Lacci design picture from the site is allowed too
      if (v === null) return { error: "One of the uploaded files could not be verified. Please upload it again.", status: 400 };
      if (v) files[k] = v;
    }
    const cz = cleanCustomization(raw.customization, product.id, (u) => cleanFileUrl(env, u));
    if (cz.error) return { error: `${product.name}: ${cz.error}`, status: 400 };
    if (!personalization.text && !files.design && !cz.customization) return { error: `${product.name}: add your text or upload a design.`, status: 400 };
    if (raw.expectedUnitCents !== undefined && Number(raw.expectedUnitCents) !== priced.unitCents) mismatch = true;
    fresh.push({ productId: product.id, unitCents: priced.unitCents });
    lines.push({
      productId: product.id, name: product.name, qty, unitCents: priced.unitCents, lineCents: priced.unitCents * qty,
      options: priced.summary, color: priced.color ? priced.color.id : null, personalization, files,
      ...(cz.customization ? { customization: cz.customization } : {}),
      coasters: coasterCount(product, selections, qty),
      items: itemCount(product, selections, qty),
      grams: (Number(product.weight) || 0) * qty,
    });
  }
  const items = lines.reduce((s, l) => s + (l.items || 0), 0);
  if (items > MAX_ITEMS_PER_ORDER && !opts.request) return { error: `Orders over ${MAX_ITEMS_PER_ORDER} items are sent as a request: we confirm the date first, then you pay. Please use "Send order request".`, status: 400, tooMany: true };
  if (items <= MAX_ITEMS_PER_ORDER && opts.request) return { error: "This order can be paid online now; no request is needed.", status: 400 };
  if (mismatch) return { error: "Prices in your cart were out of date and have been updated. Please review your cart and check out again.", status: 409, fresh };
  return { lines, catalog };
}

function lineDescription(l) {
  const parts = l.options.map((o) => `${o.label}: ${o.value}`);
  if (l.personalization.text) parts.push(`Text: ${l.personalization.text}`);
  if (l.files.design) parts.push("Artwork uploaded");
  return parts.join(" · ").slice(0, 480) || undefined;
}

// Live and sandbox orders are numbered from separate sequences (order_sequences, migrations/0002), so
// sandbox checkouts never use up production numbers: live LS-1001, LS-1002…; sandbox TEST-LS-1001…
async function nextOrderNumber(env, live) {
  const row = await env.DB.prepare(
    "INSERT INTO order_sequences (mode, last) VALUES (?, 1001) ON CONFLICT(mode) DO UPDATE SET last = last + 1 RETURNING last"
  ).bind(live ? "live" : "test").first();
  return (live ? "LS-" : "TEST-LS-") + row.last;
}

async function handleCheckout(request, env) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > LIMITS.body) return json({ error: "Request too large." }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const v = await validateCart(env, body);
  if (v.error) return json({ error: v.error, fresh: v.fresh, productId: v.productId }, v.status);
  const grams = v.lines.reduce((s, l) => s + l.grams, 0);
  const withTax = env.TAX_MODE === "stripe_tax";
  const zip = cleanZip(body.localZip);
  const shipping = shippingOptions(v.catalog, grams, withTax, zip);
  if (!shipping) return json({ error: "Online checkout isn't open yet. Please contact us to order." }, 503);

  const subtotal = v.lines.reduce((s, l) => s + l.lineCents, 0);
  const packing = packingFor(v.catalog, v.lines);
  const created = nowIso();
  const live = !isTestKey(env);
  const orderNumber = await nextOrderNumber(env, live);
  await env.DB.prepare(
    "INSERT INTO orders (order_number, status, created_at, livemode, subtotal_cents, lines_json, packing_json) VALUES (?, 'pending', ?, ?, ?, ?, ?)"
  ).bind(orderNumber, created, live ? 1 : 0, subtotal, JSON.stringify(v.lines), JSON.stringify(packing)).run();

  try {
    const session = await openSession(env, v.catalog, orderNumber, v.lines, `${siteOrigin(env, request)}/shop.html?checkout=cancelled`, siteOrigin(env, request), zip);
    return json({ url: session.url, orderNumber });
  } catch (e) {
    await env.DB.prepare("UPDATE orders SET status = 'cancelled', notes = ? WHERE order_number = ?").bind(`Checkout could not start: ${e.message}`.slice(0, 500), orderNumber).run();
    return json({ error: "We couldn't start checkout. Please try again in a moment." }, 502);
  }
}

// Stripe Checkout for an order row that already exists; records the session on the row.
async function openSession(env, catalog, orderNumber, lines, cancelUrl, origin, zip = "") {
  const grams = lines.reduce((s, l) => s + (l.grams || 0), 0);
  const withTax = env.TAX_MODE === "stripe_tax";
  const shipping = shippingOptions(catalog, grams, withTax, zip);
  if (!shipping) throw new Error("no shipping method for this weight");
  const params = {
    mode: "payment",
    client_reference_id: orderNumber,
    success_url: `${origin}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    line_items: lines.map((l) => ({
      quantity: l.qty,
      price_data: { currency: "usd", unit_amount: l.unitCents, ...(withTax ? { tax_behavior: "exclusive" } : {}),
        product_data: { name: l.name, description: lineDescription(l), metadata: { product_id: l.productId }, ...(withTax ? { tax_code: TAX_CODE_GOODS } : {}) } },
    })),
    shipping_address_collection: { allowed_countries: catalog.shipping.allowedCountries || ["US"] },
    shipping_options: shipping,
    phone_number_collection: { enabled: true },
    allow_promotion_codes: true,
    // Cards only (Apple Pay / Google Pay appear as card wallets). Link, Cash App Pay, bank debits and
    // buy-now-pay-later (Affirm, Klarna) stay off until the owner approves them.
    payment_method_types: ["card"],
    // Link would otherwise still appear (saved-card sign-up and "Pay with Bank"); owner has not approved it.
    wallet_options: { link: { display: "never" } },
    metadata: { order_number: orderNumber },
    payment_intent_data: { metadata: { order_number: orderNumber }, description: `Lacci Studio order ${orderNumber}` },
  };
  if (withTax) params.automatic_tax = { enabled: true };
  // A confirmed request can be paid again after an earlier session expired, so each session gets its own key.
  const session = await stripe(env, "POST", "checkout/sessions", params, `create-${orderNumber}-${Date.now()}`);
  await env.DB.prepare("UPDATE orders SET session_id = ?, status = 'pending' WHERE order_number = ?").bind(session.id, orderNumber).run();
  return session;
}

// ---------------------------------------------------------------- order requests (over 20 items)
// The cart is checked exactly like a checkout and saved as status 'requested' with the customer's
// contact details. Nothing is charged. The owner confirms (or declines) it in Orders; once confirmed,
// the customer's private link (order number + key) shows a Pay button that opens Stripe Checkout at
// the confirmed prices. The request table is created on first use, so no manual database step is needed.
let requestsReady = false;
async function ensureRequests(env) {
  if (requestsReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS order_requests (
    order_number TEXT PRIMARY KEY, access_key TEXT NOT NULL, needed_by TEXT, message TEXT,
    created_at TEXT NOT NULL, confirmed_at TEXT, declined_at TEXT, reply TEXT)`).run();
  requestsReady = true;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function requestLink(origin, orderNumber, key) { return `${origin}/order-request.html?o=${encodeURIComponent(orderNumber)}&k=${key}`; }

async function handleRequestCreate(request, env) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > LIMITS.body) return json({ error: "Request too large." }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const c = (body && body.contact) || {};
  const name = clip(c.name, 120), email = clip(c.email, 200), phone = clip(c.phone, 40), message = clip(c.message, 1000);
  const neededBy = typeof c.neededBy === "string" && DATE_RE.test(c.neededBy) ? c.neededBy : "";
  if (!name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email so we can reply." }, 400);
  if (neededBy && neededBy < new Date(Date.now() - 86400000).toISOString().slice(0, 10)) return json({ error: "The date you need it by has already passed." }, 400);
  const v = await validateCart(env, body, { request: true });
  if (v.error) return json({ error: v.error, fresh: v.fresh, productId: v.productId }, v.status);
  await ensureRequests(env);
  const subtotal = v.lines.reduce((s, l) => s + l.lineCents, 0);
  const created = nowIso();
  const live = !isTestKey(env);
  const orderNumber = await nextOrderNumber(env, live);
  const key = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare(
    "INSERT INTO orders (order_number, status, created_at, livemode, subtotal_cents, lines_json, packing_json, customer_name, customer_email, customer_phone) VALUES (?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(orderNumber, created, live ? 1 : 0, subtotal, JSON.stringify(v.lines), JSON.stringify(packingFor(v.catalog, v.lines)), name, email, phone || null).run();
  await env.DB.prepare("INSERT INTO order_requests (order_number, access_key, needed_by, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(orderNumber, key, neededBy || null, message || null, created).run();
  return json({ orderNumber, link: requestLink(siteOrigin(env, request), orderNumber, key) });
}

// Order + request row for a customer link; null unless the key matches.
async function requestFor(env, orderNumber, key) {
  if (!/^(TEST-)?LS-\d+$/.test(orderNumber || "") || !/^[0-9a-f]{32}$/.test(key || "")) return null;
  await ensureRequests(env);
  const r = await env.DB.prepare("SELECT * FROM order_requests WHERE order_number = ?").bind(orderNumber).first();
  if (!r || r.access_key !== key) return null;
  const o = await env.DB.prepare("SELECT * FROM orders WHERE order_number = ?").bind(orderNumber).first();
  return o ? { o, r } : null;
}
// What the customer sees: 'requested' (waiting for us), 'confirmed' (can pay), 'paid', 'declined'.
function requestView(o, r) {
  const stage = o.status === "requested" ? "requested" : o.status === "declined" ? "declined"
    : ["paid", "fulfilled"].includes(o.status) ? "paid" : r.confirmed_at ? "confirmed" : o.status;
  return {
    orderNumber: o.order_number, stage, neededBy: r.needed_by, reply: r.reply, confirmedAt: r.confirmed_at,
    email: o.customer_email ? o.customer_email.replace(/^(.).*(@.*)$/, "$1…$2") : null, subtotal: o.subtotal_cents,
    items: JSON.parse(o.lines_json || "[]").map((l) => ({ name: l.name, qty: l.qty, options: (l.options || []).map((x) => `${x.label}: ${x.value}`).join(" · "), line: l.lineCents })),
  };
}
async function handleRequestStatus(url, env) {
  const hit = await requestFor(env, url.searchParams.get("o"), url.searchParams.get("k"));
  if (!hit) return json({ error: "We couldn't find this request. Please use the link you were given." }, 404);
  return json(requestView(hit.o, hit.r));
}
async function handleRequestPay(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const hit = await requestFor(env, body && body.o, body && body.k);
  if (!hit) return json({ error: "We couldn't find this request. Please use the link you were given." }, 404);
  const { o, r } = hit;
  if (["paid", "fulfilled"].includes(o.status)) return json({ error: "This order is already paid. Thank you!" }, 409);
  if (!r.confirmed_at || !["confirmed", "pending", "expired", "payment_failed"].includes(o.status)) return json({ error: "We haven't confirmed this order yet. You'll be able to pay once we do." }, 409);
  // An earlier payment page that is still open is reused, so the order can't be paid twice.
  if (o.status === "pending" && o.session_id) {
    try {
      const s = await stripe(env, "GET", `checkout/sessions/${o.session_id}`, {});
      if (s.payment_status === "paid") { await markPaid(env, s); return json({ error: "This order is already paid. Thank you!" }, 409); }
      if (s.status === "open" && s.url) return json({ url: s.url });
    } catch {
      // unknown state of the open payment page: don't open a second one that could be paid as well
      return json({ error: "We couldn't open the payment page. Please try again in a moment." }, 502);
    }
  }
  const origin = siteOrigin(env, request);
  try {
    const session = await openSession(env, await loadCatalog(env), o.order_number, JSON.parse(o.lines_json || "[]"), requestLink(origin, o.order_number, r.access_key), origin, cleanZip(body.localZip));
    return json({ url: session.url });
  } catch {
    return json({ error: "We couldn't open the payment page. Please try again in a moment." }, 502);
  }
}

// ---------------------------------------------------------------- payment confirmation
async function markPaid(env, session) {
  if (!session || session.payment_status !== "paid") return 0;
  const cd = session.customer_details || {};
  const ship = session.shipping_details || (session.collected_information && session.collected_information.shipping_details) || null;
  const td = session.total_details || {};
  const row = await env.DB.prepare("SELECT order_number, subtotal_cents FROM orders WHERE session_id = ?").bind(session.id).first();
  if (!row) return 0;
  const notes = [];
  if (session.amount_subtotal !== row.subtotal_cents) notes.push(`AMOUNT CHECK: Stripe subtotal ${session.amount_subtotal} vs order ${row.subtotal_cents}`);
  // Free local delivery is offered to everyone (hosted Checkout cannot hide it by address): flag it outside the area.
  const catalog = await loadCatalog(env);
  const local = (catalog.shipping.methods || []).find((m) => m.postalCodePattern && m.enabled !== false);
  const postal = ship && ship.address && ship.address.postal_code;
  const rateName = session.shipping_cost && session.shipping_cost.shipping_rate && typeof session.shipping_cost.shipping_rate === "object" ? session.shipping_cost.shipping_rate.display_name : null;
  const choseLocal = rateName ? rateName === (local && local.name) : (td.amount_shipping === 0 && !!local);
  if (local && choseLocal && postal && !new RegExp(local.postalCodePattern).test(postal)) notes.push(`LOCAL DELIVERY OUTSIDE AREA: ZIP ${postal}. Contact the customer about shipping.`);
  const note = notes.length ? notes.join(" | ") : null;
  const res = await env.DB.prepare(
    `UPDATE orders SET status = 'paid', paid_at = ?, livemode = ?, customer_name = ?, customer_email = ?, customer_phone = ?,
       shipping_json = ?, shipping_cents = ?, tax_cents = ?, discount_cents = ?, total_cents = ?, payment_intent = ?,
       notes = COALESCE(?, notes)
     WHERE session_id = ? AND status IN ('pending', 'payment_failed')`
  ).bind(nowIso(), session.livemode ? 1 : 0, (ship && ship.name) || cd.name || null, cd.email || null, cd.phone || null,
    ship || rateName ? JSON.stringify({ ...(ship || {}), method: rateName || (td.amount_shipping === 0 && local ? local.name : null) }) : null, td.amount_shipping ?? null, td.amount_tax ?? null, td.amount_discount ?? null,
    session.amount_total ?? null, typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null,
    note, session.id).run();
  if (row && env.ORDER_LINK_SECRET) await ensurePaidExperience(env, row.order_number, (env.SITE_URL || "https://laccistudio.com").replace(/\/$/, ""));
  return res.meta.changes;
}

async function handleWebhook(request, env) {
  const raw = await request.text();
  const ok = await verifyStripeSignature(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: "Invalid signature." }, 400);
  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: "Invalid payload." }, 400); }
  const seen = await env.DB.prepare("SELECT 1 FROM stripe_events WHERE event_id = ?").bind(event.id).first();
  if (seen) return json({ received: true, duplicate: true });
  const session = event.data && event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      // Re-read the session from Stripe so the order records the shipping method by name.
      let full = session;
      try { full = await stripe(env, "GET", `checkout/sessions/${session.id}`, { expand: ["shipping_cost.shipping_rate"] }); } catch { /* fall back to the signed payload */ }
      await markPaid(env, full);
      break;
    }
    case "checkout.session.async_payment_failed":
      await env.DB.prepare("UPDATE orders SET status = 'payment_failed' WHERE session_id = ? AND status = 'pending'").bind(session.id).run();
      break;
    case "checkout.session.expired":
      await env.DB.prepare("UPDATE orders SET status = 'expired' WHERE session_id = ? AND status = 'pending'").bind(session.id).run();
      break;
  }
  // Recorded after processing: if processing failed, Stripe retries; the order updates are guarded so a retry cannot double-apply.
  await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (event_id, type, session_id, received_at) VALUES (?, ?, ?, ?)")
    .bind(event.id, event.type, (session && session.id) || null, nowIso()).run();
  return json({ received: true });
}

async function handleOrderStatus(url, env) {
  const id = url.searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ error: "Unknown order." }, 404);
  let order = await env.DB.prepare("SELECT * FROM orders WHERE session_id = ?").bind(id).first();
  if (!order) return json({ error: "Unknown order." }, 404);
  if (order.status === "pending" && env.STRIPE_SECRET_KEY) {
    try {
      const session = await stripe(env, "GET", `checkout/sessions/${id}`, { expand: ["shipping_cost.shipping_rate"] });
      if (await markPaid(env, session)) order = await env.DB.prepare("SELECT * FROM orders WHERE session_id = ?").bind(id).first();
    } catch { /* keep showing pending; the webhook will confirm */ }
    order = await env.DB.prepare("SELECT * FROM orders WHERE session_id = ?").bind(id).first();
  }
  const lines = JSON.parse(order.lines_json || "[]");
  const email = order.customer_email ? order.customer_email.replace(/^(.).*(@.*)$/, "$1…$2") : null;
  return json({
    orderNumber: order.order_number, status: order.status, email,
    subtotal: order.subtotal_cents, shipping: order.shipping_cents, tax: order.tax_cents, discount: order.discount_cents, total: order.total_cents,
    items: lines.map((l) => ({ name: l.name, qty: l.qty, options: l.options.map((o) => `${o.label}: ${o.value}`).join(" · "), line: l.lineCents })),
  });
}

function customerOrderView(order, decisions) {
  const lines = JSON.parse(order.lines_json || "[]"), units = proofUnits(lines);
  const byKey = Object.fromEntries((decisions || []).map((d) => [d.proof_key, d]));
  return {
    orderNumber: order.order_number, status: order.status, productionStatus: order.production_status,
    createdAt: order.created_at, paidAt: order.paid_at, customerName: order.customer_name,
    currency: order.currency, subtotal: order.subtotal_cents, shipping: order.shipping_cents, tax: order.tax_cents,
    discount: order.discount_cents, total: order.total_cents,
    shippingAddress: order.shipping_json ? JSON.parse(order.shipping_json) : null,
    tracking: order.tracking_number || order.tracking_url ? { carrier: order.tracking_carrier, number: order.tracking_number, url: order.tracking_url, shippedAt: order.shipped_at, deliveredAt: order.delivered_at } : null,
    lines,
    proofs: units.map((u) => ({ ...u, status: (byKey[u.proofKey] && byKey[u.proofKey].status) || "pending", comment: (byKey[u.proofKey] && byKey[u.proofKey].comment) || null, decidedAt: (byKey[u.proofKey] && byKey[u.proofKey].decided_at) || null })),
  };
}

async function handleCustomerOrder(request, env) {
  const hit = await authorizedOrder(request, env);
  if (!hit) return json({ error: "This private order link is invalid or has expired." }, 404);
  const { results } = await env.DB.prepare("SELECT * FROM proof_decisions WHERE order_number = ? ORDER BY line_index, item_index").bind(hit.order.order_number).all();
  return json({ order: customerOrderView(hit.order, results) });
}

async function handleProofDecision(request, env) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Request refused." }, 403);
  const hit = await authorizedOrder(request, env);
  if (!hit) return json({ error: "This private order link is invalid or has expired." }, 404);
  let body; try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const proofKey = clip(body.proofKey, 80), action = body.action, comment = clip(body.comment, 1000);
  if (!proofKey || !["approve", "request_changes"].includes(action)) return json({ error: "Choose approve or request changes." }, 400);
  if (action === "request_changes" && !comment) return json({ error: "Please describe the change you need." }, 400);
  const current = await env.DB.prepare("SELECT * FROM proof_decisions WHERE order_number = ? AND proof_key = ?").bind(hit.order.order_number, proofKey).first();
  if (!current) return json({ error: "Design proof not found." }, 404);
  const next = action === "approve" ? "approved" : "changes_requested";
  if (current.status !== "pending") {
    if (current.status === next && (next === "approved" || current.comment === comment)) return json({ saved: true, duplicate: true });
    return json({ error: "A response has already been recorded for this design. Please contact us if it needs to change." }, 409);
  }
  const at = nowIso();
  const saved = await env.DB.prepare("UPDATE proof_decisions SET status = ?, comment = ?, decided_at = ? WHERE order_number = ? AND proof_key = ? AND status = 'pending'")
    .bind(next, comment || null, at, hit.order.order_number, proofKey).run();
  if (!saved.meta.changes) return json({ error: "A response has already been recorded for this design." }, 409);
  const counts = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM proof_decisions WHERE order_number = ? GROUP BY status").bind(hit.order.order_number).all();
  const tally = Object.fromEntries(counts.results.map((r) => [r.status, r.n]));
  const production = tally.changes_requested ? "changes_requested" : tally.pending ? "awaiting_approval" : "ready";
  await env.DB.prepare("UPDATE orders SET production_status = ? WHERE order_number = ? AND production_status IN ('not_started', 'awaiting_approval', 'changes_requested', 'ready')").bind(production, hit.order.order_number).run();
  return json({ saved: true, status: next, decidedAt: at, productionStatus: production });
}

// ---------------------------------------------------------------- admin (GitHub repo editors only)
const adminCache = new Map();
async function adminUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !env.ADMIN_GITHUB_REPO) return null;
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hit = adminCache.get(digest);
  if (hit && hit.until > Date.now()) return hit.user;
  const gh = (path) => fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "lacci-admin", Accept: "application/vnd.github+json" } });
  const res = await gh(`/repos/${env.ADMIN_GITHUB_REPO}`);
  if (!res.ok) return null;
  const repo = await res.json();
  if (!repo.permissions || !(repo.permissions.push || repo.permissions.admin)) return null;
  const me = await gh("/user").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const user = { login: me.login || "editor" };
  adminCache.set(digest, { user, until: Date.now() + 5 * 60_000 });
  return user;
}

function orderView(o, full) {
  const req = o.req_key ? { neededBy: o.req_needed_by, message: o.req_message, confirmedAt: o.req_confirmed_at, declinedAt: o.req_declined_at, reply: o.req_reply, key: o.req_key } : null;
  const base = { request: req, orderNumber: o.order_number, status: o.status, productionStatus: o.production_status, createdAt: o.created_at, paidAt: o.paid_at, customerName: o.customer_name, customerEmail: o.customer_email, total: o.total_cents, subtotal: o.subtotal_cents, livemode: !!o.livemode };
  if (!full) return base;
  return { ...base, phone: o.customer_phone, shipping: o.shipping_cents, tax: o.tax_cents, discount: o.discount_cents, shippingAddress: o.shipping_json ? JSON.parse(o.shipping_json) : null,
    lines: JSON.parse(o.lines_json || "[]"), packing: o.packing_json ? JSON.parse(o.packing_json) : null, paymentIntent: o.payment_intent, fulfilledAt: o.fulfilled_at, notes: o.notes,
    tracking: { carrier: o.tracking_carrier, number: o.tracking_number, url: o.tracking_url, shippedAt: o.shipped_at, deliveredAt: o.delivered_at } };
}

async function handleAdmin(request, env, url) {
  const user = await adminUser(request, env);
  if (!user) return json({ error: "Please log in to the Lacci admin first." }, 401);
  if (url.pathname.startsWith("/api/admin/content/")) return handleAdminContent(request, env, url, (request.headers.get("authorization") || "").slice(7), user);
  await ensureRequests(env);
  const WITH_REQ = "SELECT o.*, r.access_key AS req_key, r.needed_by AS req_needed_by, r.message AS req_message, r.confirmed_at AS req_confirmed_at, r.declined_at AS req_declined_at, r.reply AS req_reply FROM orders o LEFT JOIN order_requests r ON r.order_number = o.order_number";
  const m = url.pathname.match(/^\/api\/admin\/orders(?:\/((?:TEST-)?LS-\d+))?$/);
  if (url.pathname === "/api/admin/whoami") return json({ user });
  if (!m) return json({ error: "Not found." }, 404);
  if (request.method === "GET" && !m[1]) {
    // Sandbox orders stay out of the normal lists: mode "live" (default), "test" (sandbox only) or "all".
    const status = url.searchParams.get("status");
    const mode = url.searchParams.get("mode") || "live";
    const where = [], args = [];
    if (status && status !== "all") { where.push("o.status = ?"); args.push(status); } else where.push("o.status != 'cancelled'");
    if (mode !== "all") { where.push("o.livemode = ?"); args.push(mode === "test" ? 0 : 1); }
    const { results } = await env.DB.prepare(`${WITH_REQ} WHERE ${where.join(" AND ")} ORDER BY o.id DESC LIMIT 200`).bind(...args).all();
    const proofRows = await env.DB.prepare("SELECT order_number, proof_key, line_index, item_index, status, comment, decided_at FROM proof_decisions ORDER BY order_number, line_index, item_index LIMIT 2000").all();
    const proofsByOrder = {};
    for (const p of proofRows.results) (proofsByOrder[p.order_number] ||= []).push(p);
    const reqs = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'requested' AND livemode = ?").bind(mode === "test" ? 0 : 1).first();
    const tests = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE livemode = 0 AND status != 'cancelled'").first();
    return json({ orders: results.map((o) => ({ ...orderView(o, true), proofs: proofsByOrder[o.order_number] || [] })), sandboxCount: tests ? tests.n : 0, requestCount: reqs ? reqs.n : 0, origin: siteOrigin(env, request) });
  }
  if (!m[1]) return json({ error: "Not found." }, 404);
  const one = () => env.DB.prepare(`${WITH_REQ} WHERE o.order_number = ?`).bind(m[1]).first();
  const order = await one();
  if (!order) return json({ error: "Order not found." }, 404);
  if (request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT proof_key, line_index, item_index, status, comment, decided_at FROM proof_decisions WHERE order_number = ? ORDER BY line_index, item_index").bind(m[1]).all();
    return json({ order: { ...orderView(order, true), proofs: results } });
  }
  if (request.method === "POST") {
    let body; try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
    if (body.proofRevision && typeof body.proofRevision === "object") {
      const proofKey = clip(body.proofRevision.proofKey, 80), preview = cleanFileUrl(env, body.proofRevision.preview);
      if (!proofKey || !preview) return json({ error: "A saved preview from the approved upload host is required." }, 400);
      const proof = await env.DB.prepare("SELECT * FROM proof_decisions WHERE order_number = ? AND proof_key = ?").bind(m[1], proofKey).first();
      if (!proof || proof.status !== "changes_requested") return json({ error: "Only a design with requested changes can be replaced." }, 409);
      const lines = JSON.parse(order.lines_json || "[]"), line = lines[proof.line_index];
      if (!line) return json({ error: "The saved order line was not found." }, 409);
      if (proof.item_index !== null && line.customization && Array.isArray(line.customization.items) && line.customization.items[proof.item_index]) line.customization.items[proof.item_index].previews = { ...(line.customization.items[proof.item_index].previews || {}), main: preview };
      else if (line.customization) line.customization.previews = { ...(line.customization.previews || {}), main: preview };
      else line.files = { ...(line.files || {}), preview };
      await env.DB.prepare("UPDATE orders SET lines_json = ?, production_status = 'awaiting_approval' WHERE order_number = ?").bind(JSON.stringify(lines), m[1]).run();
      await env.DB.prepare("UPDATE proof_decisions SET status = 'pending', comment = NULL, decided_at = NULL WHERE order_number = ? AND proof_key = ?").bind(m[1], proofKey).run();
    }
    if (body.request === "confirm" || body.request === "decline") {
      if (order.status !== "requested") return json({ error: "Only a request that is waiting can be confirmed or declined." }, 400);
      const reply = clip(body.reply, 500) || null;
      if (body.request === "confirm") {
        await env.DB.prepare("UPDATE order_requests SET confirmed_at = ?, reply = ? WHERE order_number = ?").bind(nowIso(), reply, m[1]).run();
        await env.DB.prepare("UPDATE orders SET status = 'confirmed' WHERE order_number = ? AND status = 'requested'").bind(m[1]).run();
      } else {
        await env.DB.prepare("UPDATE order_requests SET declined_at = ?, reply = ? WHERE order_number = ?").bind(nowIso(), reply, m[1]).run();
        await env.DB.prepare("UPDATE orders SET status = 'declined' WHERE order_number = ? AND status = 'requested'").bind(m[1]).run();
      }
    }
    if (body.status === "fulfilled" && order.status !== "paid") return json({ error: "Only paid orders can be marked fulfilled." }, 400);
    if (body.status === "fulfilled" || ["ready", "in_production", "shipped", "delivered"].includes(body.productionStatus)) {
      const blocked = await env.DB.prepare("SELECT COUNT(*) AS n FROM proof_decisions WHERE order_number = ? AND status != 'approved'").bind(m[1]).first();
      if (blocked && blocked.n) return json({ error: "Every required design proof must be approved before production." }, 409);
    }
    if (body.status === "paid" && order.status !== "fulfilled") return json({ error: "Only a fulfilled order can be moved back to paid." }, 400);
    if (body.status === "fulfilled" || body.status === "paid") {
      await env.DB.prepare("UPDATE orders SET status = ?, fulfilled_at = ? WHERE order_number = ?").bind(body.status, body.status === "fulfilled" ? nowIso() : null, m[1]).run();
    }
    if (["ready", "in_production", "shipped", "delivered"].includes(body.productionStatus)) {
      const fields = { ready: [null, null], in_production: [null, null], shipped: [nowIso(), null], delivered: [order.shipped_at || nowIso(), nowIso()] }[body.productionStatus];
      await env.DB.prepare("UPDATE orders SET production_status = ?, shipped_at = ?, delivered_at = ? WHERE order_number = ?")
        .bind(body.productionStatus, fields[0], fields[1], m[1]).run();
    }
    if (body.tracking && typeof body.tracking === "object") {
      const carrier = clip(body.tracking.carrier, 80) || null, number = clip(body.tracking.number, 120) || null;
      let trackingUrl = clip(body.tracking.url, 500) || null;
      if (trackingUrl) { try { const u = new URL(trackingUrl); if (u.protocol !== "https:") trackingUrl = null; } catch { trackingUrl = null; } }
      if (body.tracking.url && !trackingUrl) return json({ error: "Tracking link must be a valid https address." }, 400);
      await env.DB.prepare("UPDATE orders SET tracking_carrier = ?, tracking_number = ?, tracking_url = ? WHERE order_number = ?").bind(carrier, number, trackingUrl, m[1]).run();
    }
    if (["rotate", "revoke", "resend"].includes(body.access)) {
      if (body.access === "revoke") await env.DB.prepare("UPDATE order_access SET revoked_at = ? WHERE order_number = ?").bind(nowIso(), m[1]).run();
      else {
        const access = await createAccess(env, m[1], body.access === "rotate");
        await sendOrderEmail(env, order, access.token, siteOrigin(env, request));
        await env.DB.prepare("UPDATE order_access SET email_sent_at = ?, email_error_at = NULL WHERE order_number = ?").bind(nowIso(), m[1]).run();
      }
    }
    if (typeof body.notes === "string") await env.DB.prepare("UPDATE orders SET notes = ? WHERE order_number = ?").bind(clip(body.notes, 2000), m[1]).run();
    const updated = await one();
    return json({ order: orderView(updated, true) });
  }
  return json({ error: "Method not allowed." }, 405);
}

// ---------------------------------------------------------------- router
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/checkout" && request.method === "POST") return await handleCheckout(request, env);
      if (url.pathname === "/api/stripe/webhook" && request.method === "POST") return await handleWebhook(request, env);
      if (url.pathname === "/api/order-status" && request.method === "GET") return await handleOrderStatus(url, env);
      if (url.pathname === "/api/customer/order" && request.method === "GET") return await handleCustomerOrder(request, env);
      if (url.pathname === "/api/customer/proof" && request.method === "POST") return await handleProofDecision(request, env);
      if (url.pathname === "/api/order-request" && request.method === "POST") return await handleRequestCreate(request, env);
      if (url.pathname === "/api/order-request" && request.method === "GET") return await handleRequestStatus(url, env);
      if (url.pathname === "/api/order-request/pay" && request.method === "POST") return await handleRequestPay(request, env);
      if (url.pathname.startsWith("/api/admin/")) return await handleAdmin(request, env, url);
      if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error("worker error", url.pathname, e && e.message);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },
};

export { validateCart, markPaid, loadCatalog, money };
