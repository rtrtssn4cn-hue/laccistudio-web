# How to Edit Your Lacci Studio Website

## ⭐ Easiest way: the visual editor at laccistudio.com/admin
Once it's switched on (one-time setup — see **TURN-ON-VISUAL-EDITOR.md**), you edit everything visually with a live preview and a **Publish** button:
- **Shop — Products & Prices** — names, prices, per-size prices, photos, descriptions; add/remove/reorder products.
- **Homepage Text** — the headline, intro, and quote.
- **Contact & Settings** — email, phone, hours, social links, and payment mode.

No code, no files. This is the recommended way. Everything below is the manual alternative (editing the files directly) if you ever want it — behind the scenes, the editor just updates the files in the `content/` folder.

---

## Manual editing (optional)

You can also change things by editing the files directly — no coding needed.

---

## 1. Your contact info, hours & social links — edit ONE file

Open **`assets/js/site-config.js`** in any text editor (TextEdit, Notepad, or VS Code).
Change the text between the quote marks `" "`. Save. Done — it updates on **every page** automatically.

```js
email: "info@laccistudio.com",     ← your business email
phone: "",                        ← type your number, e.g. "(555) 123-4567"
hoursWeekday:  "By appointment",  ← Monday–Friday hours
hoursSaturday: "By appointment",  ← Saturday hours
hoursSunday:   "Closed",          ← Sunday hours
instagram: "",                    ← paste your Instagram link
facebook:  "",                    ← paste your Facebook link
etsy:      ""                     ← paste your Etsy link
```

Tips:
- Leave a value empty (`""`) to **hide** it. Empty phone hides the phone row; an empty social link hides that icon.
- Keep the quote marks and the comma at the end of each line.

---

## 2. Headlines & paragraphs — edit the page files

Each page is a plain file you can open in a text editor:

| File | What's on it |
|------|--------------|
| `index.html` | Home page (hero, services preview, gallery, story teaser) |
| `services.html` | Full list of services |
| `about.html` | Your story, the name story, the logo story, mission |
| `contact.html` | Contact details, inquiry form, FAQ |

To change wording, find the text you want to change and type over it — **only edit the words**, not the tags around them.

**Example** — to change the main headline, open `index.html` and find:

```html
<h1>Your Design,<br><span>Beautifully Crafted.</span></h1>
```

Edit only the words:

```html
<h1>Handmade,<br><span>Just for You.</span></h1>
```

(Leave the `<h1>`, `<br>`, and `<span>` pieces alone — those control the styling. `<br>` just starts a new line.)

**Safe rule of thumb:** text lives *between* the `>` and `<` symbols. Change what's between them; don't touch the `<...>` parts.

---

## 3. Swap in your real photos — just replace the file

Every image is an **easy swap slot**: save your photo with the **exact same file name** into `assets/img/`, and it appears automatically. No code, no config changes. Keep the current placeholder as a backup if you like.

### Shop product photos (`assets/img/`)
Landscape photos around **1200 × 750** look best (they can be square too).

| File name to replace | This is the photo for… |
|----------------------|------------------------|
| `product-tumbler.jpg` | Personalized Tumbler |
| `product-mug.jpg` | Personalized Mug |
| `product-apparel.jpg` | Custom Apparel |
| `product-gifts.jpg` | Personalized Gifts |
| `product-coasters.jpg` | Ceramic Coaster Set |
| `product-cutting-board.jpg` | Engraved Cutting Board |
| `product-ornament.jpg` | Personalized Ornament |
| `product-stickers.jpg` | Custom Stickers & Decals |

> Example: to show a real photo of your coasters, save it as **`product-coasters.jpg`** in `assets/img/` (replacing the placeholder). Done.

### Homepage gallery photos (`assets/img/`)
Same idea — replace any of: `gal-drinkware.jpg`, `gal-coasters.jpg`, `gal-embroidery.jpg`, `gal-engraving.jpg`, `gal-desk.jpg`, `gal-stickers.jpg`, `gal-apparel.jpg`, `gal-packaging.jpg`, `gal-gifts.jpg` (about **900 × 700**).

