// Updates the Stripe sandbox values in .dev.vars (local testing only; never committed).
//   node tools/set-dev-vars.mjs
// Asks for the sandbox secret key and the webhook signing secret with typing hidden, refuses live
// keys, keeps every other line in .dev.vars, and checks the key with Stripe. Values are never printed.

import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

const FILE = join(new URL("..", import.meta.url).pathname, ".dev.vars");

// One reader for both questions; what is typed or pasted is not echoed.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); };
const queued = [];
let waiting = null;
rl.on("line", (l) => { if (waiting) { const w = waiting; waiting = null; w(l.trim()); } else queued.push(l.trim()); });
function askHidden(question) {
  muted = false; rl.output.write(question); muted = true;
  return new Promise((resolve) => {
    const done = (v) => { muted = false; rl.output.write("\n"); resolve(v); };
    if (queued.length) done(queued.shift()); else waiting = done;
  });
}

const key = await askHidden("Paste the Stripe SANDBOX secret key (sk_test_… or rk_test_…), then Enter: ");
if (/_live_/.test(key)) { console.error("That is a live key. Nothing was changed."); process.exit(1); }
if (!/^(sk|rk)_test_[A-Za-z0-9]{16,}$/.test(key)) { console.error("That does not look like a sandbox secret key. Nothing was changed."); process.exit(1); }
const whsec = await askHidden("Paste the sandbox webhook signing secret (whsec_…), then Enter: ");
if (!/^whsec_[A-Za-z0-9]{16,}$/.test(whsec)) { console.error("That does not look like a webhook signing secret. Nothing was changed."); process.exit(1); }
rl.close();

const lines = existsSync(FILE) ? readFileSync(FILE, "utf8").split("\n") : [];
const set = { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: whsec };
const seen = new Set();
const out = lines.map((l) => {
  const name = l.includes("=") && !l.trim().startsWith("#") ? l.slice(0, l.indexOf("=")).trim() : null;
  if (name && name in set) { seen.add(name); return `${name}=${set[name]}`; }
  return l;
});
for (const name of Object.keys(set)) if (!seen.has(name)) out.splice(out.at(-1) === "" ? out.length - 1 : out.length, 0, `${name}=${set[name]}`);
writeFileSync(FILE, out.join("\n").replace(/\n*$/, "\n"));
chmodSync(FILE, 0o600);
console.log("Updated 2 values in .dev.vars (not shown).");

const r = await fetch("https://api.stripe.com/v1/account", { headers: { Authorization: `Bearer ${key}` } });
console.log(r.ok ? "Stripe accepted the key." : `Stripe did not accept the key (HTTP ${r.status}). Check you copied the current sandbox key.`);
