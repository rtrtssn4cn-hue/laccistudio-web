// Lacci Studio Admin — content API (products, draft / publish).
//
// The owner edits in the new admin; every save becomes one commit on the `draft` branch of the
// repository, made with the owner's own GitHub login (the same token the orders page and Decap
// use). Publish merges `draft` into `main`, which Cloudflare deploys; Discard points `draft` back
// at `main`. Git history is the revision history.
//
//   GET  /api/admin/content/state                  draft vs live: unpublished change count, last commits
//   GET  /api/admin/content/products?ref=draft|main products.json + colors.json from that branch
//   PUT  /api/admin/content/products                save products to the draft branch
//   POST /api/admin/content/publish                 merge draft into main
//   POST /api/admin/content/discard                 reset draft to main
//
// Access is checked by the caller (handleAdmin → adminUser: GitHub push access) on every request.
// The server validates everything it writes; the admin screens are never trusted on their own.

import { PRODUCT_STATUSES } from "../assets/js/pricing.mjs";

const DRAFT = "draft";
const MAIN = "main";
const PRODUCTS_PATH = "content/products.json";
const COLORS_PATH = "content/colors.json";
const MAX_BODY = 2 * 1024 * 1024;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

function gh(env, token) {
  const base = `https://api.github.com/repos/${env.ADMIN_GITHUB_REPO}`;
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "lacci-admin", Accept: "application/vnd.github+json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  };
}

// UTF-8 safe base64 for the GitHub contents API.
const toB64 = (text) => { const bytes = new TextEncoder().encode(text); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

async function branchSha(api, name) {
  const r = await api("GET", `/git/ref/heads/${name}`);
  return r.ok ? r.data.object.sha : null;
}

async function ensureDraft(api) {
  const draft = await branchSha(api, DRAFT);
  if (draft) return draft;
  const main = await branchSha(api, MAIN);
  if (!main) throw new Error("Live branch not found.");
  const r = await api("POST", "/git/refs", { ref: `refs/heads/${DRAFT}`, sha: main });
  if (!r.ok) throw new Error("Could not create the draft.");
  return main;
}

async function readFile(api, path, ref) {
  const r = await api("GET", `/contents/${path}?ref=${encodeURIComponent(ref)}`);
  if (!r.ok) return null;
  return { sha: r.data.sha, text: fromB64(r.data.content) };
}

// Server-side checks on a products list before it is written. Existing products can't disappear
// (they are archived instead); unknown fields are kept as they are.
export function validateProducts(next, current) {
  if (!next || !Array.isArray(next.products)) return "The product list is missing.";
  const ids = new Set();
  for (const p of next.products) {
    if (!p || typeof p !== "object") return "A product entry is invalid.";
    if (typeof p.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(p.id)) return `Product id "${p && p.id}" is not valid.`;
    if (ids.has(p.id)) return `Two products share the id "${p.id}".`;
    ids.add(p.id);
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 140) return `"${p.id}" needs a name (up to 140 characters).`;
    const price = Number(p.price);
    if (!Number.isFinite(price) || price < 0 || price > 10000) return `"${p.name}" has an invalid price.`;
    if (p.status !== undefined && !PRODUCT_STATUSES.includes(p.status)) return `"${p.name}" has an unknown status.`;
    if (p.images !== undefined && (!Array.isArray(p.images) || p.images.some((i) => typeof i !== "string" || /^\s*javascript:/i.test(i)))) return `"${p.name}" has an invalid picture list.`;
    for (const k of ["description", "category", "subcategory"]) if (p[k] !== undefined && (typeof p[k] !== "string" || p[k].length > 5000)) return `"${p.name}": ${k} is invalid.`;
    if (p.featured !== undefined && typeof p.featured !== "boolean") return `"${p.name}": featured must be on or off.`;
  }
  const missing = (current.products || []).filter((p) => !ids.has(p.id)).map((p) => p.name || p.id);
  if (missing.length) return `These products would be removed: ${missing.slice(0, 5).join(", ")}. Archive them instead.`;
  return null;
}

function summarize(prev, next) {
  const before = new Map((prev.products || []).map((p) => [p.id, p]));
  const lines = [];
  for (const p of next.products) {
    const o = before.get(p.id);
    if (!o) { lines.push(`Added ${p.name}`); continue; }
    const changed = Object.keys({ ...o, ...p }).filter((k) => JSON.stringify(o[k]) !== JSON.stringify(p[k]));
    if (!changed.length) continue;
    const bits = changed.map((k) => (k === "price" ? `price $${o.price} → $${p.price}` : k === "status" ? `${o.status || "active"} → ${p.status || "active"}` : k));
    lines.push(`${p.name}: ${bits.join(", ")}`);
  }
  return lines;
}

