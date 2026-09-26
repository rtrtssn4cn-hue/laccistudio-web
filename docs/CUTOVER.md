# Production cutover plan: Snipcart → Stripe Checkout

Status: **prepared, not deployed.** Nothing is deployed until the owner says **DEPLOY**. Snipcart stays active and paid until the new checkout is verified. Its next billing date is **2026-10-18**.

```
OLD:  Browser → Cloudflare (static site) → Snipcart cart/checkout (+$20/month minimum) → Stripe (…VQlh)
NEW:  Browser → Cloudflare (static site + Lacci checkout worker + D1 orders) → Stripe Checkout (…VQlh)
```

---

## 1. Configuration only the owner can enter

Sensitive values are typed only into Stripe or Cloudflare by the owner. They never go into chat, the repository, logs or documents.

### Stripe LIVE (account "Lacci Studio LLC — Snipcart", …VQlh)
| # | Where | What | Sensitive? |
|---|---|---|---|
| S1 | Settings → Tax → Head office | Business address used for Texas sourcing | **Yes: owner only** |
| S2 | Tax → Registrations → Add → United States → Texas → Sales tax | Choose **Start collecting immediately** at launch. Stripe can't backdate; the permit's real effective date stays in the owner's records | Registration details: **owner only** |
| S3 | Settings → Tax → Preset product tax code | **General – Tangible Goods** (the checkout also sends item and shipping codes) | No |
| S4 | Settings → Tax → default tax behavior | **Exclusive** (tax added on top), matching checkout | No |
| S5 | Tax → Texas → "Set up automatic filing" | **Leave off.** Paid add-on, not approved | — |
| S6 | Settings → Payment methods | Optional extra safety: turn off Link, Cash App Pay, Affirm, Klarna and bank/ACH. Checkout already restricts these per session (cards only, Link hidden) | No |
| S7 | Settings → Emails → "Successful payments" | Turn **on** customer receipts | No |
| S8 | Developers → Webhooks → Add endpoint | URL `https://laccistudio.com/api/stripe/webhook`; events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Copy the **signing secret** (whsec_…) straight into Cloudflare (C3) | **Yes: owner only** |
| S9 | Developers → API keys → **Create restricted key** | Recommended instead of the full secret key. Permissions: **Checkout Sessions: Write**, **Shipping rates: Read** (everything else None). Paste it straight into Cloudflare (C2). Never rotate, reveal or change the existing live keys used by Snipcart until Snipcart is cancelled | **Yes: owner only** |
| S10 | Products → Coupons / Promotion codes | Only if still wanted: recreate SALE55 / OPENINGSALE55. The sale banner references SALE55 | No |

### Cloudflare
| # | Where | What | Sensitive? |
|---|---|---|---|
| C1 | Workers & Pages → D1 → Create database `lacci-orders` | Send the **database id** (not secret); it goes into `wrangler.toml` | No |
| C2 | Workers & Pages → `laccistudio` → Settings → **Runtime variables and secrets** (the first section on the page, not the "Variables and secrets" box under Build) → Add → **Secret** `STRIPE_SECRET_KEY` | Live restricted key from S9 (use the sandbox key first for the rehearsal in §3) | **Yes: owner only** |
| C3 | Same place → **Secret** `STRIPE_WEBHOOK_SECRET` | Signing secret from S8 | **Yes: owner only** |
| C4 | ~~API token for GitHub Actions~~ | **Not needed.** Deploys come from Cloudflare's own Git connection (Workers Builds). The GitHub workflow was removed 2026-09-26 | — |

`TAX_MODE = "stripe_tax"`, `SITE_URL`, `ADMIN_GITHUB_REPO` and `UPLOAD_HOSTS` are already set in `wrangler.toml` (not secret).

### Snipcart (before cancelling)
| # | What |
|---|---|
| N1 | Orders → **Export as .CSV** (all statuses). Save outside the repository (it contains customer details) |
| N2 | Open SNIP-1001 → print or save as PDF (includes custom fields and artwork links) |
| N3 | Screenshot or record the settings being replaced: shipping methods, tax, discounts (already documented in COMMERCE.md) |

## 2. Exact files that change on DEPLOY (merge `stripe-checkout` → `main`)

