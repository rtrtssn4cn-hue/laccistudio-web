// Delivers real Stripe sandbox events to the local worker's webhook, signed the way Stripe signs
// them. Stripe cannot reach this computer, so this stands in for webhook delivery during local tests.
//   node tools/replay-stripe-events.mjs [minutesBack=60] [--twice]
// --twice sends every event two times to check that repeats are ignored. Test keys only.

import { devVars } from "./worker-local.mjs";

const vars = devVars();
const key = vars.STRIPE_SECRET_KEY || "", secret = vars.STRIPE_WEBHOOK_SECRET || "";
if (!/^sk_test_|^rk_test_/.test(key)) { console.error("A sandbox (sk_test_) key is required in .dev.vars."); process.exit(1); }
const minutes = Number(process.argv[2]) || 60, twice = process.argv.includes("--twice");
const since = Math.floor(Date.now() / 1000) - minutes * 60;

const q = new URLSearchParams({ limit: "100", "created[gte]": String(since) });
["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"].forEach((t, i) => q.append(`types[${i}]`, t));
const res = await fetch("https://api.stripe.com/v1/events?" + q, { headers: { Authorization: `Bearer ${key}` } });
const data = await res.json();
if (!res.ok) { console.error("Stripe:", data.error && data.error.message); process.exit(1); }

async function sign(payload) {
  const t = Math.floor(Date.now() / 1000);
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${payload}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${sig}`;
}

const events = (data.data || []).reverse();
console.log(`${events.length} sandbox event(s) in the last ${minutes} min`);
for (const ev of events) {
  for (let n = 0; n < (twice ? 2 : 1); n++) {
    const raw = JSON.stringify(ev);
    const r = await fetch("http://localhost:8787/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": await sign(raw), "Content-Type": "application/json" }, body: raw });
    console.log(`${ev.type}  session …${ev.data.object.id.slice(-6)}  -> ${r.status} ${await r.text()}`);
  }
}
