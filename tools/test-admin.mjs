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
  ok(/Personalized Mug: .*price \$11\.99 → \$19\.99/.test(gh.commits[0].message) && /active → hidden/.test(gh.commits[0].message), "readable change message: " + gh.commits[0].message.split("\n")[0]);
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
  eq(saved.status, "archived", "archived"); const { updatedAt, ...rest } = saved; ok(updatedAt, "save time stamped");
  eq(JSON.stringify({ ...rest, status: JSON.parse(before).status }), JSON.stringify(JSON.parse(before)), "every other field kept");
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

await test("9. Colours and sizes switch on/off without losing anything; only edited products get a new date", async () => {
  const r = await call("/api/admin/content/products");
  const data = r.body.data; const tee = data.products.find((p) => p.id === "apparel-t-shirt");
  tee.colors.find((c) => c.id === "black").visible = true;
  const size = tee.optionGroups.find((g) => g.label === "Size"); size.choices.find((c) => c.name === "XS").hidden = true;
  size.choices.find((c) => c.name === "3XL").price = 38.5;
  const s = await save(data, r.body.sha); eq(s.status, 200, "saved " + JSON.stringify(s.body));
  const out = JSON.parse(gh.files.draft["content/products.json"].text).products;
  const t2 = out.find((p) => p.id === "apparel-t-shirt");
  eq(t2.colors.length, tee.colors.length, "every colour kept"); eq(t2.colors.find((c) => c.id === "black").visible, true, "black on");
  eq(t2.optionGroups[1].choices.length, size.choices.length, "every size kept"); eq(t2.optionGroups[1].choices.find((c) => c.name === "XS").hidden, true, "XS off");
  ok(/colours on: black/.test(gh.commits[0].message) && /XS off/.test(gh.commits[0].message) && /3XL \$21\.99 → \$38\.5/.test(gh.commits[0].message), "plain message: " + gh.commits[0].message.split("\n")[0]);
  ok(t2.updatedAt, "edited product dated"); ok(!out.find((p) => p.id === "sublimation-mug").updatedAt, "untouched product not dated");
});
await test("10. Removing a size/colour, unknown colours, and a for-sale product with every choice off are refused", async () => {
  const r = await call("/api/admin/content/products");
  const a = structuredClone(r.body.data); a.products.find((p) => p.id === "apparel-t-shirt").optionGroups[1].choices.pop();
  const ra = await save(a, r.body.sha); eq(ra.status, 400, "choice removal refused"); ok(/Turn choices off/.test(ra.body.error), "explains turn off");
  const b = structuredClone(r.body.data); b.products.find((p) => p.id === "apparel-hoodie").colors.pop();
  eq((await save(b, r.body.sha)).status, 400, "colour removal refused");
  const c = structuredClone(r.body.data); c.products.find((p) => p.id === "apparel-hoodie").colors.push({ id: "made-up", visible: true });
  eq((await save(c, r.body.sha)).status, 400, "unknown colour refused");
  const d = structuredClone(r.body.data); d.products.find((p) => p.id === "sublimation-mug").optionGroups[0].choices.forEach((x) => (x.hidden = true));
  const rd = await save(d, r.body.sha); eq(rd.status, 400, "all sizes off refused while for sale"); ok(/Turn at least one on/.test(rd.body.error), "explains");
  const f = structuredClone(r.body.data); f.products[0].optionGroups[0].choices[0].price = "abc";
  eq((await save(f, r.body.sha)).status, 400, "bad option price refused");
  const g = structuredClone(r.body.data); g.products[0].images = ["javascript:alert(1)"];
  eq((await save(g, r.body.sha)).status, 400, "script picture refused");
  const e = structuredClone(r.body.data); const mug = e.products.find((p) => p.id === "sublimation-mug"); mug.optionGroups[0].choices.forEach((x) => (x.hidden = true)); mug.status = "hidden";
  eq((await save(e, r.body.sha)).status, 200, "allowed once the product is off");
});
await test("11. Pictures upload into the draft only; wrong types and oversize files are refused", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
  const up = await call("/api/admin/content/media", { method: "POST", body: JSON.stringify({ name: "My Photo.PNG", type: "image/png", data: png }) });
  eq(up.status, 200, "upload " + JSON.stringify(up.body)); ok(/^\/assets\/img\/uploads\/my-photo-[0-9a-f]{8}\.png$/.test(up.body.path), "safe name: " + up.body.path);
  ok(gh.files.draft[up.body.path.slice(1)], "file on draft"); ok(!gh.files.main[up.body.path.slice(1)], "not live");
  const back = await call("/api/admin/content/file?path=" + up.body.path.slice(1)); eq(back.body.data, png, "readable before publish");
  eq((await call("/api/admin/content/media", { method: "POST", body: JSON.stringify({ name: "x.svg", type: "image/svg+xml", data: png }) })).status, 400, "svg refused");
  eq((await call("/api/admin/content/file?path=content/products.json")).status, 404, "only uploads readable");
  eq((await call("/api/admin/content/media", { method: "POST", body: JSON.stringify({ name: "x.png", type: "image/png", data: png }) }, "readonly")).status, 401, "read-only user refused");
});

for (const [r, name] of results) console.log(`${r}  ${name}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
