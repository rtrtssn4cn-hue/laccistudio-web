# Commerce: Snipcart → Stripe Checkout on Cloudflare

Status (2026-09-26): **built and tested on branch `stripe-checkout` against a simulated Stripe. Real Stripe sandbox tests and production cutover have not happened.** Snipcart is still the live checkout.

Snipcart's next billing date is **2026-10-18** (Standard plan, $20 monthly minimum). The goal is to have Stripe live and verified before then, with margin.

---

## 1. What Snipcart does today (inventory)

| Area | How it works now | Replacement |
|---|---|---|
| Cart | Snipcart side cart (CDN script + CSS v3.7.1), opened by the header cart button | `assets/js/checkout.mjs` cart drawer (browser storage), same drawer styling as the site |
| Price validation | Snipcart crawls `snipcart-products.html` and compares prices | Worker recalculates every line from `content/products.json` with `assets/js/pricing.mjs`; browser prices are ignored |
| Product options and quantity modifiers | Custom fields with `[+x.xx]` modifiers | Same option data (choice full price or extra charge), priced by `pricing.mjs` |
| Personalization text, font, colour, placement, proof, comments | Snipcart custom fields | Stored per line on the order (D1), shown in admin |
| Uploaded artwork | **Not stored by Snipcart.** Browser uploads straight to Uploadcare; Snipcart only holds the link | Unchanged: links stored on the order. Back artwork was never sent to Snipcart (bug); fixed |
| T-shirt sizes and colours | Option dropdown + garment-colour field (only White visible) | Same visibility rules, enforced on the server |
| Shipping | Snipcart custom methods by order weight: Ground $8.95/11.95/14.95/19.95/44.95, Priority $12.95/15.95/19.95/25.95/54.95 (≤454 g / ≤1361 g / ≤2268 g / ≤4536 g / more), free Local Delivery for Houston ZIPs | Same methods and bands in `content/shipping.json`, offered as Stripe shipping options. Local delivery can't be hidden by address in hosted Checkout, so out-of-area picks are flagged on the order |
| Taxes | Snipcart custom tax "TX SALES TAX" 8.25% for TX addresses, on items after discounts | Stripe tax rate (8.25%, US-TX) applied by shipping address ("dynamic tax rates"). **No Stripe Tax fee** |
| Discounts | Codes SALE55 (55%, used once) and OPENINGSALE55 (55%, single use, unused) | Stripe promotion codes (checkout shows a code box). **Codes must be created in Stripe** (sandbox and live) |
| Customer information | Collected by Snipcart checkout | Collected by Stripe Checkout (name, email, phone, US shipping address) |
| Order confirmation page | Snipcart's own | `/order-confirmed.html` (shows order number, items, totals once the server confirms payment) |
| Emails | Snipcart email templates (customer receipt, owner notification) | Stripe receipt emails (turn on in Stripe settings) + Stripe "successful payment" notifications to the owner. See §6 |
| Abandoned carts | Snipcart dashboard section exists; no recovery campaigns seen | Unpaid sessions stay as `pending`/`expired` orders in admin. No automatic recovery emails |
| Order history | Snipcart dashboard: 1 order, SNIP-1001 (2026-08-06, $73.04, paid). **Real order, keep permanently** | New orders in D1 via admin Orders page; Snipcart history archived before cancellation (§8) |
| Webhooks | None configured in Snipcart | Stripe webhook → `/api/stripe/webhook` |
| Payment processor | Snipcart → Stripe account "Lacci Studio LLC — Snipcart" (…VQlh) | Same Stripe account, direct |
| Admin dependencies | /admin Settings: checkout mode, Snipcart key; sale-banner promo code | Checkout mode gains `stripe`; promo code must exist in Stripe |
| Snipcart-specific product attributes | `snipcart-products.html`, `data-item-*` buttons, `[+x.xx]` tokens | Removed after cutover (§9). Tokens remain only as internal select values in the customizer |

## 2. New architecture

