# Admin / CMS audit — September 2026

Status: **audit and proposal. The current admin has not been changed, apart from pinning its script version.**
Hands-on editing tests still need a signed-in session. The login opens a GitHub pop-up that only the owner can complete. Everything below comes from the admin configuration, the site code and the content files; those three together determine exactly what the admin can and cannot edit.

---

## 1. How it works today

```
Owner ──► laccistudio.com/admin  (Decap CMS 3.x, one static page)
            │ "Login with GitHub" pop-up
            ▼
        lacci-oauth.pupsride.workers.dev   (Cloudflare Worker: GitHub OAuth handshake)
            │ GitHub token (repo scope) stored in the browser
            ▼
        GitHub repo rtrtssn4cn-hue/laccistudio-web, branch main
            │ every Save = a commit straight to main
            ▼
        Cloudflare Workers Builds (Git connection; build command node tools/predeploy.mjs)
            │ builds snipcart-products.html from products.json (added 2026-09), then wrangler deploy
            ▼
        Cloudflare Worker "laccistudio" serving static files ──► laccistudio.com (live in ~1–2 min)
```

| Question | Answer |
|---|---|
| Where are products, prices, images stored? | `content/products.json` (all 45 products: name, price, options, images, weight, hidden flag). Image files in `assets/img/` and `assets/img/mock/`. |
| Other content | `content/home.json` (7 homepage text fields), `content/gallery.json`, `content/settings.json` (contact, social, sale banner, payment keys) |
| Hard-coded content | Everything else: navigation, footer, services cards, How-it-works, About, Contact, FAQ, all section order. Edited only in HTML. |
| How content loads | `assets/js/boot.js` fetches the four JSON files on every page view and hands them to `cart.js` (shop and customizer), `main.js` (contact and social) and `promo-banner.js` |
| Database | None. Git is the database. |
| Image uploads | Admin: into the repo (`assets/img`), full size, no resizing. Customers: design files go to Uploadcare with a public key. |
| Save → live | Save commits to `main`, which triggers the deploy. **No draft, no preview, no undo button** (history exists in git). |
| Auth | GitHub OAuth. Anyone with write access to the repo can edit. The OAuth Worker's code is not in this repo, so it could not be reviewed. |
| Checkout | Snipcart (cart + checkout), validated against `snipcart-products.html` |
| Orders | Snipcart dashboard only. Nothing in the admin. |
| Inventory | None (made to order) |
| Shipping | Per-product `weight` in grams; rates are set in the Snipcart dashboard (not visible from here) |

## 2. What is broken or confusing

> **Update 2026-09-26 (work branch):** the admin can now edit product options (with a per-choice "Hidden from customers" switch), hide or show whole products, and turn garment colours on or off per product from a shared colour library. See §7. Items 1 and 3 below are fixed on the branch; the rest stand.

### Broken
1. **Product options are invisible in the admin.** Every product's sizes, set sizes and their prices live in `optionGroups`, which the admin schema doesn't define. The admin shows an older "Choices" field that no product uses. Result: on 2026-09-26 the coaster price was edited to $6.99, but the "Single" option kept its own $8.99, so the shop still shows "from $8.99".
2. **Editing a price broke checkout.** Snipcart re-checks prices against `snipcart-products.html`, a hand-made file the admin can't touch. The same edit left it at $8.99, so Snipcart would reject coaster orders. **Fixed on the working branch:** the file is now generated from `products.json` on every deploy.
3. **Hide/show is invisible too.** `hidden` (used on 18 products) and `mockupPhoto` (33 products) aren't in the admin schema. Hiding or un-hiding a product means editing JSON.
4. **Settings mixes everyday and dangerous fields.** The same form holds the sale banner, contact email, the **checkout mode** (one wrong choice switches the store to e-mail orders), and payment keys.
5. **The Uploadcare key isn't editable** from the admin, and changes to it are needed if the account changes.
6. `HOW-TO-EDIT.md` told the owner to edit `site-config.js`, a file no page loaded (now removed).

