// Runs the checkout worker on this computer, without Cloudflare tooling:
//   node tools/worker-local.mjs            -> http://localhost:8787 (site + /api)
// Uses a local SQLite file in place of D1 (.wrangler/local-orders.sqlite) and reads secrets from
// .dev.vars (never committed). Also imported by tools/test-commerce.mjs.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import worker from "../worker/index.js";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml", ".yml": "text/yaml" };
const HIDDEN = [/^\/worker\//, /^\/migrations\//, /^\/tools\//, /^\/docs\//, /^\/\.git/, /^\/\.dev\.vars/, /^\/\.wrangler\//, /^\/\.[^/]+\//];

// Minimal D1 stand-in over node:sqlite (prepare/bind/run/first/all).
export function localD1(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(readFileSync(join(ROOT, "migrations/0001_orders.sql"), "utf8"));
  const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, norm(a)),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => stmt(sql), raw: db };
}

export function localAssets() {
  return {
    fetch: async (req) => {
      let path = decodeURIComponent(new URL(req.url).pathname);
      if (path.endsWith("/")) path += "index.html";
      if (HIDDEN.some((re) => re.test(path))) return new Response("Not found", { status: 404 });
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) return new Response("Not found", { status: 404 });
      return new Response(readFileSync(file), { headers: { "Content-Type": TYPES[extname(file)] || "application/octet-stream" } });
    },
  };
}

export function devVars() {
  const f = join(ROOT, ".dev.vars");
  if (!existsSync(f)) return {};
  return Object.fromEntries(readFileSync(f, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
}

export function makeEnv(overrides = {}) {
  const toml = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
  const vars = Object.fromEntries([...toml.slice(toml.indexOf("[vars]")).matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
  return { ...vars, SITE_URL: "http://localhost:8787", ASSETS: localAssets(), DB: localD1(overrides.dbFile), ...devVars(), ...overrides };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(join(ROOT, ".wrangler"), { recursive: true });
  const env = makeEnv({ dbFile: join(ROOT, ".wrangler/local-orders.sqlite") });
  if (!env.STRIPE_SECRET_KEY) console.log("Note: no STRIPE_SECRET_KEY in .dev.vars; checkout calls will fail.");
  else if (!/^sk_test_|^rk_test_/.test(env.STRIPE_SECRET_KEY)) { console.error("Refusing to run locally with a live Stripe key."); process.exit(1); }
  createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost:8787${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const url = new URL(request.url);
    const response = url.pathname.startsWith("/api/") ? await worker.fetch(request, env) : await env.ASSETS.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }).listen(8787, "127.0.0.1", () => console.log("Lacci local worker on http://localhost:8787"));
}