```
Browser: shop.html → customizer (cart.js) → cart drawer (checkout.mjs, prices via pricing.mjs)
    │ POST /api/checkout {lines: product, qty, options, colour, personalization, file links}
    ▼
Cloudflare Worker (worker/index.js, same "laccistudio" worker that serves the site)
    ├─ loads content/products.json, colors.json, shipping.json from its own deployed files
    ├─ re-prices every line with pricing.mjs; refuses hidden products/options/colours, bad quantities, foreign file links
    ├─ writes a 'pending' order to D1 (order number LS-1001, LS-1002, …)
    └─ creates a Stripe Checkout Session (server-side secret key) → redirect to Stripe
Stripe Checkout (hosted) → customer pays → /order-confirmed.html?session_id=…
    ├─ Stripe webhook → /api/stripe/webhook (signature checked; event ids stored; order updates guarded) → order 'paid'
    └─ confirmation page → /api/order-status → if still pending, the worker asks Stripe directly and applies the same idempotent update
Admin: /admin/orders.html → /api/admin/orders (GitHub login; repo write access required)
```

**One source of truth:** `content/products.json` (edited in /admin) → used by the shop display, the cart, and the server price check through the same `pricing.mjs`. There's no second price file in the Stripe flow.

### Files
| File | Purpose |
|---|---|
| `worker/index.js` | API routes: checkout, webhook, order status, admin orders |
| `worker/stripe.js` | Stripe REST calls, webhook signature check |
| `assets/js/pricing.mjs` | Pricing and availability rules (browser + server) |
| `assets/js/checkout.mjs` | Cart drawer and checkout call (Stripe mode only) |
| `order-confirmed.html` | Customer confirmation page |
| `admin/orders.html` | Owner's order list: items, personalization, artwork links, address, amounts, suggested box, fulfil/notes |
| `migrations/0001_orders.sql` | D1 tables `orders`, `stripe_events` |
| `content/shipping.json` | Shipping methods and bands, TX tax rate, packaging rules, real shipping history |
| `tools/worker-local.mjs` | Run the worker on this computer (SQLite instead of D1) |
| `tools/test-commerce.mjs` | Automated test suite (simulated Stripe) |

### Switching modes
- `content/settings.json` → `checkoutMode`: `snipcart` (today) or `stripe`. Editable in /admin.
- Try Stripe on any page without switching everyone: add `?checkout=stripe` to the URL (remembered for that browser tab; `?checkout=default` clears it). Used for the production smoke test.
- Rollback while Snipcart is still paid for: set `checkoutMode` back to `snipcart`.