export async function handleAdminContent(request, env, url, token, user) {
  const api = gh(env, token);
  const route = url.pathname.replace(/^\/api\/admin\/content/, "");

  if (route === "/state" && request.method === "GET") {
    const [main, draft] = await Promise.all([branchSha(api, MAIN), branchSha(api, DRAFT)]);
    let ahead = 0, commits = [];
    if (draft && main && draft !== main) {
      const cmp = await api("GET", `/compare/${MAIN}...${DRAFT}`);
      if (cmp.ok) { ahead = cmp.data.ahead_by; commits = (cmp.data.commits || []).slice(-10).reverse().map((c) => ({ message: c.commit.message.split("\n")[0], date: c.commit.author && c.commit.author.date })); }
    }
    const recent = await api("GET", `/commits?sha=${MAIN}&per_page=10`);
    return json({
      unpublished: ahead, draftCommits: commits,
      recentLive: recent.ok ? recent.data.map((c) => ({ message: c.commit.message.split("\n")[0], date: c.commit.author && c.commit.author.date })) : [],
      user: user.login,
    });
  }

  if (route === "/products" && request.method === "GET") {
    const ref = url.searchParams.get("ref") === MAIN ? MAIN : ((await branchSha(api, DRAFT)) ? DRAFT : MAIN);
    const [products, colors] = await Promise.all([readFile(api, PRODUCTS_PATH, ref), readFile(api, COLORS_PATH, ref)]);
    if (!products) return json({ error: "Could not read the products." }, 502);
    return json({ ref, sha: products.sha, data: JSON.parse(products.text), colors: colors ? JSON.parse(colors.text) : { garmentColors: [] } });
  }

  if (route === "/products" && request.method === "PUT") {
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return json({ error: "Too large." }, 413);
    let body; try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
    await ensureDraft(api);
    const current = await readFile(api, PRODUCTS_PATH, DRAFT);
    if (!current) return json({ error: "Could not read the draft." }, 502);
    if (body.sha && body.sha !== current.sha) return json({ error: "Someone else changed the products since you opened them. Reload and try again.", conflict: true }, 409);
    const prev = JSON.parse(current.text);
    const problem = validateProducts(body.data, prev);
    if (problem) return json({ error: problem }, 400);
    const next = { ...prev, ...body.data };
    const lines = summarize(prev, next);
    if (!lines.length) return json({ ok: true, sha: current.sha, unchanged: true });
    const title = lines.length === 1 ? lines[0] : `${lines.length} product changes`;
    const message = `${title}\n\n${lines.join("\n")}\n\nSaved in the Lacci Studio Admin by ${user.login}.`;
    const put = await api("PUT", `/contents/${PRODUCTS_PATH}`, { message, content: toB64(JSON.stringify(next, null, 2) + "\n"), sha: current.sha, branch: DRAFT });
    if (!put.ok) return json({ error: "Saving failed. Please try again." }, 502);
    return json({ ok: true, sha: put.data.content.sha, changes: lines });
  }

  if (route === "/publish" && request.method === "POST") {
    const [main, draft] = await Promise.all([branchSha(api, MAIN), branchSha(api, DRAFT)]);
    if (!draft || draft === main) return json({ ok: true, nothing: true });
    const r = await api("POST", "/merges", { base: MAIN, head: DRAFT, commit_message: "Publish changes from the Lacci Studio Admin" });
    if (r.status === 409) return json({ error: "The live site changed in a way that conflicts with your draft. Discard the draft or ask for help.", conflict: true }, 409);
    if (!r.ok && r.status !== 204) return json({ error: "Publishing failed. Please try again." }, 502);
    return json({ ok: true });
  }

  if (route === "/discard" && request.method === "POST") {
    const main = await branchSha(api, MAIN);
    if (!(await branchSha(api, DRAFT))) return json({ ok: true, nothing: true });
    const r = await api("PATCH", `/git/refs/heads/${DRAFT}`, { sha: main, force: true });
    if (!r.ok) return json({ error: "Could not discard the draft." }, 502);
    return json({ ok: true });
  }

  return json({ error: "Not found." }, 404);
}
