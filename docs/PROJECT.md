# Lacci Studio website — project reference

**Read this before changing anything in this repository.** Then read `AUDIT-2026-09.md`, `ADMIN_AUDIT.md` and `PRICING-2026-09.md`.
Last updated: 2026-09-26.

---

## Source of truth

- **The only accurate copy of the site is this repo:** `github.com/rtrtssn4cn-hue/laccistudio-web`, branch `main`. On this computer it lives at `~/Documents/GitHub/laccistudio-web`.
- Pushing to `main` publishes to laccistudio.com in about 1–2 minutes.
- Other copies on this computer are **stale archives**. Do not edit or deploy them:
  - Desktop `Lacci-Studio-Website`, `Lacci-Studio-Website 2`
  - Downloads `Lacci-Studio-Website-updated 6/7`, `laccistudio-web-CLEAN`, `laccistudio-web-CLEAN 2`, `laccistudio-site-main`, `laccistudio-site-main-2`, `Lacci-Studio-UPDATE-code-only`
  - The old GitHub repo `laccistudio-site`, whose builds all failed.
- `live-2026-09-26` is a git tag of exactly what was live before the September audit. Restore any file with `git checkout live-2026-09-26 -- <file>`.

## Architecture

```
content/*.json ──► assets/js/boot.js (fetches JSON on every page) ──► cart.js (shop, customizer, Snipcart)
                                                                  ├─► main.js (contact, social, menu, forms)
                                                                  └─► promo-banner.js (announcement)
/admin (Decap CMS) ── GitHub login via Cloudflare Worker lacci-oauth ──► commits to main
main ──► .github/workflows/deploy.yml ──► node tools/build-snipcart-catalog.mjs ──► wrangler deploy ──► Cloudflare Worker "laccistudio"
```

| Thing | Where |
|---|---|
| Products, prices, options, images, weights, hidden flag | `content/products.json` |
| Garment colour library (name, swatch, method) | `content/colors.json`. Which colours a product sells is in that product's `colors` list |
| Homepage text (7 fields) | `content/home.json` |
| Gallery | `content/gallery.json` (items with no photo/video are not shown) |
| Contact, social, sale banner, checkout mode, public keys | `content/settings.json` |
| Snipcart price validation page | `snipcart-products.html`. **Generated. Never edit by hand.** It's rebuilt from `products.json` on every deploy; run `node tools/build-snipcart-catalog.mjs` to preview locally. |
| Price tokens | `choiceMod()` / `snipToken()` / `customFieldDefs()` in `assets/js/cart.js` must stay identical to the generator in `tools/` |
| Shop card images | `assets/img/card/<name>.jpg`: small copies of `assets/img/mock/<name>.png`. The customizer uses the PNG. |
| Nav, footer, sections, FAQ, services, About | hand-written in each `.html` file (6 copies of nav and footer) |
| Files kept off the public site | `.assetsignore` (tools, docs, .github, *.md, …) |
| Customer design uploads | Uploadcare (public key in settings) |
| Orders | Snipcart dashboard |
| Analytics | Cloudflare Web Analytics (injected by Cloudflare) |

Local preview: `python3 -m http.server 8765` in the repo root, then open http://localhost:8765/.

## Visibility model (products, options, colours)

Nothing is deleted to take it off sale. Three switches, all editable in /admin:

| Level | Field | Meaning |
|---|---|---|
| Product | `"hidden": true` on the product | Not shown in the shop; all data kept |
| Option choice (size, quantity, finish…) | `"hidden": true` on the choice (`"visible": false` also accepted) | Not offered; its name, price and image are kept |
| Garment colour | product `colors: [{ "id": "white", "visible": true }, …]` referring to `content/colors.json` | Per product, in display order. Only `visible: true` colours are offered |

```jsonc
// content/colors.json — the library (never delete entries that were ever sold)
{ "garmentColors": [ { "id": "white", "name": "White", "hex": "#FFFFFF", "method": "sublimation" }, … 17 colours ] }
// content/products.json — per product
"colors": [ { "id": "white", "visible": true }, { "id": "black", "visible": false }, … ]
```

Rules, enforced in code:
- `boot.js` passes only visible choices and colours to the shop (`productColors()`, `isVisible()`).
- `cart.js` customizer:
  - 0 visible colours means the product can't be added.
  - 1 visible colour is shown as plain text ("Garment colour: White").
  - 2 or more are shown as swatches.
  - Add-to-cart re-checks every chosen value against current data (`lineStillOrderable()`).
  - When Snipcart loads a cart saved earlier, lines with a hidden or removed option are removed and the customer is told why.
