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
//   POST /api/admin/content/media                   save a picture or video into the draft (assets/img/uploads/)
//   GET  /api/admin/content/file?path=…             read an uploaded file back from the draft (before it is live)
//
// Access is checked by the caller (handleAdmin → adminUser: GitHub push access) on every request.
// The server validates everything it writes; the admin screens are never trusted on their own.

import { PRODUCT_STATUSES } from "../assets/js/pricing.mjs";

const DRAFT = "draft";
const MAIN = "main";
const PRODUCTS_PATH = "content/products.json";
const COLORS_PATH = "content/colors.json";
const MAX_BODY = 2 * 1024 * 1024;
const MAX_MEDIA = 28 * 1024 * 1024;
const MEDIA_TYPES = { "image/jpeg": { ext: "jpg" }, "image/png": { ext: "png" }, "image/webp": { ext: "webp" }, "video/mp4": { ext: "mp4" } };

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

// Server-side checks on a products list before it is written. Existing products, option choices
// and colours can't disappear (they are hidden or archived instead); unknown fields are kept.
const PERSONALIZATION_FLAGS = ["upload", "text", "designs", "blank", "preview", "proof", "notes"];
const unsafeUrl = (v) => typeof v !== "string" || v.length > 1000 || /^\s*(javascript|data|vbscript):/i.test(v);
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi; };
const choiceName = (c) => (c && typeof c === "object" ? c.name : c);
const choiceOn = (c) => !(c && typeof c === "object" && (c.hidden === true || c.visible === false));

function checkProduct(p, colorIds) {
  const who = `"${p.name}"`;
  if (p.optionGroups !== undefined) {
    if (!Array.isArray(p.optionGroups) || p.optionGroups.length > 20) return `${who}: the options list is invalid.`;
    const labels = new Set();
    for (const g of p.optionGroups) {
      if (!g || typeof g.label !== "string" || !g.label.trim() || g.label.length > 60) return `${who}: every option needs a name.`;
      if (labels.has(g.label)) return `${who}: two options are both called "${g.label}".`;
      labels.add(g.label);
      if (!Array.isArray(g.choices) || !g.choices.length || g.choices.length > 60) return `${who}: "${g.label}" needs at least one choice.`;
      const names = new Set();
      for (const c of g.choices) {
        const n = choiceName(c);
        if (typeof n !== "string" || !n.trim() || n.length > 80) return `${who}: a "${g.label}" choice has no name.`;
        if (names.has(n)) return `${who}: "${g.label}" lists "${n}" twice.`;
        names.add(n);
        if (c && typeof c === "object") {
          if (c.price !== undefined && c.price !== null && c.price !== "" && !num(c.price, 0.5, 10000)) return `${who}: "${n}" has an invalid price.`;
          if (c.add !== undefined && c.add !== null && c.add !== "" && !num(c.add, -1000, 1000)) return `${who}: "${n}" has an invalid extra charge.`;
          if (c.hidden !== undefined && typeof c.hidden !== "boolean") return `${who}: "${n}" availability must be on or off.`;
          if (c.img !== undefined && unsafeUrl(c.img)) return `${who}: "${n}" has an invalid picture.`;
        }
      }
      if ((p.status || "active") === "active" && !g.choices.some(choiceOn)) return `${who} is available for sale but every "${g.label}" choice is off. Turn at least one on, or turn the product off.`;
    }
  }
  if (p.colors !== undefined && p.colors !== null) {
    if (!Array.isArray(p.colors) || p.colors.length > 80) return `${who}: the colour list is invalid.`;
    const seen = new Set();
    for (const c of p.colors) {
      if (!c || typeof c.id !== "string" || !colorIds.has(c.id)) return `${who}: unknown colour "${c && c.id}".`;
      if (seen.has(c.id)) return `${who}: colour "${c.id}" is listed twice.`;
      seen.add(c.id);
      if (typeof c.visible !== "boolean") return `${who}: colour "${c.id}" availability must be on or off.`;
    }
    if ((p.status || "active") === "active" && p.colors.length && !p.colors.some((c) => c.visible)) return `${who} is available for sale but every colour is off. Turn at least one on, or turn the product off.`;
  }
  for (const k of ["mockupPhoto", "video"]) if (p[k] !== undefined && p[k] !== "" && unsafeUrl(p[k])) return `${who}: ${k} is invalid.`;
  if (p.weight !== undefined && !num(p.weight, 0, 50000)) return `${who}: weight must be between 0 and 50,000 grams.`;
  if (p.seo !== undefined) {
    if (!p.seo || typeof p.seo !== "object") return `${who}: SEO settings are invalid.`;
    if (p.seo.title !== undefined && (typeof p.seo.title !== "string" || p.seo.title.length > 120)) return `${who}: SEO title is too long (120 max).`;
    if (p.seo.description !== undefined && (typeof p.seo.description !== "string" || p.seo.description.length > 320)) return `${who}: SEO description is too long (320 max).`;
  }
  if (p.pricePlan !== undefined) {
    const z = p.pricePlan;
    if (!z || typeof z !== "object" || Array.isArray(z)) return `${who}: price plan is invalid.`;
    for (const [k, v] of Object.entries(z)) {
      if (k === "stage") { if (!["growth", "balanced", "premium"].includes(v)) return `${who}: unknown price stage.`; continue; }
      if (!["growth", "balanced", "premium"].includes(k) || !v || typeof v !== "object") return `${who}: price plan "${k}" is invalid.`;
      for (const [label, price] of Object.entries(v)) if (label.length > 160 || !num(price, 0.5, 10000)) return `${who}: planned price for "${label}" is invalid.`;
    }
  }
  if (p.personalization !== undefined) {
    const z = p.personalization;
    if (!z || typeof z !== "object") return `${who}: personalization settings are invalid.`;
    for (const f of PERSONALIZATION_FLAGS) if (z[f] !== undefined && typeof z[f] !== "boolean") return `${who}: personalization "${f}" must be on or off.`;
    for (const f of ["fonts", "textColors"]) if (z[f] !== undefined && (!Array.isArray(z[f]) || z[f].length > 40 || z[f].some((x) => typeof x !== "string" || x.length > 60))) return `${who}: personalization ${f} list is invalid.`;
  }
  return null;
}