This merge also publishes the **stabilization changes** approved earlier in the session, which were never deployed separately:
- single coaster $6.99, text-only orders, White-only shirts;
- the customer-facing fixes, SEO, sitemap/robots and image thumbnails.

| Area | Files |
|---|---|
| Pages | `index.html`, `shop.html`, `services.html`, `gallery.html`, `about.html`, `contact.html`, **new** `order-confirmed.html` |
| Admin | `admin/config.yml`, `admin/index.html`, **new** `admin/orders.html` |
| Scripts | `assets/js/boot.js`, `assets/js/cart.js`, `assets/js/main.js`, **new** `assets/js/pricing.mjs`, **new** `assets/js/checkout.mjs`; removed `assets/js/shop-config.js`, `assets/js/site-config.js` (never loaded) |
| Styles | `assets/css/styles.css` |
| Content | `content/products.json`, `content/colors.json` (new), `content/shipping.json` (new), `content/gallery.json`, `content/home.json` |
| Checkout backend (not served) | `worker/index.js`, `worker/stripe.js`, `migrations/0001_orders.sql`, `wrangler.toml` |
| Snipcart (kept for rollback) | `snipcart-products.html` (generated) |
| Build and deploy | Cloudflare Workers Builds, build command `node tools/predeploy.mjs` (secret check, then Snipcart catalog); deploy command `npx wrangler deploy`. `.assetsignore`, `.gitignore` |
| SEO | `robots.txt`, `sitemap.xml` |
| Images | 33 new shop thumbnails (`assets/img/card/`), 23 mockups resized; originals of provenance-tagged images untouched |
| Not published | `docs/`, `tools/`, `worker/`, `migrations/`, `.github/` (excluded by `.assetsignore`) |

`content/settings.json` → `checkoutMode` stays **"snipcart"** on deploy. Customers keep using Snipcart until step D6.

## 3. Deployment sequence (after the owner says DEPLOY)

| Step | Action | Check |
|---|---|---|
| D0 | Owner completes C1–C4 (sandbox key in C2 first), S8 in **sandbox**, N1–N2 | D1 id in `wrangler.toml`; secrets listed in Cloudflare (values hidden) |
| D1 | Merge `stripe-checkout` → `main`, push; Cloudflare Workers Builds publishes. **Done 2026-09-26.** Order tables created by hand in the D1 console (Cloudflare's build doesn't run migrations) | Live version = the merge; 0% errors |
| D2 | Live site still on **Snipcart**: browse all pages, add a coaster in Snipcart, open cart | No regressions; the coaster price validates |
| D3 | **Production rehearsal in sandbox mode:** on laccistudio.com with `?checkout=stripe`, place one order with Stripe's success test card and a Texas test address | Real webhook delivered to production; order in `/admin/orders.html` shows paid with tax; totals match |
| D4 | Owner switches Cloudflare secrets to **live** values (C2 live restricted key, C3 live signing secret from S8 in live) and completes S1–S4, S7 in live | Nothing customer-facing changes yet (still Snipcart) |
| D5 | **One small real order** with `?checkout=stripe` (e.g. a $6.99 coaster), owner's own card, then refund it in Stripe | Paid order in admin; Stripe shows live payment; refund issued. Cost: the ~$0.50 processing fee is not returned by Stripe |
| D6 | Set `checkoutMode` to **stripe** in /admin → Contact & Settings (a commit; deploys in ~1–2 min) | Every page: the cart button opens the new cart; no Snipcart script loads |
| D7 | Watch for 7 days (or through the first real order) | Orders arrive in admin; webhooks green in Stripe |
| D8 | Remove Snipcart code (§6) in a separate change; then the owner cancels Snipcart **before 2026-10-18** after N1–N2 | Snipcart no longer referenced anywhere |

## 4. Rollback sequence

| Situation | Fastest rollback | Time |
|---|---|---|
| Stripe checkout misbehaves after D6 | /admin → Contact & Settings → **Checkout mode = snipcart** → Publish. Customers go back to Snipcart, with the corrected, auto-generated Snipcart price file | ~2 min |
| Something breaks the whole site after D1 | Cloudflare → Workers & Pages → `laccistudio` → **Deployments → Rollback** to the previous version | Instant |
| Need to undo the code in git | `git revert -m 1 <merge commit>` and push (redeploys the previous site) | ~3 min |
| Need the exact pre-audit site | Tag `live-2026-09-26` (note: that version has the coaster price mismatch, so coaster checkout fails there) | ~3 min |

