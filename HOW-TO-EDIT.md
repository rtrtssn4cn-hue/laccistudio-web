# How to edit the Lacci Studio website

The earlier version of this guide pointed at `site-config.js` and `shop-config.js`. Those files were never loaded by the site and have been removed. Here is what actually works today.

## Everyday edits: laccistudio.com/admin
1. Open **laccistudio.com/admin** and click **Login with GitHub**.
2. Choose what to edit:
   - **Shop — Products & Prices**: product name, base price, photos, description, category, shipping weight.
   - **Gallery — Our Work**: photos, captions, categories.
   - **Homepage Text**: headline, intro, welcome section.
   - **Contact & Settings**: email, social links, sale banner.
3. Click **Publish**. The live site updates in about 1–2 minutes.

Things to know:
- **Saving publishes immediately.** There is no draft yet.
- **Option prices** (sizes, coaster sets, finishes) are under each product → Options. A choice has either a full price (e.g. Set of 4 = 24.99) or an extra charge (e.g. Glitter +3). The "from" price shown in the shop is the cheapest visible choice.
- **Hide without deleting:** product → "Hide this product from the shop"; a choice → "Hidden from customers"; a garment colour → switch "Visible to customers" off.
- Leave **Checkout mode** set to `snipcart` until the Stripe checkout is approved (see `docs/COMMERCE.md`); then it becomes `stripe`.
- **Orders** placed through the new Stripe checkout are at **laccistudio.com/admin/orders.html** (log in to /admin first).
- Product categories are free text: spell them the same way every time, or a second filter button appears.

## What can't be edited in the admin yet
Navigation, footer, homepage sections and their order, services, About and FAQ. These are HTML or data edits for now; the plan to make them editable is in `docs/ADMIN_AUDIT.md`.

## If something goes wrong
Every change is saved in GitHub history. Any file can be restored to an earlier version; `docs/PROJECT.md` explains how.

## More detail
- `docs/PROJECT.md`: how the site works, where everything lives, and the rules for changes.
- `docs/AUDIT-2026-09.md`: the September 2026 audit.
- `docs/PRICING-2026-09.md`: pricing research and recommendations.
