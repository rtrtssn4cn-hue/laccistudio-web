// Checkout test suite: runs the real worker (worker/index.js) against a simulated Stripe and GitHub.
//   node tools/test-commerce.mjs
// Covers pricing, validation, tampering, shipping, tax, webhooks (signature + idempotency),
// order status, and the admin order API. Real Stripe test-mode runs are separate (see docs/COMMERCE.md).

import worker from "../worker/index.js";
import { makeEnv, localD1 } from "./worker-local.mjs";
import pricing from "../assets/js/pricing.mjs";
import { readFileSync } from "node:fs";

const products = JSON.parse(readFileSync(new URL("../content/products.json", import.meta.url))).products;
const colors = JSON.parse(readFileSync(new URL("../content/colors.json", import.meta.url))).garmentColors;
const WEBHOOK_SECRET = "whsec_local_test_only";
const UC = "https://51niy1s3e7.ucarecd.net/3f8e2c0e-1111-4222-8333-444455556666/-/inline/no/";

// ---------------------------------------------------------------- simulated Stripe / GitHub
const stripeState = { sessions: {}, created: [], taxRates: [], calls: [] };
const realFetch = globalThis.fetch;
function parseForm(body) { const o = {}; for (const [k, v] of new URLSearchParams(body || "")) o[k] = v; return o; }
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("https://api.stripe.com/v1/")) {
    const path = url.slice("https://api.stripe.com/v1/".length).split("?")[0];
    stripeState.calls.push(`${init.method} ${path}`);
    const liveKey = /^Bearer (sk|rk)_live_/.test(init.headers.Authorization);
    if (!liveKey && !/^Bearer sk_test_/.test(init.headers.Authorization)) return reply({ error: { message: "bad key" } }, 401);
    if (path === "tax_rates" && init.method === "GET") return reply({ data: stripeState.taxRates });
    if (path === "tax_rates" && init.method === "POST") { const f = parseForm(init.body); const r = { id: "txr_test_" + (stripeState.taxRates.length + 1), percentage: Number(f.percentage), state: f.state, metadata: { lacci_id: f["metadata[lacci_id]"] } }; stripeState.taxRates.push(r); return reply(r); }
    if (path === "checkout/sessions" && init.method === "POST") {
      const f = parseForm(init.body); const id = (liveKey ? "cs_live_" : "cs_test_") + (stripeState.created.length + 1) + "abc";
      let subtotal = 0; for (let i = 0; f[`line_items[${i}][quantity]`]; i++) subtotal += Number(f[`line_items[${i}][price_data][unit_amount]`]) * Number(f[`line_items[${i}][quantity]`]);
      const s = { id, url: "https://checkout.stripe.test/" + id, params: f, amount_subtotal: subtotal, payment_status: "unpaid", livemode: liveKey };
      stripeState.sessions[id] = s; stripeState.created.push(s); return reply(s);
    }
    const m = path.match(/^checkout\/sessions\/(cs_(?:test|live)_\w+)$/);
    if (m && init.method === "GET") return reply(stripeState.sessions[m[1]] || {}, stripeState.sessions[m[1]] ? 200 : 404);
    return reply({ error: { message: "unhandled " + path } }, 400);
  }
  if (url.startsWith("https://api.github.com/")) {
    const tok = (init.headers.Authorization || "").slice(7);
    if (url.includes("/repos/")) return tok === "good" ? reply({ permissions: { push: true } }) : tok === "readonly" ? reply({ permissions: { push: false } }) : reply({}, 401);
    if (url.endsWith("/user")) return reply({ login: "owner" });
  }
  return realFetch(input, init);
};