- `tools/build-snipcart-catalog.mjs` lists only visible choices and colours. "Garment colour" is a dropdown field whose options are the visible colour names, so Snipcart's own order validation has only those values to accept.
- **Not yet proven:** Snipcart rejecting an order that carries a hidden, non-priced value (such as a colour). Snipcart's cart is disabled (HTTP 402) and can't be exercised; see AUDIT. Test it in Snipcart test mode once the account works.
- Old orders keep the colour text they were placed with (stored by Snipcart), so they stay readable after a colour is hidden.
- Keep the field order and option strings in `customFieldDefs()` (cart.js) and the generator identical. The QA check compares them for every product.

Current state (2026-09-26): all 10 apparel products that print on garments have the 17 colours, **only White visible**.

## Active products (Etsy is the reference for what is really sold)

| Product | Etsy | Website id |
|---|---|---|
| Personalized ceramic coaster: single / set of 4, round or square, ceramic with cork back | $6.99 / $19.99, ship $8.07 | `ceramic-coasters` |
| 20 oz stainless tumbler: name or pet photo | $19.99, ship $6.54 | `sublimation-tumbler` |
| 11 oz ceramic mug (pet photo on Etsy) | $19.99, ship $8.07 | `sublimation-mug` |
| White polyester sublimation tee XS–XXL | $25.98–35.98, ship $5.68 | `apparel-t-shirt` |

The website also shows 22 more products and 18 hidden ones. Whether those can be produced is **unconfirmed** (open decision). Etsy: no returns/exchanges; cancellations within 2 hours; ships from Houston, TX.

**$6.99 is the price of ONE coaster, not a set.**

## Pricing decisions

| Date | Decision | Status |
|---|---|---|
| 2026-09-26 | **$6.99 = ONE coaster (not a set).** Single stays $6.99; "Single" option corrected from $8.99 on the work branch | Decided by owner |
| 2026-09-26 | Quantity ladder (1–8 or 1/2/4/6/8) wanted, but discounts wait for real costs and margins. Set prices unchanged | Open |
| 2026-09-26 | Website and Etsy prices are **not** auto-aligned. Discrepancies reported (PRICING §0.2); each change needs approval | Decided by owner |
| 2026-09-26 | Boxes: 1–3 coasters 6×6×2 in; 4 coasters 9×6×2 in; 5–8 coasters 9×6×4 in. Real data: 8 coasters, 6×6×6 box, Etsy USPS label $10.69. Packed weights unknown; don't estimate | Recorded |
| 2026-09-26 | Recommended: identical prices on Etsy and website; no permanent "sale" pricing; revisit a direct-site perk when the website sells over ~$1k/month | Recommendation |
| – | Internal costs (blanks, ink, paper, packaging, labor, reprints) | **Not yet provided.** All price recommendations are provisional. |

## Commerce (read docs/COMMERCE.md)

The store is moving from Snipcart to **Stripe Checkout + a Cloudflare Worker** (branch `stripe-checkout`), so there's no monthly fee: only Stripe's per-sale fee.
- Prices, options and visibility come only from `content/products.json` via `assets/js/pricing.mjs`, used by the shop, the cart **and** the server. The server never trusts a browser price.
- Orders are stored in Cloudflare D1 and managed at `/admin/orders.html`. Stripe webhooks are signature-checked and idempotent.
- Shipping methods and bands, the TX 8.25% tax rate, packaging rules and real shipping history: `content/shipping.json`.
- **The future visual admin is built on this system, not Snipcart.** It edits `products.json` / `colors.json` / `shipping.json`, and shows orders from the D1 order API.
- Snipcart stays live until the owner approves the tested Stripe replacement. Its next billing date is 2026-10-18.

## Checkout status (2026-09-26)

- Snipcart runs in **Test mode** (the key in `settings.json` is a test key), on live as well.
- Snipcart's API answers every session request with **HTTP 402** ("log into Snipcart's dashboard to see why the cart isn't working"). **The website cart doesn't open for anyone.** It's an account or billing matter, not code.
- Until both are fixed, the website can't take a real order; Etsy is the only working sales channel.

## Images with generated-image credentials

9 PNGs in `assets/img` carry embedded content credentials (C2PA) that identify them as produced by a generative image tool. **Never strip this metadata.** Converting them to JPEG did, and was reverted.

| File | Where it appears |
|---|---|
| `stickers.png`, `chatgpt-image-jul-18-2026-at-08_09_47-pm.png` | Gallery → "Stickers & Decals" tile (photo 1 and 2) |
| `76f8fb34…`, `d9d80561…`, `c8915207…`, `89fc02fb…`, `c9685fc5…` | Gallery → "Custom Apparel" tile (photos 1–5) |
| `8f0aa63d…` | Sale banner background (`settings.json` → `saleBannerImage`); not shown since the banner ended 2026-09-07 |
| `7a616a6a…` | Not used anywhere |

