// Lacci Studio checkout worker (Cloudflare Workers, free plan).
//
// Static files are served by Cloudflare's asset handling before this code runs; only paths that
// are not files (the /api/ routes below) reach the worker, so browsing the site costs no
// worker requests.
//
//   POST /api/checkout                 validate the cart on the server, create a Stripe Checkout Session
//   POST /api/stripe/webhook           Stripe events (signature-checked, idempotent)
//   GET  /api/order-status?session_id  confirmation page status (asks Stripe directly if still pending)
//   GET  /api/admin/orders[/:number]   order list / detail for repo editors (GitHub login)
//   POST /api/admin/orders/:number     mark fulfilled, add a note
//   /api/admin/content/*               new admin: products, draft / publish (worker/admin-content.js)
//
// Prices come from the deployed content/products.json via the same assets/js/pricing.mjs the
// shop uses. A price sent by the browser is never charged; it is only compared, and a mismatch
// returns the correct prices instead of creating a payment.

import { cleanCustomization, DESIGN_SRC } from "./customization.js";
import { priceLine, coasterCount, money } from "../assets/js/pricing.mjs";
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

function shippingOptions(catalog, grams, withTax) {
  const methods = (catalog.shipping.methods || []).filter((m) => m && m.enabled !== false && m.name && Array.isArray(m.bands) && m.bands.length);
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
async function validateCart(env, body) {
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
      grams: (Number(product.weight) || 0) * qty,
    });
  }
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
  const shipping = shippingOptions(v.catalog, grams, withTax);
  if (!shipping) return json({ error: "Online checkout isn't open yet. Please contact us to order." }, 503);

  const subtotal = v.lines.reduce((s, l) => s + l.lineCents, 0);
  const packing = packingFor(v.catalog, v.lines);
  const created = nowIso();
  const live = !isTestKey(env);
  const orderNumber = await nextOrderNumber(env, live);
  await env.DB.prepare(
    "INSERT INTO orders (order_number, status, created_at, livemode, subtotal_cents, lines_json, packing_json) VALUES (?, 'pending', ?, ?, ?, ?, ?)"
  ).bind(orderNumber, created, live ? 1 : 0, subtotal, JSON.stringify(v.lines), JSON.stringify(packing)).run();

  const origin = siteOrigin(env, request);
  const params = {
    mode: "payment",
    client_reference_id: orderNumber,
    success_url: `${origin}/order-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/shop.html?checkout=cancelled`,
    line_items: v.lines.map((l) => ({
      quantity: l.qty,
      price_data: { currency: "usd", unit_amount: l.unitCents, ...(withTax ? { tax_behavior: "exclusive" } : {}),
        product_data: { name: l.name, description: lineDescription(l), metadata: { product_id: l.productId }, ...(withTax ? { tax_code: TAX_CODE_GOODS } : {}) } },
    })),
    shipping_address_collection: { allowed_countries: v.catalog.shipping.allowedCountries || ["US"] },
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
  try {
    const session = await stripe(env, "POST", "checkout/sessions", params, `create-${orderNumber}`);
    await env.DB.prepare("UPDATE orders SET session_id = ? WHERE order_number = ?").bind(session.id, orderNumber).run();
    return json({ url: session.url, orderNumber });
  } catch (e) {
    await env.DB.prepare("UPDATE orders SET status = 'cancelled', notes = ? WHERE order_number = ?").bind(`Checkout could not start: ${e.message}`.slice(0, 500), orderNumber).run();
    return json({ error: "We couldn't start checkout. Please try again in a moment." }, 502);
  }
}