// Pays a simulated session the way Stripe would, returning the completed session object.
function pay(id, { tax = 0, shipping = 895, discount = 0, zip = "90210", method = "USPS Ground Advantage (7–10 business days)" } = {}) {
  const s = stripeState.sessions[id];
  Object.assign(s, {
    payment_status: "paid", status: "complete", payment_intent: "pi_test_" + id,
    customer_details: { name: "Test Buyer", email: "buyer@example.com", phone: "+15555550100" },
    shipping_details: { name: "Test Buyer", address: { line1: "1 Test St", city: "Houston", state: "TX", postal_code: zip, country: "US" } },
    shipping_cost: { amount_total: shipping, shipping_rate: { display_name: method } },
    total_details: { amount_shipping: shipping, amount_tax: tax, amount_discount: discount },
    amount_total: s.amount_subtotal - discount + shipping + tax,
  });
  return s;
}

async function sign(payload, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${sig}`;
}

// ---------------------------------------------------------------- harness
// Fixed values so the suite never depends on a local .dev.vars.
const env = makeEnv({ STRIPE_SECRET_KEY: "sk_test_local_simulated", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, TAX_MODE: "none" });
const call = (path, opts = {}) => worker.fetch(new Request("http://localhost:8787" + path, opts), env).then(async (r) => ({ status: r.status, body: await r.json() }));
const checkout = (lines) => call("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }) });
const webhook = async (event, secret) => { const raw = JSON.stringify(event); return call("/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": await sign(raw, secret) }, body: raw }); };
const order = (sessionId) => env.DB.prepare("SELECT * FROM orders WHERE session_id = ?").bind(sessionId).first();
const P = (id) => products.find((p) => p.id === id);
// What the browser shows for a line (same module as the cart drawer).
const browserUnit = (l) => pricing.priceLine(P(l.productId), { options: l.options, color: l.color }, colors).unitCents;
const line = (productId, options, extra = {}) => ({ productId, qty: 1, options, color: null, personalization: { text: "Smith" }, files: {}, ...extra });

let pass = 0, fail = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); pass++; results.push(["PASS", name]); }
  catch (e) { fail++; results.push(["FAIL", name + " — " + e.message]); }
}
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, what) => { if (!c) throw new Error(what); };

// Compares a line across browser -> server order record -> Stripe session.
async function chain(lines, expectUnits) {
  const withExpected = lines.map((l) => ({ ...l, expectedUnitCents: browserUnit(l) }));
  lines.forEach((l, i) => eq(browserUnit(l), expectUnits[i], `browser unit price line ${i}`));
  const r = await checkout(withExpected);
  eq(r.status, 200, "checkout status " + JSON.stringify(r.body));
  const s = stripeState.created.at(-1);
  const o = await order(s.id);
  const stored = JSON.parse(o.lines_json);
  lines.forEach((l, i) => {
    eq(Number(s.params[`line_items[${i}][price_data][unit_amount]`]), expectUnits[i], `Stripe unit_amount line ${i}`);
    eq(Number(s.params[`line_items[${i}][quantity]`]), l.qty, `Stripe quantity line ${i}`);
    eq(stored[i].unitCents, expectUnits[i], `order record unit line ${i}`);
  });
  eq(o.subtotal_cents, s.amount_subtotal, "order subtotal = Stripe subtotal");
  eq(o.status, "pending", "order starts pending");
  return { s, o, r };
}

// ---------------------------------------------------------------- tests
await test("1. Single coaster $6.99 with text", async () => {
  const { r } = await chain([line("ceramic-coasters", { Quantity: "Single", Material: "Ceramic", Shape: "Round" })], [699]);
  ok(/^TEST-LS-\d+$/.test(r.body.orderNumber), "sandbox order number format");
});
await test("2. Coaster quantities: Set of 4 x2, Set of 8 x1, Single x3", async () => {
  await chain([
    line("ceramic-coasters", { Quantity: "Set of 4", Material: "Ceramic", Shape: "Square" }, { qty: 2 }),
    line("ceramic-coasters", { Quantity: "Set of 8", Material: "Ceramic", Shape: "Round" }),
    line("ceramic-coasters", { Quantity: "Single", Material: "Ceramic", Shape: "Round" }, { qty: 3 }),
  ], [2499, 4499, 699]);
});
await test("3. Personalized coaster with uploaded artwork (no text)", async () => {
  const { o } = await chain([line("ceramic-coasters", { Quantity: "Single", Material: "Ceramic", Shape: "Round" }, { personalization: {}, files: { design: UC, preview: UC } })], [699]);
  eq(JSON.parse(o.lines_json)[0].files.design, UC, "artwork link stored on the order");
});
await test("4. Artwork link from an unknown host is refused", async () => {
  const r = await checkout([line("ceramic-coasters", { Quantity: "Single", Material: "Ceramic", Shape: "Round" }, { files: { design: "https://evil.example/x.png" } })]);
  eq(r.status, 400, "status");
});
await test("5. Mug 15 oz Color-Changing x3", async () => { await chain([line("sublimation-mug", { Size: "15 oz", Style: "Color-Changing Magic" }, { qty: 3 })], [2499]); });
await test("6. Tumbler 30 oz Glitter", async () => { await chain([line("sublimation-tumbler", { Size: "30 oz", Finish: "Glitter" })], [3599]); });
await test("7. White T-shirt, size L, front and back", async () => {
  await chain([line("apparel-t-shirt", { "Print location": "Front and back", Size: "L" }, { color: "white", files: { design: UC, backDesign: UC } })], [3798]);
});
await test("8. Size selection: every T-shirt size prices as shown", async () => {
  const sizes = { XS: 2698, S: 2798, M: 2998, L: 3198, XL: 3398, "2XL": 3598, "3XL": 3798 };
  for (const [size, cents] of Object.entries(sizes)) await chain([line("apparel-t-shirt", { "Print location": "Front only", Size: size }, { color: "white" })], [cents]);
});
await test("9. Hidden colour (Black) cannot be ordered", async () => {
  const r = await checkout([line("apparel-t-shirt", { "Print location": "Front only", Size: "L" }, { color: "black" })]);
  eq(r.status, 400, "status"); ok(/colour/.test(r.body.error), "message mentions colour");
});
await test("10. Missing or invented size is refused", async () => {
  eq((await checkout([line("apparel-t-shirt", { "Print location": "Front only" }, { color: "white" })])).status, 400, "missing size");
  eq((await checkout([line("apparel-t-shirt", { "Print location": "Front only", Size: "5XL" }, { color: "white" })])).status, 400, "invented size");
  eq((await checkout([line("apparel-t-shirt", { "Print location": "Front only", Size: "L", Bogus: "x" }, { color: "white" })])).status, 400, "unknown option group");
});
await test("11. Cart with multiple different products", async () => {
  await chain([
    line("ceramic-coasters", { Quantity: "Set of 4", Material: "Ceramic", Shape: "Round" }),
    line("sublimation-mug", { Size: "11 oz", Style: "Standard White" }, { qty: 2 }),
    line("sublimation-tumbler", { Size: "20 oz", Finish: "Glossy" }),
    line("apparel-t-shirt", { "Print location": "Front only", Size: "M" }, { color: "white" }),
  ], [2499, 1899, 2799, 2998]);
});
await test("12. Shipping: owner's Snipcart bands chosen by weight", async () => {
  await checkout([line("ceramic-coasters", { Quantity: "Single", Material: "Ceramic", Shape: "Round" })]); // 260 g
  let f = stripeState.created.at(-1).params;
  eq(Number(f["shipping_options[0][shipping_rate_data][fixed_amount][amount]"]), 895, "Ground <=454 g");
  eq(Number(f["shipping_options[1][shipping_rate_data][fixed_amount][amount]"]), 1295, "Priority <=454 g");
  eq(f["shipping_options[2][shipping_rate_data][display_name]"], undefined, "Local delivery not offered (hidden for launch)");
  ok(!Object.entries(f).some(([k, v]) => k.includes("display_name") && /Local/.test(v)), "no local delivery option at all");
  await checkout([line("sublimation-mug", { Size: "11 oz", Style: "Standard White" }, { qty: 3 })]); // 1800 g
  f = stripeState.created.at(-1).params;
  eq(Number(f["shipping_options[0][shipping_rate_data][fixed_amount][amount]"]), 1495, "Ground 1362-2268 g");
  eq(Number(f["shipping_options[1][shipping_rate_data][fixed_amount][amount]"]), 1995, "Priority 1362-2268 g");
  eq(f["shipping_address_collection[allowed_countries][0]"], "US", "US only");
  eq(f["payment_method_types[0]"], "card", "cards only"); eq(f["payment_method_types[1]"], undefined, "no other payment methods");
  eq(f["wallet_options[link][display]"], "never", "Link hidden");
});
await test("13. Tax: Stripe Tax switched on only when TAX_MODE is stripe_tax", async () => {
  await checkout([line("sublimation-mug", { Size: "11 oz", Style: "Standard White" })]);
  eq(stripeState.created.at(-1).params["automatic_tax[enabled]"], undefined, "off by default");
  env.TAX_MODE = "stripe_tax";
  await checkout([line("sublimation-mug", { Size: "11 oz", Style: "Standard White" })]);
  const f = stripeState.created.at(-1).params;
  eq(f["automatic_tax[enabled]"], "true", "on with stripe_tax");
  eq(f["line_items[0][price_data][tax_behavior]"], "exclusive", "item tax added on top");
  eq(f["line_items[0][price_data][product_data][tax_code]"], "txcd_99999999", "item tax code");
  eq(f["shipping_options[0][shipping_rate_data][tax_code]"], "txcd_92010001", "shipping taxable code");
  eq(f["shipping_options[0][shipping_rate_data][tax_behavior]"], "exclusive", "shipping tax added on top");
  env.TAX_MODE = "none";
  ok(!Object.keys(stripeState.created.at(-1).params).some((k) => k.includes("dynamic_tax_rates")), "no deprecated dynamic_tax_rates");
});
await test("14. Price tampering: browser says $1.00 for the tumbler", async () => {
  const before = stripeState.created.length;
  const r = await checkout([{ ...line("sublimation-tumbler", { Size: "20 oz", Finish: "Glossy" }), expectedUnitCents: 100, price: 1, unit_amount: 100 }]);
  eq(r.status, 409, "refused with fresh prices"); eq(stripeState.created.length, before, "no Stripe session created");
  eq(r.body.fresh[0].unitCents, 2799, "server returns the real price");
});
await test("15. Tampering without a price hint still charges the real price", async () => {
  await checkout([{ ...line("sublimation-tumbler", { Size: "20 oz", Finish: "Glossy" }), price: 1, unit_amount: 100, unitCents: 100 }]);
  eq(Number(stripeState.created.at(-1).params["line_items[0][price_data][unit_amount]"]), 2799, "Stripe gets 2799");
});
await test("16. Other invalid carts: hidden product, unknown product, bad quantities, nothing to print", async () => {
  const hidden = products.find((p) => p.status === "hidden");
  eq((await checkout([line(hidden.id, {})])).status, 400, "hidden product");
  eq((await checkout([line("does-not-exist", {})])).status, 400, "unknown product");
  eq((await checkout([line("sublimation-mug", { Size: "11 oz", Style: "Standard White" }, { qty: 0 })])).status, 400, "qty 0");
  eq((await checkout([line("sublimation-mug", { Size: "11 oz", Style: "Standard White" }, { qty: 51 })])).status, 400, "qty 51");
  eq((await checkout([line("sublimation-mug", { Size: "11 oz", Style: "Standard White" }, { qty: 1.5 })])).status, 400, "qty 1.5");
  eq((await checkout([line("sublimation-mug", { Size: "11 oz", Style: "Standard White" }, { personalization: {} })])).status, 400, "no text or artwork");
  eq((await checkout([])).status, 400, "empty cart");
});
await test("17. Webhook with a bad signature is rejected and changes nothing", async () => {
  const { s } = await chain([line("sublimation-mug", { Size: "11 oz", Style: "Standard White" })], [1899]);
  pay(s.id);
  const r = await webhook({ id: "evt_bad", type: "checkout.session.completed", data: { object: s } }, "whsec_wrong");
  eq(r.status, 400, "status"); eq((await order(s.id)).status, "pending", "still pending");
});
await test("18. Successful payment: webhook marks the order paid with everything needed to fulfil it", async () => {
  const { s } = await chain([line("ceramic-coasters", { Quantity: "Set of 4", Material: "Ceramic", Shape: "Round" }, { files: { design: UC } })], [2499]);
  pay(s.id, { tax: 206, shipping: 895 });
  const r = await webhook({ id: "evt_ok_1", type: "checkout.session.completed", data: { object: s } });
  eq(r.status, 200, "status");
  const o = await order(s.id);
  eq(o.status, "paid", "paid"); eq(o.customer_email, "buyer@example.com", "email"); eq(o.customer_name, "Test Buyer", "name");
  eq(o.shipping_cents, 895, "shipping"); eq(o.tax_cents, 206, "tax"); eq(o.total_cents, 2499 + 895 + 206, "total"); eq(o.total_cents, s.amount_total, "order total = Stripe total");
  const ship = JSON.parse(o.shipping_json); eq(ship.address.postal_code, "90210", "address"); ok(/Ground/.test(ship.method), "shipping method recorded");
  eq(JSON.parse(o.packing_json).suggestedBox, "9 x 6 x 2 in", "4 coasters -> 9x6x2 box");
  ok(!o.notes, "no warnings");
});
await test("19. Same webhook delivered twice, and a second event for the same session: one paid order", async () => {
  const { s } = await chain([line("sublimation-tumbler", { Size: "20 oz", Finish: "Glossy" })], [2799]);
  pay(s.id);
  const ev = { id: "evt_dup_1", type: "checkout.session.completed", data: { object: s } };
  await webhook(ev);
  const first = await order(s.id);
  const again = await webhook(ev);
  eq(again.body.duplicate, true, "second delivery recognised");
  await webhook({ id: "evt_dup_2", type: "checkout.session.async_payment_succeeded", data: { object: s } });
  const after = await order(s.id);
  eq(after.paid_at, first.paid_at, "paid_at unchanged");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE session_id = ?").bind(s.id).first();
  eq(count.n, 1, "one order row");
});
await test("20. Declined card: order stays unpaid; failed async payment and expiry recorded", async () => {
  const { s } = await chain([line("sublimation-mug", { Size: "11 oz", Style: "Standard White" })], [1899]);
  // A declined card never completes the session: Stripe sends no completed event.
  const status = await call("/api/order-status?session_id=" + s.id);
  eq(status.body.status, "pending", "status page shows not paid"); eq((await order(s.id)).status, "pending", "not paid");
  await webhook({ id: "evt_exp", type: "checkout.session.expired", data: { object: s } });
  eq((await order(s.id)).status, "expired", "expired");
  const { s: s2 } = await chain([line("sublimation-mug", { Size: "11 oz", Style: "Standard White" })], [1899]);
  await webhook({ id: "evt_fail", type: "checkout.session.async_payment_failed", data: { object: s2 } });
  eq((await order(s2.id)).status, "payment_failed", "payment_failed");
});
await test("21. Confirmation page before the webhook: server asks Stripe, then confirms", async () => {
  const { s } = await chain([line("ceramic-coasters", { Quantity: "Single", Material: "Ceramic", Shape: "Round" })], [699]);
  pay(s.id, { shipping: 895, zip: "77020" });
  const r = await call("/api/order-status?session_id=" + s.id);
  eq(r.body.status, "paid", "paid via server-side Stripe lookup"); eq(r.body.email, "b…@example.com", "email masked");
  ok(!("shippingAddress" in r.body) && !JSON.stringify(r.body).includes("1 Test St"), "no address on the public status");
  const repeat = await call("/api/order-status?session_id=" + s.id);
  eq(repeat.body.orderNumber, r.body.orderNumber, "refresh shows the same order");
  eq(await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE session_id = ?").bind(s.id).first().then((x) => x.n), 1, "no duplicate on refresh");
});
await test("22. Free local delivery is not offered to anyone while it cannot be limited by ZIP", async () => {
  await checkout([line("ceramic-coasters", { Quantity: "Single", Material: "Ceramic", Shape: "Round" })]);
  const f = stripeState.created.at(-1).params;
  ok(!Object.entries(f).some(([k, v]) => k.includes("display_name") && /Local/i.test(v)), "no local delivery option");
  ok(!Object.entries(f).some(([k, v]) => k.endsWith("[fixed_amount][amount]") && v === "0"), "no free shipping option");
});
await test("23. Unknown session ids and malformed ids are not found", async () => {
  eq((await call("/api/order-status?session_id=cs_test_nope")).status, 404, "unknown");
  eq((await call("/api/order-status?session_id=../../etc")).status, 404, "malformed");
});
await test("24. Admin orders: login required, write access required, fulfil flow", async () => {
  eq((await call("/api/admin/orders")).status, 401, "no token");
  eq((await call("/api/admin/orders", { headers: { Authorization: "Bearer readonly" } })).status, 401, "read-only GitHub user");
  const list = await call("/api/admin/orders?status=paid&mode=test", { headers: { Authorization: "Bearer good" } });
  eq(list.status, 200, "editor can list"); ok(list.body.orders.length >= 3, "paid orders listed");
  const o = list.body.orders[0];
  ok(o.lines[0].personalization && o.shippingAddress, "detail includes personalization and address");
  const done = await call("/api/admin/orders/" + o.orderNumber, { method: "POST", headers: { Authorization: "Bearer good", "Content-Type": "application/json" }, body: JSON.stringify({ status: "fulfilled", notes: "Shipped USPS" }) });
  eq(done.body.order.status, "fulfilled", "fulfilled"); eq(done.body.order.notes, "Shipped USPS", "note saved");
  const pend = (await call("/api/admin/orders?status=pending&mode=test", { headers: { Authorization: "Bearer good" } })).body.orders[0];
  eq((await call("/api/admin/orders/" + pend.orderNumber, { method: "POST", headers: { Authorization: "Bearer good", "Content-Type": "application/json" }, body: JSON.stringify({ status: "fulfilled" }) })).status, 400, "cannot fulfil an unpaid order");
});
await test("25. Static files still served; worker source and secrets are not", async () => {
  eq((await worker.fetch(new Request("http://localhost:8787/content/products.json"), env)).status, 200, "content served");
  eq((await env.ASSETS.fetch(new Request("http://localhost:8787/worker/index.js"))).status, 404, "worker source hidden");
  eq((await env.ASSETS.fetch(new Request("http://localhost:8787/.dev.vars"))).status, 404, ".dev.vars hidden");
});

await test("26. Cart captured from the real browser flow: customizer -> cart -> server -> Stripe -> paid order", async () => {
  // tools/fixtures/cart-from-browser.json is the exact request the shop sent (customizer: $6.99, $24.99 x2, $31.98; cart subtotal $88.95).
  const body = JSON.parse(readFileSync(new URL("./fixtures/cart-from-browser.json", import.meta.url)));
  const r = await checkout(body.lines);
  eq(r.status, 200, "checkout " + JSON.stringify(r.body));
  const s = stripeState.created.at(-1);
  eq(s.amount_subtotal, 8895, "Stripe subtotal = cart subtotal $88.95");
  [699, 2499, 3198].forEach((c, i) => eq(Number(s.params[`line_items[${i}][price_data][unit_amount]`]), c, "Stripe unit line " + i));
  pay(s.id, { tax: 0, shipping: 1195 });
  await webhook({ id: "evt_browser_cart", type: "checkout.session.completed", data: { object: s } });
  const o = await order(s.id);
  eq(o.subtotal_cents, 8895, "order subtotal"); eq(o.total_cents, 8895 + 1195, "order total"); eq(o.total_cents, s.amount_total, "order total = Stripe total");
  const lines = JSON.parse(o.lines_json);
  eq(lines[2].options.find((x) => x.label === "Garment colour").value, "White", "garment colour on the order");
  eq(lines[0].personalization.text, "Smith", "personalization on the order");
  ok(lines.every((l) => l.files.preview), "placement previews on the order");
  eq(JSON.parse(o.packing_json).note !== null, true, "mixed cart -> pack by hand note");
});
await test("27. Public order status never exposes artwork links, personalization text or address", async () => {
  const s = stripeState.created.at(-1);
  const r = await call("/api/order-status?session_id=" + s.id);
  const text = JSON.stringify(r.body);
  ok(!/ucarecd|ucarecdn/.test(text), "no file links"); ok(!text.includes("Smith") && !text.includes("Team"), "no personalization text"); ok(!text.includes("1 Test St"), "no address");
});

await test("28. Live and sandbox orders use separate number sequences and admin lists", async () => {
  // Same database, a simulated live key: live orders are LS-####, sandbox orders TEST-LS-####.
  const liveEnv = { ...env, STRIPE_SECRET_KEY: "rk_live_local_simulated" };
  const at = (e) => (lines) => worker.fetch(new Request("http://localhost:8787/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }) }), e).then((r) => r.json());
  const one = [line("ceramic-coasters", { Quantity: "Single", Material: "Ceramic", Shape: "Round" })];
  const testsBefore = (await env.DB.prepare("SELECT last FROM order_sequences WHERE mode = 'test'").first()).last;
  const l1 = await at(liveEnv)(one), t1 = await at(env)(one), l2 = await at(liveEnv)(one);
  eq(l1.orderNumber, "LS-1001", "first live order"); eq(l2.orderNumber, "LS-1002", "second live order is not skipped by a sandbox order");
  eq(t1.orderNumber, "TEST-LS-" + (testsBefore + 1), "sandbox order continues the sandbox sequence");
  eq((await env.DB.prepare("SELECT livemode FROM orders WHERE order_number = 'LS-1001'").first()).livemode, 1, "live order stored as live");
  const liveSession = stripeState.created.find((x) => x.id.startsWith("cs_live_"));
  pay(liveSession.id); await webhook({ id: "evt_live_1", type: "checkout.session.completed", data: { object: liveSession } });
  const auth = { headers: { Authorization: "Bearer good" } };
  const toMake = (await call("/api/admin/orders?status=paid", auth)).body;
  ok(toMake.orders.length >= 1 && toMake.orders.every((o) => o.livemode && /^LS-/.test(o.orderNumber)), "To make & ship shows live orders only");
  ok(toMake.sandboxCount > 0, "admin is told how many sandbox orders are hidden");
  const all = (await call("/api/admin/orders?status=all", auth)).body.orders;
  ok(all.every((o) => o.livemode), "All tab hides sandbox orders");
  const sandbox = (await call("/api/admin/orders?status=all&mode=test", auth)).body.orders;
  ok(sandbox.length && sandbox.every((o) => !o.livemode && /^TEST-LS-/.test(o.orderNumber)), "Sandbox tab shows sandbox orders only");
  eq((await call("/api/admin/orders/" + t1.orderNumber, auth)).status, 200, "sandbox order detail opens");
  eq((await call("/api/admin/orders/SNIP-1001", auth)).status, 404, "Snipcart numbers are never served from this database");
});
await test("29. Upgrade: existing sandbox LS- order is relabelled and kept; live numbering starts at LS-1001", async () => {
  const db = localD1(":memory:", ["0001_orders.sql"]);
  db.raw.prepare("INSERT INTO orders (order_number, session_id, status, created_at, livemode, subtotal_cents, total_cents, lines_json) VALUES ('LS-1001', 'cs_test_old', 'paid', '2026-09-26T05:00:00Z', 0, 699, 1726, '[]')").run();
  const up = readFileSync(new URL("../migrations/0002_order_sequences.sql", import.meta.url), "utf8");
  db.raw.exec(up); db.raw.exec(up); // twice: must be safe to re-run
  const rows = db.raw.prepare("SELECT order_number, status, total_cents, notes FROM orders").all();
  eq(rows.length, 1, "sandbox order kept"); eq(rows[0].order_number, "TEST-LS-1001", "relabelled"); eq(rows[0].status, "paid", "status unchanged"); eq(rows[0].total_cents, 1726, "total unchanged");
  eq((rows[0].notes.match(/Renumbered from LS-1001/g) || []).length, 1, "one note recording the old number");
  const upEnv = { ...env, DB: db };
  const liveEnv = { ...upEnv, STRIPE_SECRET_KEY: "rk_live_local_simulated" };
  const one = JSON.stringify({ lines: [line("ceramic-coasters", { Quantity: "Single", Material: "Ceramic", Shape: "Round" })] });
  const go = (e) => worker.fetch(new Request("http://localhost:8787/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: one }), e).then((r) => r.json());
  eq((await go(liveEnv)).orderNumber, "LS-1001", "first live order after upgrade");
  eq((await go(upEnv)).orderNumber, "TEST-LS-1002", "next sandbox order after upgrade");
});

await test("30. Hidden products: every one is refused by checkout; draft/seasonal/unknown also off sale; Snipcart page lists active only", async () => {
  const off = products.filter((p) => p.status !== "active");
  ok(off.length >= 12, "hidden products present in the data (kept, not deleted)");
  for (const p of off) {
    const g = (p.optionGroups || [])[0], c = g && (g.choices || []).find((x) => !x.hidden);
    const r = await checkout([line(p.id, g && c ? { [g.label]: typeof c === "string" ? c : c.name } : {})]);
    eq(r.status, 400, "checkout refuses " + p.id);
  }
  const base = products.find((p) => p.status === "active");
  const st = (extra) => pricing.productStatus({ ...base, ...extra });
  eq(st({}), "active", "active stays on sale"); eq(st({ status: undefined }), "active", "no status = active");
  for (const s of ["hidden", "draft", "seasonal", "retired", ""]) ok(!pricing.isProductOnSale({ ...base, status: s || " " }), `status "${s}" is off sale`);
  ok(!pricing.isProductOnSale({ ...base, status: "active", hidden: true }), "old hidden flag still hides");
  ok(!pricing.priceLine({ ...base, status: "draft" }, { options: {} }, colors).ok, "priceLine refuses a draft product");
  const page = readFileSync(new URL("../snipcart-products.html", import.meta.url), "utf8");
  const listed = [...page.matchAll(/data-item-id="([^"]+)"/g)].map((m) => m[1]);
  eq(listed.length, products.filter((p) => p.status === "active").length, "Snipcart page lists active products only");
  ok(off.every((p) => !listed.includes(p.id)), "no hidden product on the Snipcart page");
});

await test("31. Coaster shapes switched off (Heart, Hexagon) are kept in the data, never offered, and refused by checkout", async () => {
  const shape = P("ceramic-coasters").optionGroups.find((g) => g.label === "Shape");
  for (const n of ["Heart", "Hexagon"]) {
    const c = shape.choices.find((x) => x.name === n);
    ok(c && c.hidden === true, n + " kept and switched off");
    const r = await checkout([line("ceramic-coasters", { Quantity: "Set of 4", Material: "Ceramic", Shape: n })]);
    eq(r.status, 400, "checkout refuses " + n);
  }
  const offered = pricing.visibleGroups(P("ceramic-coasters")).find((g) => g.label === "Shape").choices.map((c) => c.name);
  eq(offered.join(","), "Round,Square", "customers see Round and Square only");
  const priced = await checkout([line("ceramic-coasters", { Quantity: "Set of 4", Material: "Ceramic", Shape: "Square" })]);
  eq(priced.status, 200, "Square still sells");
  eq(pricing.fromPriceCents(P("ceramic-coasters")), 699, "switched-off shapes don't change the from-price");
});

for (const [r, n] of results) console.log(`${r}  ${n}`);
console.log(`\n${pass} passed, ${fail} failed; simulated Stripe calls: ${stripeState.calls.length}`);
process.exit(fail ? 1 : 0);