Every photo currently in the Gallery is one of these. The owner will choose replacements with real Lacci product photos; don't delete them before that.

## Brand rules

- Palette: Espresso #2B1D12, Champagne Gold #D4A43A, Warm Beige #F5EFE6, Taupe #A79D8F, Champagne #E8D8BF, ivory backgrounds. The CSS also uses walnut/gold/linen tokens from the original guidelines; keep them.
- Type: Cormorant Garamond (headings), Montserrat (body), Pinyon Script (script personalization only).
- Voice: warm, plain, specific. Avoid "elevate", "thoughtfully curated", "perfect for every occasion", "where creativity meets", "unlock", "endless possibilities", "stunning".
- Feel: premium, minimal, editorial, handmade, giftable. Not a print-on-demand template, and not quote-first.
- Name story: **Lacci = La (Lana) + cci (Chibby).** Don't invent who Lana and Chibby are.
- **Never invent reviews.** Show only real reviews, verbatim, with source, date and first name as the source shows it.
- Don't advertise products or services that aren't available. Hide them (`hidden` attribute / `"hidden": true`); don't delete them.
- Standard products are bought directly. Quotes are only for bulk, business, unusual or one-off work.

## How to hide / reactivate things

- Embroidery / Laser Engraving: search the HTML for `data-status="coming-soon"`. Delete the `hidden` attribute to show them again (home cards, services cards, footer links on 6 pages). Re-add the two `<option>`s to the Contact form select.
- A product: /admin → Shop → product → "Hide this product from the shop" (`"hidden": true`).
- An option choice: /admin → product → Options → choice → "Hidden from customers".
- A garment colour: /admin → product → Garment colours → "Visible to customers" on/off. New colours go in /admin → Garment Colours.
- Two hidden products point at images that don't exist (`assets/img/gal-gifts.jpg`, `assets/img/product-gifts.jpg`). Fix or remove those references before un-hiding them.
- A gallery item: remove its photos/video, or delete the item.

## Rules for making changes

1. Work on a branch; publish by merging to `main` only with the owner's go-ahead.
2. Replace text with anchored, exactly-once replacements. Refuse on zero or multiple matches.
3. After a change:
   - `node --check` every script.
   - Check that tag balance holds on every page.
   - Run `node tools/build-snipcart-catalog.mjs` if products changed.
   - Drive the page in a browser, including the customizer and add-to-cart.
4. Inventory controls (links, buttons, inputs) before and after, and explain every difference.
5. Count before and after (bytes, broken images, controls). No single-run timing claims.
6. No tool or vendor names, provenance statements or machine paths in files or commits. **Don't add tool-specific instruction files to the repo**; this document is the entry point. Keep third-party licence notices. Never strip content-provenance metadata (C2PA) from images: 9 images in `assets/img` carry it. Ask the owner first.
7. Never commit customer data. Order details stay in Snipcart and Etsy.

## Outstanding tasks

See `AUDIT-2026-09.md` §8 (decisions), §9 (bugs), §10 (next steps), §15 (information needed), and `ADMIN_AUDIT.md` §5 (admin phases A–F).

## Decision log

| Date | Decision |
|---|---|
| 2026-09-26 | `laccistudio-web` confirmed as the live source; the old copies are archives |
| 2026-09-26 | Snipcart validation page generated at deploy time from `products.json` |
| 2026-09-26 | Personalization: typed text **or** an uploaded file is enough to add to cart |
| 2026-09-26 | Embroidery and Laser Engraving hidden site-wide until launch |
| 2026-09-26 | Shop-first calls to action; custom orders kept on Contact |
| 2026-09-26 | Mockups capped at 1200 px; shop cards use 720 px JPEG copies. Gallery/banner images left untouched: they carry content-provenance metadata, and compressing them is the owner's decision |
| 2026-09-26 | Editor script pinned to decap-cms 3.16.3 with an integrity hash |
| 2026-09-26 | Visual editor approved in principle (ADMIN_AUDIT §4). Starts on its own branch **after** the stabilization branch is published and verified |
| 2026-09-26 | Garment colours: global library + per-product visible flags; White only visible. Option choices can be hidden the same way |
| 2026-09-26 | No tool-named files in the repository (owner preference) |
| 2026-09-26 | Whether Snipcart stays is undecided. The visual editor must not depend on Snipcart; it edits provider-neutral content only |