Rollback to Snipcart only works while the Snipcart subscription is active and the Snipcart code is still in the site. **That's why §6 happens only after D7, and cancellation after that.**

## 5. Historical order preservation

1. **SNIP-1001** (2026-08-06, $73.04, real, paid through Stripe …VQlh): never modified or deleted; never used as test data.
2. Before cancelling Snipcart: N1 (CSV of all orders) and N2 (SNIP-1001 PDF), stored privately by the owner, **not** in the public repository.
3. The Stripe payment record for SNIP-1001 stays in Stripe permanently, whatever happens to Snipcart.
4. Artwork links in old orders point to Uploadcare; they keep working while the Uploadcare files exist. Don't delete Uploadcare files referenced by any real order.
5. Optional later: import the CSV into D1 as read-only `legacy_snipcart` rows so old orders show in `/admin/orders.html`. Not built.

## 6. Snipcart dependencies removed only after D7

See `COMMERCE.md` §9. In short:
- `initSnipcart()`, `snipAdd()`, `customFieldDefs()`, the `snipcart.ready` handlers and the `SNIPCART` flag in `assets/js/cart.js`;
- Snipcart CDN script and CSS v3.7.1;
- `#snipcart` / `.snipcart-*` CSS in `styles.css`;
- `snipcartApiKey` and the `snipcart` checkout mode in `content/settings.json`, `boot.js` and `admin/config.yml`;
- `snipcart-products.html`, `tools/build-snipcart-catalog.mjs` and its deploy step;
- the robots.txt line;
- the HOW-TO-EDIT wording;
- in the Snipcart dashboard: domain, shipping, tax, discounts;
- in Stripe: disconnect the Snipcart platform from …VQlh (owner, after cancellation).

## 7. Final pre-launch checklist

- [ ] C1 D1 database created; id in `wrangler.toml`
- [x] C4 not needed (Cloudflare Git deploys)
- [ ] C2/C3 secrets set (sandbox for D3, live for D4 onward)
- [ ] S8 webhook endpoint created (sandbox, then live) with the four events
- [ ] S1–S4 live Stripe Tax: head office, Texas registration (collect immediately), General – Tangible Goods, exclusive
- [ ] S5 automatic filing **off**
- [ ] S7 customer receipts on
- [ ] Payment methods: cards + eligible Apple Pay / Google Pay only (enforced in checkout; optionally also in the dashboard)
- [ ] Local Delivery hidden (`enabled: false`)
- [ ] Shipping rates labelled PROVISIONAL in `content/shipping.json`; owner accepts them for launch or supplies packed weights
- [ ] N1/N2 Snipcart export and SNIP-1001 PDF saved privately
- [ ] Sandbox key rotated once more after testing (the current one was shown in a terminal)
- [ ] Owner has logged into /admin and opened `/admin/orders.html` once, to confirm access
- [ ] D2–D5 verified before D6

## 8. Known limitations at launch
- Shipping prices are the legacy Snipcart bands based on unverified product weights (PROVISIONAL); coaster sets don't scale weight with set size.
- Local Delivery is unavailable.
- Artwork stays on Uploadcare (unguessable links; not private-by-authentication).
- No automatic owner email per order beyond Stripe's payment notification (Stripe → Settings → Communication preferences).

## 9. Deploy pipeline (as found on 2026-09-26)
- Deploys come from **Cloudflare Workers Builds**: Cloudflare's Git connection to `rtrtssn4cn-hue/laccistudio-web`, production branch `main`.
- Build command: `node tools/predeploy.mjs`. It runs the secret check first, then rebuilds the Snipcart catalog, and any failure stops the deploy.
- Deploy command: `npx wrangler deploy`.
- The GitHub Actions workflow never had a Cloudflare token and failed on every push, so it was removed.
- Database migrations aren't run by the build. New tables or columns are applied once in the D1 console (Workers & Pages → D1 → lacci-orders → Console) using the SQL in `migrations/`.