> Tip: to line up multiple product shots quickly, drop them all into `assets/img/` first, then rename each to match the slot it belongs to.

---

## 4. Your Shop — products, prices & photos

Open **`assets/js/shop-config.js`**. Each product is a block like this:

```js
{
  id: "sublimation-tumbler",           ← a short unique name (no spaces)
  name: "Personalized Tumbler",        ← shown to customers
  price: 27.99,                        ← just the number
  image: "assets/img/product-tumbler.jpg",
  category: "Drinkware",
  description: "Insulated tumbler fully printed with your design.",
  options: { label: "Size", choices: ["20 oz Skinny", "30 oz"] }  // or:  options: null
},
```

- **Change a price** → edit the number after `price:`.
- **Change a photo** → drop your image into `assets/img/` and point `image:` to it (square photos ~800×800 look best).
- **Add a product** → copy one whole `{ ... }` block, paste it, and give it a new `id`. Keep the comma between blocks.
- **Remove a product** → delete its `{ ... }` block.
- **Variants** (size/color) → edit the `choices` list, or set `options: null` for none.
- **Different price per size** → make a choice an object with its own price, e.g.
  `choices: [ { name: "Single", price: 8.99 }, { name: "Set of 6", price: 34.99 } ]`.
  The card then shows "from $8.99" and the price updates when the customer picks a size (see the Ceramic Coaster Set for a working example). Plain text choices like `"Small"` just use the product's base price.

### Customers submitting their design
In the cart, each item has a **Personalization** box (names/initials/text), a variant dropdown, and a **"+ Add your design / photo"** upload. What the customer types and the file they choose travel into their order. (Kept in the cart so the product grid stays compact.)

- **Default (no setup):** the order email lists their personalization and the design file name, and asks them to attach the file to the email that opens. Works right now.
- **Automatic file delivery (recommended once you're live):** make a free form at **formspree.io**, copy its endpoint, and paste it into `uploadEndpoint` in `shop-config.js`. Then design files are uploaded and emailed to you automatically at checkout — no attaching needed.

### Taking payments
At the bottom of `shop-config.js` is the `checkout` section. It ships in **`"inquiry"`** mode — customers' carts are emailed to you as an order request and you invoice them. This works right now with no account.

When you're ready for automatic card payments, change `mode` to:
- **`"paypal"`** — make a free PayPal Business account, paste your Client ID into `paypalClientId`. Takes PayPal + cards.
- **`"snipcart"`** — make a Snipcart account, paste your public key into `snipcartApiKey`. Routes to Stripe, PayPal, or Square (the "all options" route).

Just tell me which one and I'll help you finish connecting it.

## 5. Your logo

Your main logo is **`assets/logo/lacci-primary.png`** — unchanged, just with a see-through background. Please don't rename it. Other versions (symbol only, gold reverse) live in the same folder.

---

## 6. Please read — designs & the law (protect your shop)

Only list products showing designs you **own or created**. Do **not** put licensed or trademarked artwork on your public listings — this includes:

- Sports teams & leagues (MLB/Astros, NFL, NBA logos & jerseys)
- Disney, Marvel, cartoon & movie characters
- Brand logos (Nike, Louis Vuitton, etc.)
- Celebrity photos and other people's artwork

Selling these is trademark/copyright infringement and is the most common reason personalization shops get suspended or hit with takedowns. Your **own husky illustrations and any design a customer supplies** are fine — for customer-supplied art, it's the customer's responsibility that they have the rights, which the order form makes clear.

---

## 7. Preview your changes
Double-click any `.html` file to open it in your browser and see your edits.

## Good to know
- Always keep a backup copy of a file before editing, just in case.
- If something looks broken after an edit, you probably changed a `<tag>` by accident — undo (Ctrl/Cmd + Z) and try again.
- Want help with bigger changes (new sections, connecting the form to your inbox, going live)? Just ask.
