// Runs before every deploy (Cloudflare build command: `node tools/predeploy.mjs`).
//
// 1. Secret check: stops the build if a Stripe secret key, a Stripe webhook secret or a local
//    .dev.vars file is in the repository. Matching values are never printed, only file names.
// 2. Rebuilds snipcart-products.html from content/products.json (see build-snipcart-catalog.mjs).
//
// Any failure exits non-zero, so Cloudflare skips the deploy and the current site stays live.
// Optional argument: a folder to scan instead of the repository root (used to test this check).

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.argv[2] || process.cwd();
const SKIP_DIRS = new Set([".git", "node_modules", ".wrangler"]);
const TEXT = /\.(html|js|mjs|cjs|json|yml|yaml|toml|md|txt|css|xml|sql|env|vars|sh)$|^\.[\w.-]+$/i;
// Built from parts so this file does not match itself.
const SECRET = new RegExp(["(sk|rk)_(test|live)_[A-Za-z0-9]{16,}", "whsec_[A-Za-z0-9]{16,}"].join("|"));

const problems = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) { walk(path); continue; }
    const rel = relative(root, path);
    if (name === ".dev.vars") { problems.push(`${rel}: local secrets file must never be committed`); continue; }
    if (st.size > 2_000_000 || !TEXT.test(name)) continue;
    if (SECRET.test(readFileSync(path, "utf8"))) problems.push(`${rel}: contains something that looks like a Stripe secret`);
  }
}
walk(root);

if (problems.length) {
  console.error("Deploy stopped by the secret check (values not shown):\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("Secret check passed.");

if (!process.argv[2]) {
  if (!existsSync(join(root, "tools/build-snipcart-catalog.mjs"))) { console.error("Snipcart catalog builder missing."); process.exit(1); }
  const r = spawnSync(process.execPath, ["tools/build-snipcart-catalog.mjs"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) { console.error("Deploy stopped: the Snipcart catalog could not be built."); process.exit(r.status || 1); }
}
