/* =========================================================================
   LACCI STUDIO — YOUR SHOP (edit this one file)
   -------------------------------------------------------------------------
   1) PRODUCTS: add / edit items below. Copy a { ... } block to add more.
   2) CHECKOUT: choose how customers pay (see the bottom of this file).
   Prices are plain numbers (dollars). Images live in assets/img/.
   ========================================================================= */

window.LACCI_SHOP = {

  currency: "USD",
  currencySymbol: "$",

  /* ----------------------------- PRODUCTS -----------------------------
     Tip: the "options" list is the dropdown customers pick from in the cart.
     Add or remove choices freely — great for offering many styles per item. */
  products: [
    {
      id: "sublimation-tumbler",
      name: "Personalized Tumbler",
      price: 27.99,
      image: "assets/img/product-tumbler.jpg",
      category: "Drinkware",
      description: "Insulated tumbler fully printed with your design, name, or monogram.",
      options: { label: "Size", choices: ["20 oz Skinny", "30 oz", "40 oz", "12 oz Kids"] }
    },
    {
      id: "sublimation-mug",
      name: "Personalized Mug",
      price: 18.99,
      image: "assets/img/product-mug.jpg",
      category: "Drinkware",
      description: "11 oz ceramic mug printed with your photo, pet portrait, or artwork.",
      options: null
    },
    {
      id: "custom-apparel",
      name: "Custom Apparel",
      price: 24.99,
      image: "assets/img/product-apparel.jpg",
      category: "Apparel",
      description: "Your design on shirts, hoodies, hats & more — sublimation or vinyl.",
      options: { label: "Garment", choices: ["T-Shirt", "Long-Sleeve Tee", "Hoodie", "Crewneck Sweatshirt", "Tank Top", "Youth Tee", "Dad Cap", "Trucker Hat", "Beanie", "Tote Bag", "Apron"] }
    },
    {
      id: "sublimation-gifts",
      name: "Personalized Gifts",
      price: 6.99,
      image: "assets/img/product-gifts.jpg",
      category: "Gifts",
      description: "Pick your item — your photo or design on a keepsake. Priced per item.",
      // Each item has its own price; the total updates when the customer picks one.
      options: { label: "Item", choices: [
        { name: "Bookmark", price: 6.99 },
        { name: "Fridge Magnet", price: 7.99 },
        { name: "Can Cooler / Koozie", price: 8.99 },
        { name: "Keychain", price: 9.99 },
        { name: "Photo Print", price: 9.99 },
        { name: "Bag Charm", price: 10.99 },
        { name: "Luggage Tag", price: 10.99 },
        { name: "Compact Mirror", price: 11.99 },
        { name: "Socks", price: 14.99 },
        { name: "Mouse Pad", price: 14.99 },
        { name: "Notebook / Journal", price: 16.99 },
        { name: "Zip Pouch", price: 16.99 },
        { name: "Phone Case", price: 19.99 },
        { name: "Jigsaw Puzzle", price: 21.99 },
        { name: "Pillow Cover", price: 24.99 }
      ] }
    },
    {
      id: "ceramic-coasters",
      name: "Ceramic Coaster Set",
      price: 8.99,
      image: "assets/img/product-coasters.jpg",
      category: "Home",
      description: "Personalized ceramic coasters with cork backing — buy one or a set.",
      // Each choice can set its own price. Leave price off to use the base price above.
      options: { label: "Quantity", choices: [
        { name: "Single", price: 8.99 },
        { name: "Set of 4", price: 24.99 },
        { name: "Set of 6", price: 34.99 },
        { name: "Set of 8", price: 44.99 },
        { name: "Set of 10", price: 52.99 },
        { name: "Set of 12", price: 60.99 }
      ] }
    },
    {
      id: "personalized-ornament",
      name: "Personalized Ornament",
      price: 16.99,
      image: "assets/img/product-ornament.jpg",
      category: "Gifts",
      description: "Custom keepsake ornament with names, dates, or a photo.",
      options: { label: "Shape", choices: ["Round", "Heart", "Star", "Snowflake", "Bauble"] }
    },
    {
      id: "custom-stickers",
      name: "Custom Stickers & Decals",
      price: 9.99,
      image: "assets/img/product-stickers.jpg",
      category: "Stickers",
      description: "Vinyl stickers & decals cut from your artwork — indoor or weatherproof.",
      options: { label: "Type", choices: ["Die-Cut", "Kiss-Cut", "Sticker Sheet", "Holographic", "Glitter", "Clear / Transparent", "Waterproof Vinyl", "Car Decal", "Laptop Decal", "Tumbler Decal"] }
    }
  ],

  /* ----------------------------- CHECKOUT -----------------------------
     Choose ONE mode:

     "inquiry"  → (default, works right now, no account needed)
                  Checkout sends the full cart to your email as an order
                  request. Great to launch with; you invoice for payment.

     "paypal"   → Real card + PayPal checkout, no separate server needed.
                  Make a free PayPal Business account, get your Client ID
                  (developer.paypal.com), and paste it below. Accepts
                  PayPal balance AND debit/credit cards.

     "snipcart" → Real checkout that can route to Stripe, PayPal, OR Square.
                  Make a Snipcart account, paste your PUBLIC API key below.
                  (This is the "all payment options" route.)
  --------------------------------------------------------------------- */
  checkout: {
    mode: "inquiry",                 // "inquiry" | "paypal" | "snipcart"
    orderEmail: "info@laccistudio.com",// where inquiry orders are sent
    paypalClientId: "",              // paste your PayPal Client ID for "paypal" mode
    snipcartApiKey: "",              // paste your Snipcart PUBLIC key for "snipcart" mode

    // Optional: lets customers UPLOAD design files that get emailed to you.
    // Make a free form at formspree.io, then paste its endpoint here, e.g.
    // "https://formspree.io/f/abcdwxyz". If left blank, customers still add
    // personalization notes and are prompted to email their design file.
    uploadEndpoint: ""
  }

};