export function validateProducts(next, current, colorLib) {
  if (!next || !Array.isArray(next.products)) return "The product list is missing.";
  const colorIds = new Set(((colorLib && colorLib.garmentColors) || []).map((c) => c.id));
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
    if (p.images !== undefined && (!Array.isArray(p.images) || p.images.some(unsafeUrl))) return `"${p.name}" has an invalid picture list.`;
    for (const k of ["description", "category", "subcategory"]) if (p[k] !== undefined && (typeof p[k] !== "string" || p[k].length > 5000)) return `"${p.name}": ${k} is invalid.`;
    if (p.featured !== undefined && typeof p.featured !== "boolean") return `"${p.name}": featured must be on or off.`;
    const problem = checkProduct(p, colorIds);
    if (problem) return problem;
  }
  const byId = new Map(next.products.map((p) => [p.id, p]));
  const missing = (current.products || []).filter((p) => !byId.has(p.id)).map((p) => p.name || p.id);
  if (missing.length) return `These products would be removed: ${missing.slice(0, 5).join(", ")}. Archive them instead.`;
  // Nothing inside a product is dropped either: choices and colours are turned off, not deleted.
  for (const old of current.products || []) {
    const p = byId.get(old.id);
    for (const g of old.optionGroups || []) {
      const ng = (p.optionGroups || []).find((x) => x.label === g.label);
      if (!ng) return `"${p.name}": the option "${g.label}" would be removed. Turn its choices off instead.`;
      const names = new Set(ng.choices.map(choiceName));
      const gone = g.choices.map(choiceName).filter((n) => !names.has(n));
      if (gone.length) return `"${p.name}": "${g.label}" would lose ${gone.slice(0, 3).join(", ")}. Turn choices off instead of removing them.`;
    }
    const nc = new Set((p.colors || []).map((c) => c.id));
    const goneC = (old.colors || []).map((c) => c.id).filter((id) => !nc.has(id));
    if (goneC.length) return `"${p.name}": colours ${goneC.slice(0, 3).join(", ")} would be removed. Turn them off instead.`;
  }
  return null;
}

function colourChange(a = [], b = []) {
  const was = new Map(a.map((c) => [c.id, c.visible]));
  const on = b.filter((c) => c.visible && was.get(c.id) === false).map((c) => c.id), off = b.filter((c) => !c.visible && was.get(c.id) === true).map((c) => c.id);
  return [on.length ? `colours on: ${on.join(", ")}` : "", off.length ? `colours off: ${off.join(", ")}` : ""].filter(Boolean).join("; ") || "colours";
}
function optionChange(a = [], b = []) {
  const out = [];
  for (const g of b) {
    const og = a.find((x) => x.label === g.label); if (!og) continue;
    for (const c of g.choices) {
      const n = choiceName(c), oc = og.choices.find((x) => choiceName(x) === n); if (oc === undefined) continue;
      const o = typeof oc === "object" ? oc : {}, v = typeof c === "object" ? c : {};
      if (choiceOn(oc) !== choiceOn(c)) out.push(`${n} ${choiceOn(c) ? "on" : "off"}`);
      if (String(o.price ?? "") !== String(v.price ?? "")) out.push(`${n} $${o.price ?? "—"} → $${v.price ?? "—"}`);
      if (String(o.add ?? "") !== String(v.add ?? "")) out.push(`${n} +$${o.add ?? 0} → +$${v.add ?? 0}`);
    }
  }
  return out.length ? out.join(", ") : "options";
}

