# Lacci Studio — Website

A responsive, multi-page website built to your Brand Guidelines v1.0 (palette, typography, voice, and logo story).

## Open it
Double-click **`index.html`** to preview in any browser. All pages are linked together.

## Pages
- `index.html` — Home (hero, services, how-it-works, gallery, name-story, CTA)
- `shop.html` — Product shop with add-to-cart and checkout
- `services.html` — Full services list + why-us + how-it-works
- `about.html` — Our story, the name story, the logo story, mission & values
- `contact.html` — Contact info, inquiry form, and FAQ

## Shop & cart
A real cart (add items, change quantities, subtotal) works out of the box and persists as customers browse. Products, prices, and photos are all edited in one file: `assets/js/shop-config.js`. Checkout ships in **"inquiry"** mode (orders are emailed to you — no account needed) and upgrades to live card payments via **PayPal** or **Snipcart** (which routes to Stripe/PayPal/Square) by pasting in a key. Full instructions are in `HOW-TO-EDIT.md`.

> Note: real card processing always requires a payment account (PayPal/Snipcart/Stripe/Square) — a website alone can't charge cards. Once you pick one, I can help finish the connection.

## Brand assets (`assets/logo/`)
- `lacci-primary.png` — **your main logo, unchanged**, now with a transparent background
- `lacci-symbol.png` — symbol only (two-tone), transparent — for favicons, watermarks, social
- `lacci-symbol-gold.png` — all-gold reverse symbol for dark backgrounds
- `lacci-primary-gold.png` — all-gold reverse full logo (used in the dark footer)
- `favicon.png` / `favicon.ico` — browser tab icon

## Colors used (from your guidelines)
Walnut Brown `#311A11` · Signature Gold `#D9A83E` · Soft Ivory `#F9F1E9` · White `#FFFFFF`
Warm Linen `#F5EFE8` · Sandstone `#D8C7B7` · Taupe `#B79C87` · Mocha `#7A5B46` · Espresso `#4A3126`

## Fonts
Cormorant Garamond (headings) + Montserrat (body), loaded from Google Fonts. The logo art itself is kept exactly as supplied — never retyped.

## Editing your site
**See `HOW-TO-EDIT.md` for a full plain-English walkthrough.** Quick version:

1. **Contact info, hours & social links** — edit the single file `assets/js/site-config.js`. Change the values, save, and it updates on every page automatically. Leave a value empty (`""`) to hide it.
2. **Headlines & paragraphs** — open any `.html` page in a text editor and type over the words (leave the `<tags>` alone).
3. **Gallery images** — replace each `gal-*.jpg` in `assets/img/` with your real product photos (same filename, ~900×700) and they drop straight in.

## The inquiry form
The form opens the visitor's email app with all details pre-filled to your address (no server needed). To collect submissions automatically instead, connect a free form service (e.g. Formspree) — happy to set that up.

## Going live
This is a static site — host it free on Netlify, Cloudflare Pages, or GitHub Pages (drag-and-drop the folder), or with your domain host.