### Confusing
- Products are one long list of 45 rows labelled "name — $price". No pictures, no status, no search.
- Fields describe the data, not the page: "Headline — line 2 (gold)", "Internal ID (leave as-is)".
- You can't see where a change will appear. There is no preview that looks like the site.
- Category is free text, so "Gifts" vs "Gift" silently creates a second filter button.
- The sale banner has 15 fields; dates are typed as text ("YYYY-MM-DD").
- Homepage sections, navigation, footer, FAQ, services and About can't be edited at all.
- No collections (Best Sellers, Pet Gifts, Christmas…), no reviews, no section order.
- Every save goes live immediately.

### Duplicated / hard-coded data
| Data | Where it lives | Problem |
|---|---|---|
| Product prices | `products.json` **and** `snipcart-products.html` | Drifted on 2026-09-26 (fixed: second copy now generated) |
| Contact email | `settings.json` + hard-coded in every page's HTML (overwritten by script) | Two sources; the HTML copy shows if scripts fail |
| Navigation and footer | copied into 6 HTML files | A nav change is six edits |
| Services list | homepage cards, services page cards, footer column, contact dropdown | Four places to hide "Embroidery" |
| Brand name / tagline / descriptions | every page head and footer | |
| Product list in `shop-config.js` | old copy with wrong prices (not loaded) | Removed 2026-09 |

## 3. Security review

| Item | Finding | Action |
|---|---|---|
| `/admin` is public | Expected. Nothing is editable without a GitHub login that has write access. | none |
| Editor script | Loaded from unpkg with a floating `^3.6.0` version and no integrity check, on the page that holds a repo-write token | **Fixed:** pinned to 3.16.3 with an integrity hash |
| Keys in `settings.json` | Snipcart public key, PayPal client ID, Uploadcare public key. All three are publishable by design, not secrets. | none |
| Secrets | Stripe keys live only as Cloudflare secrets; the build stops if a secret is ever committed (`tools/predeploy.mjs`) | none |
| `.github/` was served publicly | Workflow file visible at laccistudio.com/.github/… | **Fixed:** excluded from deploy |
| OAuth Worker | Code not in this repo. It should only send the token back to `https://laccistudio.com`. | **Owner to share the Worker code** for review |
| Customer uploads (Uploadcare) | Anyone with the public key can upload to the account. That's how it works, but it's open to abuse. | In Uploadcare: turn on signed uploads, or at least file-type and size limits |
| XSS | `boot.js`, `cart.js` and `promo-banner.js` escape text or use `textContent`. Only repo editors can write content. | none now; the new editor must keep escaping |
| Repo is public | All content and history are public. No personal data found in it. | Consider making it private; the Action and Decap both work with private repos |

## 4. Proposed architecture

Goal: **what you see while editing is the real website**, with no second copy of the design to keep in sync.

### Recommendation: keep the pipeline, add a visual editor on top

Keep: GitHub as storage, the GitHub login, the Action → Cloudflare deploy, Snipcart, and the JSON content files. All of this works and costs nothing.

Add:

**A. Content model (single source of truth)**
- `content/products.json`: add `status` (active / draft / hidden / coming-soon), `slug`, `shortDescription`, `badges`, `collections[]`, `bestSeller`, `seasonal`, `processingDays`, `seo {title, description, image}`, `imageAlts[]`. Quantity pricing stays as an option group labelled "Quantity", and is shown in the editor as a simple table (1 / 2 / 4 / 6 / 8 → price).
- `content/collections.json`: name, slug, image, product ids in order, status, show-on-homepage, season.
- `content/pages/home.json`: an ordered list of sections `{type, visible, …fields}`. Types: hero, best-sellers, collection-row, how-it-works, real-orders, reviews, story, custom-cta.
- `content/navigation.json`: header and footer links (label, destination, visible).
- `content/reviews.json`: display name, text (verbatim), rating, source, source URL, date, product. Entered by hand, never generated.
- `content/gallery.json`: add `status` and `productId` (drives the "Make yours" link).
- `content/settings.json`: split into `business.json` (everyday: contact, social, shipping and processing text, policies, announcement bar) and `advanced.json` (checkout mode, payment keys, analytics).
- The site's pages render these sections, nav and footer from JSON with the same `boot.js` pattern already in use. One change updates everywhere.

