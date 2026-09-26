// Builds snipcart-products.html from content/products.json.
//
// Snipcart re-reads this page at checkout to confirm every price. It used to be
// edited by hand, so a price change made in /admin (which only touches
// products.json) left the two files disagreeing and Snipcart refused the order.
// On 2026-09-26 the coaster base price went 8.99 -> 6.99 in products.json while
// this page still said 8.99: every coaster order since then failed validation.
//
// The deploy workflow now runs this before publishing, so the page always matches.
// The field list and price tokens below must stay identical to customFieldDefs()
// and snipToken() in assets/js/cart.js, or validation fails again.
//
// Usage: node tools/build-snipcart-catalog.mjs   (from the repository root)

import { readFileSync, writeFileSync } from "node:fs";

const FONTS = ["No preference", "Script / Cursive", "Serif / Classic", "Sans-serif / Modern", "Handwritten", "Bold / Block", "Monogram", "Match my sample (note below)"];
const COLORS = ["No preference", "White", "Black", "Gold", "Silver", "Rose Gold", "Red", "Navy", "Pink", "Green", "Custom (note below)"];
const PROOF = ["Yes — send me a proof before production (recommended)", "No proof needed — produce as submitted"];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Same shape boot.js produces from products.json
function mapChoice(c) {
  if (typeof c === "string") return { name: c };
  const o = { name: c.name };
  if (c.price !== undefined && c.price !== null && c.price !== "") o.price = Number(c.price);
  if (c.add !== undefined && c.add !== null && c.add !== "") o.add = Number(c.add);
  return o;
}
function groupsOf(pr) {
  if (pr.optionGroups && pr.optionGroups.length) return pr.optionGroups.map((g) => ({ label: g.label || "Option", choices: (g.choices || []).map(mapChoice) }));
  if (pr.choices && pr.choices.length) return [{ label: pr.optionLabel || "Option", choices: pr.choices.map(mapChoice) }];
  return [];
}

// Mirrors choiceMod() / snipToken() in cart.js
function choiceMod(price, c) {
  if (c.price != null) return Number(c.price) - Number(price);
  if (c.add != null) return Number(c.add);
  return 0;
}
function snipToken(price, c) {
  const m = choiceMod(price, c);
  return c.name + (m ? "[" + (m > 0 ? "+" : "") + m.toFixed(2) + "]" : "");
}

// Mirrors customFieldDefs() in cart.js
function customFieldDefs(pr) {
  const defs = [{ name: "Personalization", type: "textarea" }];
  defs.push({ name: "Font style", options: FONTS.join("|") });
  defs.push({ name: "Color", options: COLORS.join("|") });
  for (const g of groupsOf(pr)) defs.push({ name: g.label, options: g.choices.map((c) => snipToken(pr.price, c)).join("|") });
  for (const n of ["Design file", "Back design file", "Garment colour", "Text colour code", "Placement", "Text styling", "Placement preview"]) defs.push({ name: n, type: "hidden" });
  defs.push({ name: "Proof approval", options: PROOF.join("|") });
  defs.push({ name: "Comments", type: "textarea" });
  return defs;
}

const data = JSON.parse(readFileSync("content/products.json", "utf8"));
const products = data.products || [];
const problems = [];

const buttons = products.map((pr) => {
  if (!pr.id) problems.push(`product "${pr.name}" has no id`);
  const price = Number(pr.price);
  if (!Number.isFinite(price)) problems.push(`product "${pr.id}" has no valid price`);
  const imgs = pr.images && pr.images.length ? pr.images : pr.image ? [pr.image] : [];
  const attrs = [
    ["data-item-id", pr.id],
    ["data-item-name", pr.name],
    ["data-item-price", price.toFixed(2)],
    ["data-item-url", "/snipcart-products.html"],
    ["data-item-image", imgs[0] || ""],
    ["data-item-description", pr.description || ""],
  ];
  if (Number(pr.weight)) attrs.push(["data-item-weight", String(Number(pr.weight))]);
  customFieldDefs(pr).forEach((d, i) => {
    const pre = `data-item-custom${i + 1}-`;
    attrs.push([pre + "name", d.name]);
    if (d.options) attrs.push([pre + "options", d.options]);
    else attrs.push([pre + "type", d.type]);
  });
  return `<button class="snipcart-add-item" ${attrs.map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}>${esc(pr.name)}</button>`;
});

const ids = products.map((p) => p.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length) problems.push(`duplicate product ids: ${[...new Set(dupes)].join(", ")}`);
if (problems.length) {
  console.error("snipcart catalog not built:\n  " + problems.join("\n  "));
  process.exit(1);
}

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Lacci Studio — catalog</title><meta name="robots" content="noindex"></head><body><div hidden>
${buttons.join("\n")}
</div></body></html>
`;
writeFileSync("snipcart-products.html", html);
console.log(`snipcart-products.html: ${buttons.length} products written`);
