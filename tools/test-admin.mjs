// Admin content API tests: runs the real worker against a simulated GitHub.
//   node tools/test-admin.mjs
// Covers login/push-access checks, reading products, saving to the draft branch only, server-side
// validation (no silent deletions, valid status/price), stale-edit conflicts, publish and discard.

import worker from "../worker/index.js";
import { makeEnv } from "./worker-local.mjs";
import { readFileSync } from "node:fs";

const realProducts = readFileSync(new URL("../content/products.json", import.meta.url), "utf8");

import { gh, resetGitHub, install } from "./fake-github.mjs";
install();

// ---------------------------------------------------------------- harness
const env = makeEnv({ ADMIN_GITHUB_REPO: "rtrtssn4cn-hue/laccistudio-web" });
const call = (path, opts = {}, token = "good") => worker.fetch(new Request("http://localhost:8787" + path, { ...opts, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) } }), env).then(async (r) => ({ status: r.status, body: await r.json() }));
let pass = 0, fail = 0; const results = [];
async function test(name, fn) { resetGitHub(); try { await fn(); pass++; results.push(["PASS", name]); } catch (e) { fail++; results.push(["FAIL", name + " — " + e.message]); } }
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, what) => { if (!c) throw new Error(what); };
const save = (data, sha) => call("/api/admin/content/products", { method: "PUT", body: JSON.stringify({ data, sha }) });

await test("1. No login or read-only GitHub user is refused", async () => {
  eq((await call("/api/admin/content/products", {}, "nope")).status, 401, "bad token");
  eq((await call("/api/admin/content/products", {}, "readonly")).status, 401, "read-only user");
});
await test("2. Products load from the live branch when no draft exists", async () => {
  const r = await call("/api/admin/content/products");
  eq(r.status, 200, "status"); eq(r.body.ref, "main", "ref"); eq(r.body.data.products.length, JSON.parse(realProducts).products.length, "product count");
  ok(r.body.colors.garmentColors.length > 0, "colours included");
});
await test("3. Saving hides a product on the draft only; live is untouched; message is plain English", async () => {
  const r = await call("/api/admin/content/products");
  const data = r.body.data; const mug = data.products.find((p) => p.id === "sublimation-mug"); mug.status = "hidden"; mug.price = 19.99;
  const s = await save(data, r.body.sha);
  eq(s.status, 200, "save " + JSON.stringify(s.body)); ok(gh.branches.draft, "draft branch created");
  ok(JSON.parse(gh.files.draft["content/products.json"].text).products.find((p) => p.id === "sublimation-mug").status === "hidden", "draft has the change");
  eq(gh.files.main["content/products.json"].text, realProducts, "live file unchanged");
  ok(/Personalized Mug: .*price \$18\.99 → \$19\.99/.test(gh.commits[0].message) && /active → hidden/.test(gh.commits[0].message), "readable change message: " + gh.commits[0].message.split("\n")[0]);
  const st = await call("/api/admin/content/state"); eq(st.body.unpublished, 1, "one unpublished change");
});
await test("4. Removing a product is refused (archive instead); bad status and price are refused", async () => {
  const r = await call("/api/admin/content/products");
  const fewer = { ...r.body.data, products: r.body.data.products.slice(1) };
  const a = await save(fewer, r.body.sha); eq(a.status, 400, "removal refused"); ok(/Archive/.test(a.body.error), "explains archive");
  const bad = structuredClone(r.body.data); bad.products[0].status = "deleted";
  eq((await save(bad, r.body.sha)).status, 400, "unknown status refused");
  const neg = structuredClone(r.body.data); neg.products[0].price = -5;
  eq((await save(neg, r.body.sha)).status, 400, "negative price refused");
  const dup = structuredClone(r.body.data); dup.products[1].id = dup.products[0].id;
  eq((await save(dup, r.body.sha)).status, 400, "duplicate id refused");
  ok(!gh.branches.draft || gh.commits.length === 0, "nothing committed");
});
await test("5. Archiving keeps the product and all its data", async () => {
  const r = await call("/api/admin/content/products");
  const data = r.body.data; const before = JSON.stringify(data.products[0]); data.products[0].status = "archived";
  eq((await save(data, r.body.sha)).status, 200, "archive saved");
  const saved = JSON.parse(gh.files.draft["content/products.json"].text).products[0];
  eq(saved.status, "archived", "archived"); eq(JSON.stringify({ ...saved, status: JSON.parse(before).status }), JSON.stringify(JSON.parse(before)), "every other field kept");
});
await test("6. A stale edit (someone else saved first) is refused, not overwritten", async () => {
  const r = await call("/api/admin/content/products");
  const d1 = structuredClone(r.body.data); d1.products[0].name = "First edit";
  eq((await save(d1, r.body.sha)).status, 200, "first save");
  const d2 = structuredClone(r.body.data); d2.products[1].name = "Second edit";
  const s2 = await save(d2, r.body.sha); eq(s2.status, 409, "stale save refused"); ok(s2.body.conflict, "conflict flagged");
});
await test("7. Publish merges the draft into live; Discard resets the draft", async () => {
  const r = await call("/api/admin/content/products");
  const data = r.body.data; data.products[0].featured = true;
  await save(data, r.body.sha);
  eq((await call("/api/admin/content/publish", { method: "POST" })).status, 200, "publish");
  ok(JSON.parse(gh.files.main["content/products.json"].text).products[0].featured === true, "live has the change");
  const r2 = await call("/api/admin/content/products");
  const d2 = r2.body.data; d2.products[0].name = "Oops";
  await save(d2, r2.body.sha);
  eq((await call("/api/admin/content/discard", { method: "POST" })).status, 200, "discard");
  ok(JSON.parse(gh.files.draft["content/products.json"].text).products[0].name !== "Oops", "draft reset to live");
});
await test("8. Saving with no real change creates no commit", async () => {
  const r = await call("/api/admin/content/products");
  const s = await save(r.body.data, r.body.sha); eq(s.body.unchanged, true, "unchanged"); eq(gh.commits.length, 0, "no commit");
});

for (const [r, name] of results) console.log(`${r}  ${name}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