## 3. Security
- **Prices:** the worker never uses a browser price. `expectedUnitCents` is only compared: a mismatch returns HTTP 409 with the real prices, and no payment is created. Tested with a $1.00 tumbler (tests 14–15), and by deliberately breaking the check, which the suite then caught.
- **Secrets:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` live only as Cloudflare secrets (and in a local `.dev.vars` file that git and the public site both ignore). Nothing secret is in the repo or the browser.
- **Webhooks:** HMAC-SHA256 signature with a 5-minute tolerance; every event id is stored; order updates only apply to `pending` orders. So a replayed or re-delivered event can't create or re-apply an order (tests 17, 19).
- **Paid means paid:** an order becomes `paid` only from a signed Stripe event, or from the worker's own authenticated call to Stripe that reports `payment_status: paid`.
- **Admin:** `/api/admin/*` requires a GitHub token with write access to the repo (the same login as /admin). Customer text is always rendered as text.
- **Public status page** shows the order number, items, totals and a masked email only. No address, personalization or file links (test 27).
- **Artwork:**
  - Uploadcare file links carry random UUIDs.
  - Listing files needs the Uploadcare secret key. Checked: the public key alone gets HTTP 401, and a guessed file id gets 404.
  - The worker only accepts file links from the Uploadcare CDN hosts.
  - Remaining exposure: anyone who has a link can open that file.
  - Fully private option: move uploads to a private Cloudflare R2 bucket served only through the admin. R2's free tier covers this volume, but Cloudflare asks for a payment method to enable R2. **Owner decision; not built.**
- Input limits: 25 lines, quantity 1–50, 1,000 characters per text field, 64 KB request.

## 4. Cloudflare free tier (no paid products needed)
| Service | Free allowance | Expected use |
|---|---|---|
| Workers (Free plan) | 100,000 requests/day, 10 ms CPU per request | Static pages are served without running the worker; only /api calls count (a few per order) |
| Static assets | Free, unlimited requests | The whole site |
| D1 | 5 GB, 5M rows read/day, 100k rows written/day | A handful of rows per order |
| Secrets | Free | 2 secrets |
| R2 (optional, for private uploads) | 10 GB free | Needs a payment method on file |

Stripe: 2.9% + $0.30 per successful US card charge. No monthly fee. Tax rates are free (not Stripe Tax).

## 5. Stripe account findings (read-only, 2026-09-26)
| Entry in the account switcher | What it is | Notes |
|---|---|---|
| **Lacci Studio LLC — "Snipcart"** (…VQlh) | Live Stripe account connected to Snipcart | It received the real Snipcart payment (USD balance $70.62 = SNIP-1001 $73.04 minus Stripe's $2.42 fee). Snipcart's payment attempts appear here ("Order placed on store Lacci Studio LLC."). Has its own API keys. 1 bank account linked. Payouts: **Manual** |
| Lacci Studio LLC — sandbox (…16Tu) | Stripe sandbox (test-only copy) shown under the Snipcart account | For testing |
| Lacci Studio LLC (…x7z2) | Separate live account | No payments, $0 balance, 1 bank account linked. Not connected to Snipcart as far as the dashboard shows |

**Recommendation:** use **…VQlh** for the direct integration, with a sandbox for testing. It's the proven, activated account paying into the owner's bank. Snipcart is just a connected platform there; disconnecting it later doesn't affect the account. Leave …x7z2 unused and decide separately whether to close it.

**The $70.62 balance:** with Manual payouts, money stays in the Stripe balance until the owner clicks "Pay out funds". The migration doesn't need anything done about it; the balance is unaffected by switching from Snipcart to direct Checkout on the same account. Paying out, or switching to automatic payouts, is the owner's choice. Not changed.

## 6. Still to do before production (owner actions marked ★)
1. ★ Put the **sandbox** secret key in `.dev.vars` on this computer. Don't paste it into chat; see §7. Then run the real sandbox tests (§7).
2. ★ In the sandbox: create promotion codes if you want them for testing; turn on customer receipt emails (Settings → Emails).
3. ★ Cloudflare dashboard: create D1 database `lacci-orders`; share its id (not secret) so it goes in `wrangler.toml`; then run the migration.
4. ★ Cloudflare dashboard → worker `laccistudio` → Settings → Variables → add secrets `STRIPE_SECRET_KEY` (sandbox first) and `STRIPE_WEBHOOK_SECRET`.
5. ★ Stripe (sandbox first): Developers → Webhooks → endpoint `https://laccistudio.com/api/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
6. Deploy with Snipcart still default; smoke-test with `?checkout=stripe` in sandbox mode on laccistudio.com (webhook delivered for real).
7. ★ Approve live: swap the secrets to live values, create SALE55 / OPENINGSALE55 as live promotion codes if still wanted, turn on live receipts.
8. One small live smoke order (for example, a single coaster, refunded afterwards), only with the owner's approval.
9. Set `checkoutMode` to `stripe`; verify no Snipcart request on any page; then it's safe to cancel Snipcart (after §8).

Order notification e-mail to the owner beyond Stripe's own payment notification isn't built. Cloudflare Email Routing could send one for free later.

## 7. Real sandbox test (pending the sandbox key)
Create `.dev.vars` without the key passing through chat. In Terminal, in the repo folder:

```bash
read -s -p "Paste the Stripe SANDBOX secret key (sk_test_...): " K && printf 'STRIPE_SECRET_KEY=%s\nSTRIPE_WEBHOOK_SECRET=whsec_local_replay_only\n' "$K" > .dev.vars && unset K && echo " saved"
```

Then `node tools/worker-local.mjs` (it refuses to start with a live key). Planned tests:
- a card payment with Stripe's success test card and one with the decline test card;
- events fetched from the Stripe sandbox and replayed, signed, into the webhook handler (Stripe can't reach this computer);
- refresh and retry of the confirmation page;
- tax on a Texas address;
- a promo code, if created.

## 8. Snipcart history: archive before cancelling
1. ★ Snipcart dashboard → Orders → **Export as .CSV** (all statuses). Keep the file privately, **not in this public repository** (it holds customer details). SNIP-1001 must be in it.
2. ★ Also save SNIP-1001's order page as PDF (it shows custom fields, including artwork links).
3. The payment record stays in Stripe (…VQlh) permanently, whatever happens to Snipcart.
4. Optional: import the CSV rows into D1 as read-only `legacy_snipcart` orders, so they show in the admin next to new orders. Not built yet; never altered.
5. Artwork links in old orders point to Uploadcare and keep working as long as the Uploadcare account keeps those files.

## 9. Snipcart removal checklist (after the Stripe cutover is verified)
| Item | Where |
|---|---|
| Snipcart script `https://cdn.snipcart.com/themes/v3.7.1/default/snipcart.js` and CSS `…/snipcart.css` | `assets/js/cart.js` `initSnipcart()` |
| `#snipcart` container, `snipcart-checkout`/`snipcart-items-count` cart button, `snipcart.ready` handlers (discount-box fix, stale-cart removal) | `assets/js/cart.js` |
| `snipAdd()`, `customFieldDefs()`, `valueFor()`, hidden `.snipcart-add-item` buttons | `assets/js/cart.js` (keep `snipToken()` or rename it; the customizer uses its strings as select values) |
| `SNIPCART` mode flag and its branches | `assets/js/cart.js` |
| Snipcart CSS overrides (`#snipcart`, `.snipcart-*`) | `assets/css/styles.css` (about lines 524–540 and 727) |
| `snipcartApiKey`, `checkoutMode: "snipcart"` | `content/settings.json`, `assets/js/boot.js`, `admin/config.yml` |
| Price-validation page | `snipcart-products.html` |
| Generator and build step | `tools/build-snipcart-catalog.mjs`, and its call in `tools/predeploy.mjs` (keep the secret check) |
| robots entry | `robots.txt` `Disallow: /snipcart-products.html` |
| Admin wording | `HOW-TO-EDIT.md` ("leave checkout mode set to snipcart") |
| Snipcart dashboard: domain laccistudio.com, shipping methods, TX tax, discounts, email templates | Snipcart account (cancel after export) |
| Stripe → Snipcart connection on …VQlh | Stripe → Settings → connected platforms (disconnect only after cancellation, owner approval) |

## 9b. Open decisions: tax and payment methods (owner to decide; nothing deployed)

Sources and details: `research/texas-tax-stripe-fees-2026-09.md`. This is a summary of published rules, not tax or legal advice.

### How Snipcart taxes today
- One custom rule: "TX SALES TAX", US–TX, 8.25%. No other state.
- SNIP-1001 shows it charged on the item subtotal after the 55% discount ($67.47 × 8.25% = $5.57).
- That order had $0 shipping, so **whether Snipcart also taxed shipping can't be determined** from the settings viewed or the one order.

### What the Texas rules say (Comptroller sources)
| Situation | Rule found |
|---|---|
| Texas customer, shipped | Local tax is sourced to the seller's place of business (Pub. 94-105; Rule 3.334). Houston studio: 6.25% state + 1% City of Houston + 1% METRO = **8.25%**, already the 2% local maximum. Confirm the exact studio address in the Comptroller's rate locator (one Houston row in the table shows 7.25%). |
| Texas customer, local delivery | No separate rule; same sourcing. |
| Texas customer, pickup (if offered later) | Order taken in person: taxed at the seller's location. |
| Website orders specifically | **Unsettled:** a Comptroller amendment moving many online orders to delivery-address sourcing was permanently blocked by a Texas court (date, appeal and currently applicable text not confirmed). With Houston at the maximum rate, either reading gives ≤ 8.25%. |
| Shipping / delivery charges | **Taxable** when the item is taxable, even if stated separately (Rule 3.303; Pub. 94-171). |
| Personalized printed goods | Taxable at the full price including the customizing work (Rule 3.300); no exemption found. |
| Permit | A Texas seller of taxable items needs a sales tax permit (Rule 3.286). Filing monthly, quarterly, or yearly if under $1,000/year with approval. Whether a zero return is needed each period: to confirm. |
| Customers outside Texas | Economic-nexus thresholds are $100,000+ (some also 200 transactions) in every state that has one. **At Lacci's volume the business appears to be below all of them**, so no other state's tax should be collected unless that changes. In about 26 jurisdictions, Etsy sales count toward the seller's own threshold. |

### Implementation options
| | 1. Stripe Tax, Texas registration only | 2. Texas-only rate without Stripe Tax | 3. Embedded checkout with address callback |
|---|---|---|---|
| How | Turn on Stripe Tax, set the head office, add only a Texas registration; `TAX_MODE=stripe_tax` (already built). Shipping taxed with tax code `txcd_92010001` on the shipping rate | Ask the ship-to state on our site before checkout. If Texas, attach a fixed 8.25% rate to every line and charge shipping as a taxed line; otherwise no tax. Verify the state on the paid order | Replace hosted Checkout with the embedded form; on address change the server updates line items and taxes |
| Cost | **0.5% per taxed transaction, no monthly fee, no minimum** (about $0.15 on a $30 order; $0 in months without sales). No fee for orders outside Texas ("not collecting") | $0 | $0 |
| Accuracy | Stripe maintains rates and rules; handles the Texas origin rule; records per order for filing | Correct only while the 8.25% rate and the rules stay as coded; the customer's state entry can be wrong (flag and correct by hand) | Same as 2, but using the address the customer actually entered; wallets (Apple Pay, Google Pay) skip the callback |
| Maintenance | Low | Owner must watch rate and rule changes; shipping must be handled as a line item | Highest: more code, and this use is not shown in Stripe's guide |
| Customer experience | Unchanged | One extra question before checkout | Checkout embedded on our site |

**Recommendation for your review:** option 1 (Stripe Tax registered only in Texas, shipping taxable). It's the only option that stays correct without hand maintenance, costs nothing when there are no sales, and never collects for other states unless you add a registration. Before switching on, confirm with the Comptroller rate locator and your tax adviser: the studio's exact rate, the website-sourcing question, and your permit and filing status.

### Payment methods (US standard Stripe pricing)
| Method | Fee | Status on the branch |
|---|---|---|
| Cards | 2.9% + 30¢ (+1.5% international cards, +1% currency conversion) | **On** |
| Apple Pay / Google Pay | 2.9% + 30¢ (card wallets) | On with cards (hosted Checkout handles setup) |
| Link (card) | 2.9% + 30¢ | **Off** (`payment_method_types: ["card"]`) until approved |
| Cash App Pay | 2.9% + 30¢ | Off until approved |
| Affirm | 6% + 30¢ | **Off** (buy now, pay later) |
| Klarna | 5.99% + 30¢ | **Off** (buy now, pay later) |
| ACH / bank ("$5 back" offer) | ACH 0.8% capped at $5; the Link bank rate isn't on the pricing page | Off |

Other fees: disputes $15 (+$15 counter fee, refunded if won). Refunds cost nothing extra, but the original fee isn't returned. No extra fee for Checkout itself.

## 9c. Owner decisions (2026-09-26) and sandbox configuration

- **Tax:** Stripe Tax, Texas registration only, shipping taxable where required; no collection outside Texas until an obligation exists. Worker `TAX_MODE=stripe_tax`; items use tax code `txcd_99999999` (general tangible goods), shipping `txcd_92010001`, both tax-exclusive.
- **Sandbox registration:** Texas, state sales tax, entered by the owner in the sandbox dashboard. **Stripe can't backdate a registration** (API and dashboard both allow only "now" or a future date), so the sandbox registration starts on the test date. That's Stripe's collection-start date, not the permit's effective date. The live registration must reflect the owner's real registration information and is added only at launch, with the owner's approval.
- **Sandbox preset product tax code** still shows "Downloadable Software" in the dashboard. It doesn't affect this checkout (every item and shipping carries its own code). Recommended: change it to "General – Tangible Goods" before launch.
- **Payments:** cards only, which includes Apple Pay and Google Pay wallets (`payment_method_types: ["card"]`). **Link hidden** with `wallet_options.link.display = "never"`. Without that, Stripe still showed Link sign-up, "Link instant debit" **and Klarna through Link**, even with cards only. Cash App Pay, Affirm, Klarna and bank payments are off.
- **Shipping:** legacy Ground/Priority bands remain **PROVISIONAL** until real packed weights. Local Delivery hidden.
- **Automatic tax filing** (Stripe's paid filing add-on) isn't set up; the owner decides separately.

## 10. Test results (2026-09-26)

### Automated suite, simulated Stripe (`node tools/test-commerce.mjs`): 27 passed, 0 failed
| # | Test | Result |
|---|---|---|
| 1 | Single coaster $6.99 with text | PASS |
| 2 | Coaster quantities (Set of 4 ×2, Set of 8, Single ×3) | PASS |
| 3 | Coaster with uploaded artwork, no text | PASS |
| 4 | Artwork link from an unknown host refused | PASS |
| 5 | Mug 15 oz Color-Changing ×3 | PASS |
| 6 | Tumbler 30 oz Glitter | PASS |
| 7 | White T-shirt L, front and back, with front and back artwork | PASS |
| 8 | Every T-shirt size prices as shown (XS–3XL) | PASS |
| 9 | Hidden colour (Black) refused | PASS |
| 10 | Missing, invented or unknown options refused | PASS |
| 11 | Cart with four different products | PASS |
| 12 | Shipping bands by weight (Ground, Priority, Local), US only | PASS |
| 13 | TX 8.25% tax rate on every line, created once | PASS |
| 14 | Price tampering with a price hint ($1 tumbler) → 409, no payment created | PASS |
| 15 | Price tampering without a hint → Stripe charged the real $27.99 | PASS |
| 16 | Hidden or unknown product, bad quantities, nothing to print, empty cart | PASS |
| 17 | Webhook with a bad signature rejected; order unchanged | PASS |
| 18 | Paid webhook → order paid with name, email, address, shipping method, tax, total, suggested box | PASS |
| 19 | Same event twice + second event for the same session → one paid order | PASS |
| 20 | Declined card (never completes) stays unpaid; expiry and async failure recorded | PASS |
| 21 | Confirmation page before the webhook → server asks Stripe, confirms; refresh doesn't duplicate | PASS |
| 22 | Local delivery outside Houston flagged | PASS |
| 23 | Unknown or malformed session ids → not found | PASS |
| 24 | Admin: no login 401, read-only GitHub user 401, editor lists orders, fulfil flow, can't fulfil unpaid | PASS |
| 25 | Site files still served; worker source and secrets not served | PASS |
| 26 | Cart captured from the real browser flow → server → Stripe → paid order, all amounts equal | PASS |
| 27 | Public order status exposes no file links, personalization or address | PASS |

The suite catches regressions. With the price check and the signature check deliberately broken, tests 14, 15 and 17 fail.

### Amount chain (browser flow on this computer, then suite test 26)
| Line | Customizer | Cart | Server | Stripe line | Order record |
|---|---|---|---|---|---|
| Coaster, single | $6.99 | $6.99 | 699 | 699 | 699 |
| Coaster, set of 4 ×2 | $24.99 | $24.99 | 2499 | 2499 ×2 | 2499 |
| T-shirt L, White | $31.98 | $31.98 | 3198 | 3198 | 3198 |
| Subtotal | | $88.95 | 8895 | 8895 | 8895 |

### Other checks
- Default (Snipcart) mode is unchanged: the Snipcart script and cart button load, the Stripe cart stays inactive. Snipcart price definitions: 678 option combinations, 0 mismatches.
- Uploadcare: listing files with the public key → 401; a guessed file id → 404.

### Not yet run (needs the sandbox key, then deployment)
Real sandbox payment with success and decline test cards; real webhook delivery; real tax calculation on a Texas address; promo code; customer receipt email; admin page against real D1; production smoke test.

### Stripe Tax sandbox pass (2026-09-26, real sandbox, tax on)
| Test | Result | Evidence |
|---|---|---|
| Texas shipping address → tax | **PASS** | LS-1007: coaster $6.99 → $0.58, T-shirt $31.98 → $2.63, shipping $11.95 → $0.99; 8.25% Texas "standard_rated"; tax $4.20, total $55.12 |
| Tax on products and shipping | **PASS** | Shipping taxed ($0.99), as Texas Rule 3.303 requires; items-only would have been $3.22 |
| Non-Texas address → $0 | **PASS** | LS-1008 (Colorado test address): tax $0.00; Stripe reason "not_collecting" for item and shipping |
| Cards | **PASS** | Success test card paid LS-1007 and LS-1008 |
| Apple Pay / Google Pay | **Configured correctly** | Apple Pay button shown by Checkout on the real session in this browser (Chromium on macOS). Google Pay not shown here: this browser has no Google Pay wallet. Needs a Chrome profile with a saved Google Pay card or an Android phone to see it. Hosted Checkout runs on Stripe's domain, so no domain registration is needed |
| Disabled methods | **PASS** | Only Card (+ Apple Pay) offered; no Link, Klarna, Affirm, Cash App Pay or bank |
| Declined payment | **PASS** | Decline test card refused; LS-1009 stays pending; cart kept ("Decline test" mug, $18.99) |
| Successful payment → one paid order | **PASS** | One row per paid session |
| Duplicate webhook | **PASS** | Each real sandbox event delivered twice: second marked duplicate; 3 events, 3 paid orders |
| Totals identical | **PASS** | Cart $38.97 → server 3897 → Stripe subtotal 3897, shipping 1195, tax 420, total 5512 → order record identical |