// ---------------------------------------------------------------- payment confirmation
async function markPaid(env, session) {
  if (!session || session.payment_status !== "paid") return 0;
  const cd = session.customer_details || {};
  const ship = session.shipping_details || (session.collected_information && session.collected_information.shipping_details) || null;
  const td = session.total_details || {};
  const row = await env.DB.prepare("SELECT subtotal_cents FROM orders WHERE session_id = ?").bind(session.id).first();
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
  }
  const lines = JSON.parse(order.lines_json || "[]");
  const email = order.customer_email ? order.customer_email.replace(/^(.).*(@.*)$/, "$1…$2") : null;
  return json({
    orderNumber: order.order_number, status: order.status, email,
    subtotal: order.subtotal_cents, shipping: order.shipping_cents, tax: order.tax_cents, discount: order.discount_cents, total: order.total_cents,
    items: lines.map((l) => ({ name: l.name, qty: l.qty, options: l.options.map((o) => `${o.label}: ${o.value}`).join(" · "), line: l.lineCents })),
  });
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
  const base = { orderNumber: o.order_number, status: o.status, createdAt: o.created_at, paidAt: o.paid_at, customerName: o.customer_name, customerEmail: o.customer_email, total: o.total_cents, subtotal: o.subtotal_cents, livemode: !!o.livemode };
  if (!full) return base;
  return { ...base, phone: o.customer_phone, shipping: o.shipping_cents, tax: o.tax_cents, discount: o.discount_cents, shippingAddress: o.shipping_json ? JSON.parse(o.shipping_json) : null,
    lines: JSON.parse(o.lines_json || "[]"), packing: o.packing_json ? JSON.parse(o.packing_json) : null, paymentIntent: o.payment_intent, fulfilledAt: o.fulfilled_at, notes: o.notes };
}

async function handleAdmin(request, env, url) {
  const user = await adminUser(request, env);
  if (!user) return json({ error: "Please log in to the Lacci admin first." }, 401);
  if (url.pathname.startsWith("/api/admin/content/")) return handleAdminContent(request, env, url, (request.headers.get("authorization") || "").slice(7), user);
  const m = url.pathname.match(/^\/api\/admin\/orders(?:\/((?:TEST-)?LS-\d+))?$/);
  if (url.pathname === "/api/admin/whoami") return json({ user });
  if (!m) return json({ error: "Not found." }, 404);
  if (request.method === "GET" && !m[1]) {
    // Sandbox orders stay out of the normal lists: mode "live" (default), "test" (sandbox only) or "all".
    const status = url.searchParams.get("status");
    const mode = url.searchParams.get("mode") || "live";
    const where = [], args = [];
    if (status && status !== "all") { where.push("status = ?"); args.push(status); } else where.push("status != 'cancelled'");
    if (mode !== "all") { where.push("livemode = ?"); args.push(mode === "test" ? 0 : 1); }
    const { results } = await env.DB.prepare(`SELECT * FROM orders WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 200`).bind(...args).all();
    const tests = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE livemode = 0 AND status != 'cancelled'").first();
    return json({ orders: results.map((o) => orderView(o, true)), sandboxCount: tests ? tests.n : 0 });
  }
  if (!m[1]) return json({ error: "Not found." }, 404);
  const order = await env.DB.prepare("SELECT * FROM orders WHERE order_number = ?").bind(m[1]).first();
  if (!order) return json({ error: "Order not found." }, 404);
  if (request.method === "GET") return json({ order: orderView(order, true) });
  if (request.method === "POST") {
    let body; try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
    if (body.status === "fulfilled" && order.status !== "paid") return json({ error: "Only paid orders can be marked fulfilled." }, 400);
    if (body.status === "paid" && order.status !== "fulfilled") return json({ error: "Only a fulfilled order can be moved back to paid." }, 400);
    if (body.status === "fulfilled" || body.status === "paid") {
      await env.DB.prepare("UPDATE orders SET status = ?, fulfilled_at = ? WHERE order_number = ?").bind(body.status, body.status === "fulfilled" ? nowIso() : null, m[1]).run();
    }
    if (typeof body.notes === "string") await env.DB.prepare("UPDATE orders SET notes = ? WHERE order_number = ?").bind(clip(body.notes, 2000), m[1]).run();
    const updated = await env.DB.prepare("SELECT * FROM orders WHERE order_number = ?").bind(m[1]).first();
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