**B. Visual editor** (`/admin/editor.html`, loaded only on admin pages, never in the customer bundle)
- Loads the **real site pages** in an iframe with `?edit=1`. The site draws itself with its own CSS and scripts, so the preview can't drift from production.
- Editable elements carry `data-edit` markers (a section, a product card, a nav item). In edit mode a small script outlines them and shows "✏ Edit" on hover.
- Clicking one opens a side panel for that thing: hero, product, collection, gallery item, review, nav. Changes are sent into the iframe and redrawn instantly. Nothing is saved yet.
- Top bar: page picker, Desktop / Tablet / Mobile width toggle, Save draft, Publish, unsaved-changes guard.
- Products screen: a visual grid with search and status filters, the product editor (images drag-to-reorder with alt text, quantity-pricing table, options, status), and safe bulk actions (activate / hide / add to collection; no bulk price edits).
- Validation before save: price must be a number above zero, name required, warning when there's no image, warning on a button with no destination.
- Images: drag-and-drop upload. The browser resizes to a sensible maximum (2000 px) before committing and shows the recommended size. Originals stay in git history.

**C. Drafts, publish and history**
- **Save draft** commits to a `draft` branch. The editor previews draft content by reading the JSON from that branch, so no second website is needed.
- **Publish** merges `draft` into `main`, and the existing Action deploys it.
- **History**: each publish is a git commit. The editor shows "recent changes" and lets you restore an earlier version of a product, a page or the nav with one click (a new commit that brings back old content).
- Alternative with less custom code: turn on Decap's built-in `editorial_workflow` (Draft → In review → Ready, done with pull requests). It covers drafts in the current admin while the visual editor is built.

**D. Dashboard** (simple): Edit website · Products · Orders (link to Snipcart) · Real orders · Collections. Quick actions: add product, upload images, edit homepage, change announcement. Status: last published time and commit.

### Why not the alternatives
- **Decap alone.** Decap can use the site CSS in its preview pane, but its editing is form-first. It can't give click-on-the-page editing or section drag-and-drop without the custom layer above. Kept as the advanced/raw editor.
- **Move to Shopify / Squarespace / Wix.** You'd get a visual editor on day one, but it replaces the whole site, the customizer and the checkout, at $30–40+/month. That's the right answer only if the custom product customizer isn't worth keeping.
- **A hosted headless CMS (Sanity, Storyblok…).** Good visual editing, but it adds a second storage system, another account and a build step, and still needs the site's rendering reworked.

### Risks
| Risk | Mitigation |
|---|---|
| Content migration breaks the live shop | Migrate with a script and verify every product's price tokens are identical (the method used for the Snipcart catalog: 44/45 matched) |
| Editor writes invalid JSON | Validate before commit; the deploy step already fails on bad product data |
| Token in the browser (repo scope) | Same as Decap today. Keep only trusted collaborators; consider a private repo |
| Scope: this is several days of build | Ship in phases; each phase leaves the site working |

## 5. Phases

| Phase | Delivers | Needs owner decision first? |
|---|---|---|
| A | Content model above; site renders nav, footer, homepage sections, collections and reviews from JSON; admin schema fixed so options, status and quantity pricing are editable in the current admin; editorial workflow on | Which products stay active; collections to launch with |
| B | Products screen + product editor (visual grid, image manager, quantity-pricing table, statuses) | – |
| C | Visual page editor (iframe preview, click-to-edit, device toggle, section reorder) | – |
| D | Collections, gallery "Make yours" links, navigation and announcement editors, reviews | – |
| E | Draft / preview / publish, history restore, unsaved-changes guard | – |
| F | Validation, security (OAuth Worker review, Uploadcare limits), browser QA of all 11 tests in the brief | – |

