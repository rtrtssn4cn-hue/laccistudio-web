// Lacci Studio — the one pricing and availability rulebook.
//
// Used by the shop and cart in the browser AND by the checkout worker on the server, so a price
// shown to the customer and the price charged are worked out by the same code from the same
// content/products.json. The browser figure is only a preview: the worker recalculates every
// line and ignores any price the browser sends.
//
// Money is handled in whole cents to avoid rounding drift.

export const cents = (dollars) => Math.round(Number(dollars) * 100);

// A choice or colour is off sale when marked hidden. Hidden entries stay in the data.
export function isVisible(choice) {
  return !(choice && typeof choice === "object" && (choice.hidden === true || choice.visible === false));
}

export function choiceName(c) {
  return c && typeof c === "object" ? c.name : c;
}

export function visibleGroups(product) {
  return (product.optionGroups || []).map((g) => ({
    label: g.label || "Option",
    choices: (g.choices || []).filter(isVisible),
  }));
}

// Price change one choice makes, in cents. "price" = full price for that choice; "add" = extra charge.
export function choiceModCents(product, choice) {
  if (choice && typeof choice === "object") {
    if (choice.price !== undefined && choice.price !== null && choice.price !== "") return cents(choice.price) - cents(product.price);
    if (choice.add !== undefined && choice.add !== null && choice.add !== "") return cents(choice.add);
  }
  return 0;
}

// Colours this product is currently selling, in its own order, resolved from the colour library.
export function visibleColors(product, colorLibrary) {
  if (!product.colors || !product.colors.length) return null; // product has no garment colours
  return product.colors
    .filter((c) => c && c.visible === true)
    .map((c) => (colorLibrary || []).find((x) => x.id === c.id))
    .filter(Boolean);
}

// Validate a customer's selections for one product and return the unit price in cents.
// selections: { options: { "<group label>": "<choice name>" }, color: "<colour id>" | null }
export function priceLine(product, selections, colorLibrary) {
  if (!product) return { ok: false, error: "This product is no longer available." };
  if (product.hidden === true) return { ok: false, error: `${product.name} is no longer available.` };
  const base = cents(product.price);
  if (!Number.isFinite(base) || base <= 0) return { ok: false, error: `${product.name} has no valid price.` };

  const chosen = (selections && selections.options) || {};
  let unit = base;
  const summary = [];
  for (const g of visibleGroups(product)) {
    if (!g.choices.length) return { ok: false, error: `${product.name}: ${g.label} is not available right now.` };
    const want = chosen[g.label];
    const c = g.choices.find((x) => choiceName(x) === want);
    if (!c) return { ok: false, error: `${product.name}: please choose a valid ${g.label}.` };
    unit += choiceModCents(product, c);
    summary.push({ label: g.label, value: choiceName(c) });
  }
  // Reject selections for groups that do not exist or are hidden entirely.
  const known = new Set(visibleGroups(product).map((g) => g.label));
  for (const k of Object.keys(chosen)) if (!known.has(k)) return { ok: false, error: `${product.name}: "${k}" is not an option.` };

  const colors = visibleColors(product, colorLibrary);
  let color = null;
  if (colors) {
    if (!colors.length) return { ok: false, error: `${product.name} is not available in any colour right now.` };
    const want = selections && selections.color;
    color = colors.find((c) => c.id === want) || null;
    if (!color) return { ok: false, error: `${product.name}: that colour is not available.` };
    summary.push({ label: "Garment colour", value: color.name });
  } else if (selections && selections.color) {
    return { ok: false, error: `${product.name} does not come in colours.` };
  }
  if (unit <= 0) return { ok: false, error: `${product.name} has no valid price.` };
  return { ok: true, unitCents: unit, summary, color };
}

// Lowest price across visible choices, for "from $x" labels.
export function fromPriceCents(product) {
  let combos = [cents(product.price)];
  for (const g of visibleGroups(product)) {
    if (!g.choices.length) continue;
    const mods = g.choices.map((c) => choiceModCents(product, c));
    combos = combos.flatMap((t) => mods.map((m) => t + m));
    if (combos.length > 5000) break;
  }
  return Math.min(...combos);
}

export const money = (c) => "$" + (c / 100).toFixed(2);

// Coaster count in a line (set size x quantity) for the packaging rules; null if not a coaster line.
export function coasterCount(product, selections, qty) {
  if (!product || product.id !== "ceramic-coasters") return null;
  const q = (selections && selections.options && selections.options.Quantity) || "Single";
  const m = /(\d+)/.exec(q);
  return (m ? Number(m[1]) : 1) * qty;
}

const api = { cents, isVisible, choiceName, visibleGroups, choiceModCents, visibleColors, priceLine, fromPriceCents, money, coasterCount };
if (typeof window !== "undefined") window.LacciPricing = api;
export default api;
