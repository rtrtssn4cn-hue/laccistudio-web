// Checks and cleans the design record the visual customizer sends with a cart line.
// Only known fields are kept, numbers are range-checked,
// every picture must be an upload on the shop's own upload host, and the record is size-limited.
// It never affects the price: pricing comes from products.json only.

const MAX_BYTES = 24 * 1024;
const AREA_IDS = new Set(["main", "front", "back"]);
const LIMITS = { layers: 10, items: 12, attachments: 5, text: 200, comments: 1000, name: 120 };

const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10000) / 10000 : null);
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const hex = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : null);

// cleanUrl(url) → cleaned https URL on an allowed upload host, "" for empty, null when refused.
function cleanLayer(l, cleanUrl) {
  if (!l || typeof l !== "object") return { error: "A design layer is invalid." };
  const x = num(l.x, -1, 2), y = num(l.y, -1, 2), rotation = num(l.rotation ?? 0, -360, 360);
  if (x === null || y === null || rotation === null) return { error: "A design layer has an invalid position." };
  if (l.type === "image") {
    const src = cleanUrl(l.src);
    if (!src) return { error: "One of the uploaded files could not be verified. Please upload it again." };
    const w = num(l.w, 0.01, 5), nw = num(l.naturalW ?? 0, 0, 30000), nh = num(l.naturalH ?? 0, 0, 30000);
    if (w === null || nw === null || nh === null) return { error: "A picture in the design has an invalid size." };
    const out = { type: "image", src, name: str(l.name, LIMITS.name), naturalW: nw, naturalH: nh, x, y, w, rotation, removeWhite: l.removeWhite !== false };
    if (l.crop) {
      const c = { x: num(l.crop.x, 0, 1), y: num(l.crop.y, 0, 1), w: num(l.crop.w, 0.01, 1), h: num(l.crop.h, 0.01, 1) };
      if (Object.values(c).some((v) => v === null) || c.x + c.w > 1.0001 || c.y + c.h > 1.0001) return { error: "A picture crop is invalid." };
      out.crop = c;
    }
    if (l.flipX === true) out.flipX = true;
    return { layer: out };
  }
  if (l.type === "text") {
    const text = str(l.text, LIMITS.text).trim();
    if (!text) return { error: "A text layer is empty." };
    const size = num(l.size, 0.01, 1.5), spacing = num(l.spacing ?? 0, 0, 1), curve = num(l.curve ?? 0, -100, 100), color = hex(l.color);
    if (size === null || spacing === null || curve === null || !color) return { error: "A text layer has invalid styling." };
    const align = ["left", "center", "right"].includes(l.align) ? l.align : "center";
    return { layer: { type: "text", text, font: str(l.font, 60), color, size, x, y, rotation, spacing, curve, bold: l.bold === true, vertical: l.vertical === true, align } };
  }
  return { error: "A design layer has an unknown type." };
}

function cleanAreas(areas, cleanUrl) {
  if (!areas || typeof areas !== "object" || Array.isArray(areas)) return { error: "The design is invalid." };
  const out = {};
  let count = 0;
  for (const [id, a] of Object.entries(areas)) {
    if (!AREA_IDS.has(id) || !a || typeof a !== "object") return { error: "The design names an unknown print area." };
    const layers = Array.isArray(a.layers) ? a.layers : [];
    if (layers.length > LIMITS.layers) return { error: "Too many items in one design." };
    const clean = [];
    for (const l of layers) { const r = cleanLayer(l, cleanUrl); if (r.error) return r; clean.push(r.layer); }
    const att = [];
    for (const f of (Array.isArray(a.attachments) ? a.attachments : []).slice(0, LIMITS.attachments)) {
      const src = cleanUrl(f && f.src);
      if (!src) return { error: "One of the uploaded files could not be verified. Please upload it again." };
      att.push({ src, name: str(f.name, LIMITS.name) });
    }
    count += clean.length + att.length;
    out[id] = { layers: clean, ...(att.length ? { attachments: att } : {}) };
  }
  return { areas: out, count };
}
function cleanPreviews(p, cleanUrl) {
  const out = {};
  for (const [id, u] of Object.entries(p && typeof p === "object" ? p : {})) {
    if (!AREA_IDS.has(id)) continue;
    const v = cleanUrl(u);
    if (v === null) return { error: "A design preview could not be verified." };
    if (v) out[id] = v;
  }
  return { previews: out };
}

// Returns { customization } (cleaned), { none: true } when absent, or { error }.
export function cleanCustomization(c, productId, cleanUrl) {
  if (c === undefined || c === null) return { none: true };
  let size;
  try { size = new TextEncoder().encode(JSON.stringify(c)).length; } catch { return { error: "The design is invalid." }; }
  if (size > MAX_BYTES) return { error: "The design is too large to save. Please remove an item and try again." };
  if (typeof c !== "object" || c.schema !== 1) return { error: "The design is from an older version. Please open it and add it to the cart again." };
  if (typeof c.customizationId !== "string" || !/^c_[a-z0-9]{8,32}$/.test(c.customizationId)) return { error: "The design is invalid." };
  if (c.productId !== productId) return { error: "The design doesn't match the product." };
  const out = { schema: 1, customizationId: c.customizationId, productId, layout: c.layout === "each" ? "each" : "same", proof: c.proof !== false, comments: str(c.comments, LIMITS.comments), createdAt: str(c.createdAt, 40) };
  let total = 0;
  if (out.layout === "each") {
    if (!Array.isArray(c.items) || !c.items.length || c.items.length > LIMITS.items) return { error: "The set's designs are invalid." };
    out.items = [];
    for (const [i, it] of c.items.entries()) {
      const a = cleanAreas(it && it.areas, cleanUrl); if (a.error) return a;
      const p = cleanPreviews(it.previews, cleanUrl); if (p.error) return p;
      out.items.push({ index: i, areas: a.areas, ...(Object.keys(p.previews).length ? { previews: p.previews } : {}) });
      if (!a.count) return { error: `Coaster ${i + 1} has no design yet.` };
      total += a.count;
    }
  } else {
    const a = cleanAreas(c.areas, cleanUrl); if (a.error) return a;
    const p = cleanPreviews(c.previews, cleanUrl); if (p.error) return p;
    out.areas = a.areas; out.previews = p.previews; total = a.count;
  }
  if (!total) return { error: "Add your text or upload a design." };
  return { customization: out };
}