## 6. What can be reused / replaced

| Reuse | Replace |
|---|---|
| GitHub storage, GitHub login and OAuth Worker, deploy Action, Snipcart, Uploadcare, `boot.js` loading pattern, `cart.js` customizer, CSS | Hand-copied nav, footer and sections in 6 HTML files; the form-only admin as the main editing tool (kept as "advanced"); the mixed settings form |

## 7. Visibility architecture (built 2026-09-26; the visual editor must keep it)

One reusable rule: **hiding never deletes.** Three levels, same idea:

| Level | Data | Admin control today | Visual editor (future) |
|---|---|---|---|
| Product | `products[].hidden` | "Hide this product from the shop" switch | Product card 👁 / ⊘ |
| Option choice (size, quantity, finish, set…) | `optionGroups[].choices[].hidden` (`visible: false` also accepted) | "Hidden from customers" switch per choice | PRODUCT → OPTIONS → choice 👁 / ⊘ |
| Garment colour | library `content/colors.json` `garmentColors[] {id, name, hex, method}` + per product `colors[] {id, visible}` in display order | Garment Colours library screen; per product a colour list with drag-to-reorder and a "Visible to customers" switch | PRODUCT → OPTIONS → COLOURS: ☰ reorder, swatch, 👁 Visible / ⊘ Hidden, add or edit colour |

Why the switches differ in sense: the admin's on/off widget shows "off" for a missing field. Option choices use `hidden` (missing = visible) so existing data can't be hidden by accident. Every colour entry stores `visible` explicitly, and new ones start hidden.

What customers get:
- Only visible products, choices and colours are shown.
- 1 visible colour is shown as plain text; 2 or more as swatches.
- The Snipcart catalog (`tools/build-snipcart-catalog.mjs`, run on every deploy) lists only visible choices and colours.
- Add-to-cart re-checks the chosen values against current data.
- Carts restored from an earlier visit lose lines whose option is no longer offered, with a message.

Tested 2026-09-26 in the editor itself, run locally in its offline test mode with the real content files:
- the T-shirt shows 17 named colours, White on;
- switching Black on and publishing changed exactly 1 value in `products.json` (all 45 products otherwise identical);
- the site then offered White + Black swatches and the preview recoloured to black;
- switching it back restored `products.json` and the Snipcart catalog byte-identically.

Found and fixed during that test: summary lines using `{{#if}}` aren't supported by the editor and showed raw template text. They now use its `ternary` / `default` filters.

Still to verify once Snipcart's account works: that Snipcart's server rejects an order carrying a hidden, non-priced value such as a colour. Price-bearing options are covered, because a hidden choice is missing from the catalog.

**Requirement for the rebuild:** the visual editor writes these same fields, previews through the same `boot.js` filtering, and keeps "hide" separate from "delete". The same pattern should later cover sizes, quantities, personalization options, seasonal designs and collections.

## 8. Checkout-provider independence (owner instruction, 2026-09-26)

Whether Snipcart stays isn't decided (it's in test mode, and its API currently returns HTTP 402). So the visual editor is **not** to be built around Snipcart:
- The editor reads and writes only provider-neutral content: `content/products.json` (prices, options, visibility), `content/colors.json` and the page/section files. No Snipcart fields, IDs or concepts in the editor UI or data model.
- Everything Snipcart-specific stays behind two seams that a different checkout (Shopify Buy Button, Stripe Checkout / Payment Links, Square, etc.) would replace:
  1. `tools/build-snipcart-catalog.mjs`: turns products.json into Snipcart's validation page.
  2. The Snipcart section of `assets/js/cart.js`: `snipAdd()`, `customFieldDefs()`/`snipToken()` formatting, `initSnipcart()`, and the cart-restore check.
- Price rules (full price vs extra charge per choice), visibility and validation belong to the content model, not the provider. Any future provider adapter must reproduce them.
- The dashboard's "Orders" link points to whichever provider is chosen.
