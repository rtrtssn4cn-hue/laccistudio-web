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
| 2026-09-26 | Owner set the coaster base to $6.99 in /admin; the "Single" option still says $8.99 | Awaiting decision: $6.99 or $8.99 single (PRICING §6) |
| 2026-09-26 | Recommended: identical prices on Etsy and website; no permanent "sale" pricing; revisit a direct-site perk when the website sells over ~$1k/month | Recommendation |
| – | Internal costs (blanks, ink, paper, packaging, labor, reprints) | **Not yet provided.** All price recommendations are provisional. |

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
- A product: `"hidden": true` in `content/products.json` (not yet editable in /admin; see ADMIN_AUDIT).
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
6. No tool or vendor names, provenance statements or machine paths in files or commits. Keep third-party licence notices. Never strip content-provenance metadata (C2PA) from images: 9 images in `assets/img` carry it. Ask the owner first.
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
| 2026-09-26 | Proposed: keep GitHub + Decap as the backend and build a visual editor on top of the real pages (ADMIN_AUDIT §4). Awaiting owner approval. |