function summarize(prev, next) {
  const before = new Map((prev.products || []).map((p) => [p.id, p]));
  const lines = [];
  for (const p of next.products) {
    const o = before.get(p.id);
    if (!o) { lines.push(`Added ${p.name}`); continue; }
    const changed = Object.keys({ ...o, ...p }).filter((k) => JSON.stringify(o[k]) !== JSON.stringify(p[k]));
    if (!changed.length) continue;
    const bits = changed.filter((k) => k !== "updatedAt").map((k) => (k === "price" ? `price $${o.price} → $${p.price}` : k === "status" ? `${o.status || "active"} → ${p.status || "active"}` : k === "colors" ? colourChange(o.colors, p.colors) : k === "optionGroups" ? optionChange(o.optionGroups, p.optionGroups) : k));
    if (!bits.length) continue;
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
    const lib = await readFile(api, COLORS_PATH, DRAFT);
    const problem = validateProducts(body.data, prev, lib ? JSON.parse(lib.text) : { garmentColors: [] });
    if (problem) return json({ error: problem }, 400);
    const next = { ...prev, ...body.data };
    const stamp = new Date().toISOString(), before = new Map((prev.products || []).map((p) => [p.id, JSON.stringify({ ...p, updatedAt: 0 })]));
    next.products = next.products.map((p) => (before.get(p.id) === JSON.stringify({ ...p, updatedAt: 0 }) ? p : { ...p, updatedAt: stamp }));
    const lines = summarize(prev, next);
    if (!lines.length) return json({ ok: true, sha: current.sha, unchanged: true });
    const title = lines.length === 1 ? lines[0] : `${lines.length} product changes`;
    const message = `${title}\n\n${lines.join("\n")}\n\nSaved in the Lacci Studio Admin by ${user.login}.`;
    const put = await api("PUT", `/contents/${PRODUCTS_PATH}`, { message, content: toB64(JSON.stringify(next, null, 2) + "\n"), sha: current.sha, branch: DRAFT });
    if (!put.ok) return json({ error: "Saving failed. Please try again." }, 502);
    return json({ ok: true, sha: put.data.content.sha, changes: lines });
  }

  if (route === "/media" && request.method === "POST") {
    if (Number(request.headers.get("content-length") || 0) > MAX_MEDIA) return json({ error: "That file is too large (20 MB max)." }, 413);
    let body; try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
    const kind = MEDIA_TYPES[String(body.type || "").toLowerCase()];
    if (!kind) return json({ error: "Use a JPG, PNG, WebP picture or an MP4 video." }, 400);
    if (typeof body.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(body.data)) return json({ error: "The file could not be read." }, 400);
    const bytes = Math.floor(body.data.length * 3 / 4);
    if (bytes > (kind.ext === "mp4" ? 20 : 8) * 1024 * 1024) return json({ error: kind.ext === "mp4" ? "Videos can be up to 20 MB." : "Pictures can be up to 8 MB." }, 413);
    const base = String(body.name || "upload").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "upload";
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
    const path = `assets/img/uploads/${base}-${rand}.${kind.ext}`;
    await ensureDraft(api);
    const put = await api("PUT", `/contents/${path}`, { message: `Add ${kind.ext === "mp4" ? "video" : "picture"} ${base}.${kind.ext}\n\nUploaded in the Lacci Studio Admin by ${user.login}.`, content: body.data, branch: DRAFT });
    if (!put.ok) return json({ error: "Upload failed. Please try again." }, 502);
    return json({ ok: true, path: "/" + path });
  }

  if (route === "/file" && request.method === "GET") {
    const path = url.searchParams.get("path") || "";
    if (!/^assets\/img\/uploads\/[a-z0-9-]+\.(jpg|png|webp|mp4)$/.test(path)) return json({ error: "Not found." }, 404);
    const r = await api("GET", `/contents/${path}?ref=${DRAFT}`);
    if (!r.ok || !r.data.content) return json({ error: "Not found." }, 404);
    return json({ data: r.data.content.replace(/\n/g, "") });
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
